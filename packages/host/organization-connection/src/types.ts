/** Safe Desktop organization views; bearer tokens and certificates stay in the native owner. */
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { Principal, OrganizationView, OrganizationProjectPage, MemberView, Receipt, OrganizationId, OperationId } from '@deepseek-ai/dsh-organization/types'

/** Native request identity, scoped by server, account, organization and generation. */
export type OrganizationRequestId = Branded<'OrganizationRequestId'>

/** User-selected connection operation; no arbitrary URL path or HTTP method is accepted. */
export type ConnectionAction =
  | { kind: 'assignment-batch' | 'assignment-batch-read' | 'planning-read' | 'planning-candidates' | 'planning-plan'; request: unknown }
  | { kind: 'integration-read' | 'integration-verify' | 'integration-confirm' | 'delivery-command' | 'delivery-read' | 'delivery-download' | 'execution-list' | 'execution-command' | 'execution-read' | 'assignment-review' | 'assignment-command' | 'assignment-participant' | 'assignment-delegate' | 'assignment-tasks' | 'assignment-inbox' | 'assignment-preparation' | 'lease-claim' | 'lease-release' | 'lease-check'; request: unknown }
  | { kind: 'device-register'; name: string }
  | { kind: 'device-revoke'; expectedVersion: number }
  | { kind: 'device-read' }
  | { kind: 'workgraph-save' | 'workgraph-read' | 'workgraph-tasks' | 'workgraph-grant' | 'workgraph-grants'; request: unknown }
  | { kind: 'probe'; origin: string }
  | { kind: 'trust'; fingerprint: string }
  | { kind: 'login'; username: string; password: string }
  | { kind: 'register'; invitationToken: string; username: string; password: string }
  | { kind: 'logout' | 'reconnect' | 'personal' | 'reconcile' }
  | { kind: 'select'; organizationId: OrganizationId }
  | { kind: 'search'; query: string; offset: number }
  | { kind: 'invite'; role: 'admin' | 'member' }
  | { kind: 'command'; command: unknown }
  | { kind: 'grants'; projectId: string }

/** Native-owned connection snapshot; reset on every identity or organization transition. */
export interface ConnectionSnapshot {
  revision: number
  generation: number
  phase: 'disconnected' | 'untrusted' | 'signed-out' | 'loading' | 'ready' | 'offline'
  mode: 'personal' | 'organization'
  origin?: string | undefined
  offer?: { fingerprint: string; expiresAt: number } | undefined
  principal?: Principal | undefined
  organizations: OrganizationView[]
  organizationId?: OrganizationId | undefined
  projects?: OrganizationProjectPage | undefined
  members: MemberView[]
  username?: string | undefined
  error?: string | undefined
  pendingOperation?: OperationId | undefined
  inbox?: import('@deepseek-ai/dsh-organization').OrganizationInboxPage | undefined
  renewing?: import('@deepseek-ai/dsh-organization').OrganizationAssignmentId | undefined
}
/** Safe command result. Invitation secrets are returned only to the initiating local user. */
export interface ConnectionResult {
  assignmentBatch?: import('./assignment-batch.ts').AssignmentBatch
  planningPlan?: import('zod').z.output<typeof import('@deepseek-ai/dsh-organization/planning').planningPlanViewSchema>
  planning?: import('zod').z.output<typeof import('@deepseek-ai/dsh-organization/planning').planningViewSchema>
  candidates?: import('zod').z.output<typeof import('@deepseek-ai/dsh-organization/planning').planningCandidatesPageSchema>
  integration?: import('zod').z.output<typeof import('@deepseek-ai/dsh-organization/delivery').integrationViewSchema>
  delivery?: import('zod').z.output<typeof import('@deepseek-ai/dsh-organization/delivery').deliveryPageSchema>
  artifact?: import('zod').z.output<typeof import('@deepseek-ai/dsh-organization/delivery').artifactDownloadSchema>
  executions?: import('zod').z.output<typeof import('@deepseek-ai/dsh-organization/execution').executionPageSchema>
  execution?: import('@deepseek-ai/dsh-organization').OrganizationExecutionView
  generation?: number
  assignment?: {
    generation: number
    result: { kind: 'review'; value: import('zod').z.output<typeof import('@deepseek-ai/dsh-organization/assignment').approvalReviewResultSchema> }
      | { kind: 'tasks'; value: import('zod').z.output<typeof import('@deepseek-ai/dsh-organization/assignment').taskAssignmentsPageSchema> }
      | { kind: 'inbox'; value: import('@deepseek-ai/dsh-organization').OrganizationInboxPage }
      | { kind: 'preparation'; value: import('zod').z.output<typeof import('@deepseek-ai/dsh-organization/assignment').preparationSchema> }
      | { kind: 'device'; value: import('@deepseek-ai/dsh-organization').OrganizationDevice | null }
  }

