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
