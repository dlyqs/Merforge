/** Organization identities and safe views crossing the organization protocol. */
import type { OrganizationPlanId, OrganizationPlanRevision } from './workgraph-types.ts'
import type { Branded } from '@deepseek-ai/dsh-brand'

/** Identity of one organization service instance. */
export type ServerId = Branded<'OrganizationServerId'>
/** Account identity within a service instance. */
export type AccountId = Branded<'OrganizationAccountId'>
/** Organization identity, unrelated to a personal Project. */
export type OrganizationId = Branded<'OrganizationId'>
/** One account's membership in one organization. */
export type MembershipId = Branded<'OrganizationMembershipId'>
/** Single-use invitation identity. */
export type InvitationId = Branded<'OrganizationInvitationId'>
/** Caller-generated mutation identifier retained through retries. */
export type OperationId = Branded<'OrganizationOperationId'>
/** Secret bearer credential; never persisted in plaintext. */
export type LoginToken = Branded<'OrganizationLoginToken'>
/** Host-generated random invitation credential. */
export type InvitationToken = Branded<'OrganizationInvitationToken'>
/** Current membership action; resource actions belong to the resource authorizer. */
export type OrganizationAction = 'member' | 'manage'
/** Organization administration does not grant content read access. */
export type Role = 'admin' | 'member'

/** Server-derived identity valid only at the time of the check. */
export interface Principal {
  serverId: ServerId
  accountId: AccountId
  organizationId?: OrganizationId | undefined
  membershipId?: MembershipId | undefined
  role?: Role
}
/** Persisted mutation result without credentials or private profile data. */
export interface Receipt {
  delivery?: import('zod').z.output<typeof import('./delivery-schema.ts').deliveryReceiptSchema> | undefined
  execution?: import('./execution-types.ts').OrganizationExecutionReceipt | undefined
  operationId: OperationId
  revision: number
  accountId?: AccountId | undefined
  organizationId?: OrganizationId | undefined
  membershipId?: MembershipId | undefined
  invitationId?: InvitationId | undefined
  projectId?: OrganizationProjectId | undefined
  planId?: OrganizationPlanId | undefined
  deviceId?: import('./assignment-types.ts').OrganizationDeviceId | undefined
  lease?: import('./device-types.ts').OrganizationLease | undefined
  delegationId?: import('./assignment-types.ts').OrganizationDelegationId | undefined
  assignmentId?: import('./assignment-types.ts').OrganizationAssignmentId | undefined
  planRevision?: OrganizationPlanRevision | undefined
}
/** Successful login; the token is delivered once and held by the local Host. */
export interface LoginResult {
  token: LoginToken
  expiresAt: number
  principal: Principal
}
/** Organization visible through a currently enabled membership. */
export interface OrganizationView {
  id: OrganizationId
  name: string
  version: number
  membershipId: MembershipId
  role: Role
}
/** Administrative member view excluding password and login material. */
export interface MemberView {
  id: MembershipId
  accountId: AccountId
  username: string
  accountEnabled: boolean
  accountVersion: number
  role: Role
  enabled: boolean
  version: number
}
/** Stable denial codes suitable for localization by a protocol consumer. */
export type OrganizationErrorCode = 'invalid-input' | 'incompatible-store' | 'closed'
  | 'already-initialized' | 'not-initialized' | 'invalid-credentials' | 'rate-limited'
  | 'unauthenticated' | 'forbidden' | 'invalid-invitation' | 'username-taken'
  | 'snapshot-required' | 'already-member' | 'version-conflict' | 'last-admin' | 'operation-conflict' | 'invalid-recovery'

/** Organization-owned project identity, unrelated to personal projects and paths. */
export type OrganizationProjectId = Branded<'OrganizationProjectId'>
/** Authenticated event cursor scoped to the service lifetime, account and organization. */
export type OrganizationCursor = Branded<'OrganizationCursor'>
/** Explicit project actions; administration alone grants neither action. */
export type ProjectAction = 'read' | 'write'
/** Minimal authorized project view; no filesystem or personal Session fields. */
export interface OrganizationProjectView {
  id: OrganizationProjectId
  organizationId: OrganizationId
  name: string
  version: number
}
/** One current-authority page with its atomic event handoff cursor. */
export interface OrganizationProjectPage {
  items: OrganizationProjectView[]
  total: number
  offset: number
  revision: number
  cursor: OrganizationCursor
}
/** Resource invalidation, without historical project names or content. */
export interface OrganizationResourceEvent {
  revision: number
  projectId: OrganizationProjectId
}
/** Continuous cursor range; only currently readable project invalidations are included. */
export interface OrganizationEventBatch {
  from: OrganizationCursor
  cursor: OrganizationCursor
  revision: number
  events: OrganizationResourceEvent[]
}

/** Administrative grant metadata contains no project name or content. */
export interface ResourceGrantView {
  membershipId: MembershipId
  projectId: OrganizationProjectId
  actions: ProjectAction[]
  version: number
}