  receipt?: Receipt
  invitationToken?: string
  grants?: import('@deepseek-ai/dsh-organization/types').ResourceGrantView[]
  workgraph?: {
    generation: number
    requestId: OrganizationRequestId
    principal: Principal
    organizationId: OrganizationId
    result: { kind: 'plan'; value: import('@deepseek-ai/dsh-organization').OrganizationPlanVersion }
      | { kind: 'tasks'; value: import('@deepseek-ai/dsh-organization').OrganizationTaskPage }
      | { kind: 'grants'; value: import('@deepseek-ai/dsh-organization').OrganizationTaskGrant[] }
  }
}

/** Settings retained on the service machine, separate from all personal profiles. */
export interface OrganizationServerSettings {
  host: string
  port: number
  names: string[]
  restoreOnLaunch: boolean
}
/** Private process facts safe to show in settings. */
export interface OrganizationServerSnapshot {
  phase: 'disabled' | 'starting' | 'stopping' | 'failed' | 'ready'
  settings: OrganizationServerSettings
  fingerprint?: string
  expiresAt?: number
  renewalDue?: boolean
  port?: number
  error?: string | undefined
}
/** Explicit local service controls; backup paths are selected by native dialogs. */
export type OrganizationServerAction =
  | { kind: 'start' | 'stop' | 'backup' | 'restore' | 'rotate-certificate' }
  | { kind: 'configure'; settings: OrganizationServerSettings }
  | { kind: 'initialize'; username: string; password: string; organizationName: string; recoveryToken: string }
  | { kind: 'recover'; recoveryToken: string; newRecoveryToken: string; newPassword: string }

/** Main-owned state shared by the settings and organization navigation. */
export interface OrganizationDesktopSnapshot { connection: ConnectionSnapshot; server: OrganizationServerSnapshot }
/** Sandboxed preload operations, restricted to the owning Desktop top frame. */
export interface OrganizationDesktopBridge {
  conversation(request: import('@deepseek-ai/dsh-organization-conversation/protocol').ConversationRequest): Promise<{
    generation: number
    result: import('@deepseek-ai/dsh-organization-conversation/protocol').ConversationResult
  }>

  executionReport(request: import('@deepseek-ai/dsh-organization-execution/protocol').ExecutionReportRequest): Promise<{
    generation: number
    report: import('@deepseek-ai/dsh-organization-execution/protocol').ExecutionReport
  }>
  execution(request: import('@deepseek-ai/dsh-organization-execution/protocol').ExecutionRequest): Promise<{
    generation: number
    result: import('@deepseek-ai/dsh-organization-execution/protocol').ExecutionResult
  }>

  context(request: import('@deepseek-ai/dsh-organization-context/protocol').ContextRequest): Promise<{
    generation: number
    result: import('@deepseek-ai/dsh-organization-context/protocol').ContextResult
  }>
  snapshot(): Promise<OrganizationDesktopSnapshot>
  connection(action: ConnectionAction): Promise<ConnectionResult>
  server(action: OrganizationServerAction): Promise<{ recoveryToken?: string; path?: string }>
  secret(): Promise<string>
  subscribe(listener: (snapshot: OrganizationDesktopSnapshot) => void): () => void
}

/** Native-only fixed Run operations, retired permanently with their initiating identity. */
export interface OrganizationExecutionChannel {
  generation: number
  signal: AbortSignal
  /** @returns Current authorized Run/action metadata. */
  read(): Promise<import('@deepseek-ai/dsh-organization').OrganizationExecutionView>
  /**
   * Send one signed command for the captured Run, retaining uncertain receipts.
   * @param command - Fixed reserve, settle or transition command.
   * @returns The authority's committed receipt.
   */
  command(command: import('zod').z.output<typeof import('@deepseek-ai/dsh-organization/execution').executionCommandSchema>): Promise<Receipt>
  /**
   * Own one local Host interval until cancellation and teardown settle.
   * @param work - Private Host operation using the captured lifetime.
   * @returns The Host result after the operation drains.
   */
  run<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T>
}
