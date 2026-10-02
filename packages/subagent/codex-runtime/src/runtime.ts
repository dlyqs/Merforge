/** Persistent personal-native Codex connection with one current turn and owned teardown. */
import { brandString } from '@deepseek-ai/dsh-brand'
import type { Readable, Writable } from 'node:stream'
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'
import { JsonRpcLineTransport } from './jsonrpc.ts'
import { codexAppServerArgv, disposeCodexProcess } from './process.ts'
import { parseAccount, parseModels, parseThread, protocolObject, protocolString } from './protocol.ts'
import type {
  CodexAccount, CodexCapabilities, CodexFailureCategory, CodexItemId, CodexModel, CodexRuntimeDiagnostic,
  CodexRuntimeSpec, CodexSendReceipt, CodexSendRequest, CodexThread,
  CodexThreadId, CodexThreadSelection, CodexTurnEvent, CodexTurnId, CodexTurnTerminal,
} from './types.ts'

/** Redacted failure with a fixed category; raw wire/Host errors are never copied. */
export class CodexRuntimeError extends Error {
  constructor(readonly category: CodexFailureCategory) {
    super(`codex-runtime: ${category}`)
    this.name = 'CodexRuntimeError'
  }
}

interface ActiveTurn {
  id?: CodexTurnId
  readonly started: PromiseWithResolvers<CodexTurnId>
  readonly terminal: PromiseWithResolvers<CodexTurnTerminal>
  readonly early: Array<{ method: string; params: Record<string, unknown> }>
  readonly items: Map<CodexItemId, Readonly<Record<string, unknown>>>
  readonly onEvent?: (event: CodexTurnEvent) => void
  sent: boolean
  itemBytes: number
  timer?: ReturnType<typeof setTimeout>
}

/**
 * Validated fixed runtime limits, usable by a caller's Config resolver.
 * @param spec - fully resolved subprocess and protocol settings.
 */
export function validateCodexRuntimeSpec(spec: CodexRuntimeSpec): void {
  for (const value of Object.values(spec.limits)) {
    if (!Number.isSafeInteger(value) || value <= 0 || value > 2_147_483_647) throw new Error('codex-runtime: invalid limit')
  }
  if (spec.limits.modelPageSize > 4_294_967_295) throw new Error('codex-runtime: invalid page size')
}

/**
 * Native protocol owner. It never writes Harness Sessions or grants controlled tools.
 * Call {@link dispose} for every successful open; failures also dispose the child.
 */
export class CodexRuntime {
  /** Protocol support does not assert native isolation or organization eligibility. */
  readonly capabilities: CodexCapabilities
  /** Process exit facts remain observable independently of terminal and cleanup outcomes. */
  readonly processOutcome: Promise<import('@deepseek-ai/dsh-subprocess').SubprocessOutcome>
  private readonly child: SubprocessHandle
  private readonly transport: JsonRpcLineTransport
  private readonly lifetime = new AbortController()
  private ready = false
  private selection: CodexThreadSelection | undefined
  private thread: CodexThread | undefined
  private preparingThread = false
  private active: ActiveTurn | undefined
  private cache: { expiresAt: number; account: CodexAccount; models: readonly CodexModel[] } | undefined
  private catalogRevision = 0
  private disposal: Promise<void> | undefined

