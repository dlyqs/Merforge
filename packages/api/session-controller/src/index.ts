/** Session Remote owner: cold reads, explicit Agent commands, and live control state. */

import type {} from '@deepseek-ai/dsh-skill'
import { hostname } from 'node:os'
import { resolve } from 'node:path'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-fs'
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { ReasoningEffortId, errorChain } from '@deepseek-ai/dsh-llm'
import type { PersonalWorkflow, SavePlanRequest, ApprovePlanRequest, ReadPlanRequest, SnapshotPlanRequest, PlanRevision, PlanView, WorkflowSnapshot } from '@deepseek-ai/dsh-personal-workflow'
import { PersonalProjectRegistry } from '@deepseek-ai/dsh-personal-project'
import type { BotId, BotModel, ProjectId } from '@deepseek-ai/dsh-personal-project/types'
import type {} from '@deepseek-ai/dsh-client-file-upload'
import { canOpenNativePath, nativeFileManager, nativeFileApplications, openNativeFileApplication, openNativeAssociatedPath, revealNativePath } from '@deepseek-ai/dsh-native-command'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionInspection } from '@deepseek-ai/dsh-session-persistence'
import { SessionQueryError, type SessionObservation } from '@deepseek-ai/dsh-session-query'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import {
  ApiSessionAgentController,
  inspectApiSession,
  type ApiSessionAgentResult,
} from './agent.ts'
import { SessionCommandController } from './commands.ts'
import { SessionControlController } from './control.ts'
import { SessionHistoryController } from './history.ts'
import { SessionFileReferences } from './file-references.ts'
import { ApiSessionList } from './list.ts'
import { buildModelCatalog } from './catalog.ts'
import { installModelSelectionProjection } from './model-selection-projection.ts'
import { SessionSkillCatalog } from './skill-catalog.ts'
import { SessionMediaReferences } from './media-references.ts'
import { ArchivedSessionGate } from './archived-session-gate.ts'
import type {
  ModelCatalog,
  SessionWorkspacePathApplication,
  SessionAttachmentRequest,
  SessionAttachmentValue,
  SessionCancelRequest,
  SessionCancelValue,
  SessionControlFrame,
  SessionCreateRequest,
  SessionCreateValue,
  SessionFollowFrame,
  SessionFollowRequest,
  SessionForkRequest,
  SessionForkValue,
  SessionListRequest,
  SessionListValue,
  SessionOpenWorkspacePathRequest,
  SessionOpenWorkspacePathValue,
  SessionPage,
  SessionPageRequest,
  SessionPromptRequest,
  SessionPromptValue,
  SessionRenameRequest,
  SessionRenameValue,
  SessionSearchRequest,
  SessionSearchValue,
  SessionSelectModelRequest,
  SessionSelectModelValue,
  SessionProjectionsRequest,
  SessionProjectionsValue,
  SessionProjectionValues,
  SessionUpdateQueueRequest,
  SessionUpdateQueueValue,
  PersonalProjectCreateRequest,
  PersonalProjectUpdateRequest,
  PersonalBotCreateRequest,
  PersonalBotUpdateRequest,
  PersonalRecordsValue,
  SessionAffiliationMoveRequest,
  SessionAffiliationValue,
} from './types.ts'

export type * from './types.ts'
export { ApiSessionNotFound } from './agent.ts'
export { SessionFileReferences } from './file-references.ts'
export { SessionSkillCatalog } from './skill-catalog.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host Session business API and Remote namespace owner. */
    sessionController: SessionController
  }
}

/** Session Controller deployment policy. */
export interface Config {
  /** Override platform desktop-opener detection. */
  readonly nativeOpen?: boolean
}

/** Host integrations replaceable by direct unit tests. */
export interface SessionControllerInternals {
  /** Native default-application handoff. */
  readonly openPath?: (path: string, signal: AbortSignal) => Promise<void>
  /** Native file-association query. */
  readonly fileApplications?: typeof nativeFileApplications
  /** Explicit registered-application handoff. */
  readonly openFileApplication?: typeof openNativeFileApplication
  /** Native file-manager handoff. */
  readonly revealPath?: (path: string, signal: AbortSignal) => Promise<void>
  /** Native handoff availability probe. */
  readonly canOpenPath?: () => boolean
}

