/** Strict WorkGraph input and durable JSON parsers; plans contain no execution authority. */
import { z } from 'zod'
import { brandString, brandNumber, type Branded } from '@deepseek-ai/dsh-brand'
import { taskGraphErrors } from '@deepseek-ai/dsh-task-graph'
import type { MembershipId, OrganizationId, OrganizationProjectId, OperationId } from './types.ts'
import type { OrganizationPlanId, OrganizationTaskId, OrganizationPhaseId, OrganizationPlanRevision } from './workgraph-types.ts'

function id<T extends Branded<string>>() { return z.uuid().transform(value => brandString<T>(value)) }
const text = z.string().trim().min(1)
const taskId = id<OrganizationTaskId>()
const phaseId = id<OrganizationPhaseId>()
/** Nonzero definition revision, not a database event or authorization version. */
export const planRevisionSchema = z.number().int().positive().transform(value => brandNumber<OrganizationPlanRevision>(value))
/** Complete tree validation shared with personal plans through the stateless graph library. */
export const workgraphDefinitionSchema = z.object({
  taskId,
  phases: z.array(z.object({ id: phaseId, title: text }).strict()).min(1),
  tasks: z.array(z.object({
    id: taskId, parentTaskId: taskId.nullable(), phaseId,
    goal: text, scope: text, acceptance: z.array(text).min(1), artifacts: z.array(text),
    required: z.boolean(), dependsOn: z.array(taskId), suggestedMembershipId: id<MembershipId>().nullable(),
  }).strict()).min(1),
}).strict().superRefine((plan, ctx) => {
  for (const message of taskGraphErrors(plan)) ctx.addIssue({ code: 'custom', message })
})
/** Save a whole definition; zero expected revision creates a new caller-identified plan. */
export const workgraphSaveSchema = z.object({
  operationId: id<OperationId>(), organizationId: id<OrganizationId>(), projectId: id<OrganizationProjectId>(),
  planId: id<OrganizationPlanId>(), expectedRevision: z.number().int().nonnegative(), definition: workgraphDefinitionSchema,
}).strict()
/** Creator-only deletion of the complete task plan at its observed revision. */
export const workgraphDeleteSchema = workgraphSaveSchema.omit({ definition: true })
/** Current creator and assignment eligibility without task text. */
export const workgraphRemovalSchema = z.object({ global: z.boolean(), local: z.boolean(), revision: planRevisionSchema }).strict()
/** Exact historical or latest full-definition read; always rechecks current root permission. */
export const workgraphReadSchema = z.object({
  organizationId: id<OrganizationId>(), projectId: id<OrganizationProjectId>(), planId: id<OrganizationPlanId>(),
  revision: planRevisionSchema.optional(),
}).strict()
/** Durable full definition and server-derived authorship. */
export const workgraphVersionSchema = z.object({
  planId: id<OrganizationPlanId>(), organizationId: id<OrganizationId>(), projectId: id<OrganizationProjectId>(),
  revision: planRevisionSchema, definition: workgraphDefinitionSchema,
  createdBy: id<MembershipId>(), createdAt: z.number().int().nonnegative(),
}).strict()
/** Durable plan head; root and project remain stable across revisions. */
export const workgraphPlanSchema = z.object({
  id: id<OrganizationPlanId>(), organizationId: id<OrganizationId>(), projectId: id<OrganizationProjectId>(),
  rootTaskId: taskId, currentRevision: planRevisionSchema, structureVersion: z.number().int().positive(),
  createdBy: id<MembershipId>(),
}).strict()
/** Explicit task grant with structural epoch and retained revocation version. */
export const taskGrantRowSchema = z.object({
  planId: id<OrganizationPlanId>(), taskId, membershipId: id<MembershipId>(), scope: z.enum(['node', 'subtree']),
  canRead: z.union([z.literal(0), z.literal(1)]), canEdit: z.union([z.literal(0), z.literal(1)]),
  structureVersion: z.number().int().positive(), version: z.number().int().positive(),
}).strict()
/** Explicit task-grant management selector, never a content read. */
export const workgraphGrantsSchema = workgraphReadSchema.omit({ revision: true })
/** Node reads or root-subtree edits; the authority checks the selected root. */
export const workgraphGrantSchema = workgraphGrantsSchema.extend({
  operationId: id<OperationId>(), taskId, membershipId: id<MembershipId>(),
  scope: z.enum(['node', 'subtree']), actions: z.array(z.enum(['read', 'edit'])).max(2),
  expectedVersion: z.number().int().nonnegative(),
}).strict().refine(value => new Set(value.actions).size === value.actions.length
  && (!value.actions.includes('edit') || value.actions.includes('read') && value.scope === 'subtree'))
/** List, search, detail and history all select from the same authorized task projection. */
export const workgraphTasksSchema = z.object({
  organizationId: id<OrganizationId>(), projectId: id<OrganizationProjectId>(),
  planId: id<OrganizationPlanId>().optional(), taskId: taskId.optional(), revision: planRevisionSchema.optional(),
  excluded: z.array(id<OrganizationPlanId>()).optional(),
  search: z.string().max(120).default(''), offset: z.number().int().nonnegative().default(0),
  cursor: z.string().max(2048).optional(),
}).strict().refine(value => value.revision === undefined || value.planId !== undefined)
/** Wire task view deliberately does not require a complete tree. */
export const workgraphTaskViewSchema = workgraphDefinitionSchema.shape.tasks.element.extend({
  planId: id<OrganizationPlanId>(), revision: planRevisionSchema, phaseTitle: text,
  assignable: z.boolean(), hasUndisclosedPrerequisite: z.boolean(),
}).strict()
/** Bounded transport page; the service applies byte and entry ceilings before delivery. */
export const workgraphPageSchema = z.object({
  items: z.array(workgraphTaskViewSchema), total: z.number().int().nonnegative(), offset: z.number().int().nonnegative(),
  revision: z.number().int().nonnegative(), cursor: z.string().transform(value => brandString<import('./types.ts').OrganizationCursor>(value)),
}).strict()
/** Grant response contains only management identifiers and action metadata. */
export const workgraphGrantViewSchema = z.object({
  planId: id<OrganizationPlanId>(), taskId, membershipId: id<MembershipId>(), scope: z.enum(['node', 'subtree']),
  actions: z.array(z.enum(['read', 'edit'])), version: z.number().int().positive(), active: z.boolean(),
}).strict()
/** Content-free task invalidations on the separate WorkGraph stream. */
export const workgraphBatchSchema = z.object({
  from: workgraphPageSchema.shape.cursor, cursor: workgraphPageSchema.shape.cursor,
  revision: z.number().int().nonnegative(),
  events: z.array(z.object({ revision: z.number().int().positive(), planId: id<OrganizationPlanId>() }).strict()),
}).strict()