  constructor(private readonly spec: CodexRuntimeSpec, child: SubprocessHandle, input: Readable, output: Writable) {
    this.capabilities = Object.freeze({ version: '0.153.4', persistentText: spec.experimentalApi,
      controlledTools: false, organizationExecution: false, completeModelLog: false, perModelRequestPermit: false,
      steering: false, fork: false, attachments: false })
    this.child = child
    this.processOutcome = child.done.catch(() => { throw new CodexRuntimeError('startup') })
    void this.processOutcome.catch((error: unknown) => { void error })
    this.transport = new JsonRpcLineTransport(input, output, {
      maxFrameBytes: spec.limits.maxFrameBytes, strict: true,
    })
    this.transport.onFailure((error) => {
      this.fail(new CodexRuntimeError(error.message.includes('frame-limit') ? 'frame-limit' : error.message.includes('input closed') ? 'eof' : 'protocol'))
    })
    // The runtime refuses every server request until a separately verified human/tool bridge exists.
    this.transport.onRequest(() => Promise.reject(new Error('unsupported server request')))
    this.transport.onNotification((method, params) => { this.notification(method, params) })
    this.child.stderr?.on('data', this.drainStderr)
    this.child.stderr?.on('error', this.ignoreStderrError)
    void this.child.done.then(async () => {
      // Preserve an already queued authoritative terminal independently of process exit.
      await new Promise<void>((resolve) => { setImmediate(resolve) })
      this.fail(new CodexRuntimeError('process'))
    }, () => { this.fail(new CodexRuntimeError('startup')) })
    this.transport.start()
  }

  /**
   * Complete initialize/initialized before exposing business operations.
   * @param signal - preparation cancellation, detached after initialization.
   */
  async initialize(signal?: AbortSignal): Promise<void> {
    if (this.ready) throw new CodexRuntimeError('protocol')
    this.report({ stage: 'initialize' })
    const response = protocolObject(await this.rpc('initialize', { clientInfo: { name: 'merforge', title: 'Merforge', version: '0.1.7' },
      capabilities: { experimentalApi: this.spec.experimentalApi, requestAttestation: false } }, this.spec.limits.startupTimeoutMs, signal))
    protocolString(response.userAgent)
    protocolString(response.platformFamily)
    protocolString(response.platformOs)
    protocolString(response.codexHome)
    this.transport.notify('initialized')
    await this.bounded(this.transport.flush(), this.spec.limits.startupTimeoutMs, signal)
    this.assertOpen()
    this.ready = true
    this.report({ stage: 'ready' })
  }

  /**
   * Invalidate picker availability after config, auth or limit changes.
   * @returns the new catalog revision, preventing stale in-flight cache publication.
   */
  invalidateCatalog(): number {
    this.cache = undefined
    return ++this.catalogRevision
  }

  /**
   * Read safe account availability and all visible model pages together.
   * @param refresh - bypass the bounded cache without changing native login state.
   * @returns a safe account/model snapshot; no account email or credentials.
   */
  async catalog(refresh = false): Promise<{ account: CodexAccount; models: readonly CodexModel[] }> {
    this.assertReady()
    if (!refresh && this.cache !== undefined && this.cache.expiresAt > Date.now()) return this.cache
    const revision = refresh ? this.invalidateCatalog() : this.catalogRevision
    try {
      const account = parseAccount(await this.rpc('account/read', { refreshToken: false }))
      const models: CodexModel[] = []
      const cursors = new Set<string>()
      let cursor: string | null = null
      for (let page = 0; page < this.spec.limits.maxModelPages; page++) {
        const response = parseModels(await this.rpc('model/list', { cursor, limit: this.spec.limits.modelPageSize, includeHidden: false }))
        for (const model of response.models) {
          if (models.some(existing => existing.id === model.id)) throw new CodexRuntimeError('protocol')
          models.push(model)
        }
        cursor = response.cursor
        if (cursor === null) {
          if (revision !== this.catalogRevision) throw new CodexRuntimeError('protocol')
          const snapshot = Object.freeze({ account: Object.freeze(account), models: Object.freeze(models),
            expiresAt: Date.now() + this.spec.limits.modelCacheMs })
          this.cache = snapshot
          return snapshot
        }
        if (cursors.has(cursor)) throw new CodexRuntimeError('protocol')
        cursors.add(cursor)
      }
      throw new CodexRuntimeError('protocol')
    } catch (error) {
      this.invalidateCatalog()
      throw error instanceof CodexRuntimeError ? error : new CodexRuntimeError('protocol')
    }
  }

