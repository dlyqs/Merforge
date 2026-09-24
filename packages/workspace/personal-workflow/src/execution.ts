/** Task-local execution transactions; no automatic task or conversation scheduler. */
import type { ToolCallId } from '@deepseek-ai/dsh-llm'
import { createHash, randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-workspace'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import { SessionId, type Session } from '@deepseek-ai/dsh-session'
import type { StoredPlan, PlanRevision, PlanView, TaskId } from './types.ts'
import type {
  ExecutionLimits, TaskRun, RunId, HandoffId, ClaimTaskRequest, ControlTaskRequest, ResumeTaskRequest,
  HandoffTaskRequest, CompleteTaskRequest, TaskHandoff,
} from './execution-types.ts'
import { claimSchema, controlSchema, resumeSchema, handoffSchema, completeSchema } from './execution-schema.ts'
import { observeWorkspace, sameWorkspace, sameDirectory } from './workspace-baseline.ts'
import { projectPlan } from './projection.ts'

/** Sole execution writer, sharing the plan service's short atomic mutation queue. */
export class WorkflowExecution {
  constructor(
    private readonly ctx: Context,
    private readonly table: () => KvTable<TaskId, StoredPlan>,
    private readonly enqueue: <T>(work: () => Promise<T>) => Promise<T>,
    /** Deployment ceilings; authorization can only narrow them. */
    readonly limits: ExecutionLimits,
  ) {}

  /** Reconcile interrupted owners before exposing the service after restart.
   * @returns Completion after durable unknown-action markers are committed.
   */
  async recover(): Promise<void> {
    for (const [, plan] of this.table().entries()) {
      for (const run of plan.runs ?? []) {
        if (run.status === 'running' || run.actions.some(action => action.status === 'pending')) {
          await this.store({ ...run, status: 'needs_reconciliation', reason: 'host-restarted',
            actions: run.actions.map(action => action.status === 'pending' ? { ...action, status: 'unknown' } : action) })
        }
      }
    }
  }

  /** Project the current revision from its persisted execution evidence.
   * @param plan - Atomic plan aggregate.
   * @returns Shared candidate and task-detail view.
   */
  view(plan: StoredPlan): PlanView {
    const snapshot = current(plan)
    const runs = (plan.runs ?? []).filter(run => run.planRevision === snapshot.revision)
    const observations = runs.map(run => ({
      taskId: run.taskId, status: run.status, evidence: run.evidence.map(item => item.summary),
    }))
    return { ...projectPlan(snapshot, observations), runs: plan.runs ?? [] }
  }

  /** Read the attempt associated with a current or former execution conversation.
   * @param sessionId - Existing conversation identity.
   * @returns Associated attempt, including a revoked former owner.
   */
  forSession(sessionId: SessionId): TaskRun | null {
    for (const [, plan] of this.table().entries()) {
      const run = plan.runs?.find(run => run.sessions.includes(sessionId)
        || run.handoffs.some(handoff => handoff.targetSessionId === sessionId))
      if (run !== undefined) return run
    }
    return null
  }

  /** List only ready tasks matching this conversation's affiliation and directory.
   * @param session - Conversation selected by the user.
   * @returns Plan views restricted to executable candidates.
   */
  candidates(session: Session): PlanView[] {
    if (this.forSession(session.id) !== null) return []
    return [...this.table().entries()].flatMap(([, plan]) => {
      const view = this.view(plan)
      if (this.permissionReason(session, view.snapshot) !== undefined) return []
      const ready = view.ready.filter((id) => {
        const task = taskOf(view.snapshot, id)
        return task.cwd === null || sameDirectory(task.cwd, session.header.cwd ?? '')
      })
      return ready.length ? [{ ...view, ready, tasks: view.tasks.filter(task => ready.includes(task.taskId)) }] : []
    })
  }

  /** Atomically acquire one task; the caller must separately submit a prompt.
   * @param session - User-selected receiving conversation.
   * @param request - Exact-version selection and explicit execution limits.
   * @returns Durable owner and attempt, reused on identical retries.
   */
  claim(session: Session, request: ClaimTaskRequest): Promise<TaskRun> {
    return this.enqueue(async () => {
      const parsed = claimSchema.parse(request)
      const plan = this.requirePlan(parsed.planId)
      const retry = this.retry(plan, parsed.operationId, parsed)
      if (retry) return retry
      const snapshot = current(plan)
      if (session.id !== parsed.sessionId) throw new Error('session-mismatch')
      this.checkPermission(session, snapshot)
      if (snapshot.revision !== parsed.expectedRevision) throw new Error('revision-conflict')
      if (this.forSession(session.id) !== null) throw new Error('conversation-already-bound')
      if (!this.view(plan).ready.includes(parsed.taskId)) throw new Error('task-not-ready-or-already-owned')
      const task = taskOf(snapshot, parsed.taskId)
      const auth = parsed.authorization
      if (auth.stopPhaseId !== task.phaseId || auth.maxActions > this.limits.maxActions
        || auth.maxTurns > this.limits.maxTurns || auth.maxDurationMs > this.limits.maxDurationMs) throw new Error('authorization-outside-task-or-configured-limits')
      if (!session.header.cwd || (task.cwd !== null && !sameDirectory(task.cwd, session.header.cwd ?? ''))) throw new Error('explicit-matching-execution-directory-required')
      const baseline = await observeWorkspace(session.header.cwd, this.paths(snapshot, parsed.taskId), this.limits.maxEvidenceBytes)
      const prerequisites = (plan.runs ?? []).filter(run =>
        run.planRevision === snapshot.revision && task.dependsOn.includes(run.taskId))
      for (const prerequisite of prerequisites) {
        if (!sameDirectory(prerequisite.baseline.cwd, baseline.cwd)) throw new Error('prerequisite-in-another-workspace')
      }
      this.checkPermission(session, snapshot)
      const run: TaskRun = {
        id: randomUUID() as RunId, planId: parsed.planId, taskId: parsed.taskId, planRevision: snapshot.revision,
        sessionId: session.id, sessions: [session.id], ownerEpoch: 1, status: 'running', reason: null,
        authorization: auth, startedAt: Date.now(), turnsUsed: 0, baseline,
        permissionFingerprint: this.permissions(session), reconciliations: [], actions: [], evidence: [], handoffs: [],
      }
      await this.store(run, { operationId: parsed.operationId, fingerprint: digest(parsed), runId: run.id })
      return run
    })
  }

  /** Final synchronous denial, also used after asynchronous tool admission.
   * @param session - Calling execution conversation.
   * @param toolName - Optional dispatched tool identity for configured capability exclusions.
   * @returns Denial reason or undefined for permitted/ordinary conversations.
   */
  denial(session: Session, toolName?: string): string | undefined {
    const run = this.forSession(session.id)
    if (run === null) {
      if (session.header.parentSession !== undefined && this.forSession(session.header.parentSession) !== null) return 'task-does-not-authorize-delegated-execution'
      return undefined
    }
    if (toolName !== undefined && this.limits.blockedTools.includes(toolName)) return 'tool-outside-task-authorization'
    if (run.sessionId !== session.id) return 'execution-owner-revoked'
    if (run.status !== 'running') return `task-${run.status}`
    const snapshot = current(this.requirePlan(run.planId))
    if (snapshot.revision !== run.planRevision || snapshot.approval === null) return 'approval-or-version-changed'
    const permission = this.permissionReason(session, snapshot)
    if (permission !== undefined) return permission
    if (this.permissions(session) !== run.permissionFingerprint || !sameDirectory(session.header.cwd, run.baseline.cwd)) return 'execution-permissions-or-directory-changed'
    if (Date.now() - run.startedAt >= run.authorization.maxDurationMs) return 'duration-limit'
    return undefined
  }

  /** Recheck queued request permission and durably expose a changed execution scope.
   * @param session - Calling conversation.
   * @returns Completion when access is still permitted; otherwise a recorded rejection.
   */
  checkAccess(session: Session): Promise<void> {
    return this.enqueue(async () => {
      const reason = this.denial(session)
      if (reason === undefined) return
      const run = this.forSession(session.id)
      if (run?.sessionId === session.id && run.status === 'running') {
        await this.store({ ...run, status: 'needs_reconciliation', reason })
      }
      throw new Error(reason)
    })
  }

  /** Persist admission before dispatch; pending calls become unknown after a crash.
   * @param session - Calling conversation.
   * @param callId - Actual registry call identity.
   * @param name - Actual tool name.
   * @returns Attempt identity, or null for an ordinary conversation.
   */
  beginAction(session: Session, callId: ToolCallId, name: string): Promise<RunId | null> {
    return this.enqueue(async () => {
      const run = this.forSession(session.id)
      const denied = this.denial(session, name)
      if (run === null) { if (denied !== undefined) throw new Error(denied); return null }
      if (denied !== undefined) {
        if (run.sessionId === session.id && run.status === 'running') await this.store({ ...run, status: 'needs_reconciliation', reason: denied })
        throw new Error(denied)
      }
      if (run.actions.length >= run.authorization.maxActions) {
        await this.store({ ...run, status: 'paused', reason: 'action-limit' }); throw new Error('action-limit')
      }
      if (run.actions.some(action => action.callId === callId)) throw new Error('action-already-admitted')
      await this.store({ ...run, actions: [...run.actions, { callId, name, status: 'pending' }] })
      return run.id
    })
  }

  /** Record a dispatched call's outcome even if cancellation happened meanwhile.
   * @param runId - Attempt that admitted the action.
   * @param callId - Registry call identity.
   * @param succeeded - Actual tool executor outcome.
   * @returns Completion after settlement persistence.
   */
  settleAction(runId: RunId, callId: ToolCallId, succeeded: boolean): Promise<void> {
    return this.enqueue(async () => {
      const run = this.find(runId)
      await this.store({ ...run, actions: run.actions.map(action => action.callId === callId ? { ...action, status: succeeded ? 'succeeded' : 'failed' } : action) })
    })
  }

  /** Admit a new user turn while retaining a cumulative budget across handoffs.
   * @param session - Selected task conversation.
   * @returns Logged-context text, or null for ordinary conversation.
   */
  enterTurn(session: Session): Promise<string | null> {
    return this.enqueue(async () => {
      const run = this.forSession(session.id)
      const denied = this.denial(session)
      if (run === null) { if (denied !== undefined) throw new Error(denied); return null }
      if (denied !== undefined) throw new Error(denied)
      if (run.turnsUsed >= run.authorization.maxTurns) {
        await this.store({ ...run, status: 'paused', reason: 'turn-limit' }); throw new Error('turn-limit')
      }
      await this.store({ ...run, turnsUsed: run.turnsUsed + 1 })
      return this.context(run)
    })
  }

  /** Settle a manual turn without interpreting Agent idle as task completion.
   * @param session - Conversation whose turn is closing.
   * @returns Completion after a settled baseline and stop state are persisted.
   */
  endTurn(session: Session): Promise<boolean> {
    return this.enqueue(async () => {
      const run = this.forSession(session.id)
      if (run === null || run.sessionId !== session.id || run.status !== 'running') return false
      if (run.actions.some(action => action.status === 'pending')) throw new Error('actions-still-in-flight')
      const baseline = await this.observe(run)
      const canContinue = run.authorization.mode !== 'manual' && run.turnsUsed < run.authorization.maxTurns && run.actions.length < run.authorization.maxActions && this.denial(session) === undefined
      await this.store({ ...run, baseline, status: canContinue ? 'running' : 'paused', reason: canContinue ? null : run.authorization.mode === 'manual' ? 'manual-turn-ended' : 'authorization-boundary' })
      return canContinue
    })
  }

  /** Mark an unexpected whole-conversation stop without inventing task completion.
   * @param session - Conversation that reached idle outside the normal task stop path.
   * @returns Completion after any still-running owner is fenced for reconciliation.
   */
  interrupt(session: Session): Promise<void> {
    return this.enqueue(async () => {
      const run = this.forSession(session.id)
      if (run === null || run.sessionId !== session.id || run.status !== 'running') return
      await this.store({ ...run, status: 'needs_reconciliation', reason: 'conversation-stopped-without-task-settlement',
        actions: run.actions.map(action => action.status === 'pending' ? { ...action, status: 'unknown' } : action),
      })
    })
  }

  /** Pause or cancel only the selected attempt, leaving in-flight results observable.
   * @param session - Current owner conversation.
   * @param request - Exact owner epoch and retry identity.
   * @param cancel - Whether to enter the terminal cancelled state.
   * @returns Durable stopped attempt.
   */
  stop(session: Session, request: ControlTaskRequest, cancel: boolean): Promise<TaskRun> {
    return this.enqueue(async () => {
      const parsed = controlSchema.parse(request)
      const run = this.owner(session, parsed)
      const receipt = { operationId: parsed.operationId, fingerprint: digest({ ...parsed, cancel }), runId: run.id }
      const retry = this.retry(this.requirePlan(run.planId), parsed.operationId, { ...parsed, cancel })
      if (retry) return retry
      if (run.status === 'completed' || run.status === 'cancelled') throw new Error('task-already-terminal')
      const baseline = run.actions.some(action => action.status === 'pending') ? run.baseline : await this.observe(run)
      return this.store({ ...run, baseline, status: cancel ? 'cancelled' : 'paused', reason: cancel ? 'user-cancelled' : 'user-paused' }, receipt)
    })
  }

  /** Resume after rechecking permission, workspace and unchanged cumulative limits.
   * @param session - Current owner conversation.
   * @param request - Explicit reconciliation note when effects or files are uncertain.
   * @returns Resumed attempt; never replays a previous action.
   */
  resume(session: Session, request: ResumeTaskRequest): Promise<TaskRun> {
    return this.enqueue(async () => {
      const parsed = resumeSchema.parse(request)
      const run = this.owner(session, parsed)
      const plan = this.requirePlan(run.planId)
      const retry = this.retry(plan, parsed.operationId, parsed)
      if (retry) return retry
      if (run.status !== 'paused' && run.status !== 'needs_reconciliation') throw new Error('task-not-resumable')
      this.checkPermission(session, current(plan))
      if (current(plan).revision !== run.planRevision || current(plan).approval === null) throw new Error('approval-or-version-changed')
      const prepared = run.handoffs.some(handoff => handoff.status === 'prepared')
      if (prepared && !parsed.reconciliation.trim()) throw new Error('reconcile-prepared-handoff-first')
      if (run.actions.some(action => action.status === 'pending')) throw new Error('actions-still-in-flight')
      const activity = await this.ctx.waterfall('workspace/session-activity', { sessionId: session.id }, () => Promise.resolve([]))
      if (activity.length) throw new Error('conversation-still-active')
      if (!sameDirectory(session.header.cwd, run.baseline.cwd)) throw new Error('workspace-directory-changed')
      const baseline = await this.observe(run)
      const changed = !sameWorkspace(run.baseline, baseline, this.siblingArtifacts(run)) || this.permissions(session) !== run.permissionFingerprint || run.actions.some(action => action.status === 'unknown')
      if ((changed || run.status === 'needs_reconciliation') && !parsed.reconciliation.trim()) {
        await this.store({ ...run, status: 'needs_reconciliation', reason: 'explicit-reconciliation-required' })
        throw new Error('explicit-reconciliation-required')
      }
      if (run.actions.length >= run.authorization.maxActions || run.turnsUsed >= run.authorization.maxTurns || Date.now() - run.startedAt >= run.authorization.maxDurationMs) throw new Error('authorization-budget-exhausted')
      return this.store({ ...run, baseline, permissionFingerprint: this.permissions(session), status: prepared ? 'paused' : 'running', reason: parsed.reconciliation.trim() || null,
        handoffs: run.handoffs.map(handoff => handoff.status === 'prepared' ? { ...handoff, baseline } : handoff),
        actions: run.actions.map(action => action.status === 'unknown' ? { ...action, status: 'reconciled' } : action),
        reconciliations: parsed.reconciliation.trim() ? [...run.reconciliations, {
          note: parsed.reconciliation.trim(), time: Date.now(), sessionId: session.id, baseline,
        }] : run.reconciliations },
      { operationId: parsed.operationId, fingerprint: digest(parsed), runId: run.id })
    })
  }

  /** Verify an execution's claimed acceptance against settled actions and readable artifacts.
   * @param session - Current execution conversation.
   * @param request - Acceptance results and successful action identities.
   * @returns Completed attempt with host-observed evidence.
   */
  complete(session: Session, request: CompleteTaskRequest): Promise<TaskRun> {
    return this.enqueue(async () => {
      const parsed = completeSchema.parse(request)
      const denied = this.denial(session)
      if (denied !== undefined) throw new Error(denied)
      const run = this.forSession(session.id)
      if (run === null) throw new Error('no-selected-task')
      if (run.actions.some(action => action.status === 'pending' || action.status === 'unknown')) throw new Error('unsettled-action-effects')
      const activity = await this.ctx.waterfall('workspace/session-activity', { sessionId: session.id }, () => Promise.resolve([]))
      const activityKinds: readonly string[] = activity.map(item => item.kind)
      if (activityKinds.some(kind => kind !== 'turn')) throw new Error('background-effects-still-active')
      if (parsed.callIds.some(id => !run.actions.some(action => action.callId === id && action.status === 'succeeded'))) throw new Error('verification-action-not-successful')
      const snapshot = current(this.requirePlan(run.planId))
      const task = taskOf(snapshot, run.taskId)
      if (parsed.acceptance.length !== task.acceptance.length) throw new Error('acceptance-results-required-for-each-criterion')
      const baseline = await this.observe(run)
      if (baseline.files.some(file => file.sha256 === null)) throw new Error('declared-artifact-missing')
      if (!await this.ctx.sessions.flush(session)) throw new Error('execution-results-not-durable')
      const logged = new Set<string>()
      for (const sessionId of run.sessions) {
        using observation = await this.ctx.sessionQuery.observeSession(sessionId, { projectionMode: 'none' })
        for (const event of observation.events) if (event.type === 'tool/result' && !event.data.message.isError) logged.add(event.data.message.toolCallId)
      }
      if (parsed.callIds.some(id => !logged.has(id))) throw new Error('verification-result-not-recorded')
      const evidence = { ...parsed, files: baseline.files, time: Date.now() }
      return this.store({ ...run, baseline, status: 'completed', reason: 'verified-evidence-recorded', evidence: [...run.evidence, evidence] })
    })
  }

  /** Prepare a single durable receiver identity after source actions settle.
   * @param session - Current source owner.
   * @param request - User decisions and remaining work.
   * @returns Stored transfer package for idempotent Session creation.
   */
  prepareHandoff(session: Session, request: HandoffTaskRequest): Promise<TaskHandoff> {
    return this.enqueue(async () => {
      const parsed = handoffSchema.parse(request)
      const run = this.find(parsed.runId)
      const existing = run.handoffs.find(handoff => handoff.operationId === parsed.operationId)
      if (existing !== undefined) {
        if (existing.context !== parsed.context || existing.sourceSessionId !== session.id || existing.ownerEpoch !== parsed.ownerEpoch) throw new Error('operation-id-conflict')
        return existing
      }
      this.retry(this.requirePlan(run.planId), parsed.operationId, parsed)
      this.owner(session, parsed)
      if (run.status !== 'running' && run.status !== 'paused') throw new Error('reconcile-before-handoff')
      if (run.actions.some(action => action.status === 'pending' || action.status === 'unknown')) throw new Error('actions-must-settle-before-handoff')
      if (run.handoffs.some(handoff => handoff.status === 'prepared')) throw new Error('handoff-already-prepared')
      const snapshot = current(this.requirePlan(run.planId))
      this.checkPermission(session, snapshot)
      if (snapshot.revision !== run.planRevision || snapshot.approval === null) throw new Error('approval-or-version-changed')
      if (run.actions.length >= run.authorization.maxActions || run.turnsUsed >= run.authorization.maxTurns || Date.now() - run.startedAt >= run.authorization.maxDurationMs) throw new Error('authorization-budget-exhausted')
      const activity = await this.ctx.waterfall('workspace/session-activity', { sessionId: session.id }, () => Promise.resolve([]))
      if (activity.length) throw new Error('source-conversation-still-active')
      const baseline = await this.observe(run)
      if (run.status === 'paused' && !sameWorkspace(run.baseline, baseline, this.siblingArtifacts(run))) {
        await this.store({ ...run, status: 'needs_reconciliation', reason: 'workspace-changed' }); throw new Error('reconcile-before-handoff')
      }
      const handoff: TaskHandoff = {
        runId: run.id, taskId: run.taskId, planRevision: run.planRevision,
        id: randomUUID() as HandoffId, operationId: parsed.operationId, sourceSessionId: session.id,
        targetSessionId: SessionId(`session-${randomUUID()}`), ownerEpoch: run.ownerEpoch, status: 'prepared',
        context: parsed.context, baseline, snapshot, authorization: run.authorization,
        actionsUsed: run.actions.length, turnsUsed: run.turnsUsed, evidence: run.evidence,
        prerequisites: this.prerequisites(run),
      }
      await this.store({ ...run, status: 'paused', reason: 'handoff-prepared', baseline, handoffs: [...run.handoffs, handoff] })
      return handoff
    })
  }

  /** Transfer ownership to the persisted receiver without prompting it.
   * @param target - Idempotently created receiving Session.
   * @param runId - Source attempt identity.
   * @param handoffId - Prepared package identity.
   * @returns Attempt with a new epoch; user explicitly resumes after inspecting context.
   */
  finishHandoff(target: Session, runId: RunId, handoffId: HandoffId): Promise<TaskRun> {
    return this.enqueue(async () => {
      const run = this.find(runId)
      const handoff = run.handoffs.find(item => item.id === handoffId)
      if (handoff === undefined || target.id !== handoff.targetSessionId) throw new Error('handoff-target-mismatch')
      if (handoff.status === 'transferred') return run
      if (run.ownerEpoch !== handoff.ownerEpoch || run.sessionId !== handoff.sourceSessionId || run.status !== 'paused') throw new Error('handoff-owner-changed')
      const snapshot = current(this.requirePlan(run.planId))
      this.checkPermission(target, snapshot)
      if (snapshot.revision !== run.planRevision || snapshot.approval === null || !sameDirectory(target.header.cwd, run.baseline.cwd)) throw new Error('handoff-workspace-or-version-changed')
      const baseline = await this.observe(run)
      if (!sameWorkspace(handoff.baseline, baseline, this.siblingArtifacts(run)) || this.permissions(target) !== run.permissionFingerprint) throw new Error('handoff-reconciliation-required')
      return this.store({ ...run, sessionId: target.id, sessions: [...run.sessions, target.id], ownerEpoch: run.ownerEpoch + 1,
        status: 'paused', reason: 'handoff-ready-for-explicit-resume', baseline,
        handoffs: run.handoffs.map(item => item.id === handoffId ? { ...item, status: 'transferred' } : item) })
    })
  }

  private context(run: TaskRun): string {
    const plan = this.requirePlan(run.planId)
    const snapshot = revisionOf(plan, run.planRevision)
    return `Execute only the selected task. Do not claim another task or create conversations. Completion requires workflow_complete with actual successful action IDs and acceptance results.\n${JSON.stringify({ run, snapshot, prerequisites: this.prerequisites(run) })}`
  }
  private prerequisites(run: TaskRun) {
    const plan = this.requirePlan(run.planId)
    const task = taskOf(revisionOf(plan, run.planRevision), run.taskId)
    const children = revisionOf(plan, run.planRevision).definition.tasks.filter(item => item.parentTaskId === task.id && item.required)
    const required = new Set([...task.dependsOn, ...children.map(item => item.id)])
    return (plan.runs ?? []).filter(item => item.planRevision === run.planRevision && required.has(item.taskId))
      .flatMap(item => item.evidence)
  }
  private paths(snapshot: PlanRevision, id: TaskId): string[] {
    const task = taskOf(snapshot, id)
    const children = snapshot.definition.tasks.filter(item => item.parentTaskId === id && item.required)
    const ids = new Set([id, ...task.dependsOn, ...children.map(item => item.id)])
    return snapshot.definition.tasks.filter(item => ids.has(item.id)).flatMap(item => item.artifacts)
  }
  private observe(run: TaskRun) {
    const paths = this.paths(revisionOf(this.requirePlan(run.planId), run.planRevision), run.taskId)
    return observeWorkspace(run.baseline.cwd, paths, this.limits.maxEvidenceBytes)
  }
  private siblingArtifacts(run: TaskRun): string[] {
    const plan = this.requirePlan(run.planId)
    const activeSiblings = new Set((plan.runs ?? []).filter(item => item.id !== run.id && item.planRevision === run.planRevision)
      .map(item => item.taskId))
    return revisionOf(plan, run.planRevision).definition.tasks.filter(task => activeSiblings.has(task.id)).flatMap(task => task.artifacts)
  }
  private permissionReason(session: Session, snapshot: PlanRevision): string | undefined {
    const affiliation = this.ctx.personalProjects.affiliation(session).current
    if ((affiliation.projectId ?? null) !== snapshot.definition.projectId || (affiliation.botId ?? null) !== snapshot.definition.botId) return 'task-affiliation-changed'
    if (snapshot.definition.projectId !== null && !this.ctx.personalProjects.getProject(snapshot.definition.projectId)) return 'project-deleted'
    if (!this.ctx.personalProjects.allowsSkill(session, 'dev-workflow')) return 'workflow-skill-disabled'
    if (this.ctx.get('workspaceRegistry')?.archivedSessionIds.includes(session.id)) return 'session-archived'
    return undefined
  }
  private checkPermission(session: Session, snapshot: PlanRevision): void {
    const reason = this.permissionReason(session, snapshot)
    if (reason !== undefined) throw new Error(reason)
  }
  private permissions(session: Session): string {
    const affiliation = this.ctx.personalProjects.affiliation(session).current
    return digest({
      affiliation, bot: affiliation.botId === undefined ? null : this.ctx.personalProjects.getBot(affiliation.botId),
      project: affiliation.projectId === undefined ? null : this.ctx.personalProjects.getProject(affiliation.projectId),
    })
  }
  private owner(session: Session, request: ControlTaskRequest): TaskRun {
    const run = this.find(request.runId)
    if (request.sessionId !== session.id || run.sessionId !== session.id || run.ownerEpoch !== request.ownerEpoch) throw new Error('execution-owner-revoked')
    return run
  }
  private find(id: RunId): TaskRun {
    for (const [, plan] of this.table().entries()) {
      const run = plan.runs?.find(run => run.id === id)
      if (run !== undefined) return run
    }
    throw new Error('unknown-execution-run')
  }
  private requirePlan(id: TaskId): StoredPlan {
    const plan = this.table().get(id)
    if (plan === undefined) throw new Error('unknown-plan')
    return plan
  }
  private retry(plan: StoredPlan, operationId: import('./types.ts').OperationId, request: object): TaskRun | undefined {
    if (plan.receipts.some(receipt => receipt.operationId === operationId)
      || plan.runs?.some(run => run.handoffs.some(handoff => handoff.operationId === operationId))) throw new Error('operation-id-conflict')
    const receipt = plan.executionReceipts?.find(receipt => receipt.operationId === operationId)
    if (!receipt) return undefined
    if (receipt.fingerprint !== digest(request)) throw new Error('operation-id-conflict')
    return this.find(receipt.runId)
  }
  private async store(run: TaskRun, receipt?: import('./execution-types.ts').ExecutionReceipt): Promise<TaskRun> {
    const previous = this.requirePlan(run.planId).runs?.find(item => item.id === run.id)
    await this.table().update(run.planId, plan => ({ ...plan,
      runs: [...(plan.runs ?? []).filter(item => item.id !== run.id), run],
      executionReceipts: [...plan.executionReceipts ?? [], ...receipt === undefined ? [] : [receipt]],
    }))
    if (previous === undefined || previous.status !== run.status || previous.sessionId !== run.sessionId || previous.handoffs.length !== run.handoffs.length) this.ctx.logger.info(`personal-workflow taskId=${run.taskId} runId=${run.id} sessionId=${run.sessionId} decisionCode=${run.reason ?? 'execution-update'} result=${run.status}`)
    return run
  }
}
function current(plan: StoredPlan): PlanRevision { return revisionOf(plan, plan.revisions.length) }
function revisionOf(plan: StoredPlan, revision: number): PlanRevision {
  const value = plan.revisions[revision - 1]
  if (value === undefined) throw new Error('unknown-plan-revision')
  return value
}
function taskOf(snapshot: PlanRevision, id: TaskId) {
  const task = snapshot.definition.tasks.find(task => task.id === id)
  if (task === undefined) throw new Error('unknown-plan-task')
  return task
}
function digest(value: object): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex') }