/** Host service backing the generated `ctx.remote.session` namespace. */
export class SessionController extends TypertRemoteService {
  static inject = [
    'agentDefaultModel',
    'agents',
    'attachments',
    'fileUploads',
    'fs',
    'llm',
    'sessions',
    'sessionProjections',
    'sessionQuery',
    'typert',
    'workspaceRegistry',
  ]

  static Config: z<Config> = z.object({
    nativeOpen: z.boolean(),
  })

  private readonly agents: ApiSessionAgentController
  private readonly commands: SessionCommandController
  private readonly controlState: SessionControlController
  private readonly history: SessionHistoryController
  private readonly listState: ApiSessionList
  private readonly openPath: (path: string, signal: AbortSignal) => Promise<void>
  private readonly fileApplications: typeof nativeFileApplications
  private readonly openFileApplication: typeof openNativeFileApplication
  private readonly revealPath: (path: string, signal: AbortSignal) => Promise<void>
  private readonly canOpenPath: () => boolean
  private readonly promotions = new Set<Promise<void>>()

  /**
   * @param ctx - Host context containing the Session capability assembly.
   * @param config - native-opener deployment policy.
   * @param internals - host integrations replaceable by direct unit tests.
   */
  constructor(ctx: Context, config: Config, internals: SessionControllerInternals = {}) {
    super(ctx, 'sessionController', { namespace: 'session' })
    installModelSelectionProjection(ctx)
    this.agents = new ApiSessionAgentController(ctx)
    this.commands = new SessionCommandController(ctx, this.agents, process.cwd())
    ctx.effect(() => ctx.fileUploads.registerAgentResolver(async (sessionId) => {
      const result = await this.agents.resolveAgent(sessionId)
      if ('error' in result) throw result.error
      return result.agent
    }), 'session-controller: file-upload Agent resolver')
    this.controlState = new SessionControlController(ctx)
    // Registered before history so reverse-order teardown closes every
    // follower before waiting for already-admitted promotions.
    ctx.effect(() => async () => {
      await Promise.allSettled([...this.promotions])
    }, 'session-controller.promotions')
    this.history = new SessionHistoryController(ctx, (observation) => { this.promote(observation) })
    this.listState = new ApiSessionList(ctx)
    this.fileApplications = internals.fileApplications ?? nativeFileApplications
    this.openFileApplication = internals.openFileApplication ?? openNativeFileApplication
    this.openPath = internals.openPath ?? openNativeAssociatedPath
    this.revealPath = internals.revealPath ?? revealNativePath
    this.canOpenPath = internals.canOpenPath
      ?? (() => config.nativeOpen ?? (internals.openPath !== undefined || canOpenNativePath()))
    ctx.plugin(SessionFileReferences)
    ctx.plugin(SessionMediaReferences)
    ctx.plugin(SessionSkillCatalog)
    // An archived Session, or a subagent descendant of one, runs no model step
    // until it is restored; what it still runs is stopped by the owners that
    // answer the Workspace registry's archive-admission events.
    ctx.plugin(ArchivedSessionGate)

    ctx.on('session/created', (session) => {
      ctx.emit('api-session/added', this.listState.summaryFor(session))
    })
    ctx.on('session/disposed', (session) => {
      ctx.emit('api-session/removed', session.id)
    })
    const publishAgentAvailability = ({ agent }: { agent: Agent }): undefined => {
      if (ctx.sessions.get(agent.id) === agent.session) {
        ctx.emit('api-session/added', this.listState.summaryFor(agent.session))
      }
    }
    ctx.on('agent/created', publishAgentAvailability)
    ctx.on('agent/disposed', publishAgentAvailability)
    ctx.on('agent/status', ({ agent, status }) => {
      ctx.emit('api-session/status', agent.id, status === 'running')
    })
    ctx.on('agent/error', ({ agent, error }) => {
      ctx.emit('api-session/error', agent.id, errorChain(error))
    })
    ctx.on('session/event', (session, event) => {
      if (event.type === 'request/header') {
        const agent = ctx.agents.get(session.id)
        if (agent?.session === session) this.agents.consumeSelection(
          agent,
          event.data.header.config.provider,
          event.data.header.config.model,
          event.data.header.config.reasoningEffort,
        )
      }
      if (event.type !== 'user/message' || event.data.source.kind !== 'user') return
      ctx.emit('api-session/activity', session.id, event.time)
    })
  }

