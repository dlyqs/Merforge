/** Exact-version integration evidence and explicit human final delivery. */
import { z } from 'zod'
import { brandString } from '@deepseek-ai/dsh-brand'
import { workgraphReadSchema, planRevisionSchema, workgraphDefinitionSchema } from './workgraph-schema.ts'
import type { OrganizationIntegrationId, OrganizationTargetId } from './delivery-types.ts'
import type { OrganizationAssignmentId } from './assignment-types.ts'
import type { OperationId, MembershipId } from './types.ts'
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
  artifacts: z.array(z.object({ artifactId: z.uuid().transform(brandString<OrganizationArtifactId>), sha256: hash }).strict()).min(1),
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
/** Native-only mutations; Renderer supplies neither observations nor accepted inputs. */
export const integrationCommandSchema = z.discriminatedUnion('kind', [
  integrationReadSchema.extend({ kind: z.literal('verify-integration'), operationId: z.uuid().transform(brandString<OperationId>),
    inputs: z.array(integrationInputSchema).min(1), observation: integrationObservationSchema }).strict(),
  integrationReadSchema.extend({ kind: z.literal('confirm-integration'), operationId: z.uuid().transform(brandString<OperationId>),
    integrationId, observation: integrationObservationSchema, confirmed: z.literal(true) }).strict(),
])
/** Durable projection distinguishes dependency, acceptance, verification and delivery. */
export const integrationViewSchema = integrationReadSchema.extend({ dependenciesReady: z.boolean(), inputsReady: z.boolean(),
  inputs: z.array(integrationInputSchema), canConfirm: z.boolean(),
  latest: integrationRecordSchema.nullable(), delivered: z.boolean(),
}).strict()
/** Fixed native dialog operations accept no filesystem path or caller-authored evidence. */
export const integrationNativeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('integration-verify'), request: integrationReadSchema }).strict(),
  z.object({ kind: z.literal('integration-confirm'), request: integrationReadSchema.extend({ integrationId, confirmed: z.literal(true) }).strict() }).strict(),
])
/** Receipt result for account-scoped uncertain-write reconciliation. */
export const integrationReceiptSchema = z.object({ integrationId, delivered: z.boolean() }).strict()
