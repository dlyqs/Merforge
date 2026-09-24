/** Personal plan view props and Remote callbacks. */
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkflowMode, SetWorkflowModeRequest, PlanView, PlanRevision, SavePlanRequest, ApprovePlanRequest, ReadPlanRequest } from '@deepseek-ai/dsh-personal-workflow/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-client-ui-personal/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { WorkflowKey } from './locales.ts'

/** Operations return only committed Host results. */
export interface WorkflowActions {
  list(): Promise<PlanView[]>
  save(request: SavePlanRequest): Promise<PlanRevision>
  approve(request: ApprovePlanRequest): Promise<PlanRevision>
  exportPlan(request: ReadPlanRequest): Promise<string>
  openSession(id: SessionId): void
}
/** Derived slot props and user operations. */
export type WorkflowProps = PropsRuntime<'sidebar.personal.workflow'> & PropsLocale<'personalWorkflow'> & WorkflowActions

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Task plan review and editing copy. */
    personalWorkflow: WorkflowKey
  }
}

/** Explicit mode selection callbacks; no model caller receives these. */
export interface ModeActions {
  readMode(this: void, sessionId: SessionId): Promise<WorkflowMode>
  setMode(request: SetWorkflowModeRequest): Promise<WorkflowMode>
}
/** Composer mode toggle with the standard Session binding. */
export type ModeProps = PropsRuntime<'conversation.input.left'> & PropsLocale<'personalWorkflow'> & ModeActions