  private promote(observation: SessionObservation): void {
    const sessionId = observation.header.id
    const task = (async () => {
      using ownedObservation = observation
      const result = await this.agents.resolveObservedAgent(ownedObservation)
      if ('error' in result) this.ctx.emit('api-session/error', sessionId, result.error.message)
    })().catch((error: unknown) => {
      this.ctx.logger.error(`session-controller: background activation for "${sessionId}" failed: ${errorChain(error)}`)
    })
    this.promotions.add(task)
    void task.finally(() => { this.promotions.delete(task) })
  }

  /**
   * Resolve or resume one ordinary Session for another Host API domain.
   * @param sessionId - Session identity whose Agent owns the operation.
   * @returns the live Agent or the stable Session-domain failure.
   */
  resolveAgent(sessionId: SessionId): Promise<ApiSessionAgentResult> {
    return this.agents.resolveAgent(sessionId)
  }

  /**
   * Inspect one attached or persisted Session without activating its Agent.
   * @param sessionId - durable Session identity.
   * @param signal - optional caller cancellation for persistence reads.
   * @returns the current attached state or persisted header and event prefix.
   */
  inspect(
    sessionId: SessionId,
    signal?: AbortSignal,
  ): Promise<SessionInspection> {
    const attached = this.ctx.sessions.get(sessionId)
    if (attached !== undefined) {
      return Promise.resolve({
        meta: attached.header,
        inheritedEventCount: attached.inheritedEventCount,
        // oxlint-disable-next-line typescript/no-deprecated -- Existing Session history read; migration deferred.
        events: attached.snapshotEvents(),
      })
    }
    return inspectApiSession(this.ctx, sessionId, signal)
  }

  /**
   * Read all visible Session rows without resuming an Agent.
   * @param _request - reserved empty list request.
   * @param signal - cancellation for persistence reads.
   * @returns visible Session summaries ordered by activity.
   */
  @Remote('list')
  async list(_request: SessionListRequest, signal: AbortSignal): Promise<SessionListValue> {
    return { items: await this.listState.list(signal) }
  }

  /**
   * Search visible Session content without resuming an Agent.
   * @param request - literal message-content query.
   * @param signal - cancellation for list and search reads.
   * @returns authorized bounded Session search results.
   */
  @Remote('search')
  search(request: SessionSearchRequest, signal: AbortSignal): Promise<SessionSearchValue> {
    return this.listState.search(request.query, signal)
  }

  /**
   * Create or idempotently adopt one ordinary Session.
   * @param request - requested identity, location, and Agent preset.
   * @returns the Session identity and resolved preset when configured.
   */
  @Remote('create')
  create(request: SessionCreateRequest): Promise<SessionCreateValue> {
    return this.commands.create(request)
  }

  private workflow(): PersonalWorkflow {
    const service = this.ctx.get('personalWorkflow')
    if (service === undefined) throw new Error('personal workflow service is unavailable')
    return service
  }

  /** Read the durable user-selected task enhancement mode.
   * @param sessionId - Existing conversation identity.
   * @returns Current mode; initially disabled.
   */
  @Remote('workflowMode')
  async workflowMode(sessionId: SessionId): Promise<import('@deepseek-ai/dsh-personal-workflow/types').WorkflowMode> {
    return this.workflow().mode(await this.personalSession(sessionId))
  }

  /** Select enhancement mode without submitting a prompt.
   * @param request - Explicit user choice and expected mode revision.
   * @returns Mode after persistence succeeds.
   */
  @Remote('workflowSetMode')
  async workflowSetMode(request: import('@deepseek-ai/dsh-personal-workflow/types').SetWorkflowModeRequest): Promise<import('@deepseek-ai/dsh-personal-workflow/types').WorkflowMode> {
    const resolved = await this.agents.resolveAgent(request.sessionId)
    if ('error' in resolved) throw resolved.error
    if (request.enabled) {
      const skill = await this.ctx.get('skills')?.get('dev-workflow', { scope: resolved.agent, cwd: resolved.agent.session.header.cwd })
      if (skill?.provider !== 'dev-workflow') throw new Error('personal-workflow: bundled dev-workflow Skill unavailable in this conversation')
    }
    return this.workflow().setMode(resolved.agent.session, request)
  }