  /**
   * Start one persistent personal-native thread, refusing unverified modes.
   * @param selection - explicit native model and effort.
   * @returns verified persistent thread identity and configuration.
   */
  async startThread(selection: CodexThreadSelection): Promise<CodexThread> {
    return this.prepareThread(selection, undefined)
  }

  /**
   * Read then resume an exact persistent binding without history/path overrides.
   * Consumer must separately recheck account generation, ownership and log baseline.
   * @param threadId - previously persisted native identity.
   * @param selection - original model/effort, never a fallback.
   * @returns the resumed thread only after exact configuration checks.
   */
  async resumeThread(threadId: CodexThreadId, selection: CodexThreadSelection): Promise<CodexThread> {
    return this.prepareThread(selection, threadId)
  }

  /**
   * Read complete legacy typed history, refusing a different cwd/version/identity.
   * @param threadId - native identity to reconcile.
   * @returns Host-only typed history; not a complete model request log.
   */
  async readThread(threadId: CodexThreadId): Promise<CodexThread> {
    this.assertReady()
    const thread = parseThread(await this.rpc('thread/read', { threadId, includeTurns: true }))
    if (thread.id !== threadId || thread.cwd !== this.spec.cwd) throw new CodexRuntimeError('protocol')
    return thread
  }

  /**
   * Reserve the sole current turn, commit its intent, then write turn/start once.
   * A failed response after writing is unknown and closes this connection; never retry it.
   * @param request - stable input identity, text and durable commit operation.
   * @param onEvent - optional transient observer; exceptions do not interrupt settlement.
   * @returns exact native IDs and a separate authoritative terminal promise.
   */
  async send(request: CodexSendRequest, onEvent?: (event: CodexTurnEvent) => void): Promise<CodexSendReceipt> {
    this.assertReady()
    const thread = this.thread
    const selection = this.selection
    if (thread === undefined || selection === undefined || this.active !== undefined) throw new CodexRuntimeError('protocol')
    if (request.texts.length === 0 || request.texts.every(text => text.trim().length === 0)) throw new CodexRuntimeError('protocol')
    const active: ActiveTurn = { started: Promise.withResolvers<CodexTurnId>(), terminal: Promise.withResolvers<CodexTurnTerminal>(),
      early: [], items: new Map(), sent: false, itemBytes: 0, ...onEvent === undefined ? {} : { onEvent } }
    void active.started.promise.catch((error: unknown) => { void error })
    void active.terminal.promise.catch((error: unknown) => { void error })
    this.active = active
    const params = Object.freeze({ threadId: thread.id, clientUserMessageId: request.inputId,
      model: selection.model, effort: selection.effort,
      input: Object.freeze(request.texts.map(text => Object.freeze({ type: 'text', text, text_elements: Object.freeze([]) }))) })
    try {
      await request.persistIntent(Object.freeze({ inputId: request.inputId, threadId: thread.id, method: 'turn/start', params }))
      this.assertReady()
      this.report({ stage: 'input-committed' })
      active.sent = true
      const response = protocolObject(await this.rpc('turn/start', params))
      active.id = brandString<CodexTurnId>(protocolString(protocolObject(response.turn).id))
      active.started.resolve(active.id)
      this.report({ stage: 'turn-accepted' })
      active.timer = setTimeout(() => { this.fail(new CodexRuntimeError('timeout')) }, this.spec.limits.turnTimeoutMs)
      for (const event of active.early.splice(0)) this.accept(active, event.method, event.params)
      return { inputId: request.inputId, threadId: thread.id, turnId: active.id, terminal: active.terminal.promise }
    } catch (error) {
      const failure = active.sent ? new CodexRuntimeError('unknown-send') : error
      active.started.reject(failure)
      active.terminal.reject(failure)
      if (active.sent) this.fail(new CodexRuntimeError('unknown-send'))
      else if (this.active === active) this.active = undefined
      throw failure
    }
  }

