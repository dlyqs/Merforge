/** Organization task controls for an ordinary Controller-owned Session. */
import { brandString } from '@deepseek-ai/dsh-brand'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import type { AccountSessionTarget, SessionControls, SessionTaskChoiceId } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ModelCatalog, ModelSelection } from '@deepseek-ai/dsh-api-session-controller/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ConversationRequest, ConversationResult } from '@deepseek-ai/dsh-organization-conversation/protocol'
import type { OrganizationDesktopBridge, OrganizationDesktopSnapshot } from '@deepseek-ai/dsh-organization-connection/types'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
type Query = Pick<ConversationRequest, 'organizationId' | 'projectId' | 'conversationId' | 'assignment' | 'botId'>

/** Account task actions; submission, streaming and queues belong to the ordinary Session. */
export class AccountSession implements AccountSessionTarget {
  readonly kind = 'account'
  readonly sessionId: SessionId
  readonly controls: SessionControls
  private readonly attachmentId: NonNullable<ConversationResult['attachmentId']>
  private result: ConversationResult
  private active = true
  private disposal: Promise<void> | undefined
  private readonly identityGeneration: number
  private readonly candidates = new Map<SessionTaskChoiceId, Extract<ConversationRequest, { kind: 'select-task' }>['target']>()
  /**
   * @param initial - Native attachment report with its ordinary Session identity.
   * @param query - Account-owned selectors.
   * @param native - Fixed organization task operations.
   * @param identity - Native account lifetime.
   * @param changed - Refresh account navigation after metadata changes.
   * @param execute - Open task detail without starting a second Agent.
   * @param manage - Common conversation management action.
   * @param loadModels - Ordinary Desktop model catalog.
   * @param selectModel - Ordinary Controller model selection.
   */
  constructor(initial: { generation: number; result: ConversationResult }, private readonly query: Query,
    private readonly native: Pick<OrganizationDesktopBridge, 'conversation' | 'connection'>,
    private readonly identity: ObservableSnapshot<OrganizationDesktopSnapshot>, private readonly changed: () => void,
    execute: (report: ConversationResult) => void, manage: () => void, loadModels: () => Promise<ModelCatalog>,
    selectModel: SessionControls['selectModel']) {
    if (!initial.result.sharedSessionId) throw new Error('organization-conversation: common-session-required')
    if (!initial.result.attachmentId) throw new Error('organization-conversation: attachment-required')
    this.attachmentId = initial.result.attachmentId
    this.identityGeneration = identity.getSnapshot().connection.identityGeneration
    this.sessionId = initial.result.sharedSessionId; this.result = initial.result
    const catalog = createSnapshotStore<ReturnType<SessionControls['catalog']['store']['getSnapshot']>>({ value: null,
      status: 'idle', error: null })
    const load = async (): Promise<ModelCatalog> => {
      this.assertCurrent(); catalog.set({ ...catalog.getSnapshot(), status: 'loading', error: null })
      try {
        const value = await loadModels(); this.assertCurrent()
        catalog.set({ value, status: 'ready', error: null }); return value
      } catch (error: unknown) {
        if (this.active) catalog.set({ value: null, status: 'error', error: error instanceof Error ? error.message : String(error) })
        throw error
      }
    }
    const current = () => this.result
    this.controls = {
      get assigned() { return !!current().assignment },
      get taskTitle() { return current().execution?.title },
      get taskId() { const id = current().execution?.target.taskId; return id ? brandString<SessionTaskChoiceId>(id) : undefined },
      listTasks: async () => {
        this.assertCurrent(); this.candidates.clear()
        if (!query.projectId) return []
        const tasks: Awaited<ReturnType<SessionControls['listTasks']>>[number][] = []
        let offset = 0, cursor: string | undefined
        while (this.active) {
          const page = await native.connection({ kind: 'workgraph-tasks', request: { organizationId: query.organizationId,
            projectId: query.projectId, offset, ...(cursor ? { cursor } : {}) } })
          this.assertCurrent()
          if (page.workgraph?.result.kind !== 'tasks' || page.workgraph.generation !== this.identity.getSnapshot().connection.generation) throw new Error('organization-conversation: superseded')
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
      selectModel: async (selection: ModelSelection) => { this.assertCurrent(); return selectModel(selection) },
      readMode: () => { this.assertCurrent(); return Promise.resolve(this.result.settings) },
      setMode: async (enabled, expectedRevision, operationId) => {
        await this.perform({ ...query, kind: 'settings', operationId: brandString<ConversationRequest['operationId']>(operationId),
          expectedRevision, settings: { enabled, granularity: this.result.settings.granularity } }); return this.result.settings
      },
      openExecution: () => { this.assertCurrent(); execute(this.result) }, manage,
    }
  }
  private assertCurrent(): void {
    const c = this.identity.getSnapshot().connection
    if (!this.active || !['ready', 'loading'].includes(c.phase) || c.mode !== 'organization'
      || c.identityGeneration !== this.identityGeneration
      || c.organizationId !== this.result.owner.organizationId || c.principal?.serverId !== this.result.owner.serverId
      || c.principal.accountId !== this.result.owner.accountId) throw new Error('organization-conversation: superseded')
  }
  private async perform(request: ConversationRequest): Promise<void> {
    this.assertCurrent()
    const reply = await this.native.conversation(request)
    this.assertCurrent()
    if (reply.generation !== this.identity.getSnapshot().connection.generation) throw new Error('organization-conversation: superseded')
    this.result = { ...reply.result, attachmentId: this.result.attachmentId }; this.changed()
  }
  /** Release native authorization after its Agent stops; Controller references own history and streams.
   * @returns Settlement after the native attachment drains or its identity has already retired.
   */
  dispose(): Promise<void> {
    if (this.disposal) return this.disposal
    this.active = false
    this.disposal = this.native.conversation({ ...this.query, kind: 'detach', attachmentId: this.attachmentId, operationId: randomUUID() as ConversationRequest['operationId'] })
      .then(() => {})
      .catch((_error: unknown) => { /* Identity changes already retire the native attachment. */ })
    return this.disposal
  }
}
