/** Explicit employee sharing and immutable, exact-version delivery records. */
import { z } from 'zod'
import { brandString, type Branded } from '@deepseek-ai/dsh-brand'
import { planRevisionSchema } from './workgraph-schema.ts'
import { assignmentReadSchema } from './assignment-schema.ts'
import type { OperationId, MembershipId } from './types.ts'
import type { OrganizationRunId } from './execution-types.ts'
import type { OrganizationArtifactId, OrganizationSubmissionId, OrganizationAcceptanceId } from './delivery-types.ts'
const id = <T extends Branded<string>>() => z.uuid().transform(brandString<T>)
const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const hash = z.string().regex(/^[a-f0-9]{64}$/)
/** Portable shared paths never name a local absolute directory or traversal. */
export const artifactPathSchema = z.string().min(1).max(512).refine(value =>
  !/[\\:\x00-\x1f]/.test(value) && value.split('/').every(part => part !== '' && part !== '.' && part !== '..'))
const selector = assignmentReadSchema.extend({ runId: id<OrganizationRunId>().nullable().default(null),
  planRevision: planRevisionSchema }).strict()
const metadata = z.object({ path: artifactPathSchema, mediaType: z.string().min(1).max(120),
  description: z.string().trim().min(1).max(2048), kind: z.enum(['file', 'test-report', 'git-change']),
  /** Source file modification time in milliseconds; absent in older shared artifacts. */
  modifiedAt: integer.optional(), size: integer, sha256: hash }).strict()
/** Files are published only after complete bytes pass the declared length and hash. */
export const artifactSchema = selector.extend({ ...metadata.shape, id: id<OrganizationArtifactId>(),
  employeeId: id<MembershipId>(), createdRevision: integer.positive() }).strict()
/** Shared Git evidence uses explicit before/after bytes; applying it is a separate human operation. */
export const gitChangeSchema = z.object({ format: z.literal(1), baseCommit: z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/),
  baseTree: z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/), patch: z.string().min(1),
  files: z.array(z.object({ path: artifactPathSchema, operation: z.enum(['add', 'modify', 'delete']),
    oldSha256: hash.nullable(), newSha256: hash.nullable(), bytes: z.string().nullable() }).strict()).min(1),
}).strict()
const evidence = z.array(z.object({ artifactId: id<OrganizationArtifactId>(), sha256: hash }).strict())
const decision = selector.extend({ operationId: id<OperationId>(), submissionId: id<OrganizationSubmissionId>(),
  artifacts: evidence, confirmed: z.literal(true) }).strict()
/** Closed human delivery mutations; no model-facing tool consumes these commands. */
export const deliveryCommandSchema = z.discriminatedUnion('kind', [
  decision.extend({ kind: z.literal('accept-delivery') }).strict(),
  decision.extend({ kind: z.literal('reject-delivery'), reason: z.string().trim().min(1).max(8192),
    requirements: z.string().trim().min(1).max(8192) }).strict(),
  selector.extend({ ...metadata.shape, kind: z.literal('publish-artifact'), artifactKind: metadata.shape.kind,
    operationId: id<OperationId>(), bytes: z.string() }).strict(),
  selector.extend({ kind: z.literal('submit-delivery'), operationId: id<OperationId>(),
    artifactIds: z.array(id<OrganizationArtifactId>()), summary: z.string().trim().min(1).max(8192),
    target: z.string().trim().max(8192), confirmed: z.literal(true) }).strict(),
])
/** Immutable employee decision and issuer's durable pending acceptance notification. */
export const submissionSchema = selector.extend({ id: id<OrganizationSubmissionId>(), kind: z.literal('accept-delivery'),
  employeeId: id<MembershipId>(), handlerId: id<MembershipId>(), state: z.literal('submitted'),
  artifactIds: z.array(id<OrganizationArtifactId>()), summary: z.string().min(1).max(8192),
  /** Authority-recorded submission time in milliseconds; older submissions omit it. */
  submittedAt: integer.optional(),
  target: z.string().max(8192), createdRevision: integer.positive() }).strict()
/** Issuer decision binds immutable hashes; rejection links the newly authored whole-plan revision. */
export const acceptanceSchema = selector.extend({ id: id<OrganizationAcceptanceId>(), submissionId: id<OrganizationSubmissionId>(),
  issuerId: id<MembershipId>(), artifacts: evidence, createdRevision: integer.positive(),
  state: z.enum(['accepted', 'rejected']), reason: z.string().min(1).nullable(), requirements: z.string().min(1).nullable(),
  reworkRevision: planRevisionSchema.nullable() }).strict().refine(v => v.state === 'accepted'
  ? v.reason === null && v.requirements === null && v.reworkRevision === null
  : v.reason !== null && v.requirements !== null && v.reworkRevision === v.planRevision + 1)
/** Current review status is derived without rewriting the employee submission. */
export const submissionViewSchema = submissionSchema.extend({ acceptance: acceptanceSchema.nullable(),
  reviewState: z.enum(['pending', 'accepted', 'rejected', 'superseded', 'blocked']) }).strict()
/** Delivery result references used by account-scoped reconciliation. */
export const deliveryReceiptSchema = z.object({ artifactId: id<OrganizationArtifactId>().optional(),
  submissionId: id<OrganizationSubmissionId>().optional(), acceptanceId: id<OrganizationAcceptanceId>().optional(),
}).strict().refine(value =>
  [value.artifactId, value.submissionId, value.acceptanceId].filter(v => v !== undefined).length === 1)
/** A bounded page belongs to one exact assignment. */
export const deliveryReadSchema = assignmentReadSchema.extend({
  runId: id<OrganizationRunId>().optional(), offset: integer.default(0),
}).strict()
/** Artifact downloads use identifiers and current task access, never a hash URL. */
export const artifactReadSchema = assignmentReadSchema.extend({ artifactId: id<OrganizationArtifactId>() }).strict()
/** Authorized byte response remains on the private organization transport. */
export const artifactDownloadSchema = z.object({ artifact: artifactSchema, bytes: z.string() }).strict()
/** Deployment ceilings are exposed so the explicit sharing form can reject oversized selections. */
export const deliveryLimitsSchema = z.object({ artifactMaxFiles: integer.positive(), artifactMaxFileBytes: integer.positive(),
  artifactMaxTotalBytes: integer.positive() }).strict()
/** Authorized submissions and published evidence, bounded before native delivery. */
export const deliveryPageSchema = z.object({ artifacts: z.array(artifactSchema), submissions: z.array(submissionViewSchema),
  total: integer, offset: integer, limits: deliveryLimitsSchema }).strict()
