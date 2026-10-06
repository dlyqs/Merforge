/** Organization native executor: scheduling permissions cover dispatch, never Codex-owned tools. */
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { brandString } from '@deepseek-ai/dsh-brand'
import { SessionSeq, type SessionEvent } from '@deepseek-ai/dsh-session'
import type { SessionPersistence } from '@deepseek-ai/dsh-session-persistence'
import { openCodexRuntime, type CodexRuntime, type CodexRuntimeLimits, type CodexRuntimeSpec,
  type CodexInputId, type CodexServerRequest } from '@deepseek-ai/dsh-codex-runtime'
import { executionCommandSchema } from '@deepseek-ai/dsh-organization/execution'
import { ActionGuard, actionDigest, actionEvidenceSchema, type ExecutionBridge } from './action-guard.ts'
import { acquireDirectory } from './resources.ts'
import { nativeJournal, nativeJournalSchema, nativeBaseline, type NativeJournal } from './codex-journal.ts'
import type { RuntimeLimits } from './runtime.ts'
import type { ExecutionResult, ExecutionAuthority } from './protocol.ts'
/** Deployment-configured native waits and retained protocol limits. */
export const nativeLimitsSchema: z.ZodType<CodexRuntimeLimits> = z.object({
  startupTimeoutMs: z.number().int().positive().max(2147483647), rpcTimeoutMs: z.number().int().positive().max(2147483647),
  turnTimeoutMs: z.number().int().positive().max(2147483647), humanTimeoutMs: z.number().int().positive().max(2147483647),
  interruptTimeoutMs: z.number().int().positive().max(2147483647), disposeGraceMs: z.number().int().positive().max(2147483647),
  maxFrameBytes: z.number().int().positive().max(2147483647), maxEarlyEvents: z.number().int().positive().max(2147483647),
  maxTurnBytes: z.number().int().positive().max(2147483647), modelCacheMs: z.number().int().positive().max(2147483647),
  modelPageSize: z.number().int().positive().max(2147483647), maxModelPages: z.number().int().positive().max(2147483647),
}).strict()
const humanTool = { type: 'function', name: 'organization_request_human',
  description: 'Ask the employee or original task issuer for missing information. Execution stops until a human answers and the employee explicitly continues. Send only the necessary question.',
  inputSchema: { type: 'object', properties: { prompt: { type: 'string' }, recipient: { type: 'string', enum: ['employee', 'issuer'] } },
    required: ['prompt', 'recipient'], additionalProperties: false } } as const
/**
 * Reconcile or dispatch one native turn in the original isolated Run journal.
 * @param binding - Immutable approved task and selected materials, with no personal history.
 * @param authority - Fresh device qualification after start or resume.
 * @param bridge - Native fixed signed scheduling channel.
 * @param store - Employee-only Run persistence.
 * @param spec - Fixed runtime launch and validated native limits.
 * @param limits - Local interval limits and revocation polling.
 * @param signal - Employee identity, window, sleep and stop lifetime.
 * @param recovery - Reviewed journal digest; reconciliation never sends input.
 * @returns Observed interval status after native process and writes drain.
 */
