/** Organization planning identities and complete definitions, without execution fields. */
import type { Branded, BrandedNumber } from '@deepseek-ai/dsh-brand'
import type { MembershipId, OrganizationId, OrganizationProjectId } from './types.ts'

/** Stable plan identity within the organization authority. */
export type OrganizationPlanId = Branded<'OrganizationPlanId'>
/** Stable task identity, never reused after removal. */
export type OrganizationTaskId = Branded<'OrganizationTaskId'>
/** Planning phase identity, unrelated to execution status. */
export type OrganizationPhaseId = Branded<'OrganizationPhaseId'>
/** Per-plan immutable definition sequence, distinct from database event revisions. */
export type OrganizationPlanRevision = BrandedNumber<'OrganizationPlanRevision'>
/** Explicit task definition; suggested membership never grants access. */
export interface OrganizationTask {
  id: OrganizationTaskId
  parentTaskId: OrganizationTaskId | null
  phaseId: OrganizationPhaseId
  goal: string
  scope: string
  acceptance: string[]
  artifacts: string[]
  required: boolean
  dependsOn: OrganizationTaskId[]
  suggestedMembershipId: MembershipId | null
}
/** Complete edit input; authorization-filtered task views are not definitions. */
export interface OrganizationPlanDefinition {
  taskId: OrganizationTaskId
  phases: { id: OrganizationPhaseId; title: string }[]
  tasks: OrganizationTask[]
}
/** Immutable stored definition with server-recorded author and exact revision. */
export interface OrganizationPlanVersion {
  planId: OrganizationPlanId
  organizationId: OrganizationId
  projectId: OrganizationProjectId
  revision: OrganizationPlanRevision
  definition: OrganizationPlanDefinition
  createdBy: MembershipId
  createdAt: number
}
/** Authorized task projection; hidden relations cannot be reconstructed from this view. */
export interface OrganizationTaskView extends OrganizationTask {
  planId: OrganizationPlanId
  revision: OrganizationPlanRevision
  phaseTitle: string
  assignable: boolean
  hasUndisclosedPrerequisite: boolean
}
/** Current-authority page; total counts only matching visible tasks. */
export interface OrganizationTaskPage {
  items: OrganizationTaskView[]
  total: number
  offset: number
  revision: number
  cursor: import('./types.ts').OrganizationCursor
}
/** Administration metadata does not confer permission to read task text. */
export interface OrganizationTaskGrant {
  planId: OrganizationPlanId
  taskId: OrganizationTaskId
  membershipId: MembershipId
  scope: 'node' | 'subtree'
  actions: ('read' | 'edit')[]
  version: number
  active: boolean
}
/** Content-free invalidations for currently visible changes only. */
export interface OrganizationWorkgraphBatch {
  from: import('./types.ts').OrganizationCursor
  cursor: import('./types.ts').OrganizationCursor
  revision: number
  events: { revision: number; planId: OrganizationPlanId }[]
}
