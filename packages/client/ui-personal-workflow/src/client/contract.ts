/** Personal plan view props and Remote callbacks. */
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkflowMode, SetWorkflowModeRequest, PlanView, PlanRevision, SavePlanRequest, ApprovePlanRequest, ReadPlanRequest } from '@deepseek-ai/dsh-personal-workflow/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-client-ui-personal/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { createWorkflowStore } from './store.ts'
import type { WorkflowKey } from './locales.ts'

/** Operations return only committed Host results. */
export interface WorkflowActions {
  list(this: void): Promise<PlanView[]>
  save(request: SavePlanRequest): Promise<PlanRevision>
  approve(request: ApprovePlanRequest): Promise<PlanRevision>
  exportPlan(request: ReadPlanRequest): Promise<string>
  openSession(id: SessionId): void
}
/** Derived slot props and user operations. */
export type WorkflowProps = PropsRuntime<'main'> & PropsLocale<'personalWorkflow'> & WorkflowActions & PropsStore<ReturnType<typeof createWorkflowStore>>
/** Shared task list selection and navigation. */
export type WorkflowListProps = PropsRuntime<'sidebar.tasks'> & PropsLocale<'personalWorkflow'> & Pick<WorkflowActions, 'list'> & PropsStore<ReturnType<typeof createWorkflowStore>> & { openTasks(): void }

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Task plan review and editing copy. */
    personalWorkflow: WorkflowKey
  }
}

/** Explicit mode selection callbacks; no model caller receives these. */
export interface ModeActions {
  /** Account task controls retain their own planning settings and execution authority. */
  readonly personalPlanning: boolean
  readPlanningPreferences(this: void): Promise<import('@deepseek-ai/dsh-personal-workflow/types').WorkflowPreferences>
  setPlanningPreferences(request: import('@deepseek-ai/dsh-personal-workflow/types').SetWorkflowPreferencesRequest): Promise<import('@deepseek-ai/dsh-personal-workflow/types').WorkflowPreferences>
  readTesting(this: void): Promise<import('@deepseek-ai/dsh-personal-workflow/types').WorkflowTestingPreferences>
  readMode(this: void, sessionId: SessionId): Promise<WorkflowMode>
  setMode(request: SetWorkflowModeRequest): Promise<WorkflowMode>
}
/** Composer mode toggle with the standard Session binding. */
export type ModeProps = PropsRuntime<'conversation.input.left'> & PropsLocale<'personalWorkflow'> & ModeActions

/** Explicit execution controls exposed only through user actions. */
export interface ExecutionActions {
  /** Account task selection uses the same composer action and its authorized detail area. */
  account?: Pick<import('@deepseek-ai/dsh-api-session-controller/client').SessionControls,
    'assigned' | 'openExecution' | 'taskTitle' | 'taskId' | 'listTasks' | 'selectTask'> | undefined
  candidates(sessionId: SessionId): Promise<PlanView[]>
  readRun(sessionId: SessionId): Promise<import('@deepseek-ai/dsh-personal-workflow/types').TaskRun | null>
  /** @param request - Bound plan identity and immutable revision. @returns Definition used by this execution attempt. */
  readPlan(request: ReadPlanRequest): Promise<PlanRevision>
  limits(): Promise<{ maxActions: number; maxTurns: number; maxDurationMs: number }>
  claim(request: import('@deepseek-ai/dsh-personal-workflow/types').ClaimTaskRequest): Promise<import('@deepseek-ai/dsh-personal-workflow/types').TaskRun>
  stop(request: import('@deepseek-ai/dsh-personal-workflow/types').ControlTaskRequest, cancel: boolean): Promise<import('@deepseek-ai/dsh-personal-workflow/types').TaskRun>
  resume(request: import('@deepseek-ai/dsh-personal-workflow/types').ResumeTaskRequest): Promise<import('@deepseek-ai/dsh-personal-workflow/types').TaskRun>
  handoff(request: import('@deepseek-ai/dsh-personal-workflow/types').HandoffTaskRequest): Promise<import('@deepseek-ai/dsh-personal-workflow/types').TaskRun>
  openSession(id: SessionId): void
}
/** Composer execution selector and owner controls. */
export type ExecutionProps = PropsRuntime<'conversation.input.left'> & PropsLocale<'personalWorkflow'> & ExecutionActions
