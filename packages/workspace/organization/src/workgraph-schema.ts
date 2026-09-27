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
