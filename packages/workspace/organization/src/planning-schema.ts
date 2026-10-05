/** Fixed planning-only authority protocol; no task, device, credential or execution fields. */
import { z } from 'zod'
import { brandString, type Branded } from '@deepseek-ai/dsh-brand'
import { workgraphSaveSchema, workgraphDefinitionSchema, workgraphVersionSchema } from './workgraph-schema.ts'
import { executionModelSchema } from './execution-schema.ts'
import { projectContentFields } from './resource-schema.ts'
import type { OrganizationId, OrganizationProjectId, OperationId, AccountId, MembershipId } from './types.ts'
const id = <T extends Branded<string>>() => z.uuid().transform(brandString<T>)
const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
/** Stable local conversation selector, independently owned by each organization account. */
export const planningReadSchema = z.object({ organizationId: id<OrganizationId>(), projectId: id<OrganizationProjectId>(),
  conversationId: id<Branded<'OrganizationConversationId'>>() }).strict()
/** Deployment-approved model destinations and finite planning ceilings. */
export const planningPolicySchema = z.object({ models: z.array(executionModelSchema).max(100),
  ttlMs: integer.positive().max(3600000), permitTtlMs: integer.positive().max(60000),
  maxRequests: integer.positive().max(1000), maxInputBytes: integer.positive().max(10485760),
  maxOutputBytes: integer.positive().max(10485760), maxTotalBytes: integer.positive().max(1073741824),
  maxDurationMs: integer.positive().max(3600000),
}).strict()
const base = planningReadSchema.extend({ operationId: id<OperationId>() })
/** Explicit selection creates finite permission without assignment, lease or write access. */
export const planningOpenSchema = base.extend({ kind: z.literal('open-planning'), selection: executionModelSchema }).strict()
/** Each actual HTTP attempt reserves count and byte ceilings before sending. */
export const planningReserveSchema = base.extend({ kind: z.literal('reserve-planning-request'),
  requestDigest: z.string().regex(/^[a-f0-9]{64}$/), inputBytes: integer.positive(), outputBytes: integer.positive(),
}).strict()
/** Final online admission consumes one reserved attempt; replay never permits another send. */
export const planningConsumeSchema = base.extend({ kind: z.literal('consume-planning-request'),
  permitId: id<Branded<'OrganizationPlanningPermitId'>>(), requestDigest: planningReserveSchema.shape.requestDigest,
}).strict()
/** One stable private goal writes one shared plan; editing preserves its exact selected root. */
export const planningDraftSchema = base.extend({ kind: z.literal('save-planning-draft'),
  goalId: id<Branded<'OrganizationConversationGoalId'>>(), assessmentId: id<OperationId>(), settingsRevision: integer,
  planId: workgraphSaveSchema.shape.planId, expectedRevision: workgraphSaveSchema.shape.expectedRevision,
  definition: workgraphDefinitionSchema,
}).strict()
/** Current subtree read is separately authorized and carries no mutation intent. */
export const planningPlanReadSchema = planningReadSchema.extend({ kind: z.literal('read-planning-plan'),
  planId: workgraphSaveSchema.shape.planId, taskId: workgraphDefinitionSchema.shape.taskId }).strict()
/** Authorized subtree plus impact information, without hidden sibling identifiers or content. */
export const planningPlanViewSchema = z.object({ version: workgraphVersionSchema, canEdit: z.boolean(),
  structuralEdit: z.boolean(), invalidatesQualifications: z.literal(true),
  requiresOriginalApproval: z.literal(true) }).strict()
/** Closed planning command set used only by the private native planning channel. */
export const planningCommandSchema = z.discriminatedUnion('kind', [planningOpenSchema, planningReserveSchema, planningConsumeSchema, planningDraftSchema])
/** Durable finite qualification; policy and current grants are rechecked on every use. */
export const planningGrantSchema = planningReadSchema.extend({ accountId: id<AccountId>(), membershipId: id<MembershipId>(),
  serverEpoch: z.uuid(), policyDigest: planningReserveSchema.shape.requestDigest, accessDigest: planningReserveSchema.shape.requestDigest,
  selection: executionModelSchema, limits: planningPolicySchema.omit({ models: true }),
  createdAt: integer, expiresAt: integer, usedRequests: integer, usedBytes: integer, createdRevision: integer.positive(),
  qualificationRevision: integer.positive(),
}).strict()
/** Charged reservation remains charged when dispatch or its receipt is uncertain. */
export const planningPermitSchema = planningReserveSchema.omit({ kind: true, operationId: true }).extend({
  id: planningConsumeSchema.shape.permitId, accountId: id<AccountId>(), serverEpoch: z.uuid(),
  expiresAt: integer, qualificationRevision: integer.positive(), state: z.enum(['reserved', 'consumed']), createdRevision: integer.positive(),
  consumedRevision: integer.positive().nullable(),
}).strict()
/** Historical receipt identifiers contain no fresh permission. */
export const planningReceiptSchema = z.object({ conversationId: planningReadSchema.shape.conversationId,
  permitId: planningConsumeSchema.shape.permitId.optional(), permitExpiresAt: integer.optional(),
  planId: workgraphSaveSchema.shape.planId.optional(),
  planRevision: integer.positive().optional(), taskId: workgraphDefinitionSchema.shape.taskId.optional() }).strict()
/** Strict planning mutation receipt excludes every unrelated business record. */
export const planningMutationReceiptSchema = z.object({ operationId: id<OperationId>(), revision: integer,
  organizationId: planningReadSchema.shape.organizationId, projectId: planningReadSchema.shape.projectId,
  planning: planningReceiptSchema }).strict()
/** Fresh project authorization and optional finite qualification. */
export const planningViewSchema = z.object({ project: z.object({ id: planningReadSchema.shape.projectId,
  organizationId: planningReadSchema.shape.organizationId, name: z.string(), version: integer,
  background: projectContentFields.background.default(''), summary: projectContentFields.summary.default(''), goal: projectContentFields.goal.default('') }).strict(),
canWrite: z.boolean().default(false),
plans: z.array(z.object({ goalId: planningDraftSchema.shape.goalId, planId: workgraphSaveSchema.shape.planId,
  taskId: workgraphDefinitionSchema.shape.taskId }).strict()).default([]),
grant: planningGrantSchema.nullable(), eligible: z.boolean(), serverTime: integer, policy: planningPolicySchema,
}).strict()
/** Candidate query is scoped to current project read; name matching never resolves an identity implicitly. */
export const planningCandidatesSchema = planningReadSchema.pick({ organizationId: true, projectId: true })
  .extend({ search: z.string().max(120).default(''), offset: integer.default(0) }).strict()
/** Only enabled, explicitly project-readable peers are visible; no account metadata or other tasks. */
export const planningCandidatesPageSchema = z.object({ items: z.array(z.object({ membershipId: id<MembershipId>(),
  username: z.string() }).strict()),
offset: integer, total: integer }).strict()

/** Account conversation reads authorize membership without requiring a project grant. */
export const accountConversationReadSchema = planningReadSchema.partial({ projectId: true })
/** Account reads without a project carry no planning grant, task references or write permission. */
export const accountConversationViewSchema = planningViewSchema.extend({ project: planningViewSchema.shape.project.optional() })
