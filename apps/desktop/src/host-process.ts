import { conversationRequestSchema, conversationNativeMessageSchema, type ConversationRequest, type ConversationBridge, type ConversationResult } from '@deepseek-ai/dsh-organization-conversation/protocol'
/** Electron Node-mode child lifecycle for the shared Web application. */
import { executionReportRequestSchema, executionReportSchema, executionResultSchema, type ExecutionReportRequest, type ExecutionReadAuthority, type ExecutionReport, executionNativeMessageSchema, executionRequestSchema, type ExecutionRequest, type ExecutionAuthority, type ExecutionCommand, type ExecutionResult } from '@deepseek-ai/dsh-organization-execution/protocol'

import { codexSetupNativeMessageSchema } from '@deepseek-ai/dsh-agent-codex/setup-protocol'
import type { CodexSetupOwnerId, CodexSetupOperation, CodexSetupView, CodexSetupSnapshot } from '@deepseek-ai/dsh-agent-codex/setup-types'
import { randomUUID } from 'node:crypto'
import { contextNativeMessageSchema, contextRequestSchema, type ContextRequest, type ContextAuthority, type ContextResult } from '@deepseek-ai/dsh-organization-context/protocol'
import { spawn, type ChildProcess } from 'node:child_process'
import { join } from 'node:path'
import { desktopNodeEnvironment } from './node-environment.ts'

interface ReadyEvent {
  readonly type: 'ready'
  readonly url: string
  readonly injections?: readonly unknown[] | undefined
}

interface FatalEvent {
  readonly type: 'fatal'
  readonly message: string
  /** The Host's complete inspected error: stack, enumerable properties, cause chain. */
  readonly diagnostic?: string
}

type DesktopHostEvent = ReadyEvent | FatalEvent | { readonly type: 'shutdown-complete' } | {
  readonly type: 'update-tasks'
  readonly requestId: number
  readonly active: boolean
  readonly error?: string
}

const MAX_HOST_DIAGNOSTIC_CHARS = 64 * 1024

function isDesktopHostEvent(message: unknown): message is DesktopHostEvent {
  if (typeof message !== 'object' || message === null || !('type' in message)) return false
  const candidate = message as Record<string, unknown>
  switch (candidate.type) {
    case 'shutdown-complete':
      return true
    case 'ready':
      return typeof candidate.url === 'string'
    case 'fatal':
      return typeof candidate.message === 'string' && (candidate.diagnostic === undefined || typeof candidate.diagnostic === 'string')
    case 'update-tasks':
      return Number.isSafeInteger(candidate.requestId) && typeof candidate.active === 'boolean'
        && (candidate.error === undefined || typeof candidate.error === 'string')
    default:
      return false
  }
}

