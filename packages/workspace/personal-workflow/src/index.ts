/** Personal task plan authority over atomic storage-domain records. */
import { z } from 'zod'
import { WorkflowExecution } from './execution.ts'
import { createHash } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import { defineDomain, domainTable, type KvTable } from '@deepseek-ai/dsh-storage-domain'
import type { Session, SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-personal-project'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-session-query'
import { approveSchema, operationIdSchema, readSchema, saveSchema, storedPlanSchema } from './schema.ts'
import { workflowModeProjection, workflowModeSchema } from './mode-projection.ts'
import type {} from '@deepseek-ai/dsh-session-projection'
import { exportPlan } from './projection.ts'
import type {
  ApprovePlanRequest, OperationId, PlanDefinition, PlanRevision, PlanView, ReadPlanRequest,
  SavePlanRequest, StoredPlan, TaskId, WorkflowSnapshot, WorkflowMode, SetWorkflowModeRequest, WorkflowAssessment,
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

/** Deployment ceilings resolved before execution authorization is accepted. */
export interface Config {
  /** Maximum tool actions in one attempt, including all handoffs. */
  maxActions?: number
  /** Maximum user or automatic progression inputs in one attempt. */
  maxTurns?: number
  /** Maximum elapsed milliseconds from initial task claim. */
  maxDurationMs?: number
  /** Maximum total bytes read for one workspace observation. */
  maxEvidenceBytes?: number
  /** Tool names excluded from selected-task execution; include renamed delegation tools. */
  blockedTools?: string[]
}

/** Sole plan writer; approvals never create execution attempts. */
export class PersonalWorkflow extends Service {
  static Config = z.object({
    maxActions: z.number().int().positive().default(100),
    maxTurns: z.number().int().positive().default(20),
    maxDurationMs: z.number().int().positive().default(3600000),
    maxEvidenceBytes: z.number().int().positive().default(16777216),
    blockedTools: z.array(z.string().min(1)).default(['subagent', 'subagent_fork', 'subagent_codex', 'subagent_claude_code', 'send_message']),
  }).prefault({})
  /** Task execution writer sharing atomic plan transactions. */
  readonly execution: WorkflowExecution
  static inject = ['storageDomain', 'sessions', 'sessionPersistence', 'sessionQuery', 'personalProjects', 'sessionProjections']
  private plans?: KvTable<TaskId, StoredPlan>
  private tail: Promise<void> = Promise.resolve()
  private closing = false

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'personalWorkflow')
    this.execution = new WorkflowExecution(ctx, () => this.table(), work => this.enqueue(work), PersonalWorkflow.Config.parse(config))
  }

  protected async [Service.init](): Promise<void> {
    this.ctx.sessionProjections.register(workflowModeProjection)
    const domain = await this.ctx.storageDomain.open(domainSpec)
    this.plans = domain.table('plans')
    this.ctx.effect(() => async () => {
      this.closing = true
      await this.tail
      await domain.close()
    }, 'personal-workflow.domainClose')
    await this.execution.recover()
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

  /** Read the Session-log projection for tool visibility; this grants no operation permission.
   * @param session - Session whose current mode selection is displayed.
   * @returns Log-derived mode selection.
   */
  selectedMode(session: Session): WorkflowMode {
    const mode = this.ctx.sessionProjections.stateOf(session, 'personalWorkflowMode')
    if (mode === undefined) throw new Error('personal-workflow: mode projection unavailable')
    return mode
  }

  /** Read only the persisted mode, so a failed flush never enables planning.
   * @param session - Session selected by the user.
   * @returns Latest durable selection, initially disabled.
   */
  async mode(session: Session): Promise<WorkflowMode> {
    await using handle = await this.ctx.sessionPersistence.open(session.id, 'read')
    const { events } = await handle.read()
    const event = events.findLast(item => item.type === 'personal-workflow/mode')
    return event?.type === 'personal-workflow/mode'
      ? workflowModeSchema.parse({ enabled: event.data.enabled, revision: event.data.revision }) : { enabled: false, revision: 0 }
  }

  /** Persist an explicit user mode selection without creating a plan or starting work.
   * @param session - Existing Session receiving the selection.
   * @param request - Compare-and-set gesture with retry identity.
   * @returns Committed mode after durable flush.
   */
  setMode(session: Session, request: SetWorkflowModeRequest): Promise<WorkflowMode> {
    return this.enqueue(async () => {
      operationIdSchema.parse(request.operationId)
      if (request.sessionId !== session.id || !Number.isInteger(request.expectedRevision) || request.expectedRevision < 0) throw new Error('invalid-mode-request')
      if (request.enabled && !this.ctx.personalProjects.allowsSkill(session, 'dev-workflow')) throw new Error('dev-workflow Skill is disabled by the current Bot')
      using observation = await this.ctx.sessionQuery.observeSession(session.id, { projectionMode: 'none' })
      const existing = observation.events.find(event => event.type === 'personal-workflow/mode' && event.data.operationId === request.operationId)
      if (existing?.type === 'personal-workflow/mode') {
        if (existing.data.enabled !== request.enabled || existing.data.revision !== request.expectedRevision + 1) throw new Error('operation-id-conflict')
      } else {
        const current = await this.mode(session)
        if (this.selectedMode(session).revision !== current.revision) throw new Error('personal-workflow: retry the pending mode operation before another choice')
        if (current.revision !== request.expectedRevision) throw new Error('mode-revision-conflict')
        session.append('personal-workflow/mode', { enabled: request.enabled, revision: current.revision + 1, operationId: request.operationId })
      }
      if (!await this.ctx.sessions.flush(session)) throw new Error('personal-workflow: Session has no durability listener')
      const committed = await this.mode(session)
      if (committed.revision < request.expectedRevision + 1) throw new Error('personal-workflow: mode was not persisted')
      this.ctx.logger.info(`personal-workflow sessionId=${session.id} decisionCode=mode-selection result=committed`)
      return committed
    })
  }

  /** Record model routing independently of proposal creation.
   * @param session - Calling model's Session.
   * @param assessment - Goal classification and reason, with the observed mode version.
   * @returns Durable routing decision; never an execution authorization.
   */
  assess(session: Session, assessment: WorkflowAssessment): Promise<WorkflowAssessment> {
    return this.enqueue(async () => {
      await this.requireMode(session, assessment.modeRevision)
      session.append('personal-workflow/assessment', assessment)
      if (!await this.ctx.sessions.flush(session)) throw new Error('personal-workflow: Session has no durability listener')
      this.ctx.logger.info(`personal-workflow sessionId=${session.id} decisionCode=${assessment.decision} result=assessed`)
      return assessment
    })
  }

  /** Check current mode and Skill permission at the operation that consumes them.
   * @param session - Calling Session.
   * @param revision - Exact mode version observed by the model.
   * @returns Resolved enabled mode or a rejection.
   */
  async requireMode(session: Session, revision: number): Promise<WorkflowMode> {
    const mode = await this.mode(session)
    if (!mode.enabled || mode.revision !== revision) throw new Error('personal-workflow: enhancement mode is off or changed')
    if (!this.ctx.personalProjects.allowsSkill(session, 'dev-workflow')) throw new Error('dev-workflow Skill is disabled by the current Bot')
    return mode
  }

  /** Read all current plan views; this does not bind or start a Session.
   * @returns current persisted plans and computed candidates.
   */
  list(): PlanView[] {
    return [...this.table().entries()].map(([, plan]) => this.execution.view(plan))
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

  /** Submit an assessed complex goal through the enabled-mode model path.
   * @param session - Calling Agent's Session.
   * @param modeRevision - Mode version observed during assessment.
   * @param request - Unapproved structured proposal.
   * @returns Persisted plan and Session snapshot.
   */
  async propose(session: Session, modeRevision: number, request: unknown): Promise<WorkflowSnapshot> {
    const parsed = saveSchema.parse(request)
    const revision = await this.commitProposal(parsed, 'model', session.id, { session, modeRevision })
    return this.recordSnapshot(session, parsed.operationId, revision)
  }

  private commitProposal(request: SavePlanRequest, source: 'user' | 'model', sessionId: SessionId | null, enhancement?: { session: Session; modeRevision: number }): Promise<PlanRevision> {
    return this.enqueue(async () => {
      try {
        if (enhancement !== undefined) {
          await this.requireMode(enhancement.session, enhancement.modeRevision)
          await using handle = await this.ctx.sessionPersistence.open(enhancement.session.id, 'read')
          const { events } = await handle.read()
          const assessment = events.findLast(event => event.type === 'personal-workflow/assessment')
          if (assessment?.type !== 'personal-workflow/assessment' || assessment.data.modeRevision !== enhancement.modeRevision || assessment.data.decision !== 'complex') throw new Error('personal-workflow: clarify and assess a complex goal before proposing')
          const goal = events.findLast(event => event.type === 'user/message' && event.data.source.kind === 'user')
          if (goal !== undefined && assessment.seq < goal.seq) throw new Error('personal-workflow: assess the current goal before proposing')
          const affiliation = this.ctx.personalProjects.affiliation(enhancement.session).current
          if (request.definition.projectId !== (affiliation.projectId ?? null) || request.definition.botId !== (affiliation.botId ?? null)) throw new Error('personal-workflow: proposal affiliation differs from its conversation')
        }
        const parsed = saveSchema.parse(request)
        const { definition, operationId } = parsed
        const fingerprint = digest({ kind: 'save', source, sessionId, ...parsed })
        const table = this.table()
        const previous = table.get(definition.taskId)
        const retry = this.retry(previous, operationId, fingerprint)
        if (retry) return retry
        if ((previous?.revisions.length ?? 0) !== parsed.expectedRevision) throw new Error('revision-conflict')
        if (previous?.runs?.some(run => run.status === 'running' || run.actions.some(action => action.status === 'pending' || action.status === 'unknown') || run.handoffs.some(handoff => handoff.status === 'prepared'))) throw new Error('stop-execution-before-editing')
        this.validateIdentity(definition, previous)
        const snapshot: PlanRevision = {
          revision: parsed.expectedRevision + 1, definition, source, sessionId,
          createdAt: Date.now(), approval: null,
        }
        const next: StoredPlan = {
          ...previous, taskId: definition.taskId, revisions: [...previous?.revisions ?? [], snapshot],
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
    if (plan?.executionReceipts?.some(receipt => receipt.operationId === operationId)
      || plan?.runs?.some(run => run.handoffs.some(handoff => handoff.operationId === operationId))) throw new Error('operation-id-conflict')
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