  /** Read local workflow testing preferences.
   * @returns User-owned switch and revision.
   */
  @Remote('workflowTestingPreferences')
  workflowTestingPreferences(): import('@deepseek-ai/dsh-personal-workflow/types').WorkflowTestingPreferences {
    return this.workflow().testingPreferences()
  }

  /** Set the temporary decomposition override without granting execution permission.
   * @param request - Explicit user gesture with the observed revision.
   * @returns Persisted testing preference.
   */
  @Remote('workflowSetTestingPreferences')
  workflowSetTestingPreferences(request: import('@deepseek-ai/dsh-personal-workflow/types').SetWorkflowTestingPreferencesRequest): Promise<import('@deepseek-ai/dsh-personal-workflow/types').WorkflowTestingPreferences> {
    return this.workflow().setTestingPreferences(request)
  }

  /** Read configured execution ceilings for the authorization form.
   * @returns Deployment-specific action, turn, duration and observation limits.
   */
  @Remote('workflowLimits')
  workflowLimits(): import('@deepseek-ai/dsh-personal-workflow/types').ExecutionLimits {
    return this.workflow().execution.limits
  }

  /** Read ready task candidates for an existing conversation.
   * @param sessionId - User-selected conversation.
   * @returns Currently executable tasks; reading grants no ownership.
   */
  @Remote('workflowCandidates')
  async workflowCandidates(sessionId: SessionId): Promise<PlanView[]> {
    return this.workflow().execution.candidates(await this.personalSession(sessionId))
  }

  /** Read the current or historical execution binding.
   * @param sessionId - Conversation identity.
   * @returns Associated attempt, including any revoked ownership.
   */
  @Remote('workflowRun')
  workflowRun(sessionId: SessionId): import('@deepseek-ai/dsh-personal-workflow/types').TaskRun | null {
    return this.workflow().execution.forSession(sessionId)
  }

  /** Claim one exact-version task without submitting a prompt.
   * @param request - User selection and separately chosen execution authorization.
   * @returns Durable task owner.
   */
  @Remote('workflowClaim')
  async workflowClaim(request: import('@deepseek-ai/dsh-personal-workflow/types').ClaimTaskRequest): Promise<import('@deepseek-ai/dsh-personal-workflow/types').TaskRun> {
    const resolved = await this.agents.resolveAgent(request.sessionId)
    if ('error' in resolved) throw resolved.error
    if (resolved.agent.status !== 'idle') throw new Error('select-task-in-idle-conversation')
    return this.workflow().execution.claim(resolved.agent.session, request)
  }

  /** Pause or cancel this task without cancelling sibling tasks.
   * @param request - Current owner and user stop gesture.
   * @param cancel - Whether to permanently cancel this attempt.
   * @returns Persisted stopped attempt; in-flight results remain tracked.
   */
  @Remote('workflowStop')
  async workflowStop(request: import('@deepseek-ai/dsh-personal-workflow/types').ControlTaskRequest, cancel: boolean): Promise<import('@deepseek-ai/dsh-personal-workflow/types').TaskRun> {
    return this.workflow().execution.stop(await this.personalSession(request.sessionId), request, cancel)
  }

  /** Resume only after explicit reconciliation where required.
   * @param request - Owner epoch and user's reconciliation note.
   * @returns Resumed attempt with unchanged authorization budget.
   */
  @Remote('workflowResume')
  async workflowResume(request: import('@deepseek-ai/dsh-personal-workflow/types').ResumeTaskRequest): Promise<import('@deepseek-ai/dsh-personal-workflow/types').TaskRun> {
    return this.workflow().execution.resume(await this.personalSession(request.sessionId), request)
  }

