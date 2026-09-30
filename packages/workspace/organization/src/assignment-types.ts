/** Durable organization assignment identities and read views; no execution permission. */
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { MembershipId, OrganizationId, OrganizationProjectId } from './types.ts'
import type { OrganizationPlanId, OrganizationPlanRevision, OrganizationTaskId } from './workgraph-types.ts'

/** One explicit approval, retained after revocation or definition changes. */
export type OrganizationAssignmentId = Branded<'OrganizationAssignmentId'>
/** One designated member's durable acceptance request. */
export type OrganizationHumanRequestId = Branded<'OrganizationHumanRequestId'>
/** One durable notification fact; reading it never answers its request. */
export type OrganizationNotificationId = Branded<'OrganizationNotificationId'>
/** Exact-version approval and terminal invalidation metadata. */
export interface OrganizationAssignment {
  id: OrganizationAssignmentId
  organizationId: OrganizationId
  projectId: OrganizationProjectId
  planId: OrganizationPlanId
  planRevision: OrganizationPlanRevision
  taskId: OrganizationTaskId
  approvedBy: MembershipId
  assigneeId: MembershipId
  state: 'pending' | 'accepted' | 'rejected' | 'revoked' | 'invalidated'
  reason: 'revision-changed' | 'authority-lost' | 'restored' | null
  createdAt: number
  createdRevision: number
  version: number
}

/** Independent, bounded permission to prepare execution on one registered device. */
export type OrganizationDelegationId = Branded<'OrganizationDelegationId'>
/** Revocable native public-key registration, never a renderer-selected machine identity. */
export type OrganizationDeviceId = Branded<'OrganizationDeviceId'>
/** Durable answer and notification metadata, filtered through current task visibility. */
export interface OrganizationHumanRequest {
  id: OrganizationHumanRequestId
  assignmentId: OrganizationAssignmentId
  kind: 'accept-assignment'
  state: 'pending' | 'cancelled' | 'accepted' | 'rejected' | 'expired'
  expiresAt: number | null
  answeredRevision: number | null
}
/** One assignee-visible inbox entry; readAt never implies acceptance. */
export interface OrganizationInboxItem {
  request: import('zod').z.output<typeof import('./delivery-schema.ts').submissionViewSchema> | OrganizationHumanRequest | import('zod').z.output<typeof import('./execution-human-schema.ts').executionHumanSchema>
  assignment: OrganizationAssignment
  notificationId: OrganizationNotificationId | null
  readAt: number | null
}
/** Current-authority snapshot; pagination must retain its cursor. */
export interface OrganizationInboxPage {
  items: OrganizationInboxItem[]
  total: number
  unread: number
  offset: number
  revision: number
  cursor: import('./types.ts').OrganizationCursor
}
/** Capabilities are preparation-only until Phase 7A supplies an action consumer. */
export interface OrganizationDelegation {
  id: OrganizationDelegationId
  assignmentId: OrganizationAssignmentId
  planRevision: OrganizationPlanRevision
  membershipId: MembershipId
  deviceId: OrganizationDeviceId
  executorId: 'desktop-builtin'
  capabilities: ('task-read' | 'draft')[]
  budget: number
  expiresAt: number
  state: 'active' | 'revoked' | 'invalidated' | 'expired'
  createdRevision: number
  version: number
}