export async function runCodexExecution(binding: ExecutionResult, authority: ExecutionAuthority, bridge: ExecutionBridge,
  store: SessionPersistence, spec: CodexRuntimeSpec, limits: RuntimeLimits, signal: AbortSignal,
  recovery?: { baselineDigest: string; reconcile: boolean }): Promise<'completed' | 'failed' | 'waiting-human' | 'reconciled'> {
  const backend = binding.inputs.backend, selection = binding.inputs.execution
  if (!backend || !selection || JSON.stringify(binding.run.backend) !== JSON.stringify(backend)) throw new Error('organization-execution: native-selection-mismatch')
  const lock = await acquireDirectory(selection.directory)
  const cancel = new AbortController(), lifetime = AbortSignal.any([cancel.signal, signal])
  let runtime: CodexRuntime | undefined, stopping: Promise<void> | undefined
  let timer: ReturnType<typeof setTimeout> | undefined, poll: ReturnType<typeof setTimeout> | undefined
  let checking: Promise<void> = Promise.resolve(), writes: Promise<void> = Promise.resolve()
  const human = { waiting: false }
  const receiptReady = Promise.withResolvers<void>()
  void receiptReady.promise.catch((error: unknown) => { void error })
  const earlyItems = new Map<string, NativeJournal>()
  let receiptCommitted = false
  const handle = await store.open(binding.sessionId, 'write').catch((error: unknown) => { lock.release(); throw error })
  let events: SessionEvent[] = []
  const append = (event: SessionEvent): Promise<void> => {
    const pending = writes.then(async () => {
      const committed = { ...event, seq: SessionSeq(events.length), time: Date.now() }
      if (Buffer.byteLength(JSON.stringify(committed)) > limits.maxBytes) throw new Error('organization-execution: journal-size-limit')
      await handle.append([committed]); await handle.flush(); events.push(committed)
    })
    writes = pending
    return pending
  }
  const record = (data: NativeJournal) => append({ type: 'organization/execution-native', data: nativeJournalSchema.parse(data), seq: SessionSeq(0), time: 0 })
  const guard = new ActionGuard(binding, authority, bridge, data => append({ type: 'organization/execution-action',
    data: actionEvidenceSchema.parse(data), seq: SessionSeq(0), time: 0 }), lifetime, limits)
  const { id, state: _state, version: _version, createdRevision: _created, configDigest: _digest,
    backend: _backend, startedAt: _started, stopReason: _stop,
    deviceId: _device, serverEpoch: _epoch, fencingEpoch: _fence, ...selector } = binding.run
  const command = (fields: object) => executionCommandSchema.parse({ ...selector, runId: id, operationId: randomUUID(), ...fields })
  const stop = () => {
    if (runtime) {
      stopping ??= runtime.stop()
      void stopping.catch((error: unknown) => { void error /* Cleanup is awaited by this interval owner. */ })
    }
  }
  lifetime.addEventListener('abort', stop, { once: true })
  const onRequest = async (request: CodexServerRequest, callbackSignal: AbortSignal): Promise<unknown> => {
    callbackSignal.throwIfAborted(); await guard.checkOnline()
    // The receipt append races a callback immediately after turn/start; drain it first.
    await receiptReady.promise; await writes
    const state = nativeJournal(events)
    if (state.receipt?.turnId !== request.turnId) throw new Error('organization-execution: native-request-unbound')
    let prompt: string, recipient = 'employee', approval = false
    switch (request.method) {
      case 'item/tool/call': {
        const call = z.object({ tool: z.literal('organization_request_human'), arguments: z.object({
          prompt: z.string().min(1).max(32768), recipient: z.enum(['employee', 'issuer']),
        }).strict() }).parse(request.params)
        prompt = call.arguments.prompt; recipient = call.arguments.recipient; break
      }
      case 'item/tool/requestUserInput': {
        const questions = z.object({ questions: z.array(z.object({ question: z.string().min(1),
          isSecret: z.literal(false), options: z.array(z.object({ label: z.string(), description: z.string() })).nullable().optional(),
        })).min(1).max(3) }).parse(request.params).questions
        prompt = questions.map(q => [q.question, ...(q.options?.map(o => `${o.label}: ${o.description}`) ?? [])].join('\n')).join('\n')
        break
      }
      case 'item/commandExecution/requestApproval': case 'item/fileChange/requestApproval':
        z.object({ itemId: z.string().min(1) }).parse(request.params)
        prompt = request.method === 'item/commandExecution/requestApproval' ? 'Codex requests permission for a native command. Review the private Run details before deciding.'
          : 'Codex requests permission for a native file change. Review the private Run details before deciding.'
        approval = true; break
      default: return assertNever(request.method)
    }
    const proposal = Object.fromEntries(Object.entries(request.params).filter(([key]) =>
      !['threadId', 'turnId', 'itemId', 'startedAtMs'].includes(key)).sort(([left], [right]) => left.localeCompare(right)))
    const reusableCommand = request.method === 'item/commandExecution/requestApproval'
      && typeof proposal.command === 'string' && typeof proposal.cwd === 'string'
    const digest = actionDigest({ method: request.method, params: reusableCommand ? proposal : request.params })
    if (recovery && reusableCommand) {
      await guard.checkOnline()
      const view = (await bridge()).execution
      const approved = view.humanRequests.find(h => h.requestDigest === digest && h.expiresAt > view.serverTime
        && ['approved', 'denied'].includes(h.state) && !events.some(e => e.type === 'organization/execution-native'
          && e.data.kind === 'decision' && e.data.inboxId === h.id))
      if (approved) {
        const decision = approved.state === 'approved' ? 'accept' : 'decline'
        if (request.params.availableDecisions != null && !z.array(z.json()).parse(request.params.availableDecisions).includes(decision)) {
          throw new Error('organization-execution: native-decision-unavailable')
        }
        callbackSignal.throwIfAborted()
        await record({ kind: 'decision', threadId: request.threadId, turnId: request.turnId, requestId: request.requestId,
          inboxId: approved.id, digest, decision })
        await guard.checkOnline(); callbackSignal.throwIfAborted()
        return { decision }
      }
    }
    const inboxId = randomUUID()
    await record({ kind: 'human', threadId: request.threadId, turnId: request.turnId, requestId: request.requestId,
      method: request.method, params: z.json().parse(request.params), digest, inboxId })
    callbackSignal.throwIfAborted()
    const view = (await bridge()).execution
    await bridge(command({ kind: 'request-execution-human', requestId: inboxId,
      handlerId: recipient === 'issuer' ? view.approvedBy : view.assigneeId, requestKind: approval ? 'tool-approval' : 'work-question',
      prompt, actionId: null, requestDigest: approval ? digest : null, expiresAt: view.delegation.expiresAt }))
    human.waiting = true
    cancel.abort(new Error('organization-execution: waiting-human'))
    return approval ? { decision: 'cancel' } : request.method === 'item/tool/call'
      ? { success: false, contentItems: [{ type: 'inputText', text: 'Execution waits for a human answer and explicit continuation.' }] } : { answers: {} }
  }
  try {
    events = [...(await handle.read()).events]
    lifetime.throwIfAborted()
    if (recovery && nativeBaseline(events) !== recovery.baselineDigest) throw new Error('organization-execution: baseline-changed')
    let journal = nativeJournal(events)
    if (!journal.bound && journal.status !== 'unbound') throw new Error('organization-execution: native-thread-unknown')
    if (!recovery?.reconcile) {
      timer = setTimeout(() => { cancel.abort(new Error('organization-execution: duration-limit')) }, limits.maxDurationMs)
      const recheck = () => {
        checking = guard.checkOnline().catch((error: unknown) => { cancel.abort(error) }).then(() => {
          if (!lifetime.aborted) poll = setTimeout(recheck, limits.recheckMs)
        })
      }
      poll = setTimeout(recheck, limits.recheckMs)
    }
    runtime = await openCodexRuntime({ ...spec, cwd: lock.root, onRequest, dynamicTools: [humanTool] }, lifetime)
    lifetime.throwIfAborted()
    if (runtime.capabilities.version !== backend.runtimeVersion) throw new Error('organization-execution: native-selection-mismatch')
    if (journal.bound) {
      if (journal.bound.cwd !== lock.root) throw new Error('organization-execution: directory-changed')
      if (journal.intent && (!journal.result || journal.result.status === 'unknown')) {
        if (!journal.receipt) throw new Error('organization-execution: native-result-unknown')
        const receipt = journal.receipt
        const native = await runtime.readThread(journal.bound.threadId)
        const turn = native.turns.find(turn => turn.id === receipt.turnId)
        const parsed = z.object({ id: z.string(), status: z.enum(['completed', 'interrupted', 'failed']), items: z.array(z.record(z.string(), z.json())) }).safeParse(turn)
        if (!parsed.success) throw new Error('organization-execution: native-result-unknown')
        const final = parsed.data.items.filter(item => item.type === 'agentMessage' && item.phase === 'final_answer').at(-1)
          ?? parsed.data.items.filter(item => item.type === 'agentMessage' && item.phase == null).at(-1)
        await record({ ...journal.receipt, kind: 'result', status: parsed.data.status,
          finalText: final === undefined ? null : z.string().parse(final.text), items: parsed.data.items, recovered: true, usage: 'unknown' })
        journal = nativeJournal(events)
      }
      if (journal.result && journal.result.status !== 'unknown') {
        const evidence = events.findLast(event => event.type === 'organization/execution-action')
        if (evidence?.type === 'organization/execution-action' && evidence.data.action.capability === 'codex-turn'
          && !(evidence.data.stage === 'settled' && ['succeeded', 'failed'].includes(evidence.data.outcome ?? ''))) {
          const outcome = journal.result.status === 'completed' ? 'succeeded' : 'failed', evidenceDigest = actionDigest(journal.result)
          await append({ type: 'organization/execution-action', data: { action: evidence.data.action, stage: 'settled', outcome, evidenceDigest }, seq: SessionSeq(0), time: 0 })
          await bridge(command({ kind: 'settle-action', actionId: evidence.data.action.actionId, outcome, evidenceDigest }))
        }
      }
    }
    if (recovery?.reconcile) return 'reconciled'
    await guard.checkOnline()
    if (journal.bound) await runtime.resumeThread(journal.bound.threadId, { mode: 'native', model: backend.model, effort: backend.effort })
    else {
      await record({ kind: 'preparing', cwd: lock.root, directory: selection.directory })
      const thread = await runtime.startThread({ mode: 'native', model: backend.model, effort: backend.effort })
      await record({ kind: 'bound', threadId: thread.id, cwd: lock.root })
    }
    const native = runtime, association = nativeJournal(events).bound
    if (!association) throw new Error('organization-execution: native-log-mismatch')
    const inputId = brandString<CodexInputId>(randomUUID())
    const input = JSON.stringify({ task: binding.snapshot, materials: binding.inputs.materials, messages: binding.inputs.messages,
      ...(recovery ? { continuation: 'Continue from native history without repeating completed side effects. Previous callbacks are cancelled; human decisions are context, not permission for a new native action.',
        humanAnswers: authority.execution.humanRequests.filter(h => ['answered', 'approved', 'denied'].includes(h.state)) } : {}) })
    const terminal = await guard.perform('codex-turn', { inputId, input }, async (issue) => {
      const check = await issue()
      const receipt = await native.send({ inputId, texts: [input], persistIntent: async (intent) => {
        await record({ kind: 'intent', inputId, threadId: intent.threadId, params: z.json().parse(intent.params) })
        check()
      } }, (event) => {
        if (event.type !== 'item') return
        const data: NativeJournal = { kind: 'item', threadId: association.threadId,
          turnId: event.turnId, item: z.record(z.string(), z.json()).parse(event.item) }
        if (!receiptCommitted) earlyItems.set(event.itemId, data)
        else void record(data).catch((error: unknown) => { cancel.abort(error) })
      })
      await record({ kind: 'receipt', inputId, threadId: receipt.threadId, turnId: receipt.turnId })
      receiptCommitted = true; receiptReady.resolve()
      for (const data of earlyItems.values()) await record(data)
      earlyItems.clear()
      const terminal = await receipt.terminal
      await record({ kind: 'result', inputId, threadId: receipt.threadId, turnId: receipt.turnId, status: terminal.status,
        finalText: terminal.finalText, items: terminal.items.map(item => z.record(z.string(), z.json()).parse(item)), recovered: false, usage: 'unknown' })
      return terminal
    }, result => result.status === 'completed' ? 'succeeded' : 'failed')
    if (human.waiting) return 'waiting-human'
    lifetime.throwIfAborted()
    return terminal.status === 'completed' ? 'completed' : 'failed'
  } catch (error) {
    receiptReady.reject(error)
    const journal = nativeJournal(events)
    if (journal.intent && !journal.result && journal.bound) await record({ kind: 'result', inputId: journal.intent.inputId,
      threadId: journal.bound.threadId, turnId: journal.receipt?.turnId ?? null, status: 'unknown', finalText: null, items: [], recovered: false, usage: 'unknown' })
    if (human.waiting) return 'waiting-human'
    throw error instanceof Error && error.message.startsWith('organization-execution:') ? error : new Error('organization-execution: native-unavailable')
  } finally {
    clearTimeout(timer); clearTimeout(poll)
    lifetime.removeEventListener('abort', stop)
    try {
      if (stopping) await stopping
      else await runtime?.dispose()
    } catch (error) {
      const observed = nativeJournal(events).result
      if (!observed || observed.status === 'unknown') throw error
      await record({ kind: 'diagnostic', category: 'cleanup' })
    } finally {
      await checking
      await guard.drain()
      try { await writes } finally { await handle.close(); lock.release() }
    }
  }
}

function assertNever(value: never): never { throw new Error(`organization-execution: unknown native method ${String(value)}`) }
