/** Native account transport adapter for the standard Session, Chat, Trajectory and composer. */
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionTaskChoiceId } from '@deepseek-ai/dsh-api-session-controller/client'
import { SessionSeq } from '@deepseek-ai/dsh-session/types'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { MutableSessionEventSource } from '@deepseek-ai/dsh-api-session-controller/client'
import type { BeginSubmissionInput, ExternalSessionTarget, SessionControls, SessionFace, SessionSnapshot, SubmissionHandle } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ModelCatalog, ModelSelection, PromptContentPart, SessionRequestId } from '@deepseek-ai/dsh-api-session-controller/types'
import type { ConversationRequest, ConversationResult } from '@deepseek-ai/dsh-organization-conversation/protocol'
import type { OrganizationDesktopBridge, OrganizationDesktopSnapshot } from '@deepseek-ai/dsh-organization-connection/types'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
type Query = Pick<ConversationRequest, 'organizationId' | 'projectId' | 'conversationId' | 'assignment' | 'botId'>
/** One already-authorized private Session; business records remain with the native Host. */
export class AccountSession implements ExternalSessionTarget {
  readonly kind = 'external'
  readonly title = createSnapshotStore('')
  readonly session: SessionFace
  readonly controls: SessionControls
  private result: ConversationResult
  private readonly state: SnapshotStore<SessionSnapshot>
  private readonly projections = new Map<string, SnapshotStore<unknown>>()
  private readonly candidates = new Map<SessionTaskChoiceId, Extract<ConversationRequest, { kind: 'select-task' }>['target']>()
  private selection: ModelSelection | undefined
  private readonly submissions = new Map<SessionRequestId, BeginSubmissionInput>()
  private pendingRequest: Extract<ConversationRequest, { kind: 'send' }> | undefined
  private active = true
  private generation: number
  /**
   * @param initial - Current authorized native report.
   * @param query - Account-owned conversation selectors.
   * @param native - Fixed private operation callbacks.
   * @param identity - Current native identity and generation.
   * @param changed - Refresh account navigation after a committed change.
   * @param execute - Open task execution settings in the main task detail area.
   * @param manage - Open the standard conversation management controls.
   * @param emptyTitle - Localized title for an empty conversation.
   * @param eventSource - Standard Controller event publisher owned by this transport.
   */
  constructor(initial: { generation: number; result: ConversationResult }, private readonly query: Query,
    private readonly native: Pick<OrganizationDesktopBridge, 'conversation' | 'connection'>,
    private readonly identity: ObservableSnapshot<OrganizationDesktopSnapshot>, private readonly changed: () => void,
    execute: (report: ConversationResult) => void, manage: () => void, private readonly emptyTitle: string,
    readonly eventSource: MutableSessionEventSource) {
    this.result = initial.result; this.generation = initial.generation
    this.state = createSnapshotStore<SessionSnapshot>({ sessionId: initial.result.sessionId, pendingSubmissions: [], running: false,
      subagent: null, removed: false, openState: 'open', openError: null, hasMore: initial.result.truncated, loadingOlder: false,
      promptError: null, blank: initial.result.entries.length === 0, lastAgentError: null, promptAttempted: false,
      awaitingFirstTurn: false })
    const catalog = createSnapshotStore<ReturnType<SessionControls['catalog']['store']['getSnapshot']>>({ value: null,
      status: 'idle', error: null })
    const load = async (): Promise<ModelCatalog> => {
      this.assertCurrent(); catalog.set({ ...catalog.getSnapshot(), status: 'loading', error: null })
      try {
        const read = await native.connection({ kind: 'planning-read', request: query }); this.assertCurrent()
        if (!read.planning) throw new Error('organization-conversation: planning-required')
        const models = read.planning.policy.models
        const groups = [...new Set(models.map(model => model.endpoint))].map(endpoint => ({ id: endpoint, name: endpoint,
          models: models.filter(model => model.endpoint === endpoint).map(model => ({ id: model.model, name: model.model })) }))
        const stored = this.result.selection ?? this.result.catalog?.bots.find(bot => bot.id === query.botId)?.selection
        const fallback = stored ?? models[0]
        if (!fallback) throw new Error('organization-conversation: model-required')
        const value: ModelCatalog = { groups, failures: [], routableProviders: groups.map(group => group.id),
          default: { provider: fallback.endpoint, model: fallback.model } }
        this.selection ??= value.default
        this.project('modelSelection').set({ next: this.selection, lastUsed: null })
        catalog.set({ value, status: 'ready', error: null }); return value
      } catch (error: unknown) {
        if (this.active) catalog.set({ value: null, status: 'error', error: error instanceof Error ? error.message : String(error) })
        throw error
      }
    }
    const current = () => this.result
    this.controls = {
      get assigned() { return !!current().execution },
      get taskTitle() { return current().execution?.title },
      get taskId() { const id = current().execution?.target.taskId; return id ? brandString<SessionTaskChoiceId>(id) : undefined },
      listTasks: async () => {
        this.assertCurrent()
        const tasks: Awaited<ReturnType<SessionControls['listTasks']>>[number][] = []
        this.candidates.clear()
        let offset = 0, cursor: string | undefined
        while (this.active) {
          const page = await native.connection({ kind: 'workgraph-tasks', request: { organizationId: query.organizationId,
            projectId: query.projectId, offset, ...(cursor ? { cursor } : {}) } })
          this.assertCurrent()
          if (page.workgraph?.result.kind !== 'tasks' || page.workgraph.generation !== this.generation) throw new Error('organization-conversation: superseded')
          const value = page.workgraph.result.value
          for (const task of value.items) {
            if (this.result.assignment && task.id !== this.result.assignment.taskId) continue
            const id = brandString<SessionTaskChoiceId>(task.id)
            this.candidates.set(id, { planId: task.planId, taskId: task.id })
            tasks.push({ id, title: task.goal, scope: task.scope, acceptance: task.acceptance, artifacts: task.artifacts })
          }
          offset += value.items.length; cursor = value.cursor
          if (!value.items.length || offset >= value.total) break
        }
        return tasks
      },
      selectTask: async (id) => {
        const target = this.candidates.get(id)
        if (!target) throw new Error('organization-conversation: task-required')
        await this.perform({ ...query, kind: 'select-task', target, operationId: randomUUID() as ConversationRequest['operationId'] })
      },
      catalog: { store: catalog, load, refresh: () => { void load().catch(() => {}) } },
      selectModel: async (selection) => {
        await this.perform({ ...query, kind: 'select-model', operationId: randomUUID() as ConversationRequest['operationId'],
          selection: { endpoint: selection.provider, model: selection.model } })
        this.selection = selection; this.project('modelSelection').set({ next: selection, lastUsed: null })
        return { ok: true, value: { selected: selection } }
      },
      readMode: () => { this.assertCurrent(); return Promise.resolve(this.result.settings) },
      setMode: async (enabled, expectedRevision, operationId) => {
        await this.perform({ ...query, kind: 'settings', operationId: brandString<ConversationRequest['operationId']>(operationId), expectedRevision,
          settings: { enabled, granularity: this.result.settings.granularity } }); return this.result.settings
      },
      openExecution: () => { this.assertCurrent(); execute(this.result) }, manage,
    }
    const unsupported = (): Promise<never> => Promise.reject(new Error('organization-conversation: action-unavailable'))
    this.session = {
      sessionId: initial.result.sessionId, getSnapshot: () => this.state.getSnapshot(),
      subscribe: listener => this.state.subscribe(listener),
      projections: { faceOf: key => this.project(key) },
      beginSubmission: input => this.begin(input), prompt: (content, _mode, signal) => this.prompt(content, signal),
      cancel: async () => { await this.perform({ ...query, kind: 'stop', operationId: randomUUID() as ConversationRequest['operationId'] })
        return { ok: true, value: { accepted: true } } },
      rename: async (title) => { await this.perform({ ...query, kind: 'rename', title, operationId: randomUUID() as ConversationRequest['operationId'] })
        this.title.set(title)
        return { ok: true, value: { title, seq: SessionSeq(this.eventSource.getSnapshot().entries.at(-1)?.event.seq ?? 0) } } },
      readAttachment: unsupported, updateQueue: unsupported, command: unsupported,
      loadOlder: async () => { await this.perform({ ...query, kind: 'read',
        operationId: randomUUID() as ConversationRequest['operationId'] }) },
      loadThrough: async () => { await this.session.loadOlder() },
    }
    this.update(initial.result)
    void load().catch(() => {})
  }
  private project(key: string): SnapshotStore<unknown> {
    let source = this.projections.get(key)
    if (!source) { source = createSnapshotStore<unknown>(undefined); this.projections.set(key, source) }
    return source
  }
  private begin(input: BeginSubmissionInput): SubmissionHandle {
    const requestId = randomUUID() as SessionRequestId
    this.assertCurrent(); this.submissions.set(requestId, input)
    this.state.set({ ...this.state.getSnapshot(), pendingSubmissions: [...this.state.getSnapshot().pendingSubmissions,
      { requestId, placement: 'transcript', time: Date.now(), text: input.text, attachments: input.attachments }] })
    return { requestId, abandon: () => {
      this.state.set({ ...this.state.getSnapshot(),
        pendingSubmissions: this.state.getSnapshot().pendingSubmissions.filter(item => item.requestId !== requestId) })
      this.submissions.delete(requestId)
      input.onRetire?.({ reason: 'failed' }) } }
  }
  private assertCurrent(): void {
    const c = this.identity.getSnapshot().connection
    if (!this.active || c.phase !== 'ready' || c.mode !== 'organization' || c.generation !== this.generation
      || c.organizationId !== this.result.owner.organizationId || c.principal?.serverId !== this.result.owner.serverId
      || c.principal.accountId !== this.result.owner.accountId) throw new Error('organization-conversation: superseded')
  }
  private async perform(request: ConversationRequest): Promise<void> {
    this.assertCurrent()
    const reply = await this.native.conversation(request)
    const c = this.identity.getSnapshot().connection
    if (!this.active || c.mode !== 'organization' || c.principal?.accountId !== this.result.owner.accountId
      || c.principal.serverId !== this.result.owner.serverId || c.organizationId !== this.result.owner.organizationId
      || reply.generation !== c.generation) throw new Error('organization-conversation: superseded')
    this.generation = reply.generation; this.update(reply.result); this.changed()
  }
  private update(result: ConversationResult): void {
    this.result = result
    this.title.set(result.title || result.catalog?.conversations.find(row => row.conversationId === this.query.conversationId)?.title || result.entries.find(row => row.role === 'user')?.text.split('\n')[0] || result.execution?.title || this.emptyTitle)
    this.eventSource.replace(result.history.map(event => ({ type: 'event', event })), result.truncated)
    this.state.set({ ...this.state.getSnapshot(), blank: result.entries.length === 0, hasMore: result.truncated })
  }
  private async prompt(content: PromptContentPart[], signal?: AbortSignal) {
    this.assertCurrent(); signal?.throwIfAborted()
    const text = content.filter(part => part.type === 'text').map(part => part.text).join('\n')
    if (!this.selection || !text.trim() || content.some(part => part.type !== 'text')) throw new Error('organization-conversation: input-required')
    const goal = this.result.execution
      ? this.result.goals.find(goal => String(goal.id) === String(this.result.assignment?.id ?? this.result.execution?.target.taskId))
      : this.result.goals.at(-1)
    this.state.set({ ...this.state.getSnapshot(), running: true, promptAttempted: true, promptError: null })
    try {
      const request: Extract<ConversationRequest, { kind: 'send' }> = { ...this.query, kind: 'send',
        operationId: randomUUID() as ConversationRequest['operationId'],
        selection: { endpoint: this.selection.provider, model: this.selection.model }, text,
        route: this.result.execution ? 'query' : !goal ? 'new_goal' : goal.classification === 'clarify' ? 'clarification' : 'modify',
        ...(goal ? { goalId: goal.id } : {}), ...(this.result.execution ? { target: this.result.execution.target } : {}) }
      const fingerprint = (request: ConversationRequest) => JSON.stringify({ ...request, operationId: undefined })
      if (!this.pendingRequest || fingerprint(this.pendingRequest) !== fingerprint(request)) this.pendingRequest = request
      const abort = () => { void this.session.cancel().catch((_error: unknown) => {
        /* Native identity cancellation may have already ended the operation. */
      }) }
      signal?.addEventListener('abort', abort, { once: true })
      try { await this.perform(this.pendingRequest) } finally { signal?.removeEventListener('abort', abort) }
      if (this.result.state === 'unknown') throw new Error('organization-conversation: outcome-unknown')
      this.pendingRequest = undefined
      this.retireSubmissions(true)
      this.state.set({ ...this.state.getSnapshot(), pendingSubmissions: [] })
      return { ok: true as const, value: { accepted: true as const } }
    } catch (reason: unknown) {
      const error = new RemoteError('gateway/internal', reason instanceof Error ? reason.message : String(reason), {})
      this.retireSubmissions(false)
      if (!this.active) return { ok: false as const, error }
      this.state.set({ ...this.state.getSnapshot(), pendingSubmissions: [], promptError: { op: 'send', error } })
      return { ok: false as const, error }
    } finally { if (this.active) this.state.set({ ...this.state.getSnapshot(), running: false }) }
  }
  private retireSubmissions(observed: boolean): void {
    const inputs = [...this.submissions.values()]; this.submissions.clear()
    for (const input of inputs) input.onRetire?.(observed ? { reason: 'observed', attachments: [] } : { reason: 'failed' })
  }
  /** Retire the account generation and hide its events immediately. */
  dispose(): void {
    if (!this.active) return
    if (this.state.getSnapshot().running) void this.native.conversation({ ...this.query, kind: 'stop',
      operationId: randomUUID() as ConversationRequest['operationId'] })
      .catch((_error: unknown) => { /* Native lifetime cancellation can retire the operation before this stop arrives. */ })
    this.active = false; this.retireSubmissions(false); this.eventSource.replace([], false)
    this.state.set({ ...this.state.getSnapshot(), removed: true, running: false, pendingSubmissions: [] })
  }
}
