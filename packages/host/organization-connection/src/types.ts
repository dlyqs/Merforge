/** Safe Desktop organization views; bearer tokens and certificates stay in the native owner. */
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { Principal, OrganizationView, OrganizationProjectPage, MemberView, Receipt, OrganizationId, OperationId } from '@deepseek-ai/dsh-organization/types'
import type { z } from 'zod'
import type { accountConversationViewSchema, planningPlanReadSchema, planningPlanViewSchema,
  planningCandidatesSchema, planningCandidatesPageSchema, planningCommandSchema } from '@deepseek-ai/dsh-organization/planning'
import type { assignmentReadSchema, preparationSchema } from '@deepseek-ai/dsh-organization/assignment'

/** Native-only account conversation operations that survive content refreshes. */
export interface OrganizationConversationChannel {
  generation: number
  signal: AbortSignal
  /** @returns Captured principal after checking the current login and organization lifetime. */
  current(): Principal
  /** @returns Current membership or project planning permissions for the captured conversation. */
  read(): Promise<z.output<typeof accountConversationViewSchema>>
  /** @param input - Exact task selector in this project and conversation. @returns Currently readable task definition. */
  plan(input: z.input<typeof planningPlanReadSchema>): Promise<z.output<typeof planningPlanViewSchema>>
  /** @param input - Candidate query in this project. @returns Visible project members. */
  candidates(input: z.input<typeof planningCandidatesSchema>): Promise<z.output<typeof planningCandidatesPageSchema>>
  /** @param input - Assignment selector in this project. @returns Current assignment and preparation facts. */
  assignment(input: z.input<typeof assignmentReadSchema>): Promise<z.output<typeof preparationSchema>>
  /** @param input - Planning write in this project and conversation. @returns Committed or reconciled authority receipt. */
  command(input: z.output<typeof planningCommandSchema>): Promise<Receipt>
}

/** Native request identity, scoped by server, account, organization and generation. */
export type OrganizationRequestId = Branded<'OrganizationRequestId'>

/** User-selected connection operation; no arbitrary URL path or HTTP method is accepted. */
export type ConnectionAction =
  | { kind: 'set-avatar'; avatarUrl: string | null }
  | { kind: 'remove-project'; projectId: import('@deepseek-ai/dsh-organization/types').OrganizationProjectId }
  | { kind: 'assignment-batch' | 'assignment-batch-read' | 'planning-read' | 'planning-candidates' | 'planning-plan'; request: unknown }
  | { kind: 'delivery-command' | 'delivery-read' | 'delivery-download' | 'execution-list' | 'execution-command' | 'execution-read' | 'assignment-review' | 'assignment-command' | 'assignment-participant' | 'assignment-tasks' | 'assignment-inbox' | 'assignment-preparation'; request: unknown }
  | { kind: 'workgraph-sharing' | 'workgraph-share' | 'remove-plan' | 'workgraph-delete' | 'workgraph-removal' | 'workgraph-save' | 'workgraph-read' | 'workgraph-tasks' | 'workgraph-grant' | 'workgraph-grants'; request: unknown }
  | { kind: 'probe'; origin: string }
  | { kind: 'trust'; fingerprint: string }
  | { kind: 'login'; username: string; password: string }
  | { kind: 'register'; invitationToken: string; username: string; password: string }
  | { kind: 'hierarchy' }
  | { kind: 'project-page'; offset: number; cursor?: string }
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
  /** Account cancellation lifetime; content refreshes change only generation. */
  identityGeneration: number
  phase: 'disconnected' | 'untrusted' | 'signed-out' | 'loading' | 'ready' | 'offline'
  mode: 'personal' | 'organization'
  origin?: string | undefined
  offer?: { fingerprint: string; expiresAt: number } | undefined
  principal?: Principal | undefined
  organizations: OrganizationView[]
  organizationId?: OrganizationId | undefined
  projects?: OrganizationProjectPage | undefined
  members: MemberView[]
  /** Local removals and authority deletions awaiting or completing private Host cleanup. */
  /** Installation-local task-plan removals for the current identity. */
  removedPlans?: import('@deepseek-ai/dsh-organization').OrganizationPlanId[] | undefined
  removedProjects?: import('@deepseek-ai/dsh-organization/types').OrganizationProjectId[] | undefined
  hierarchy?: import('zod').z.output<typeof import('@deepseek-ai/dsh-organization/protocol').hierarchySchema> | undefined
  /** Current authenticated account portrait; absent after logout. */
  avatarUrl?: string | null | undefined
  username?: string | undefined
  error?: string | undefined
  pendingOperation?: OperationId | undefined
  inbox?: import('@deepseek-ai/dsh-organization').OrganizationInboxPage | undefined
}
/** Safe command result. Invitation secrets are returned only to the initiating local user. */
export interface ConnectionResult {
  sharing?: z.output<typeof import('@deepseek-ai/dsh-organization/workgraph').workgraphSharingViewSchema>
  planRemoval?: z.output<typeof import('@deepseek-ai/dsh-organization/workgraph').workgraphRemovalSchema>
  projects?: OrganizationProjectPage
  hierarchy?: import('zod').z.output<typeof import('@deepseek-ai/dsh-organization/protocol').hierarchySchema>

  assignmentBatch?: import('./assignment-batch.ts').AssignmentBatch
  planningPlan?: import('zod').z.output<typeof import('@deepseek-ai/dsh-organization/planning').planningPlanViewSchema>
  planning?: import('zod').z.output<typeof import('@deepseek-ai/dsh-organization/planning').accountConversationViewSchema>
  candidates?: import('zod').z.output<typeof import('@deepseek-ai/dsh-organization/planning').planningCandidatesPageSchema>
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
   * Send one authenticated command for the captured Run, retaining uncertain receipts.
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
