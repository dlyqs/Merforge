/** Personal task plan authority over atomic storage-domain records. */
import { createHash } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import { defineDomain, domainTable, type KvTable } from '@deepseek-ai/dsh-storage-domain'
import type { Session, SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-personal-project'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-session-query'
import { approveSchema, operationIdSchema, readSchema, saveSchema, storedPlanSchema } from './schema.ts'
import { exportPlan, projectPlan } from './projection.ts'
import type {
  ApprovePlanRequest, OperationId, PlanDefinition, PlanRevision, PlanView, ReadPlanRequest,
  SavePlanRequest, StoredPlan, TaskId, WorkflowSnapshot,
} from './types.ts'
export type * from './types.ts'
export { exportPlan, projectPlan } from './projection.ts'

const domainSpec = defineDomain({
  name: 'personal_workflow', version: 1,
  tables: { plans: domainTable<TaskId, StoredPlan>(storedPlanSchema) },
})

declare module '@deepseek-ai/cordis' {
  interface Context {
    personalWorkflow: PersonalWorkflow
  }
}

/** Sole plan writer; approvals never create execution attempts. */
export class PersonalWorkflow extends Service {
  static inject = ['storageDomain', 'sessions', 'sessionPersistence', 'sessionQuery', 'personalProjects']
  private plans?: KvTable<TaskId, StoredPlan>
  private tail: Promise<void> = Promise.resolve()
  private closing = false

  constructor(ctx: Context) { super(ctx, 'personalWorkflow') }

  protected async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(domainSpec)
    this.plans = domain.table('plans')
    this.ctx.effect(() => async () => {
      this.closing = true
      await this.tail
      await domain.close()
    }, 'personal-workflow.domainClose')
    const ids = new Set<TaskId>()
    for (const [key, plan] of this.plans.entries()) {
      if (key !== plan.taskId) throw new Error('personal-workflow: stored plan identity mismatch')
      const owned = new Set(plan.revisions.flatMap(revision => revision.definition.tasks.map(task => task.id)))
      for (const id of owned) {
        if (ids.has(id)) throw new Error('personal-workflow: task identity belongs to multiple plans')
        ids.add(id)
      }
    }
  }

  private table(): KvTable<TaskId, StoredPlan> {
    if (!this.plans) throw new Error('personal-workflow: service unavailable')
    return this.plans
  }

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    if (this.closing) return Promise.reject(new Error('personal-workflow: service closing'))
    const result = this.tail.then(work)
    this.tail = result.then(() => undefined, () => undefined)
    return result
  }

  /** Read all current plan views; this does not bind or start a Session.
   * @returns current persisted plans and computed candidates.
   */
  list(): PlanView[] {
    return [...this.table().entries()].map(([, plan]) => projectPlan(latest(plan)))
  }

  /** Read one exact version, retaining approvals on historical versions.
   * @param request - root task identity and optional exact revision.
   * @returns stored revision, or an error for an unknown plan/version.
   */
  read(request: ReadPlanRequest): PlanRevision {
    const parsed = readSchema.parse(request)
    const plan = this.table().get(parsed.taskId)
    const revision = parsed.revision === undefined ? plan?.revisions.at(-1) : plan?.revisions[parsed.revision - 1]
    if (!revision) throw new Error('personal-workflow: plan or revision not found')
    return revision
  }

  /** Save a user-authored proposal or edit without approving it.
   * @param request - complete definition with expected current version and retry identity.
   * @returns committed unapproved revision, or the original retry receipt.
   */
  save(request: SavePlanRequest): Promise<PlanRevision> {
    return this.commitProposal(request, 'user', null)
  }

  /** Submit a model proposal and durably record what its Session observed.
   * @param session - initiating Agent's Session.
   * @param request - complete proposal; cannot carry an approval or execution status.
   * @returns the committed snapshot after Session persistence succeeds.
   */
  async propose(session: Session, request: SavePlanRequest): Promise<WorkflowSnapshot> {
    const revision = await this.commitProposal(request, 'model', session.id)
    return this.recordSnapshot(session, request.operationId, revision)
  }

  private commitProposal(request: SavePlanRequest, source: 'user' | 'model', sessionId: SessionId | null): Promise<PlanRevision> {
    return this.enqueue(async () => {
      try {
        const parsed = saveSchema.parse(request)
        const { definition, operationId } = parsed
        const fingerprint = digest({ kind: 'save', source, sessionId, ...parsed })
        const table = this.table()
        const previous = table.get(definition.taskId)
        const retry = this.retry(previous, operationId, fingerprint)
        if (retry) return retry
        if ((previous?.revisions.length ?? 0) !== parsed.expectedRevision) throw new Error('revision-conflict')
        this.validateIdentity(definition, previous)
        const snapshot: PlanRevision = {
          revision: parsed.expectedRevision + 1, definition, source, sessionId,
          createdAt: Date.now(), approval: null,
        }
        const next: StoredPlan = {
          taskId: definition.taskId, revisions: [...previous?.revisions ?? [], snapshot],
          receipts: [...previous?.receipts ?? [], { operationId, fingerprint, snapshot }],
        }
        if (previous) {
          await table.update(definition.taskId, (current) => {
            if (current.revisions.length !== parsed.expectedRevision) throw new Error('revision-conflict')
            return next
          })
        } else await table.put(definition.taskId, next)
        this.ctx.logger.info(`personal-workflow taskId=${definition.taskId} planRevision=${snapshot.revision} operationId=${operationId} decisionCode=proposal result=committed`)
        return snapshot
      } catch (error) {
        this.ctx.logger.warn('personal-workflow decisionCode=proposal-rejected result=failed')
        throw error
      }
    })
  }

  private validateIdentity(definition: PlanDefinition, previous: StoredPlan | undefined): void {
    const current = previous?.revisions.at(-1)?.definition
    if (current && (current.projectId !== definition.projectId || current.botId !== definition.botId)) {
      throw new Error('personal-workflow: task affiliation is immutable')
    }
    if (!current) {
      if (definition.projectId !== null && !this.ctx.personalProjects.getProject(definition.projectId)) throw new Error('unknown project')
      if (definition.botId !== null && !this.ctx.personalProjects.getBot(definition.botId)) throw new Error('unknown bot')
    }
    const currentIds = new Set(current?.tasks.map(task => task.id))
    const historicIds = new Set(previous?.revisions.flatMap(revision => revision.definition.tasks.map(task => task.id)))
    for (const task of definition.tasks) {
      if (historicIds.has(task.id) && !currentIds.has(task.id)) throw new Error('retired task identity cannot be reused')
    }
    const requested = new Set(definition.tasks.map(task => task.id))
    for (const [, plan] of this.table().entries()) {
      if (plan.taskId === definition.taskId) continue
      if (plan.revisions.some(revision => revision.definition.tasks.some(task => requested.has(task.id)))) {
        throw new Error('task identity belongs to another plan')
      }
    }
  }

  private retry(plan: StoredPlan | undefined, operationId: OperationId, fingerprint: string): PlanRevision | undefined {
    const receipt = plan?.receipts.find(receipt => receipt.operationId === operationId)
    if (!receipt) return undefined
    if (receipt.fingerprint !== fingerprint) throw new Error('operation-id-conflict')
    return receipt.snapshot
  }

  /** Approve only the current exact version through the human command surface.
   * @param request - expected version and unique retry identity.
   * @returns approved revision; no execution is started.
   */
  approve(request: ApprovePlanRequest): Promise<PlanRevision> {
    return this.enqueue(async () => {
      try {
        const parsed = approveSchema.parse(request)
        const fingerprint = digest({ kind: 'approve', ...parsed })
        const table = this.table()
        const previous = table.get(parsed.taskId)
        const retry = this.retry(previous, parsed.operationId, fingerprint)
        if (retry) return retry
        const updated = await table.update(parsed.taskId, (current) => {
          if (current.revisions.length !== parsed.expectedRevision) throw new Error('revision-conflict')
          const revision = latest(current)
          const snapshot: PlanRevision = {
            ...revision, approval: revision.approval ?? { operationId: parsed.operationId, time: Date.now() },
          }
          return {
            ...current, revisions: [...current.revisions.slice(0, -1), snapshot],
            receipts: [...current.receipts, { operationId: parsed.operationId, fingerprint, snapshot }],
          }
        })
        this.ctx.logger.info(`personal-workflow taskId=${parsed.taskId} planRevision=${parsed.expectedRevision} operationId=${parsed.operationId} decisionCode=approval result=committed`)
        return latest(updated)
      } catch (error) {
        this.ctx.logger.warn('personal-workflow decisionCode=approval-rejected result=failed')
        throw error
      }
    })
  }

  /** Export exactly the requested structured version as read-only Markdown.
   * @param request - root identity and optional exact version.
   * @returns Markdown from the persisted version.
   */
  export(request: ReadPlanRequest): string { return exportPlan(this.read(request)) }

  /** Persist an observed plan version before returning it to a model consumer.
   * @param session - reading Session, not an execution owner.
   * @param request - exact version or current version on the first attempt.
   * @param operationId - stable retry identity for this read.
   * @returns the durable snapshot, preserved across retries and later edits.
   */
  snapshot(session: Session, request: ReadPlanRequest, operationId: OperationId): Promise<WorkflowSnapshot> {
    const parsed = readSchema.parse(request)
    const id = operationIdSchema.parse(operationId)
    return this.enqueue(async () => {
      using observation = await this.ctx.sessionQuery.observeSession(session.id, { projectionMode: 'none' })
      const existing = observation.events.find(event => event.type === 'personal-workflow/snapshot' && event.data.operationId === id)
      if (existing?.type === 'personal-workflow/snapshot') {
        if (existing.data.taskId !== parsed.taskId
          || (parsed.revision !== undefined && existing.data.snapshot.revision !== parsed.revision)) {
          throw new Error('operation-id-conflict')
        }
        await this.flushSnapshot(session, existing.data)
        return existing.data
      }
      return await this.appendSnapshot(session, id, this.read(parsed))
    })
  }

  private recordSnapshot(session: Session, operationId: OperationId, snapshot: PlanRevision): Promise<WorkflowSnapshot> {
    return this.enqueue(() => this.appendSnapshot(session, operationId, snapshot))
  }

  private async appendSnapshot(session: Session, operationId: OperationId, snapshot: PlanRevision): Promise<WorkflowSnapshot> {
    const data: WorkflowSnapshot = { taskId: snapshot.definition.taskId, operationId, snapshot }
    using observation = await this.ctx.sessionQuery.observeSession(session.id, { projectionMode: 'none' })
    const existing = observation.events.find(event =>
      event.type === 'personal-workflow/snapshot' && event.data.operationId === operationId)
    if (existing?.type === 'personal-workflow/snapshot') {
      if (JSON.stringify(existing.data) !== JSON.stringify(data)) throw new Error('operation-id-conflict')
    } else session.append('personal-workflow/snapshot', data)
    await this.flushSnapshot(session, data)
    return existing?.type === 'personal-workflow/snapshot' ? existing.data : data
  }

  private async flushSnapshot(session: Session, data: WorkflowSnapshot): Promise<void> {
    if (!await this.ctx.sessions.flush(session)) throw new Error('personal-workflow: Session has no durability listener')
    await using handle = await this.ctx.sessionPersistence.open(session.id, 'read')
    const { events } = await handle.read()
    if (!events.some(event => event.type === 'personal-workflow/snapshot' && JSON.stringify(event.data) === JSON.stringify(data))) {
      throw new Error('personal-workflow: Session snapshot was not persisted')
    }
  }
}

function latest(plan: StoredPlan): PlanRevision {
  const revision = plan.revisions.at(-1)
  if (revision === undefined) throw new Error('personal-workflow: plan has no revisions')
  return revision
}

function digest(value: object): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex') }

export default PersonalWorkflow
