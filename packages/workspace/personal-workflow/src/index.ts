/** Personal task plan authority over atomic storage-domain records. */
import { z } from 'zod'
import { WorkflowExecution } from './execution.ts'
import { preferencesSchema, setPreferencesSchema, assessmentSchema } from './planning.ts'
import { assertPersonalSessionId } from '@deepseek-ai/dsh-session'
import { createHash, randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import { defineDomain, domainTable, type KvTable, type DomainGlobal } from '@deepseek-ai/dsh-storage-domain'
import type { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-personal-project'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-session-query'
import { approveSchema, definitionSchema, operationIdSchema, readSchema, saveSchema, storedPlanSchema } from './schema.ts'
import { workflowModeProjection, workflowModeSchema } from './mode-projection.ts'
import type {} from '@deepseek-ai/dsh-session-projection'
import { exportPlan } from './projection.ts'
import type {
  ApprovePlanRequest, OperationId, PlanDefinition, PlanRevision, PlanView, ReadPlanRequest,
  WorkflowTestingPreferences, SetWorkflowTestingPreferencesRequest, SavePlanRequest, StoredPlan, TaskId,
  WorkflowSnapshot, WorkflowMode, SetWorkflowModeRequest, WorkflowAssessment, WorkflowAssessmentRequest,
  WorkflowPreferences, SetWorkflowPreferencesRequest, WorkflowPolicy, WorkflowGoal, GoalId,
} from './types.ts'
export type * from './types.ts'
export { exportPlan, projectPlan } from './projection.ts'

/** Account task providers participate in the ordinary managed-method pipeline. */
export interface WorkflowSessionAdapter {
  /** @param id - Ordinary Session identity. @returns Whether this provider owns its task data. */
  owns(id: SessionId): boolean
  /** @param session - Current Session. @param tool - Tool name. @returns Current task-tool visibility. */
  allowsTool(session: Session, tool: string): boolean
  /** @param agent - Ordinary Agent. @param decision - Claimed input. @param signal - Turn lifetime.
   * @returns Input with authorized task facts, using the ordinary durable message pipeline. */
  prepare(agent: Agent, decision: PreStepDecision, signal: AbortSignal): Promise<PreStepDecision>
}

const domainSpec = defineDomain({
  name: 'personal_workflow', version: 1,
  tables: { plans: domainTable<TaskId, StoredPlan>(storedPlanSchema) },
})

const preferencesSpec = defineDomain({
  name: 'personal_workflow_preferences', version: 1, tables: {},
  global: { schema: preferencesSchema, initial: { enabled: true, granularity: 'balanced' as const, revision: 0 } },
})

const testingPreferencesSpec = defineDomain({
  name: 'personal_workflow_testing', version: 1, tables: {},
  global: {
    schema: z.object({ forceDecomposition: z.boolean(), revision: z.number().int().nonnegative() }).strict(),
    initial: { forceDecomposition: false, revision: 0 },
  },
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
  private preferencesStore?: DomainGlobal<WorkflowPreferences>
  private testing?: DomainGlobal<WorkflowTestingPreferences>
  private plans?: KvTable<TaskId, StoredPlan>
  private tail: Promise<void> = Promise.resolve()
  private closing = false
  private readonly sessionAdapters = new Set<WorkflowSessionAdapter>()

  /**
   * Register account-owned task behavior for ordinary Sessions.
   * @param adapter - Account task provider.
   * @returns Disposer removing its contribution.
   */
  registerSessionAdapter(adapter: WorkflowSessionAdapter): () => Promise<void> {
    return this.ctx.effect(() => {
      this.sessionAdapters.add(adapter)
      return () => { this.sessionAdapters.delete(adapter) }
    }, 'personalWorkflow.registerSessionAdapter()')
  }

  /**
   * Resolve the task method owned by an account Session.
   * @param id - Ordinary Session.
   * @returns Its account task provider, when present.
   */
  sessionAdapter(id: SessionId): WorkflowSessionAdapter | undefined {
    return [...this.sessionAdapters].find(adapter => adapter.owns(id))
  }

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
    const testing = await this.ctx.storageDomain.open(testingPreferencesSpec)
    this.testing = testing.global
    this.ctx.effect(() => async () => {
      this.closing = true
      await this.tail
      await testing.close()
    }, 'personal-workflow.testingClose')
    const preferences = await this.ctx.storageDomain.open(preferencesSpec)
    this.preferencesStore = preferences.global
    this.ctx.effect(() => async () => {
      this.closing = true
      await this.tail
      await preferences.close()
    }, 'personal-workflow.preferencesClose')
    await this.execution.recover()
    const ids = new Set<TaskId>()
    const goals = new Set<string>()
    for (const [key, plan] of this.plans.entries()) {
      if (key !== plan.taskId) throw new Error('personal-workflow: stored plan identity mismatch')
      const bindings = new Set(plan.revisions.filter(revision => revision.goalId !== undefined && revision.sessionId !== null)
        .map(revision => JSON.stringify([revision.sessionId, revision.goalId])))
      if (bindings.size > 1) throw new Error('personal-workflow: plan belongs to multiple conversation goals')
      for (const binding of bindings) {
        if (goals.has(binding)) throw new Error('personal-workflow: goal belongs to multiple plans')
        goals.add(binding)
      }
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

  /** Read this profile's automatic planning defaults.
   * @returns Durable user preference and compare-and-set revision.
   */
  preferences(): WorkflowPreferences {
    if (this.preferencesStore === undefined) throw new Error('personal-workflow: preferences unavailable')
    return this.preferencesStore.get()
  }

  /** Save user defaults without changing explicit conversation selections or authorizing work.
   * @param request - User choice and exact settings revision.
   * @returns Committed preferences; stale writes are refused.
   */
  setPreferences(request: SetWorkflowPreferencesRequest): Promise<WorkflowPreferences> {
    const parsed = setPreferencesSchema.parse(request)
    return this.enqueue(async () => {
      const current = this.preferences()
      if (parsed.expectedRevision !== current.revision) throw new Error('preferences-revision-conflict')
      const next = { enabled: parsed.enabled, granularity: parsed.granularity, revision: current.revision + 1 }
      if (this.preferencesStore === undefined) throw new Error('personal-workflow: preferences unavailable')
      await this.preferencesStore.set(next)
      this.ctx.logger.info(`component=planning-settings settingsRevision=${next.revision} operation=preferences result=committed`)
      return next
    })
  }

  /** Resolve persisted mode, profile defaults and the explicit testing override.
   * @param session - Personal conversation whose permission references are captured.
   * @returns Effective planning policy, never execution authorization.
   */
  async resolve(session: Session): Promise<WorkflowPolicy> {
    assertPersonalSessionId(session.id)
    const mode = await this.mode(session)
    const preferences = this.preferences()
    const testing = this.testingPreferences()
    const affiliation = this.ctx.personalProjects.affiliation(session)
    const bot = affiliation.current.botId === undefined ? undefined : this.ctx.personalProjects.getBot(affiliation.current.botId)
    const permitted = this.ctx.personalProjects.allowsSkill(session, 'dev-workflow')
      && (bot?.allowedTools === undefined || ['workflow_assess', 'workflow_propose'].every(tool => bot.allowedTools?.includes(tool)))
    return {
      enabled: permitted && (mode.enabled || testing.forceDecomposition), forced: testing.forceDecomposition,
      granularity: preferences.granularity, modeRevision: mode.revision,
      preferencesRevision: preferences.revision, testingRevision: testing.revision,
      affiliation: JSON.stringify({ current: affiliation.current, seq: affiliation.history.at(-1)?.seq ?? null,
        allowedTools: bot?.allowedTools ?? null, allowedSkills: bot?.allowedSkills ?? null }),
    }
  }

  /** Rebuild stable goal identities and current plan associations without creating plans.
   * @param session - Personal Session containing the assessment history.
   * @returns Latest decision and authoritative plan reference for each goal.
   */
  async goals(session: Session): Promise<WorkflowGoal[]> {
    assertPersonalSessionId(session.id)
    await using handle = await this.ctx.sessionPersistence.open(session.id, 'read')
    const { events } = await handle.read()
    const goals = new Map<GoalId, WorkflowGoal>()
    for (const event of events) {
      if (event.type !== 'personal-workflow/assessment' || event.data.context === undefined || event.data.context.route === 'query') continue
      const goalId = event.data.context.goalId
      const revision = this.goalPlan(session.id, goalId)
      goals.set(goalId, { goalId, decision: event.data.decision,
        taskId: revision?.definition.taskId ?? null, revision: revision?.revision ?? null })
    }
    return [...goals.values()]
  }

  private goalPlan(sessionId: SessionId, goalId: GoalId): PlanRevision | undefined {
    for (const [, plan] of this.table().entries()) {
      if (plan.revisions.some(revision => revision.sessionId === sessionId && revision.goalId === goalId)) return plan.revisions.at(-1)
    }
    return undefined
  }

  /** Read the local testing override; it never authorizes task execution.
   * @returns Persisted switch and compare-and-set revision.
   */
  testingPreferences(): WorkflowTestingPreferences {
    if (this.testing === undefined) throw new Error('personal-workflow: testing preferences unavailable')
    return this.testing.get()
  }

  /** Persist the user's temporary override without changing conversation selections.
   * @param request - Desired switch and observed settings revision.
   * @returns Committed settings; stale writes are refused.
   */
  setTestingPreferences(request: SetWorkflowTestingPreferencesRequest): Promise<WorkflowTestingPreferences> {
    const parsed = z.object({ forceDecomposition: z.boolean(), expectedRevision: z.number().int().nonnegative() }).strict().parse(request)
    return this.enqueue(async () => {
      const current = this.testingPreferences()
      if (parsed.expectedRevision !== current.revision) throw new Error('testing-preferences-revision-conflict')
      const next = { forceDecomposition: parsed.forceDecomposition, revision: current.revision + 1 }
      if (this.testing === undefined) throw new Error('personal-workflow: testing preferences unavailable')
      await this.testing.set(next)
      return next
    })
  }

  /** Read the Session-log projection for tool visibility; this grants no operation permission.
   * @param session - Session whose current mode selection is displayed.
   * @returns Log-derived mode selection.
   */
  selectedMode(session: Session): WorkflowMode {
    const mode = this.ctx.sessionProjections.stateOf(session, 'personalWorkflowMode')
    if (mode === undefined) throw new Error('personal-workflow: mode projection unavailable')
    return { enabled: mode.selected ? mode.enabled : this.preferences().enabled, revision: mode.revision }
  }

  /** Read only the persisted mode, so a failed flush never enables planning.
   * @param session - Session selected by the user.
   * @returns Latest explicit selection, otherwise the profile default.
   */
  async mode(session: Session): Promise<WorkflowMode> {
    await using handle = await this.ctx.sessionPersistence.open(session.id, 'read')
    const { events } = await handle.read()
    const event = events.findLast(item => item.type === 'personal-workflow/mode')
    return event?.type === 'personal-workflow/mode'
      ? workflowModeSchema.parse({ enabled: event.data.enabled, revision: event.data.revision })
      : { enabled: this.preferences().enabled, revision: 0 }
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
  assess(session: Session, assessment: WorkflowAssessmentRequest): Promise<WorkflowAssessment> {
    const parsed = assessmentSchema.parse(assessment)
    return this.enqueue(async () => {
      await this.requireMode(session, parsed.modeRevision)
      if (this.execution.forSession(session.id) !== null) throw new Error('personal-workflow: selected execution cannot be decomposed')
      const policy = await this.resolve(session)
      const route = parsed.route ?? 'new_goal'
      if (policy.forced && parsed.decision === 'simple' && route !== 'query') throw new Error('personal-workflow: testing requires decomposition; clarify or assess complex before proposing')
      using observation = await this.ctx.sessionQuery.observeSession(session.id, { projectionMode: 'none' })
      const goal = observation.events.findLast(event => event.type === 'user/message' && event.data.source.kind === 'user')
      if (goal?.type !== 'user/message') throw new Error('personal-workflow: assessment requires an accepted user message')
      const method = observation.events.findLast(event => event.type === 'user/message' && event.data.source.kind === 'personal-workflow-method')
      if (method?.type === 'user/message' && method.data.source.kind === 'personal-workflow-method'
        && (method.seq < goal.seq || JSON.stringify(method.data.source.policy) !== JSON.stringify(policy))) {
        throw new Error('personal-workflow: planning settings or affiliation changed; send a new input')
      }
      const retry = observation.events.find(event => event.type === 'personal-workflow/assessment' && event.data.context?.messageId === goal.data.id)
      let data: WorkflowAssessment
      if (retry?.type === 'personal-workflow/assessment' && retry.data.context !== undefined) {
        if (retry.data.modeRevision !== parsed.modeRevision || retry.data.decision !== parsed.decision
          || retry.data.explanation !== parsed.explanation || retry.data.context.route !== route
          || (route !== 'new_goal' && retry.data.context.goalId !== parsed.goalId)) throw new Error('message-assessment-conflict')
        if (JSON.stringify(retry.data.context.policy) !== JSON.stringify(policy)) throw new Error('personal-workflow: planning settings or affiliation changed; send a new input')
        data = retry.data
      } else {
        if (route === 'new_goal' && parsed.goalId != null) throw new Error('personal-workflow: new goals cannot reuse a goal identity')
        const previous = route === 'new_goal' ? undefined : observation.events.findLast(event => event.type === 'personal-workflow/assessment'
          && event.data.context?.goalId === parsed.goalId && event.data.context?.route !== 'query')
        if (route !== 'new_goal' && previous?.type !== 'personal-workflow/assessment') throw new Error('personal-workflow: unknown goal in this conversation')
        if (route === 'clarification' && previous?.type === 'personal-workflow/assessment' && previous.data.decision !== 'clarify') throw new Error('personal-workflow: goal is not awaiting clarification')
        if (route === 'modify' && (parsed.goalId == null || this.goalPlan(session.id, parsed.goalId) === undefined)) throw new Error('personal-workflow: modification requires an existing plan')
        const goalId = route === 'new_goal' ? randomUUID() as GoalId : parsed.goalId
        if (goalId == null) throw new Error('personal-workflow: goal identity is required')
        data = { modeRevision: parsed.modeRevision, decision: parsed.decision, explanation: parsed.explanation,
          context: { goalId, messageId: goal.data.id, route, policy } }
        session.append('personal-workflow/assessment', data)
      }
      if (!await this.ctx.sessions.flush(session)) throw new Error('personal-workflow: Session has no durability listener')
      this.ctx.logger.info(`component=planning goalId=${data.context?.goalId} sessionId=${session.id} settingsRevision=${policy.preferencesRevision} decisionCode=${data.decision} operation=${route} result=assessed`)
      return data
    })
  }

  /** Check current mode and Skill permission at the operation that consumes them.
   * @param session - Calling Session.
   * @param revision - Exact mode version observed by the model.
   * @returns Validated conversation selection, or a rejection; the testing override can admit a disabled selection.
   */
  async requireMode(session: Session, revision: number): Promise<WorkflowMode> {
    assertPersonalSessionId(session.id)
    const mode = await this.mode(session)
    if ((!mode.enabled && !this.testingPreferences().forceDecomposition) || mode.revision !== revision) throw new Error('personal-workflow: enhancement mode is off or changed')
    this.assertPlanningPermissions(session)
    return mode
  }

  private assertPlanningPermissions(session: Session): void {
    if (!this.ctx.personalProjects.allowsSkill(session, 'dev-workflow')) throw new Error('dev-workflow Skill is disabled by the current Bot')
    const botId = this.ctx.personalProjects.affiliation(session).current.botId
    const allowedTools = botId === undefined ? undefined : this.ctx.personalProjects.getBot(botId)?.allowedTools
    if (allowedTools !== undefined && !['workflow_assess', 'workflow_propose'].every(tool => allowedTools.includes(tool))) throw new Error('personal-workflow: workflow tools are disabled by the current Bot')
    const agent = this.ctx.get('agents')?.get(session.id)
    if (agent !== undefined) {
      const tools = this.ctx.get('tools')
      if (tools === undefined || !['workflow_assess', 'workflow_propose'].every(tool => tools.get(tool, agent) !== undefined)) throw new Error('personal-workflow: workflow tools are unavailable under the current tool permissions')
    }
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
        const parsed = saveSchema.parse(request)
        const { operationId } = parsed
        const fingerprint = digest({ kind: 'save', source, sessionId, ...parsed })
        const table = this.table()
        const previous = table.get(parsed.definition.taskId)
        if (enhancement !== undefined) await this.requireMode(enhancement.session, enhancement.modeRevision)
        const retry = this.retry(previous, operationId, fingerprint)
        if (retry) return retry
        const priorMode = previous?.revisions.at(-1)?.definition.planningMode
        const definition = parsed.definition.planningMode === undefined && (previous === undefined || priorMode !== undefined)
          ? definitionSchema.parse({ ...parsed.definition, planningMode: priorMode ?? 'hierarchical' }) : parsed.definition
        let goalId: GoalId | undefined
        if (enhancement !== undefined) {
          if (this.execution.forSession(enhancement.session.id) !== null) throw new Error('personal-workflow: selected execution cannot be decomposed')
          if (this.testingPreferences().forceDecomposition && request.definition.tasks.filter(task => task.parentTaskId !== null && task.required).length < 2) throw new Error('personal-workflow: testing requires at least two required subtasks')
          await using handle = await this.ctx.sessionPersistence.open(enhancement.session.id, 'read')
          const { events } = await handle.read()
          const assessment = events.findLast(event => event.type === 'personal-workflow/assessment')
          if (assessment?.type !== 'personal-workflow/assessment' || assessment.data.modeRevision !== enhancement.modeRevision || assessment.data.decision !== 'complex'
            || assessment.data.context === undefined || assessment.data.context.route === 'query') throw new Error('personal-workflow: clarify and assess a complex goal before proposing')
          const goal = events.findLast(event => event.type === 'user/message' && event.data.source.kind === 'user')
          using current = await this.ctx.sessionQuery.observeSession(enhancement.session.id, { projectionMode: 'none' })
          const liveGoal = current.events.findLast(event => event.type === 'user/message' && event.data.source.kind === 'user')
          if (goal?.type !== 'user/message' || assessment.data.context.messageId !== goal.data.id
            || (liveGoal?.type === 'user/message' && liveGoal.data.id !== goal.data.id)) throw new Error('personal-workflow: assess the current goal before proposing')
          const policy = await this.resolve(enhancement.session)
          if (JSON.stringify(policy) !== JSON.stringify(assessment.data.context.policy)) throw new Error('personal-workflow: planning settings or affiliation changed; reassess the goal')
          if (policy.granularity === 'fine' && definition.planningMode !== 'phases') throw new Error('personal-workflow: Agent execution preference requires an ordered phase plan')
          goalId = assessment.data.context.goalId
          const bound = this.goalPlan(enhancement.session.id, goalId)
          if (bound !== undefined && bound.definition.taskId !== definition.taskId) throw new Error('personal-workflow: goal already has a plan')
          if (previous !== undefined && !previous.revisions.some(revision => revision.goalId === goalId && revision.sessionId === sessionId)) throw new Error('personal-workflow: plan belongs to another goal')
          const affiliation = this.ctx.personalProjects.affiliation(enhancement.session).current
          if (request.definition.projectId !== (affiliation.projectId ?? null) || request.definition.botId !== (affiliation.botId ?? null)) throw new Error('personal-workflow: proposal affiliation differs from its conversation')
        }
        if (enhancement !== undefined) this.assertPlanningPermissions(enhancement.session)
        if ((previous?.revisions.length ?? 0) !== parsed.expectedRevision) throw new Error('revision-conflict')
        if (previous?.runs?.some(run => run.status === 'running' || run.actions.some(action => action.status === 'pending' || action.status === 'unknown') || run.handoffs.some(handoff => handoff.status === 'prepared'))) throw new Error('stop-execution-before-editing')
        this.validateIdentity(definition, previous)
        const linkedGoal = goalId ?? previous?.revisions.at(-1)?.goalId
        const snapshot: PlanRevision = {
          revision: parsed.expectedRevision + 1, definition, source, sessionId,
          createdAt: Date.now(), approval: null,
          ...(linkedGoal === undefined ? {} : { goalId: linkedGoal }),
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
