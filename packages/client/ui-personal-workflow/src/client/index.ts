/** Task view registration over the personal sidebar's extension seat. */
import type { Context } from '@deepseek-ai/cordis'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { WorkflowActions, ModeActions, ExecutionActions } from './contract.ts'
import { Execution } from './Execution.tsx'
import { Mode } from './Mode.tsx'
import { Workflow } from './Workflow.tsx'
import { en, zh } from './locales.ts'

/** Services used by the Remote adapter and navigation. */
export const inject = ['slots', 'remote', 'remote.session', 'locale', 'uiWorkspace']

function valueOf<T>(result: RemoteResult<T>): T {
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

/** Register localized plan review without starting an Agent.
 * @param ctx - Client plugin context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register('personalWorkflow', { zh, en }), 'personal-workflow: dictionaries')
  ctx.slots.inject('sidebar.personal.workflow', () => ctx.slots.register({
    name: 'sidebar.personal.workflow', locale: 'personalWorkflow',
    inject: (): WorkflowActions => ({
      list: async () => valueOf(await ctx.remote.session.workflowList()),
      save: async request => valueOf(await ctx.remote.session.workflowSave(request)),
      approve: async request => valueOf(await ctx.remote.session.workflowApprove(request)),
      exportPlan: async request => valueOf(await ctx.remote.session.workflowExport(request)),
      openSession: (id) => { ctx.uiWorkspace.openSession(id) },
    }),
  }, Workflow))
  ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
    name: 'conversation.input.left', id: 'personal-workflow-mode', locale: 'personalWorkflow',
    inject: (): ModeActions => ({
      readMode: async sessionId => valueOf(await ctx.remote.session.workflowMode(sessionId)),
      setMode: async request => valueOf(await ctx.remote.session.workflowSetMode(request)),
    }),
  }, Mode))

  ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
    name: 'conversation.input.left', id: 'personal-workflow-execution', locale: 'personalWorkflow',
    inject: (): ExecutionActions => ({
      candidates: async sessionId => valueOf(await ctx.remote.session.workflowCandidates(sessionId)),
      readRun: async sessionId => valueOf(await ctx.remote.session.workflowRun(sessionId)),
      limits: async () => valueOf(await ctx.remote.session.workflowLimits()),
      claim: async request => valueOf(await ctx.remote.session.workflowClaim(request)),
      stop: async (request, cancel) => valueOf(await ctx.remote.session.workflowStop(request, cancel)),
      resume: async request => valueOf(await ctx.remote.session.workflowResume(request)),
      handoff: async request => valueOf(await ctx.remote.session.workflowHandoff(request)),
      openSession: (id) => { ctx.uiWorkspace.openSession(id) },
    }),
  }, Execution))

}
