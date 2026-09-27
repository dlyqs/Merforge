/** Safe Desktop organization views; bearer tokens and certificates stay in the native owner. */
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { Principal, OrganizationView, OrganizationProjectPage, MemberView, Receipt, OrganizationId, OperationId } from '@deepseek-ai/dsh-organization/types'

/** Native request identity, scoped by server, account, organization and generation. */
export type OrganizationRequestId = Branded<'OrganizationRequestId'>

/** User-selected connection operation; no arbitrary URL path or HTTP method is accepted. */
export type ConnectionAction =
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
}
/** Safe command result. Invitation secrets are returned only to the initiating local user. */
export interface ConnectionResult {
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
  snapshot(): Promise<OrganizationDesktopSnapshot>
  connection(action: ConnectionAction): Promise<ConnectionResult>
  server(action: OrganizationServerAction): Promise<{ recoveryToken?: string; path?: string }>
  secret(): Promise<string>
  subscribe(listener: (snapshot: OrganizationDesktopSnapshot) => void): () => void
}