  /**
   * Interrupt the current turn first, then dispose the owned process range.
   * @returns cleanup completion; an observed terminal is never rewritten by cleanup failure.
   */
  async stop(): Promise<void> {
    const active = this.active
    try {
      if (active !== undefined && active.sent && this.thread !== undefined && !this.lifetime.signal.aborted) {
        const id = await this.bounded(active.started.promise, this.spec.limits.interruptTimeoutMs)
        await this.rpc('turn/interrupt', { threadId: this.thread.id, turnId: id }, this.spec.limits.interruptTimeoutMs)
        await this.bounded(active.terminal.promise, this.spec.limits.interruptTimeoutMs)
      }
    } catch (error) {
      // Protocol loss does not remove the subprocess owner's cleanup obligation.
      void error
    } finally {
      await this.dispose()
    }
  }

  /** Close protocol listeners and pending work synchronously before process cleanup. */
  close(): void { this.closeWith(new CodexRuntimeError('closed')) }

  private closeWith(reason: CodexRuntimeError): void {
    if (this.lifetime.signal.aborted) return
    this.lifetime.abort(reason)
    this.ready = false
    this.invalidateCatalog()
    this.transport.close()
    const active = this.active
    this.active = undefined
    if (active !== undefined) {
      clearTimeout(active.timer)
      active.started.reject(new CodexRuntimeError('closed'))
      active.terminal.reject(new CodexRuntimeError(active.sent ? 'unknown-send' : 'closed'))
      active.early.length = 0
    }
  }

  /**
   * Await whole-range quiescence exactly once, including automatic failure cleanup.
   * @returns process cleanup completion; cleanup failures are separately classified.
   */
  dispose(): Promise<void> {
    return this.disposal ??= (async () => {
      try {
        await disposeCodexProcess(this, this.child)
        this.report({ stage: 'cleanup' })
      } catch (error) {
        this.report({ stage: 'cleanup', category: 'cleanup' })
        void error
        throw new CodexRuntimeError('cleanup')
      } finally {
        this.child.stderr?.off('data', this.drainStderr)
      }
    })()
  }

  private report(diagnostic: CodexRuntimeDiagnostic): void {
    try { this.spec.onDiagnostic?.(diagnostic) } catch (error) {
      // Diagnostic sinks cannot change protocol or lifecycle outcomes.
      void error
    }
  }

  private readonly drainStderr = (): void => { /* Native stderr is discarded, never general diagnostics. */ }
  private readonly ignoreStderrError = (): void => { /* Protocol/process observations own failures. */ }

