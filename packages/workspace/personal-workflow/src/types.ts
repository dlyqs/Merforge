/** Durable task definitions, version receipts, and derived execution views. */
import type { TaskRun, ExecutionReceipt } from './execution-types.ts'
export type * from './execution-types.ts'
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { ProjectId, BotId } from '@deepseek-ai/dsh-personal-project/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Stable task identity; a root task also identifies its plan. */
export type TaskId = Branded<'PersonalTaskId'>
/** Stable review and progression stage identity within a plan. */
export type PhaseId = Branded<'PersonalPhaseId'>
/** Caller-generated retry identity within one plan. */
export type OperationId = Branded<'PersonalWorkflowOperationId'>
/** One independently identifiable part of a goal. */
export interface TaskDefinition {
  readonly id: TaskId
  readonly parentTaskId: TaskId | null
  readonly phaseId: PhaseId
  readonly goal: string
  readonly scope: string
  readonly acceptance: readonly string[]
  readonly artifacts: readonly string[]
  readonly cwd: string | null
  readonly dependsOn: readonly TaskId[]
  readonly required: boolean
}
/** Named review stage; array order defines progression order. */
export interface PlanPhase {
  readonly id: PhaseId
  readonly title: string
}
/** Complete plan definition, never inferred from chat text or list order. */
export interface PlanDefinition {
  readonly taskId: TaskId
  readonly projectId: ProjectId | null
  readonly botId: BotId | null
  readonly phases: readonly PlanPhase[]
  readonly tasks: readonly TaskDefinition[]
}
/** Exact-version approval; does not authorize tool use or continuous execution. */
export interface PlanApproval {
  readonly operationId: OperationId
  readonly time: number
}
/** Immutable definition with its current review record. */
export interface PlanRevision {
  readonly revision: number
  readonly definition: PlanDefinition
  readonly source: 'user' | 'model'
  readonly sessionId: SessionId | null
  readonly createdAt: number
  readonly approval: PlanApproval | null
}
/** Compare-and-save request; zero is reserved for initial creation. */
export interface SavePlanRequest {
  readonly operationId: OperationId
  readonly expectedRevision: number
  readonly definition: PlanDefinition
}
/** Human approval request for the current exact revision. */
export interface ApprovePlanRequest {
  readonly taskId: TaskId
  readonly operationId: OperationId
  readonly expectedRevision: number
}
/** Read an immutable definition; omit revision to read the current revision. */
export interface ReadPlanRequest {
  readonly taskId: TaskId
  readonly revision?: number | undefined
}
/** Durable operation response; reused verbatim after an identical retry. */
export interface PlanReceipt {
  readonly operationId: OperationId
  readonly fingerprint: string
  readonly snapshot: PlanRevision
}
/** Atomic persistence unit: history and retry receipts commit together. */
export interface StoredPlan {
  readonly taskId: TaskId
  readonly revisions: readonly PlanRevision[]
  readonly receipts: readonly PlanReceipt[]
  readonly runs?: readonly TaskRun[] | undefined
  readonly executionReceipts?: readonly ExecutionReceipt[] | undefined
}
/** Snapshot observed by one Session; reading does not claim execution. */
export interface WorkflowSnapshot {
  readonly taskId: TaskId
  readonly operationId: OperationId
  readonly snapshot: PlanRevision
}
/** Session-targeted explicit read that persists the returned snapshot. */
export interface SnapshotPlanRequest extends ReadPlanRequest {
  readonly sessionId: SessionId
  readonly operationId: OperationId
}
/** Task states exposed by the task detail view. */
export type TaskStatus = 'draft' | 'pending_review' | 'blocked' | 'ready' | 'running' | 'paused' | 'needs_reconciliation' | 'completed' | 'cancelled'
/** Trusted execution observations; Phase 5 supplies these from Run/Evidence records. */
export interface TaskObservation {
  readonly taskId: TaskId
  readonly status: 'running' | 'paused' | 'needs_reconciliation' | 'completed' | 'cancelled'
  readonly evidence: readonly string[]
}
/** Computed status and dependency explanation for one task. */
export interface TaskView {
  readonly taskId: TaskId
  readonly status: TaskStatus
  readonly candidate: boolean
  readonly blockers: readonly TaskId[]
  readonly requiredChildren: number
  readonly completedChildren: number
}
/** One-version task tree and dependency projection. */
export interface PlanView {
  readonly snapshot: PlanRevision
  readonly tasks: readonly TaskView[]
  readonly ready: readonly TaskId[]
  readonly runs?: readonly TaskRun[] | undefined
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Exact durable plan observed in this Session; it grants no execution ownership. */
    'personal-workflow/snapshot': WorkflowSnapshot
  }
}

/** User-selected enhancement mode; revision is monotonic within one Session. */
export interface WorkflowMode {
  readonly enabled: boolean
  readonly revision: number
}
/** Compare-and-set user gesture for the enhancement mode. */
export interface SetWorkflowModeRequest {
  readonly sessionId: SessionId
  readonly enabled: boolean
  readonly expectedRevision: number
  readonly operationId: OperationId
}
/** Durable routing decision made by the model after examining the user's goal. */
export interface WorkflowAssessment {
  readonly modeRevision: number
  readonly decision: 'simple' | 'clarify' | 'infeasible' | 'complex'
  readonly explanation: string
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Explicit user selection; never inferred from model text. */
    'personal-workflow/mode': WorkflowMode & { readonly operationId: OperationId }
    /** Model assessment grants proposal permission only for this mode revision. */
    'personal-workflow/assessment': WorkflowAssessment
  }
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    personalWorkflowMode: WorkflowMode
  }
  interface SessionProjectionMap {
    personalWorkflowMode: WorkflowMode
  }
}

/** User-owned temporary workflow testing preference, persisted on this device. */
export interface WorkflowTestingPreferences {
  readonly forceDecomposition: boolean
  readonly revision: number
}
/** Compare-and-set user gesture; not exposed to model tools. */
export interface SetWorkflowTestingPreferencesRequest {
  readonly forceDecomposition: boolean
  readonly expectedRevision: number
}
