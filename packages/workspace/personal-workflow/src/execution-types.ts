/** Durable execution ownership, limits, evidence and same-workspace transfers. */
import type { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { OperationId, PhaseId, TaskId, TaskStatus, PlanRevision } from './types.ts'

/** Execution attempt identity retained across conversation transfers. */
export type RunId = Branded<'PersonalWorkflowRunId'>
/** Persisted transfer identity. */
export type HandoffId = Branded<'PersonalWorkflowHandoffId'>
/** Explicit task or inclusive phase-range authorization; budgets span the entire execution. */
export interface ExecutionAuthorization {
  readonly mode: 'manual' | 'auto' | 'auto_until'
  readonly stopPhaseId: PhaseId
  /** Present only for an explicitly authorized ordered phase sequence. */
  readonly startPhaseId?: PhaseId | undefined
  /** Create a fresh conversation after this many completed phases; omitted disables automatic relay. */
  readonly relayEveryPhases?: number | undefined
  readonly maxActions: number
  readonly maxTurns: number
  readonly maxDurationMs: number
}
/** Host-observed file fingerprint; null means the declared path is absent. */
export interface ArtifactFingerprint { readonly path: string; readonly sha256: string | null }
/** API workspace observation or native canonical directory, used for explicit reconciliation, never for rollback. */
export interface WorkspaceBaseline {
  readonly cwd: string
  readonly gitHead: string | null
  readonly gitDirty: string | null
  readonly gitFiles: readonly ArtifactFingerprint[]
  readonly files: readonly ArtifactFingerprint[]
}
/** One admitted tool invocation; pending after restart means unknown effects. */
export interface ExecutionAction {
  readonly callId: ToolCallId
  readonly name: string
  readonly status: 'pending' | 'succeeded' | 'failed' | 'unknown' | 'reconciled'
}
/** API completion evidence or explicitly identified Codex completion report. */
export interface ExecutionEvidence {
  /** Native reports are recorded without independent file/tool verification. */
  readonly reportedBy?: 'codex' | undefined
  readonly summary: string
  readonly acceptance: readonly string[]
  readonly callIds: readonly string[]
  readonly files: readonly ArtifactFingerprint[]
  readonly time: number
}
/** Same-task ownership transfer persisted before creating its receiver. */
export interface TaskHandoff {
  readonly runId: RunId
  readonly taskId: TaskId
  readonly planRevision: number
  readonly id: HandoffId
  readonly operationId: OperationId
  readonly sourceSessionId: SessionId
  readonly targetSessionId: SessionId
  readonly ownerEpoch: number
  readonly status: 'prepared' | 'transferred'
  readonly context: string
  readonly baseline: WorkspaceBaseline
  readonly snapshot: PlanRevision
  readonly authorization: ExecutionAuthorization
  readonly actionsUsed: number
  readonly turnsUsed: number
  readonly evidence: readonly ExecutionEvidence[]
  readonly prerequisites: readonly ExecutionEvidence[]
}
/** One attempt with a single current owner and retained conversation history. */
export interface TaskRun {
  /** Fixed authorized order and independently verified completed tasks across phase progression. */
  readonly sequence?: {
    readonly taskIds: readonly TaskId[]
    readonly completed: readonly {
      readonly taskId: TaskId
      readonly evidence: readonly ExecutionEvidence[]
      readonly actionsUsed: number
    }[]
  } | undefined
  /** Absent on historical API runs; fixed at explicit task selection. */
  readonly backend?: 'codex' | undefined
  readonly id: RunId
  readonly taskId: TaskId
  readonly planId: TaskId
  readonly planRevision: number
  readonly sessionId: SessionId
  readonly sessions: readonly SessionId[]
  readonly ownerEpoch: number
  readonly status: Extract<TaskStatus, 'running' | 'paused' | 'needs_reconciliation' | 'completed' | 'cancelled'>
  readonly reason: string | null
  readonly authorization: ExecutionAuthorization
  readonly startedAt: number
  readonly turnsUsed: number
  readonly baseline: WorkspaceBaseline
  readonly reconciliations: readonly {
    readonly note: string
    readonly time: number
    readonly sessionId: SessionId
    readonly baseline: WorkspaceBaseline
  }[]
  readonly permissionFingerprint: string
  readonly actions: readonly ExecutionAction[]
  readonly evidence: readonly ExecutionEvidence[]
  readonly handoffs: readonly TaskHandoff[]
}
/** User selection with exact plan version; selecting never submits a prompt. */
export interface ClaimTaskRequest {
  readonly sessionId: SessionId
  readonly planId: TaskId
  readonly taskId: TaskId
  readonly expectedRevision: number
  readonly operationId: OperationId
  readonly authorization: ExecutionAuthorization
}
/** Compare-and-set control shared by stop, resume and transfer gestures. */
export interface ControlTaskRequest {
  readonly sessionId: SessionId
  readonly runId: RunId
  readonly ownerEpoch: number
  readonly operationId: OperationId
}
/** Explicit user decision after inspecting unknown actions or changed files. */
export interface ResumeTaskRequest extends ControlTaskRequest { readonly reconciliation: string }
/** Human-requested transfer with decisions and remaining work. */
export interface HandoffTaskRequest extends ControlTaskRequest { readonly context: string }
/** Completion report checked against API evidence or recorded as Codex-reported acceptance. */
export interface CompleteTaskRequest {
  readonly summary: string
  readonly acceptance: readonly string[]
  readonly callIds: readonly string[]
}
/** Atomic operation receipt; retries cannot mint new owners or budgets. */
export interface ExecutionReceipt { readonly operationId: OperationId; readonly fingerprint: string; readonly runId: RunId }

/** Deployment limits applied to every authorization and artifact observation. */
export interface ExecutionLimits {
  readonly maxActions: number
  readonly maxTurns: number
  readonly maxDurationMs: number
  readonly maxEvidenceBytes: number
  readonly blockedTools: readonly string[]
}