  private assertOpen(): void {
    if (this.lifetime.signal.aborted) throw this.lifetime.signal.reason
  }
  private assertReady(): void {
    this.assertOpen()
    if (!this.ready) throw new CodexRuntimeError('protocol')
  }
  private async prepareThread(selection: CodexThreadSelection, id: CodexThreadId | undefined): Promise<CodexThread> {
    this.assertReady()
    if (selection.mode !== 'native') throw new Error('codex-runtime: unsupported execution mode')
    if (!this.spec.experimentalApi) throw new Error('codex-runtime: persistent threads require experimental negotiation')
    if (this.preparingThread || this.thread !== undefined) throw new CodexRuntimeError('protocol')
    this.preparingThread = true
    let dispatched = false
    try {
      const catalog = await this.catalog(true)
      if (catalog.account.requiresOpenaiAuth && catalog.account.kind === 'none') throw new Error('codex-runtime: login required')
      const model = catalog.models.find(model => model.model === selection.model)
      if (model === undefined || !model.efforts.includes(selection.effort)) throw new Error('codex-runtime: unavailable model or effort')
      if (id !== undefined) {
        const read = await this.readThread(id)
        if (read.model !== selection.model || read.turns.some(turn => turn.status === 'inProgress')) throw new CodexRuntimeError('protocol')
      }
      const params = { cwd: this.spec.cwd, model: selection.model, approvalPolicy: 'never',
        ...id === undefined ? { ephemeral: false, historyMode: 'legacy', allowProviderModelFallback: false } : { threadId: id } }
      dispatched = true
      const thread = parseThread(await this.rpc(id === undefined ? 'thread/start' : 'thread/resume', params))
      if (thread.cwd !== this.spec.cwd || thread.model !== selection.model || (id !== undefined && thread.id !== id)) throw new CodexRuntimeError('protocol')
      this.thread = thread
      this.selection = Object.freeze({ ...selection })
      this.report({ stage: 'thread-bound' })
      return thread
    } catch (error) {
      if (dispatched) {
        const failure = new CodexRuntimeError('unknown-thread')
        this.fail(failure)
        throw failure
      }
      throw error
    } finally { this.preparingThread = false }
  }
  private async rpc(method: string, params: object, timeoutMs = this.spec.limits.rpcTimeoutMs, signal?: AbortSignal): Promise<unknown> {
    this.assertOpen()
    const timer = AbortSignal.timeout(timeoutMs)
    const signalParts = [this.lifetime.signal, timer, ...signal === undefined ? [] : [signal]]
    try {
      return await this.transport.request(method, params, AbortSignal.any(signalParts))
    } catch (error) {
      this.invalidateCatalog()
      const failure = this.lifetime.signal.aborted ? this.lifetime.signal.reason as CodexRuntimeError
        : new CodexRuntimeError(timer.aborted ? 'timeout' : 'rpc')
      // Wire errors are not diagnostics; a failed RPC does not publish stale availability.
      void error
      if (timer.aborted) this.fail(failure)
      throw failure
    }
  }
  private async bounded<T>(pending: Promise<T>, ms: number, signal?: AbortSignal): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined
    const cancellation = signal === undefined ? this.lifetime.signal : AbortSignal.any([signal, this.lifetime.signal])
    let onAbort = (): void => {}
    try {
      return await Promise.race([pending, new Promise<never>((_resolve, reject) => {
        onAbort = () => { reject(new CodexRuntimeError('closed')) }
        if (cancellation.aborted) { onAbort(); return }
        cancellation.addEventListener('abort', onAbort, { once: true })
        timer = setTimeout(() => { reject(new CodexRuntimeError('timeout')) }, ms)
      })])
    } finally {
      clearTimeout(timer)
      cancellation.removeEventListener('abort', onAbort)
    }
  }
  private fail(error: CodexRuntimeError): void {
    if (this.lifetime.signal.aborted) return
    const active = this.active
    if (active !== undefined) {
      active.started.reject(error)
      active.terminal.reject(error)
    }
    this.report({ stage: 'error', category: error.category })
    this.closeWith(error)
    void this.dispose().catch((cleanupError: unknown) => {
      // The owner can await dispose for the independent cleanup outcome.
      void cleanupError
    })
  }
  private retainItem(active: ActiveTurn, id: CodexItemId, item: Record<string, unknown>): void {
    const previous = active.items.get(id)
    const bytes = Buffer.byteLength(JSON.stringify(item))
    const replacedBytes = previous === undefined ? 0 : Buffer.byteLength(JSON.stringify(previous))
    if (active.itemBytes - replacedBytes + bytes > this.spec.limits.maxTurnBytes) throw new CodexRuntimeError('frame-limit')
    active.itemBytes += bytes - replacedBytes
    active.items.set(id, item)
  }
  private notification(method: string, params: Record<string, unknown>): void {
    if (method === 'account/updated' || method === 'account/rateLimits/updated' || method === 'config/updated') this.invalidateCatalog()
    const active = this.active
    if (active === undefined || !active.sent || params.threadId !== this.thread?.id) return
    if (!['turn/completed', 'item/completed', 'item/agentMessage/delta'].includes(method)) return
    if (active.id === undefined) {
      if (active.early.length >= this.spec.limits.maxEarlyEvents) { this.fail(new CodexRuntimeError('protocol')); return }
      active.early.push({ method, params })
      return
    }
    this.accept(active, method, params)
  }
  private accept(active: ActiveTurn, method: string, params: Record<string, unknown>): void {
    if (active !== this.active) return
    try {
      const turn = method === 'turn/completed' ? protocolObject(params.turn) : undefined
      if ((turn?.id ?? params.turnId) !== active.id) return
      if (turn !== undefined) {
        const status = turn.status
        if (status === 'failed') this.invalidateCatalog()
        if (status !== 'completed' && status !== 'interrupted' && status !== 'failed') throw new CodexRuntimeError('protocol')
        if (!Array.isArray(turn.items)) throw new CodexRuntimeError('protocol')
        for (const value of turn.items) {
          const item = protocolObject(value)
          this.retainItem(active, brandString<CodexItemId>(protocolString(item.id)), item)
        }
        const items = [...active.items.values()]
        const final = items.filter(item => item.type === 'agentMessage' && item.phase === 'final_answer').at(-1)
          ?? items.filter(item => item.type === 'agentMessage' && item.phase == null).at(-1)
        if (final !== undefined && typeof final.text !== 'string') throw new CodexRuntimeError('protocol')
        clearTimeout(active.timer)
        const terminal: CodexTurnTerminal = { turnId: active.id as CodexTurnId, status, items,
          finalText: final === undefined ? null : final.text as string, usage: 'unknown' }
        if (Buffer.byteLength(JSON.stringify(terminal)) > this.spec.limits.maxTurnBytes) throw new CodexRuntimeError('frame-limit')
        this.active = undefined
        active.terminal.resolve(terminal)
        this.report({ stage: 'terminal', status })
        return
      }
      let event: CodexTurnEvent
      if (method === 'item/completed') {
        const item = protocolObject(params.item)
        const itemId = brandString<CodexItemId>(protocolString(item.id))
        this.retainItem(active, itemId, item)
        event = { type: 'item', turnId: active.id as CodexTurnId, itemId, item }
      } else {
        if (typeof params.delta !== 'string') throw new CodexRuntimeError('protocol')
        event = { type: 'text-delta', turnId: active.id as CodexTurnId, itemId: brandString<CodexItemId>(protocolString(params.itemId)), text: params.delta }
      }
      try { active.onEvent?.(event) } catch (error) { void error /* A transient UI observer does not own terminal settlement. */ }
    } catch (error) {
      void error
      this.fail(error instanceof CodexRuntimeError ? error : new CodexRuntimeError('protocol'))
    }
  }
}