  /** Prepare, create or adopt, and transfer to one durable receiving conversation.
   * @param request - Explicit same-workspace handoff gesture and context.
   * @returns Transferred attempt; receiver waits for explicit resume and prompt.
   */
  @Remote('workflowHandoff')
  async workflowHandoff(request: import('@deepseek-ai/dsh-personal-workflow/types').HandoffTaskRequest): Promise<import('@deepseek-ai/dsh-personal-workflow/types').TaskRun> {
    const source = await this.personalSession(request.sessionId)
    const handoff = await this.workflow().execution.prepareHandoff(source, request)
    const { projectId, botId } = handoff.snapshot.definition
    await this.commands.create({ sessionId: handoff.targetSessionId, cwd: handoff.baseline.cwd,
      ...(projectId === null ? {} : { projectId }), ...(botId === null ? {} : { botId }),
      ...(source.header.agentPreset === undefined ? {} : { agentPreset: source.header.agentPreset }),
    })
    return this.workflow().execution.finishHandoff(await this.personalSession(handoff.targetSessionId), request.runId, handoff.id)
  }

  /** List current task plans without activating execution.
   * @returns persistent plan views.
   */
  @Remote('workflowList')
  workflowList(): PlanView[] { return this.workflow().list() }

  /** Read an exact structured plan version.
   * @param request - root task and optional version.
   * @returns persistent version.
   */
  @Remote('workflowRead')
  workflowRead(request: ReadPlanRequest): PlanRevision { return this.workflow().read(request) }

  /** Save a user proposal or edit without approval.
   * @param request - complete proposal and compare-and-save version.
   * @returns committed version or original retry receipt.
   */
  @Remote('workflowSave')
  workflowSave(request: SavePlanRequest): Promise<PlanRevision> { return this.workflow().save(request) }

  /** Approve the current exact version without starting execution.
   * @param request - human review and expected version.
   * @returns committed approval.
   */
  @Remote('workflowApprove')
  workflowApprove(request: ApprovePlanRequest): Promise<PlanRevision> { return this.workflow().approve(request) }

  /** Export the same structured version displayed by task views.
   * @param request - root task and optional version.
   * @returns read-only Markdown.
   */
  @Remote('workflowExport')
  workflowExport(request: ReadPlanRequest): string { return this.workflow().export(request) }

  /** Record an exact plan snapshot in an existing Session.
   * @param request - Session, task, version and retry identity.
   * @returns snapshot after Session flush.
   */
  @Remote('workflowSnapshot')
  async workflowSnapshot(request: SnapshotPlanRequest): Promise<WorkflowSnapshot> {
    const session = await this.personalSession(request.sessionId)
    return this.workflow().snapshot(session, {
      taskId: request.taskId, ...(request.revision === undefined ? {} : { revision: request.revision }),
    }, request.operationId)
  }

  private personal(): PersonalProjectRegistry {
    const registry = this.ctx.get('personalProjects')
    if (registry === undefined) throw new Error('personal Project and Bot service is unavailable')
    return registry
  }

  /** List current personal records for the Client data surface.
   * @returns Project and Bot records.
   */
  @Remote('personalList')
  personalList(): PersonalRecordsValue {
    const registry = this.personal()
    return { projects: registry.listProjects(), bots: registry.listBots() }
  }

  /** Create a Project with an identity independent of Workspace.
   * @param request - validated Project fields.
   * @returns the stored Project.
   */
  @Remote('personalCreateProject')
  personalCreateProject(request: PersonalProjectCreateRequest): Promise<import('@deepseek-ai/dsh-personal-project/types').Project> {
    return this.personal().createProject(request)
  }

  /** Edit the current Project metadata.
   * @param request - Project ID and changed fields.
   * @returns the updated Project.
   */
  @Remote('personalUpdateProject')
  personalUpdateProject(request: PersonalProjectUpdateRequest): Promise<import('@deepseek-ai/dsh-personal-project/types').Project> {
    const { id, ...patch } = request
    return this.personal().updateProject(id, patch)
  }

  /** Remove one Project while retaining every Session and its history.
   * @param id - Project to remove.
   * @returns whether the Project existed.
   */
  @Remote('personalDeleteProject')
  personalDeleteProject(id: ProjectId): Promise<boolean> {
    return this.personal().deleteProject(id, sessionId => this.personalSession(sessionId))
  }

