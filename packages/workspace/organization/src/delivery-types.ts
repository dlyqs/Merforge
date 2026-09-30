/** Organization-owned evidence and employee submission identifiers. */
import type { Branded } from '@deepseek-ai/dsh-brand'
/** Immutable published evidence; its identifier alone grants no access. */
export type OrganizationArtifactId = Branded<'OrganizationArtifactId'>
/** One explicit employee submission of an immutable artifact set. */
export type OrganizationSubmissionId = Branded<'OrganizationSubmissionId'>
