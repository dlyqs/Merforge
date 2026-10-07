/** Task view registration over the personal sidebar's extension seat. */
import { personalPlanDefinition } from './conversation-node.ts'
import { ConversationPlan } from './ConversationPlan.tsx'
import type { Context } from '@deepseek-ai/cordis'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { WorkflowActions, ModeActions, ExecutionActions } from './contract.ts'
import { TestingPreferences, type TestingPreferencesActions } from './TestingPreferences.tsx'
import { Execution } from './Execution.tsx'
import { Mode } from './Mode.tsx'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import { createWorkflowStore } from './store.ts'
import { WorkflowList, WorkflowIcon } from './WorkflowList.tsx'
import { Workflow } from './Workflow.tsx'
import { en, zh } from './locales.ts'

/** Services used by the Remote adapter and navigation. */
export const inject = ['slots', 'remote', 'remote.session', 'locale', 'uiWorkspace', 'layout', 'uiConversation', 'sessions']
function valueOf<T>(result: RemoteResult<T>): T {
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

/** Register localized plan review without starting an Agent.
 * @param ctx - Client plugin context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register('personalWorkflow', { zh, en }), 'personal-workflow: dictionaries')
  ctx.slots.inject('settings.personal.testing', () => ctx.slots.register({
    name: 'settings.personal.testing', locale: 'personalWorkflow',
    inject: (): TestingPreferencesActions => ({
      readPlanningPreferences: async () => valueOf(await ctx.remote.session.workflowPreferences()),
      setPlanningPreferences: async request => valueOf(await ctx.remote.session.workflowSetPreferences(request)),
      readPreferences: async () => valueOf(await ctx.remote.session.workflowTestingPreferences()),
      setPreferences: async request => valueOf(await ctx.remote.session.workflowSetTestingPreferences(request)),
    }),
  }, TestingPreferences))
  const store = createWorkflowStore()
  const openTasks = (): void => { ctx.layout.selectPanel('tasks' as MainPanelId) }
  const workflowActions: WorkflowActions = {
    list: async () => valueOf(await ctx.remote.session.workflowList()),
    save: async request => valueOf(await ctx.remote.session.workflowSave(request)),
    approve: async request => valueOf(await ctx.remote.session.workflowApprove(request)),
    exportPlan: async request => valueOf(await ctx.remote.session.workflowExport(request)),
    openSession: (id) => { ctx.uiWorkspace.openSession(id) },
  }
  ctx.effect(() => ctx.uiConversation.events.register(personalPlanDefinition), 'personal-workflow.conversation-node')
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({ name: 'conversation.chat.node', key: 'personal-plan',
    locale: 'personalWorkflow', inject: () => ({ list: workflowActions.list, save: (request: Parameters<WorkflowActions['save']>[0]) => workflowActions.save(request) }) }, ConversationPlan))
  ctx.slots.inject('sidebar.tasks', () => ctx.slots.register({
    name: 'sidebar.tasks', locale: 'personalWorkflow', store,
    inject: () => ({ list: workflowActions.list, openTasks }),
  }, WorkflowList))
  const t = ctx.locale.bind('personalWorkflow')
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist', id: 'tasks', order: -100, label: () => t('plans'),
  }, WorkflowIcon))
  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main', key: 'tasks', locale: 'personalWorkflow', store, inject: () => workflowActions,
  }, Workflow))
  ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
    name: 'conversation.input.left', id: 'personal-workflow-mode', locale: 'personalWorkflow',
    inject: (sessionId): ModeActions => ({
      personalPlanning: ctx.sessions.binding(sessionId)?.controls?.planningScope !== 'account',
      readPlanningPreferences: async () => ctx.sessions.binding(sessionId)?.controls?.readPlanningPreferences()
        ?? valueOf(await ctx.remote.session.workflowPreferences()),
      setPlanningPreferences: async request => ctx.sessions.binding(sessionId)?.controls?.setPlanningPreferences(request)
        ?? valueOf(await ctx.remote.session.workflowSetPreferences(request)),
      readTesting: async () => valueOf(await ctx.remote.session.workflowTestingPreferences()),
      readMode: async sessionId => ctx.sessions.binding(sessionId)?.controls?.readMode()
        ?? valueOf(await ctx.remote.session.workflowMode(sessionId)),
      setMode: async request => ctx.sessions.binding(request.sessionId)?.controls?.setMode(request.enabled,
        request.expectedRevision, request.operationId) ?? valueOf(await ctx.remote.session.workflowSetMode(request)),
    }),
  }, Mode))

  ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
    name: 'conversation.input.left', id: 'personal-workflow-execution', locale: 'personalWorkflow',
    inject: (sessionId): ExecutionActions => ({
      account: ctx.sessions.binding(sessionId)?.controls,
      candidates: async sessionId => valueOf(await ctx.remote.session.workflowCandidates(sessionId)),
      readRun: async sessionId => valueOf(await ctx.remote.session.workflowRun(sessionId)),
      readPlan: async request => valueOf(await ctx.remote.session.workflowRead(request)),
      limits: async () => valueOf(await ctx.remote.session.workflowLimits()),
      claim: async request => valueOf(await ctx.remote.session.workflowClaim(request)),
      stop: async (request, cancel) => valueOf(await ctx.remote.session.workflowStop(request, cancel)),
      resume: async request => valueOf(await ctx.remote.session.workflowResume(request)),
      handoff: async request => valueOf(await ctx.remote.session.workflowHandoff(request)),
      openSession: (id) => { ctx.uiWorkspace.openSession(id) },
    }),
  }, Execution))

}