  /** Create a user-authored Bot profile.
   * @param request - Bot fields without credentials.
   * @returns the stored Bot profile.
   */
  @Remote('personalCreateBot')
  async personalCreateBot(request: PersonalBotCreateRequest): Promise<import('@deepseek-ai/dsh-personal-project/types').BotProfile> {
    await this.validateBotModel(request.defaultModel)
    return this.personal().createBot(request)
  }

  /** Edit a Bot profile for subsequent requests.
   * @param request - Bot ID and changed fields.
   * @returns the updated Bot profile.
   */
  @Remote('personalUpdateBot')
  async personalUpdateBot(request: PersonalBotUpdateRequest): Promise<import('@deepseek-ai/dsh-personal-project/types').BotProfile> {
    if (request.defaultModel !== null) await this.validateBotModel(request.defaultModel)
    const { id, ...patch } = request
    return this.personal().updateBot(id, patch)
  }

  /** Remove one Bot while retaining every Session and its history.
   * @param id - Bot to remove.
   * @returns whether the Bot existed.
   */
  @Remote('personalDeleteBot')
  personalDeleteBot(id: BotId): Promise<boolean> {
    return this.personal().deleteBot(id, sessionId => this.personalSession(sessionId))
  }

  /** Read one Session's current affiliation and transitions without copying it.
   * @param sessionId - Session to inspect.
   * @returns its current affiliation and history.
   */
  @Remote('personalAffiliation')
  async personalAffiliation(sessionId: SessionId): Promise<SessionAffiliationValue> {
    const state = await this.inspect(sessionId)
    return { affiliation: PersonalProjectRegistry.fold(state.events) }
  }

  /** Move a Session's Project and/or Bot reference in its own event log.
   * @param request - Session ID and changed affiliation fields.
   * @returns the committed affiliation projection.
   */
  @Remote('personalMove')
  async personalMove(request: SessionAffiliationMoveRequest): Promise<SessionAffiliationValue> {
    const session = await this.personalSession(request.sessionId)
    const current = this.personal().affiliation(session).current
    const affiliation = this.personal().move(session, {
      ...(request.projectId === undefined
        ? current.projectId === undefined ? {} : { projectId: current.projectId }
        : request.projectId === null ? {} : { projectId: request.projectId }),
      ...(request.botId === undefined
        ? current.botId === undefined ? {} : { botId: current.botId }
        : request.botId === null ? {} : { botId: request.botId }),
    })
    await this.ctx.sessions.flush(session)
    return { affiliation }
  }

  private async personalSession(sessionId: SessionId): Promise<import('@deepseek-ai/dsh-session').Session> {
    const resolved = await this.agents.resolveAgent(sessionId)
    if ('error' in resolved) throw resolved.error
    return resolved.agent.session
  }

  private async validateBotModel(model: BotModel | undefined): Promise<void> {
    if (model === undefined) return
    try {
      await this.ctx.llm.resolveCallConfig({
        provider: model.provider, model: model.model,
        ...(model.reasoningEffort === undefined ? {} : { reasoningEffort: ReasoningEffortId(model.reasoningEffort) }),
      })
    } catch (error) {
      this.ctx.logger.warn(`personal-bot model-route-rejected provider=${model.provider} model=${model.model}`)
      throw new RemoteError('session/model-unavailable', error instanceof Error ? error.message : String(error), {
        provider: model.provider, model: model.model,
      })
    }
  }

  /**
   * Select one Session-local model after explicitly resuming the Session.
   * @param request - Session identity and requested model selection.
   * @returns the normalized selection installed for the Session.
   */
  @Remote('selectModel')
  selectModel(request: SessionSelectModelRequest): Promise<SessionSelectModelValue> {
    return this.commands.selectModel(request)
  }

  /**
   * Describe every currently routable model for Host-generation selectors.
   * @returns provider-grouped models, the deployment default, and isolated provider failures.
   */
  @Remote('modelCatalog')
  modelCatalog(): Promise<ModelCatalog> {
    return buildModelCatalog(this.ctx)
  }

