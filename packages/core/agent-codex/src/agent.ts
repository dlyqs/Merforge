/** Text-only native bridge; Codex owns tools and model context, Session owns observations. */
import { z } from 'zod'
import type { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import {
  agentEvents, ReactLoopInbox, AssistantStreamAttempt,
  type AgentBackendSelection, type AgentOptions, type ScopedAgentDriver, type AgentStatus, type AgentCancelCause,
  type CancelOptions, type InboxTarget,
} from '@deepseek-ai/dsh-agent'
import { createAssistantMessage } from '@deepseek-ai/dsh-llm'
import { createScope, type Scope } from '@deepseek-ai/dsh-scope'
import type { Session, SessionId, UserMessage, TurnEndReason, SessionEventMap } from '@deepseek-ai/dsh-session'
import {
  openCodexRuntime, CodexRuntimeError, type CodexRuntime, type CodexRuntimeSpec,
  type CodexInputId, type CodexTurnId, type CodexItemId, type CodexEffort, type CodexTurnTerminal,
} from '@deepseek-ai/dsh-codex-runtime'
import { workflowTools, answerNativeRequest } from './requests.ts'
import type { CodexBridgeProjection } from './types.ts'

const effortSchema = z.enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'])
type ResultData = SessionEventMap['codex/turn-result']
interface Activity {
  readonly kind: 'turn' | 'maintenance'
  readonly abort: AbortController
  cancelCause: AgentCancelCause | null
  wakeupAfterCancel: boolean
}

/** Scoped driver created and published only by the existing Agent factory. */
export class CodexAgent implements ScopedAgentDriver {
  readonly scope: Scope
  readonly ctx: Context
  readonly inbox: ReactLoopInbox
  private readonly dispatch
  private activity: Activity | undefined
  private done: Promise<void> = Promise.resolve()
  private disposed = false
  private revision = 0
  private attempt = 0
  private lastTurn: number
  private readonly selection: AgentBackendSelection
  private readonly cwd: string

  constructor(
    factoryCtx: Context,
    readonly id: SessionId,
    readonly options: AgentOptions,
    readonly session: Session,
    private readonly spec: (cwd: string) => CodexRuntimeSpec,
    private readonly providerActive: () => boolean,
  ) {
    if (options.backend === undefined || session.header.cwd === undefined) throw new Error('Codex requires an explicit backend and cwd')
    this.selection = options.backend
    this.cwd = session.header.cwd
    this.scope = createScope(factoryCtx, this)
    this.ctx = this.scope.ctx
    this.dispatch = agentEvents(factoryCtx, this)
    this.inbox = new ReactLoopInbox(this.ctx.sessionProjections, session, this.dispatch)
    this.lastTurn = this.ctx.sessionProjections.stateOf(session, 'turnBoundary')?.lastTurn ?? 0
  }

  get status(): AgentStatus { return this.activity?.kind === 'turn' ? 'running' : 'idle' }

  send(message: UserMessage, target: InboxTarget, wakeup: boolean): void {
    this.assertAvailable()
    if (target !== 'next-turn' || !wakeup || message.content.some(part => part.type !== 'text')) {
      throw new Error('Codex supports ordinary text follow-ups only; steering, injected context and attachments are unavailable')
    }
    this.inbox.append('next-turn', message)
    if (this.activity?.abort.signal.aborted) this.activity.wakeupAfterCancel = true
    this.wake()
  }
  followup(message: UserMessage): void { this.send(message, 'next-turn', true) }
  steer(_message: UserMessage): void { throw new Error('Codex steering is unavailable') }
  inject(_message: UserMessage): void { throw new Error('Codex injected context is unavailable') }

  cancel(cause: AgentCancelCause, options: CancelOptions = {}): void {
    if (cause.kind === 'disposed') this.disposed = true
    if (!options.keepInbox) this.inbox.clear()
    if (this.activity !== undefined && !this.activity.abort.signal.aborted) {
      this.activity.cancelCause = cause
      this.activity.abort.abort(cause)
    }
  }
  async whenIdle(): Promise<void> {
    let observed: Promise<void>
    do { await (observed = this.done) } while (observed !== this.done)
  }
  runMaintenance<T>(task: (signal: AbortSignal) => Promise<T>): Promise<T> {
    this.assertAvailable()
    if (this.activity !== undefined) throw new Error('Codex agent already has active work')
    const operation: Activity = { kind: 'maintenance', abort: new AbortController(), cancelCause: null, wakeupAfterCancel: false }
    const done = Promise.withResolvers<void>()
    this.activity = operation
    this.done = done.promise
    return (async () => {
      try { return await task(operation.abort.signal) }
      finally {
        this.activity = undefined
        if ((!operation.abort.signal.aborted || operation.wakeupAfterCancel)
          && !this.disposed && this.inbox.nextTurn.length > 0) this.wake()
        done.resolve()
      }
    })()
  }

  private assertAvailable(): void {
    if (this.ctx.get('workspaceRegistry')?.archivedSessionIds.includes(this.id)) throw new Error('Restore this archived conversation before sending')
    if (this.disposed || !this.providerActive()) throw new Error('Codex agent is disposed')
  }
  private state(): CodexBridgeProjection {
    const state = this.ctx.sessionProjections.stateOf(this.session, 'codexBridge')
    if (state === undefined) throw new Error('Codex bridge projection is unavailable')
    return state
  }
  private async flush(): Promise<void> {
    if (!await this.ctx.sessions.flush(this.session)) throw new Error('Codex requires durable Session persistence')
  }
  private wake(): void {
    if (this.activity !== undefined || this.disposed || this.inbox.nextTurn.length === 0) return
    const operation: Activity = { kind: 'turn', abort: new AbortController(), cancelCause: null, wakeupAfterCancel: false }
    const done = Promise.withResolvers<void>()
    this.activity = operation
    this.done = done.promise
    this.dispatch.emit('agent/status', { status: 'running' })
    void this.ctx.agents.withInitiator(this, async () => {
      try {
        while (!operation.abort.signal.aborted && !this.disposed && this.inbox.nextTurn.length > 0) {
          if (!await this.runTurn(operation)) break
        }
      } catch (error: unknown) {
        this.dispatch.emit('agent/error', { turn: this.lastTurn, step: 1, error })
      } finally {
        this.activity = undefined
        this.dispatch.emit('agent/status', { status: 'idle' })
        if (operation.wakeupAfterCancel && !this.disposed && this.inbox.nextTurn.length > 0) this.wake()
        done.resolve()
      }
    })
  }

  private stream(turn: number): AssistantStreamAttempt {
    return new AssistantStreamAttempt(this.id, ++this.attempt, () => ++this.revision, turn, 1,
      (frame) => { this.dispatch.emit('agent/assistant-stream', { frame }) })
  }
  private settleText(result: ResultData, attempt = this.stream(result.turn)): void {
    const finalText = result.finalText
    if (finalText === null) { if (!attempt.ended) attempt.abandon(); return }
    // The final native answer is authoritative; transient commentary is not added to model history.
    attempt.push({ type: 'block-end', index: 0, block: { type: 'text', text: finalText } })
    attempt.push({ type: 'finish', reason: { kind: 'stop' } })
    attempt.settle('assistant/message', () => this.session.append('assistant/message', {
      turn: result.turn, step: 1,
      message: createAssistantMessage({ content: [{ type: 'text', text: finalText }], source: { provider: 'codex', model: this.selection.model } }),
      stream: attempt.stream,
      ...(result.status === 'interrupted' ? { interrupted: true as const } : {}),
    }, { surfaceOp: 'append' }).seq)
  }

  private async reconcile(runtime: CodexRuntime): Promise<void> {
    const state = this.state()
    if (state.threadId === null) {
      if (state.status !== 'unbound') throw new Error('Codex thread creation is unknown; create a new conversation')
      return
    }
    // oxlint-disable-next-line typescript/no-deprecated -- Recovery reads the complete local prefix once per native connection.
    const events = this.session.snapshotEvents()
    const intent = events.findLast(event => event.type === 'codex/send-intent')
    const result = events.findLast(event => event.type === 'codex/turn-result')
    if (intent?.type === 'codex/send-intent' && (result?.type !== 'codex/turn-result'
      || result.data.inputId !== intent.data.inputId || result.data.status === 'unknown')) {
      const receipt = events.findLast(event => event.type === 'codex/send-receipt' && event.data.inputId === intent.data.inputId)
      if (receipt?.type !== 'codex/send-receipt') throw new Error('Codex send has no confirmed receipt; it will not be replayed')
      const native = await runtime.readThread(state.threadId)
      const turn = native.turns.find(turn => turn.id === receipt.data.turnId)
      if (turn === undefined || !['completed', 'interrupted', 'failed'].includes(String(turn.status))) {
        throw new Error('Codex turn outcome is unknown; it will not be replayed')
      }
      const items = z.array(z.record(z.string(), z.json())).parse(turn.items)
      const final = items.filter(item => item.type === 'agentMessage' && item.phase === 'final_answer').at(-1)
        ?? items.filter(item => item.type === 'agentMessage' && item.phase == null).at(-1)
      const recovered: ResultData = { ...receipt.data, status: z.enum(['completed', 'interrupted', 'failed']).parse(turn.status),
        finalText: final === undefined ? null : z.string().parse(final.text), items, usage: 'unknown', recovered: true }
      for (const item of items) {
        const itemId = z.string().min(1).parse(item.id)
        if (!events.some(event => event.type === 'codex/item' && event.data.turnId === receipt.data.turnId && event.data.itemId === itemId)) {
          this.session.append('codex/item', { turn: receipt.data.turn, threadId: state.threadId, turnId: receipt.data.turnId,
            itemId: brandString<CodexItemId>(itemId), item })
        }
      }
      this.session.append('codex/turn-result', recovered)
      await this.flush()
    } else if (result?.type === 'codex/turn-result' && result.data.status !== 'unknown' && !result.data.recovered && result.data.finalText !== null
      && !events.some(event => event.type === 'assistant/message' && event.data.turn === result.data.turn)) {
      this.session.append('codex/turn-result', { ...result.data, recovered: true })
      await this.flush()
    }
  }

  private async runTurn(operation: Activity): Promise<boolean> {
    const signal = operation.abort.signal
    const turn = ++this.lastTurn
    this.session.append('turn/start', { turn })
    this.session.append('step/start', { turn, step: 1 })
    let messages = this.inbox.claim('next-turn', turn)
    const firstMessage = messages[0]
    if (firstMessage === undefined) {
      this.session.append('step/end', { turn, step: 1 })
      this.session.append('turn/end', { turn, reason: { kind: 'completed' } })
      return true
    }

    const inputId = brandString<CodexInputId>(firstMessage.id)
    let runtime: CodexRuntime | undefined
    let stopping: Promise<void> | undefined
    let nativeTurnId: CodexTurnId | undefined
    let terminal: CodexTurnTerminal | undefined
    const attempt = this.stream(turn)
    let streamed = false
    let reason: TurnEndReason = { kind: 'completed' }
    const onAbort = (): void => {
      if (runtime !== undefined) {
        stopping ??= runtime.stop()
        void stopping.catch((error: unknown) => { void error /* Cleanup is awaited below. */ })
      }
    }
    signal.addEventListener('abort', onAbort, { once: true })
    try {
      signal.throwIfAborted()
      const selection = this.selection
      const decision = await this.dispatch.waterfall('agent/pre-step', { messages, turn, step: 1, signal },
        () => Promise.resolve({ kind: 'enter' as const, messages }))
      if (decision.kind === 'reject' || decision.messages.length === 0) return false
      messages = decision.messages
      signal.throwIfAborted()
      const dynamicTools = workflowTools(this.ctx, this)
      const binding = this.state()
      if (binding.threadId !== null
        && messages.some(message => ['personal-workflow-method', 'personal-workflow-execution'].includes(message.source.kind))
        && dynamicTools.some(tool => !binding.dynamicTools?.includes(tool.name))) {
        throw new Error('Codex task declarations changed; create a new conversation for task enhancement or execution')
      }
      for (const message of messages) this.session.append('user/message', message, { surfaceOp: 'append' })
      const effort: CodexEffort = effortSchema.parse(selection.effort)
      const cwd = this.cwd
      runtime = await openCodexRuntime({ ...this.spec(cwd), dynamicTools,
        onRequest: (request, lifetime) => answerNativeRequest(this.ctx, this, turn, request, AbortSignal.any([signal, lifetime])),
      }, signal)
      if (signal.aborted) onAbort()
      signal.throwIfAborted()
      try { await this.reconcile(runtime) }
      catch (error: unknown) {
        const threadId = this.state().threadId
        if (threadId !== null) this.session.append('codex/recovery', { threadId, status: 'unknown' })
        throw error
      }
      signal.throwIfAborted()
      const before = this.state()
      if (before.threadId === null) {
        // Validate availability before reserving a potentially side-effecting thread/start.
        const catalog = await runtime.catalog(true)
        if (catalog.account.requiresOpenaiAuth && catalog.account.kind === 'none') {
          throw new Error('codex-runtime: login required; sign in with native Codex, then send again')
        }
        if (!catalog.models.some(model => model.model === selection.model && model.efforts.includes(effort))) {
          throw new Error('codex-runtime: unavailable model or effort; refresh models')
        }
        this.session.append('codex/thread-preparing', { cwd, selection })
        await this.flush()
        signal.throwIfAborted()
        const thread = await runtime.startThread({ mode: 'native', model: selection.model, effort })
        this.session.append('codex/thread-bound', { threadId: thread.id, cwd, runtimeVersion: selection.runtimeVersion,
          dynamicTools: dynamicTools.map(tool => tool.name) })
        await this.flush()
      } else {
        try {
          await runtime.resumeThread(before.threadId, { mode: 'native', model: selection.model, effort })
          this.session.append('codex/recovery', { threadId: before.threadId, status: 'verified' })
        } catch (error: unknown) {
          this.session.append('codex/recovery', { threadId: before.threadId, status: 'unknown' })
          throw error
        }
      }
      signal.throwIfAborted()
      const texts = messages.flatMap(message => message.content.flatMap(part => part.type === 'text' ? [part.text] : []))
      const observedItems = new Set<string>()
      let itemError: Error | undefined
      const threadId = this.state().threadId
      if (threadId === null) throw new Error('Codex dispatch requires a bound thread')
      const receipt = await runtime.send({ inputId, texts, persistIntent: async (intent) => {
        this.session.append('codex/send-intent', { turn, inputId, threadId: intent.threadId, params: z.json().parse(intent.params) })
        await this.flush()
        signal.throwIfAborted()
      } }, (event) => {
        try {
          if (event.type === 'text-delta') {
            if (!streamed) { attempt.start(); attempt.push({ type: 'block-start', index: 0, blockType: 'text' }); streamed = true }
            attempt.push({ type: 'text-delta', index: 0, text: event.text })
          } else {
            observedItems.add(event.itemId)
            this.session.append('codex/item', { turn, threadId, turnId: event.turnId, itemId: event.itemId, item: z.json().parse(event.item) })
          }
        } catch (error: unknown) { itemError = error instanceof Error ? error : new Error('Codex item persistence failed', { cause: error }) }
      })
      nativeTurnId = receipt.turnId
      this.session.append('codex/send-receipt', { turn, inputId, threadId: receipt.threadId, turnId: receipt.turnId })
      await this.flush()
      terminal = await receipt.terminal
      if (itemError !== undefined) throw itemError
      for (const item of terminal.items) {
        const itemId = z.string().min(1).parse(item.id)
        if (!observedItems.has(itemId)) this.session.append('codex/item', { turn, threadId: receipt.threadId, turnId: receipt.turnId,
          itemId: brandString<CodexItemId>(itemId), item: z.json().parse(item) })
      }
      const result: ResultData = { turn, inputId, threadId: receipt.threadId, turnId: terminal.turnId,
        status: terminal.status, finalText: terminal.finalText, items: terminal.items.map(item => z.json().parse(item)), usage: 'unknown', recovered: false }
      this.session.append('codex/turn-result', result)
      this.settleText(result, attempt)
      await this.flush()
      await this.dispatch.serial('agent/turn-stopping', { turn, signal })
      reason = terminal.status === 'completed' ? { kind: 'completed' }
        : terminal.status === 'interrupted' ? { kind: 'aborted', reason: operation.cancelCause ?? { kind: 'legacy' } }
          : { kind: 'error', error: { code: 'UNKNOWN', message: 'Codex reported a failed turn' } }
    } catch (error: unknown) {
      const category = error instanceof CodexRuntimeError ? error.category : 'bridge'
      const state = this.state()
      const unknown = state.status === 'sending' || state.status === 'running' || state.status === 'unknown'
        || category === 'unknown-thread' || category === 'unknown-send'
      // Callback writes may complete before an awaited RPC rejects.
      if (terminal === undefined && (state.status === 'sending' || state.status === 'running' || state.status === 'preparing' || category === 'unknown-thread' || category === 'unknown-send')) {
        this.session.append('codex/turn-result', { turn, inputId: state.inputId ?? inputId,
          threadId: state.threadId, turnId: nativeTurnId ?? state.turnId,
          status: unknown ? 'unknown' : 'failed', finalText: null, items: [], usage: 'unknown', recovered: false })
      }
      this.session.append('codex/diagnostic', { category })
      reason = signal.aborted && operation.cancelCause !== null
        ? { kind: 'aborted', reason: operation.cancelCause }
        : { kind: 'error', error: { code: 'UNKNOWN', message: error instanceof Error ? error.message : 'Codex bridge failed' } }
      if (!signal.aborted) this.dispatch.emit('agent/error', { turn, step: 1, error })
      if (!attempt.ended) attempt.abandon()
    } finally {
      signal.removeEventListener('abort', onAbort)
      // Close callback answer eligibility and drain its writes before closing the Session turn.
      const cleanup = await Promise.allSettled([stopping, runtime?.dispose()])
      if (cleanup.some(outcome => outcome.status === 'rejected')) this.session.append('codex/diagnostic', { category: 'cleanup' })
      this.session.append('step/end', { turn, step: 1 })
      this.session.append('turn/end', { turn, reason })
      await this.flush()
    }
    return reason.kind === 'completed'
  }
}