/**
 * Prepare a fixed runtime and roll back its child on every initialization failure.
 * @param spec - fully resolved deployment configuration.
 * @param signal - cancellation of unpublished preparation only.
 * @returns an initialized process owner; callers must dispose it.
 */
export async function openCodexRuntime(spec: CodexRuntimeSpec, signal?: AbortSignal): Promise<CodexRuntime> {
  validateCodexRuntimeSpec(spec)
  if (signal?.aborted) throw new CodexRuntimeError('closed')
  let child: SubprocessHandle
  try {
    child = spec.spawn({ argv: codexAppServerArgv(), cwd: spec.cwd, env: spec.env,
      stdio: { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' }, graceMs: spec.limits.disposeGraceMs })
  } catch (error) {
    void error
    throw new CodexRuntimeError('startup')
  }
  if (child.stdin === undefined || child.stdout === undefined) {
    try { await disposeCodexProcess({ close() {} }, child) } catch (error) {
      void error
      throw new AggregateError([new CodexRuntimeError('startup'), new CodexRuntimeError('cleanup')],
        'codex-runtime: startup and cleanup failed')
    }
    throw new CodexRuntimeError('startup')
  }
  const runtime = new CodexRuntime(spec, child, child.stdout, child.stdin)
  try {
    await runtime.initialize(signal)
    return runtime
  } catch (error) {
    const failure = error instanceof CodexRuntimeError ? error : new CodexRuntimeError('protocol')
    try { await runtime.dispose() } catch (cleanupError) {
      throw new AggregateError([failure, cleanupError], 'codex-runtime: initialize and cleanup failed')
    }
    throw failure
  }
}