async function exitsWithin(exit: Promise<void>, milliseconds: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => { resolve(false) }, milliseconds)
    timer.unref()
  })
  try {
    return await Promise.race([exit.then(() => true), timeout])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/** Browser authentication URL reported by the running Web application. */
export interface DesktopHostReady {
  readonly url: string
  readonly injections?: readonly unknown[] | undefined
}

/** The child has exited, but task teardown did not finish successfully. */
export class DesktopHostUncleanExitError extends Error {}

/**
 * A Host failure reported over IPC before the process exited. `message` is what
 * the Host chose to show; `diagnostic` is its complete inspected error, kept
 * separately so a crash report can print it verbatim instead of a string escaped
 * inside another error's properties.
 */
export class DesktopHostFatalError extends Error {
  readonly #diagnostic: string | undefined

  /**
   * @param message - The Host's failure message.
   * @param diagnostic - The Host's inspected error, when the Host supplied one.
   */
  constructor(message: string, diagnostic: string | undefined) {
    super(message)
    this.#diagnostic = diagnostic
  }

  /** The Host's inspected error; a getter so `util.inspect` of this error does not repeat it as an escaped property. */
  get diagnostic(): string | undefined { return this.#diagnostic }
}

/** One Web backend running under the Electron executable in Node mode. */
export class DesktopHostProcess {
  private child: ChildProcess | undefined
  private readyResolve!: (ready: DesktopHostReady) => void
  private readyReject!: (error: Error) => void
  private readonly readyPromise = new Promise<DesktopHostReady>((resolve, reject) => {
    this.readyResolve = resolve
    this.readyReject = reject
  })
  private exitPromise: Promise<void> | undefined
  private stderr = ''
  private failureReported = false
  private stopping = false
  private shutdownCompleted = false
  private readonly contextNonce = randomUUID()
  private readonly contextQueries = new Map<string, {
    authorize: (revision?: ContextAuthority['task']['revision']) => Promise<ContextAuthority>
    resolve: (result: ContextResult) => void
    reject: (error: Error) => void
  }>()
  private readonly conversationQueries = new Map<string, {
    authorize: ConversationBridge
    resolve: (result: ConversationResult) => void
    reject: (error: Error) => void
  }>()
  private readonly executionQueries = new Map<string, {
    authorize: (command?: ExecutionCommand) => Promise<ExecutionAuthority | ExecutionReadAuthority>
    resolve: (result: ExecutionResult | ExecutionReport) => void
    reject: (error: Error) => void
  }>()
  private readonly setupListeners = new Set<(snapshot: CodexSetupSnapshot) => void>()
  private readonly setupQueries = new Map<string, {
    resolve: (value: { view: CodexSetupView; verificationUrl?: string }) => void
    reject: (error: Error) => void
  }>()
  private setupSnapshot: CodexSetupSnapshot | undefined
  private nextControlId = 1
  private readonly taskQueries = new Map<number, { resolve: (active: boolean) => void; reject: (error: Error) => void }>()

  /**
   * @param node - Absolute Electron executable in Node mode.
   * @param runtimeDir - Immutable packages carried by the current application.
   * @param projectDir - Desktop plugin profile and child working directory.
   * @param inspectPort - Optional loopback inspector port for workspace development.
   * @param environment - Environment inherited by the Host and its plugin subprocesses.
   * @param onFailure - Receives the first unexpected child failure, including after readiness.
   * @param primaryRuntime - Optional bundled dependency payload.
   * @param packageManager - Bundled pnpm entry and Node launcher directory, scoped to package operations.
   */
  constructor(
    private readonly node: string,
    private readonly runtimeDir: string,
    private readonly projectDir: string,
    private readonly inspectPort?: number,
    private readonly environment: NodeJS.ProcessEnv = process.env,
    private readonly onFailure?: (error: Error) => void,
    private readonly primaryRuntime?: string,
    private readonly packageManager?: { readonly pnpm: string; readonly nodeBin: string },
  ) {}

  /**
   * Start this child once and await its Web application URL.
   * @returns Ready facts supplied by the child after application startup.
   */
  async start(): Promise<DesktopHostReady> {
    if (this.child !== undefined) return this.readyPromise
    const entry = join(this.runtimeDir, 'node_modules', '@deepseek-ai', 'dsh-desktop-host', 'lib', 'index.js')
    const child = spawn(this.node, [
      '--expose-internals',
      ...(this.inspectPort === undefined ? [] : [`--inspect=127.0.0.1:${String(this.inspectPort)}`]),
      entry,
      this.runtimeDir,
      this.projectDir,
      this.primaryRuntime ?? join(this.runtimeDir, '..', 'runtime', 'primary-runtime'),
      ...this.packageManager === undefined ? [] : [this.packageManager.pnpm, this.packageManager.nodeBin],
    ], {
      cwd: this.projectDir,
      env: desktopNodeEnvironment(this.node, undefined, this.environment),
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    })
    this.child = child
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => { this.stderr = (this.stderr + chunk).slice(-MAX_HOST_DIAGNOSTIC_CHARS) })
    child.stdout?.pipe(process.stdout)
    child.on('message', (message: unknown) => {
      const setup = codexSetupNativeMessageSchema.safeParse(message)
      if (setup.success) {
        const response = setup.data
        if (response.nonce !== this.contextNonce || this.stopping || this.failureReported) return
        if (response.type === 'codex-setup-changed') {
          if (this.setupSnapshot && response.snapshot.revision <= this.setupSnapshot.revision) return
          this.setupSnapshot = response.snapshot
          for (const listener of this.setupListeners) {
            try { listener(response.snapshot) } catch (error) { void error /* Observers do not own the Host channel. */ }
          }
        } else {
          const query = this.setupQueries.get(response.requestId)
          if (response.error || !response.result) query?.reject(new Error(`codex-setup: ${response.error ?? 'protocol'}`))
          else if (this.setupSnapshot && this.setupSnapshot.revision > response.result.snapshot.revision) {
            query?.resolve({ view: { snapshot: this.setupSnapshot } })
          } else if (query) {
            this.setupSnapshot = response.result.snapshot
            query.resolve({ view: response.result,
              ...response.verificationUrl === undefined ? {} : { verificationUrl: response.verificationUrl } })
          }
        }
        return
      }
      const conversation = conversationNativeMessageSchema.safeParse(message)
      if (conversation.success) {
        const response = conversation.data, query = this.conversationQueries.get(response.requestId)
        if (!query || response.nonce !== this.contextNonce) return
        if (response.type === 'organization-conversation-result') {
          if (response.result && !response.error) query.resolve(response.result)
          else query.reject(new Error(response.error ?? 'organization-conversation-unavailable'))
        } else {
          void query.authorize(response.command).then((authority) => {
            if (this.conversationQueries.get(response.requestId) === query && child.connected)
              child.send({ type: 'organization-conversation-authorized', requestId: response.requestId, nonce: response.nonce,
                authorizationId: response.authorizationId, authority })
          }, () => {
            if (this.conversationQueries.get(response.requestId) === query && child.connected)
              child.send({ type: 'organization-conversation-authorized', requestId: response.requestId, nonce: response.nonce,
                authorizationId: response.authorizationId, error: 'denied' })
          }).catch(() => { query.reject(new Error('organization-conversation-unavailable')) })
        }
        return
      }
      const context = contextNativeMessageSchema.safeParse(message)
      if (context.success) {
        const response = context.data
        const query = this.contextQueries.get(response.requestId)
        if (!query || response.nonce !== this.contextNonce) return
        if (response.type === 'organization-context-result') {
          if (response.result && !response.error) query.resolve(response.result)
          else query.reject(new Error('organization-context-unavailable'))
        } else {
          void query.authorize(response.revision).then((authority) => {
            if (this.contextQueries.get(response.requestId) === query && child.connected) {
              child.send({ type: 'organization-context-authorized', requestId: response.requestId, nonce: response.nonce, authorizationId: response.authorizationId, authority })
            }
          }, () => {
            if (child.connected) child.send({ type: 'organization-context-authorized', requestId: response.requestId, nonce: response.nonce, authorizationId: response.authorizationId, error: 'denied' })
          }).catch(() => { query.reject(new Error('organization-context-unavailable')) })
        }
        return
      }
      const execution = executionNativeMessageSchema.safeParse(message)
      if (execution.success) {
        const response = execution.data
        const query = this.executionQueries.get(response.requestId)
        if (!query || response.nonce !== this.contextNonce) return
        if (response.type === 'organization-execution-result') {
          const result = response.result ?? response.report
          if (result && !response.error) query.resolve(result)
          else query.reject(new Error(response.error ?? 'organization-execution-unavailable'))
        } else {
          void query.authorize(response.command).then((authority) => {
            if (this.executionQueries.get(response.requestId) === query && child.connected) {
              child.send({ type: 'organization-execution-authorized', requestId: response.requestId, nonce: response.nonce, authorizationId: response.authorizationId, authority })
            }
          }, () => {
            if (child.connected) child.send({ type: 'organization-execution-authorized', requestId: response.requestId, nonce: response.nonce, authorizationId: response.authorizationId, error: 'denied' })
          }).catch(() => { query.reject(new Error('organization-execution-unavailable')) })
        }
        return
      }
      if (!isDesktopHostEvent(message)) {
        this.fail(new Error('dsh desktop host sent an invalid IPC event'))
        child.kill('SIGTERM')
        return
      }
      if (message.type === 'ready') this.readyResolve({ url: message.url, injections: message.injections })
      else if (message.type === 'shutdown-complete') {
        if (this.stopping) this.shutdownCompleted = true
        else this.fail(new Error('dsh desktop host acknowledged an unrequested shutdown'))
      }
      else if (message.type === 'fatal') this.fail(new DesktopHostFatalError(message.message, message.diagnostic))
      else {
        const query = this.taskQueries.get(message.requestId)
        if (message.error === undefined) query?.resolve(message.active)
        else query?.reject(new Error(message.error))
      }
    })
    child.once('error', (error) => { this.fail(error) })
    this.exitPromise = new Promise<void>((resolve) => {
      child.once('close', (code) => {
        const suffix = this.stderr.trim() === '' ? '' : `: ${this.stderr.trim()}`
        if (code !== 0 && code !== null) this.fail(new Error(`dsh desktop host exited with ${String(code)}${suffix}`))
        else this.fail(new Error(`dsh desktop host stopped${suffix}`))
        resolve()
      })
    })
    return this.readyPromise
  }

  /** Subscribe to safe native setup changes for this Host lifetime.
   * @param listener - fixed safe state observer.
   * @returns subscription disposer.
   */
  subscribeCodexSetup(listener: (snapshot: CodexSetupSnapshot) => void): () => void {
    this.setupListeners.add(listener)
    return () => { this.setupListeners.delete(listener) }
  }
  /** Dispatch fixed setup control on this startup-nonce-bound parent channel.
   * @param owner - Electron-owned window/document lifetime.
   * @param operation - fixed setup operation or native-only retirement.
   * @returns cropped view and an optional Host-only validated URL.
   */
  async codexSetup(owner: CodexSetupOwnerId, operation: CodexSetupOperation | { kind: 'destroyOwner' }):
  Promise<{ view: CodexSetupView; verificationUrl?: string }> {
    const child = this.child
    if (!child?.connected || this.stopping || this.failureReported) throw new Error('codex-setup: closed')
    const requestId = randomUUID()
    try {
      return await new Promise((resolve, reject) => {
        this.setupQueries.set(requestId, { resolve, reject })
        child.send({ type: 'codex-setup', version: 1, requestId, nonce: this.contextNonce, owner, operation }, (error) => {
          if (error !== null) reject(new Error('codex-setup: closed'))
        })
      })
    } finally { this.setupQueries.delete(requestId) }
  }

  /**
   * Dispatch a fixed private planning operation and await its drained result after cancellation.
   * @param input - Project selector and optional explicit message.
   * @param authorize - Native online planning read/command callback.
   * @param timeoutMs - Interval deadline, also enforced by the child.
   * @param signal - Native identity and top-frame lifetime.
   * @returns Private bounded transcript after Host settlement.
   */
  async organizationConversation(input: ConversationRequest, authorize: ConversationBridge, timeoutMs: number,
    signal: AbortSignal): Promise<ConversationResult> {
    signal.throwIfAborted()
    const request = conversationRequestSchema.parse(input), child = this.child, requestId = randomUUID()
    if (!child?.connected || this.stopping || this.failureReported) throw new Error('organization-conversation-unavailable')
    const abort = () => {
      if (!child.connected) { this.conversationQueries.get(requestId)?.reject(new Error('organization-conversation-cancelled')); return }
      child.send({ type: 'organization-conversation-cancel', requestId, nonce: this.contextNonce }, (error) => {
        if (error) this.conversationQueries.get(requestId)?.reject(error)
      })
    }
    signal.addEventListener('abort', abort, { once: true })
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await new Promise<ConversationResult>((resolve, reject) => {
        this.conversationQueries.set(requestId, { authorize, resolve, reject })
        timer = setTimeout(abort, timeoutMs)
        child.send({ type: 'organization-conversation-operation', requestId, nonce: this.contextNonce, request, timeoutMs }, (error) => { if (error) reject(error) })
      })
    } finally {
      clearTimeout(timer); signal.removeEventListener('abort', abort); this.conversationQueries.delete(requestId)
      // The child may disconnect while its owned interval drains.
      // oxlint-disable-next-line typescript/no-unnecessary-condition
      if (child.connected) child.send({ type: 'organization-conversation-cancel', requestId, nonce: this.contextNonce }, () => {})
    }
  }

  /**
   * Request a read-only binding through the private Host channel.
   * @param input - Task selector; identities and snapshots are not accepted.
   * @param authorize - Native online task read bound to the initiating connection generation.
   * @param timeoutMs - Native request deadline.
   * @param signal - Native identity lifetime cancellation.
   * @returns Durable context after online rechecks; no execution capability.
   */
  async openOrganizationContext(input: ContextRequest, authorize: (revision?: ContextAuthority['task']['revision']) => Promise<ContextAuthority>, timeoutMs: number, signal: AbortSignal): Promise<ContextResult> {
    signal.throwIfAborted()
    const request = contextRequestSchema.parse(input)
    const child = this.child
    if (!child?.connected || this.stopping || this.failureReported) throw new Error('organization-context-unavailable')
    const requestId = randomUUID()
    const abort = () => { this.contextQueries.get(requestId)?.reject(new Error('organization-context-cancelled')) }
    signal.addEventListener('abort', abort, { once: true })
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await new Promise<ContextResult>((resolve, reject) => {
        this.contextQueries.set(requestId, { authorize, resolve, reject })
        timer = setTimeout(() => { reject(new Error('organization-context-timeout')) }, timeoutMs)
        child.send({ type: 'organization-context-open', requestId, nonce: this.contextNonce, request, timeoutMs }, (error) => {
          if (error !== null) reject(error)
        })
      })
    } finally {
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
      this.contextQueries.delete(requestId)
      // IPC may disconnect during the awaited operation.
      // oxlint-disable-next-line typescript/no-unnecessary-condition
      if (child.connected) child.send({ type: 'organization-context-cancel', requestId, nonce: this.contextNonce }, () => {})
    }
  }

  /**
   * Request a read-only binding through the private Host channel.
   * @param input - Task selector; identities and snapshots are not accepted.
   * @param authorize - Native online task read bound to the initiating connection generation.
   * @param timeoutMs - Native request deadline.
   * @param signal - Native identity lifetime cancellation.
   * @returns Durable context after online rechecks; no execution capability.
   */
  async openOrganizationExecution(input: ExecutionRequest, authorize: (command?: ExecutionCommand) => Promise<ExecutionAuthority>,
    timeoutMs: number, signal: AbortSignal): Promise<ExecutionResult> {
    return executionResultSchema.parse(await this.executionOperation(input, authorize, timeoutMs, signal, false))
  }
  /**
   * Read a local transcript through the private Host under fresh native read qualification.
   * @param input - Exact Run selector.
   * @param authorize - Online current-identity task read.
   * @param timeoutMs - Native request deadline.
   * @param signal - Window and identity cancellation.
   * @returns Bounded private conversation text.
   */
  async readOrganizationExecution(input: ExecutionReportRequest, authorize: () => Promise<ExecutionReadAuthority>,
    timeoutMs: number, signal: AbortSignal): Promise<ExecutionReport> {
    return executionReportSchema.parse(await this.executionOperation(input, authorize, timeoutMs, signal, true))
  }
  private async executionOperation(input: ExecutionRequest | ExecutionReportRequest,
    authorize: (command?: ExecutionCommand) => Promise<ExecutionAuthority | ExecutionReadAuthority>,
    timeoutMs: number, signal: AbortSignal, report: boolean): Promise<ExecutionResult | ExecutionReport> {
    signal.throwIfAborted()
    const request = report ? executionReportRequestSchema.parse(input) : executionRequestSchema.parse(input)
    const child = this.child
    if (!child?.connected || this.stopping || this.failureReported) throw new Error('organization-execution-unavailable')
    const requestId = randomUUID()
    const abort = () => {
      if (!child.connected) { this.executionQueries.get(requestId)?.reject(new Error('organization-execution-cancelled')); return }
      child.send({ type: 'organization-execution-cancel', requestId, nonce: this.contextNonce }, (error) => {
        if (error) this.executionQueries.get(requestId)?.reject(error)
      })
    }
    signal.addEventListener('abort', abort, { once: true })
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await new Promise<ExecutionResult | ExecutionReport>((resolve, reject) => {
        this.executionQueries.set(requestId, { authorize, resolve, reject })
        timer = setTimeout(() => { reject(new Error('organization-execution-timeout')) }, timeoutMs)
        child.send({ type: report ? 'organization-execution-report' : 'organization-execution-open', requestId, nonce: this.contextNonce, request, timeoutMs }, (error) => {
          if (error !== null) reject(error)
        })
      })
    } finally {
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
      this.executionQueries.delete(requestId)
      // IPC may disconnect during the awaited operation.
      // oxlint-disable-next-line typescript/no-unnecessary-condition
      if (child.connected) child.send({ type: 'organization-execution-cancel', requestId, nonce: this.contextNonce }, () => {})
    }
  }

  /**
   * Inspect active work or lock request admission for update handoff.
   * @param action - Read-only inspection, admission lock, or recovery unlock.
   * @returns Whether live tasks would be affected. Locking drains admitted API requests before inspecting tasks;
   * an unanswered drain fails at the control-request deadline without authorizing installation.
   */
  async updateTasks(action: 'inspect' | 'lock' | 'unlock'): Promise<boolean> {
    const child = this.child
    if (child === undefined || !child.connected || this.failureReported || this.stopping) {
      throw new Error('desktop update: Host is unavailable')
    }
    const requestId = this.nextControlId++
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await new Promise<boolean>((resolve, reject) => {
        this.taskQueries.set(requestId, { resolve, reject })
        timer = setTimeout(() => { reject(new Error('desktop update: task inspection timed out')) }, 10_000)
        child.send({ type: 'update-tasks', requestId, action }, (error) => { if (error !== null) reject(error) })
      })
    } finally {
      clearTimeout(timer)
      this.taskQueries.delete(requestId)
    }
  }

  /**
   * Request teardown and await child exit, escalating termination when needed.
   * @param requireGraceful - Reject update handoff after forced termination or unsuccessful child exit.
   * @returns Completion of owned process teardown. DesktopHostUncleanExitError confirms exit but refuses installation;
   * other failures do not confirm exit.
   */
  async stop(requireGraceful = false): Promise<void> {
    const child = this.child
    if (child === undefined) return
    this.stopping = true
    if (child.connected) child.send({ type: 'shutdown' }, (error) => { if (error !== null) this.fail(error) })
    const exited = this.exitPromise ?? Promise.resolve()
    const graceful = await exitsWithin(exited, 10_000)
    if (!graceful) child.kill('SIGTERM')
    if (!await exitsWithin(exited, 5_000)) {
      child.kill('SIGKILL')
      if (!await exitsWithin(exited, 5_000)) {
        throw new Error('dsh desktop host did not exit after SIGKILL')
      }
    }
    this.child = undefined
    if (requireGraceful && (!graceful || child.exitCode !== 0 || !this.shutdownCompleted)) {
      // This diagnostic reaches expandable UI; arbitrary plugin stderr can contain credentials.
      throw new DesktopHostUncleanExitError(`desktop update: Host did not complete graceful task teardown (exit ${String(child.exitCode)}, signal ${String(child.signalCode)}, shutdown acknowledged ${String(this.shutdownCompleted)}, graceful deadline exceeded ${String(!graceful)})`)
    }
  }

  private fail(error: Error): void {
    this.readyReject(error)
    for (const query of this.setupQueries.values()) query.reject(new Error('codex-setup: closed'))
    this.setupQueries.clear()
    if (this.setupSnapshot) {
      this.setupSnapshot = { ...this.setupSnapshot, revision: this.setupSnapshot.revision + 1,
        runtime: { version: '0.153.4', status: 'error', category: 'closed' },
        account: { status: 'unknown' }, catalog: { status: 'unknown', models: [] },
        login: { status: 'failed', category: 'closed' } }
      for (const listener of this.setupListeners) {
        try { listener(this.setupSnapshot) } catch (listenerError) {
          void listenerError /* Host loss invalidates every short-lived view. */
        }
      }
    }
    for (const query of this.conversationQueries.values()) query.reject(error)
    this.conversationQueries.clear()
    for (const query of this.contextQueries.values()) query.reject(error)
    this.contextQueries.clear()
    for (const query of this.executionQueries.values()) query.reject(error)
    this.executionQueries.clear()
    for (const query of this.taskQueries.values()) query.reject(error)
    this.taskQueries.clear()
    if (!this.failureReported && !this.stopping) {
      this.failureReported = true
      try { this.onFailure?.(error) } catch (listenerError) {
        console.error('desktop host failure listener failed', listenerError)
      }
    }
  }
}