  /**
   * Report whether this deployment can hand a Session workspace path to a native desktop.
   * @returns true when the matching open operation is available.
   */
  @Remote
  canOpenWorkspacePath(): boolean {
    return this.canOpenPath()
  }

  /**
   * Describe the serving desktop for authenticated file-action routes.
   * @returns Host name, configured availability, and platform-specific file-manager behavior.
   */
  workspaceDesktop(): { name: string; available: boolean; fileManager: 'finder' | 'explorer' | 'directory' | null } {
    const fileManager = nativeFileManager()
    return { name: hostname(), available: fileManager !== null && this.canOpenPath(), fileManager }
  }

  /**
   * Verify one path through the composed filesystem and open it on the Host desktop.
   * @param request - path after best-effort Session workspace resolution.
   * @param signal - caller lifetime; abort terminates the native command.
   * @returns confirmation after the native opener accepts the path.
   * @throws RemoteError when the request is invalid, has no verified Host mapping, is cancelled, or the opener fails.
   */
  @Remote('openWorkspacePath')
  async openWorkspacePath(
    request: SessionOpenWorkspacePathRequest,
    signal: AbortSignal,
  ): Promise<SessionOpenWorkspacePathValue> {
    try {
      const path = await this.verifyDesktopPath(request.path, signal)
      if (request.action === 'reveal') await this.revealPath(path, signal)
      else if (request.application !== undefined) await this.openFileApplication(path, request.application, signal)
      else await this.openPath(path, signal)
      return { opened: true }
    } catch (error: unknown) {
      if (signal.aborted) throw new RemoteError('gateway/cancelled', 'path open was aborted', {})
      if (error instanceof RemoteError) throw error
      throw new RemoteError(
        'gateway/internal',
        'path open failed',
        {},
        { cause: error },
      )
    }
  }

  /**
   * Query current file handlers on the serving desktop without activating an Agent.
   * @param request - file path in Host filesystem syntax.
   * @param signal - caller lifetime, propagated to filesystem and desktop queries.
   * @returns OS application names, icons, and default selection; empty when desktop opening is unavailable.
   * @throws RemoteError when the path is invalid, the query is cancelled, or native discovery fails.
   */
  @Remote('workspacePathApplications')
  async workspacePathApplications(
    request: { readonly path: string }, signal: AbortSignal,
  ): Promise<readonly SessionWorkspacePathApplication[]> {
    if (!this.canOpenPath()) return []
    try {
      const path = await this.verifyDesktopPath(request.path, signal)
      return await this.fileApplications(path, signal)
    } catch (error: unknown) {
      if (signal.aborted) throw new RemoteError('gateway/cancelled', 'application query was aborted', {})
      if (error instanceof RemoteError) throw error
      throw new RemoteError('gateway/internal', 'file application query failed', {}, { cause: error })
    }
  }

  private async verifyDesktopPath(path: string, signal: AbortSignal): Promise<string> {
    if (path.length === 0) throw new RemoteError('gateway/bad-request', 'A non-empty file path is required', {})
    signal.throwIfAborted()
    const hostPath = resolve(path)
    const { fs } = this.ctx
    const mapped = fs.processPathFromHostPath(hostPath)
    if (mapped === undefined || fs.processPath(await fs.resolve(mapped, { signal })) !== hostPath) {
      throw new RemoteError('gateway/bad-request', 'Path has no verified Host path', {})
    }
    signal.throwIfAborted()
    return hostPath
  }

  /**
   * Rename one Session after explicitly resuming it.
   * @param request - Session identity and proposed title.
   * @returns the accepted title and durable event sequence.
   */
  @Remote('rename')
  rename(request: SessionRenameRequest): Promise<SessionRenameValue> {
    return this.commands.rename(request)
  }

  /**
   * Fork one cold-readable exact event prefix into a new Session. An omitted
   * boundary selects the latest completed-turn prefix; an open cut receives
   * synthetic fork closers.
   * @param request - source Session and optional exact inclusive event boundary.
   * @returns the new Session identity.
   */
  @Remote('fork')
  fork(request: SessionForkRequest): Promise<SessionForkValue> {
    return this.commands.fork(request)
  }

