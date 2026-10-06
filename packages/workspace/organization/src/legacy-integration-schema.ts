/** Stored record readers for retired target verification; no commands are accepted. */
import { z } from 'zod'
import { brandString } from '@deepseek-ai/dsh-brand'
import { workgraphReadSchema, planRevisionSchema, workgraphDefinitionSchema } from './workgraph-schema.ts'
import type { Branded } from '@deepseek-ai/dsh-brand'
/** Identifier retained only in stored target records. */
export type OrganizationIntegrationId = Branded<'OrganizationIntegrationId'>
/** Historical opaque target reference. */
export type OrganizationTargetId = Branded<'OrganizationTargetId'>
import type { OrganizationAssignmentId } from './assignment-types.ts'
import type { MembershipId } from './types.ts'
import type { OrganizationSubmissionId, OrganizationArtifactId } from './delivery-types.ts'
const hash = z.string().regex(/^[a-f0-9]{64}$/)
const git = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/)
const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
/** Explicit task selection, independent of leaf assignment or lease. */
export const integrationReadSchema = workgraphReadSchema.omit({ revision: true }).extend({
  taskId: workgraphDefinitionSchema.shape.taskId, planRevision: planRevisionSchema,
}).strict()
/** Exact accepted submission set; order has no semantic meaning. */
export const integrationInputSchema = z.object({ assignmentId: z.uuid().transform(brandString<OrganizationAssignmentId>),
  taskId: workgraphDefinitionSchema.shape.taskId,
  submissionId: z.uuid().transform(brandString<OrganizationSubmissionId>),
  artifacts: z.array(z.object({ artifactId: z.uuid().transform(brandString<OrganizationArtifactId>), sha256: hash }).strict()),
}).strict()
/** Portable file evidence has no local directory name or file body. */
export const integrationFileSchema = z.object({ path: z.string().min(1).max(512).refine(v =>
  !/[\\:\x00-\x1f]/.test(v) && v.split('/').every(p => p !== '' && p !== '.' && p !== '..')),
sha256: hash.nullable(), size: integer.nullable() }).strict()
/** Native target observation; failed observations cannot support final delivery. */
export const integrationObservationSchema = z.object({
  targetRef: z.uuid().transform(brandString<OrganizationTargetId>), baseCommit: git, baseTree: git,
  files: z.array(integrationFileSchema).min(1), verifiedAt: integer,
  result: z.enum(['verified', 'rejected']),
}).strict()
const integrationId = z.uuid().transform(brandString<OrganizationIntegrationId>)
/** Immutable authority receipt including the original plan issuer. */
export const integrationRecordSchema = integrationReadSchema.extend({ id: integrationId,
  inputs: z.array(integrationInputSchema).min(1), observation: integrationObservationSchema,
  operatorId: z.uuid().transform(brandString<MembershipId>), issuerId: z.uuid().transform(brandString<MembershipId>),
  createdRevision: integer.positive(),
}).strict()
/** Receipt result for account-scoped uncertain-write reconciliation. */
export const integrationReceiptSchema = z.object({ integrationId, delivered: z.boolean() }).strict()