  /**
   * Admit one prompt after explicitly resuming its Session.
   * @param request - Session identity, prompt content, source metadata, and delivery mode.
   * @param signal - caller cancellation before prompt admission begins.
   * @returns acknowledgement that the Agent accepted the prompt.
   */
  @Remote('prompt')
  prompt(request: SessionPromptRequest, signal: AbortSignal): Promise<SessionPromptValue> {
    signal.throwIfAborted()
    return this.commands.prompt(request)
  }

  /**
   * Read one image proven reachable from the addressed Session log.
   * @param request - Session and attachment identities used for authorization.
   * @returns the durable attachment reference and base64-encoded bytes.
   */
  @Remote('attachment')
  attachment(request: SessionAttachmentRequest): Promise<SessionAttachmentValue> {
    return this.commands.attachment(request)
  }

  /**
   * Mutate one still-pending queue occurrence, resuming a cold Agent first.
   * @param request - Session, queue item, and requested mutation.
   * @returns acknowledgement that the queue mutation was applied.
   */
  @Remote('updateQueue')
  updateQueue(request: SessionUpdateQueueRequest): Promise<SessionUpdateQueueValue> {
    return this.commands.updateQueue(request)
  }

  /**
   * Cancel one active Agent turn without dropping its pending inbox.
   * @param request - Session whose active Agent turn is cancelled.
   * @returns acknowledgement that cancellation was requested.
   */
  @Remote('cancel')
  cancel(request: SessionCancelRequest): SessionCancelValue {
    return this.commands.cancel(request)
  }

  /**
   * Read one cold-safe, message-aligned Session history page.
   * @param request - durable address, backward cursor, and page budget.
   * @param signal - cancellation for persistence reads.
   * @returns one chronological page.
   */
  @Remote('page')
  page(request: SessionPageRequest, signal: AbortSignal): Promise<SessionPage> {
    return this.history.page(request, signal)
  }

  /**
   * Follow one Session log from its opening or resume cursor.
   * @param request - durable address and last committed sequence already held by the caller.
   * @param signal - cancellation owned by the Remote stream carrier.
   * @returns a complete opening snapshot followed by gap-free durable event
   *   frames and optional cursorless assistant-stream frames.
   */
  @Remote({ mode: 'stream' })
  follow(request: SessionFollowRequest, signal: AbortSignal): AsyncIterable<SessionFollowFrame> {
    return this.history.follow(request, signal)
  }

  /**
   * Read all registered projections without activating an Agent.
   * @param request - Session whose current values are required.
   * @param signal - cancellation for the Session observation.
   * @returns complete baseline, or null when the Session does not exist.
   */
  @Remote('projections')
  async projections(request: SessionProjectionsRequest, signal: AbortSignal): Promise<SessionProjectionsValue> {
    const { sessionId } = request
    if (sessionId.length === 0) {
      throw new RemoteError('gateway/bad-request', 'sessionId must not be empty', {})
    }
    try {
      using observation = await this.ctx.sessionQuery.observeSession(sessionId, { signal })
      const projections = observation.projections
      if (projections === undefined) {
        throw new RemoteError('session/projections-unavailable', 'Session projections are unavailable', {})
      }
      return { asOfSeq: projections.asOfSeq, values: projections.values as SessionProjectionValues }
    } catch (error: unknown) {
      if (error instanceof SessionQueryError && error.code === 'SESSION_QUERY_SESSION_NOT_FOUND') return null
      if (signal.aborted
        || (error instanceof SessionQueryError && error.code === 'SESSION_QUERY_ABORTED')) {
        throw new RemoteError('gateway/cancelled', 'Session projection read was cancelled', {}, { cause: error })
      }
      if (error instanceof RemoteError) throw error
      throw new RemoteError('gateway/internal', 'Session projection read failed', {}, { cause: error })
    }
  }

  /**
   * Stream a complete live-control baseline followed by replacement frames.
   * @param signal - cancellation owned by the Remote stream carrier.
   * @returns one complete baseline followed by live replacement frames.
   */
  @Remote({ mode: 'stream' })
  control(signal: AbortSignal): AsyncIterable<SessionControlFrame> {
    return this.controlState.control(signal)
  }


}

export { buildModelCatalog }
export default SessionController
