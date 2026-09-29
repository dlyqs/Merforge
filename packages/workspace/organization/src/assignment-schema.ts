/** Strict approval commands and durable assignment records. */
import { z } from 'zod'
import { executionHumanSchema } from './execution-human-schema.ts'
import { brandString, type Branded } from '@deepseek-ai/dsh-brand'
import { workgraphGrantsSchema, planRevisionSchema } from './workgraph-schema.ts'
import type { OrganizationAssignmentId, OrganizationHumanRequestId, OrganizationNotificationId, OrganizationDelegationId, OrganizationDeviceId } from './assignment-types.ts'
import type { MembershipId, OperationId } from './types.ts'
import type { OrganizationTaskId } from './workgraph-types.ts'

function id<T extends Branded<string>>() { return z.uuid().transform(value => brandString<T>(value)) }
/** Assignment identity parser used by receipts and durable records. */
export const assignmentIdSchema = id<OrganizationAssignmentId>()
/** Approval confirms the complete immutable definition, without granting visibility. */
export const approveAssignmentSchema = workgraphGrantsSchema.extend({
  kind: z.literal('approve-assignment'), operationId: id<OperationId>(),
  planRevision: planRevisionSchema, taskId: id<OrganizationTaskId>(), assigneeId: id<MembershipId>(),
}).strict()
/** Revocation is optimistic and irreversible; reassignment requires a new approval. */
export const revokeAssignmentSchema = workgraphGrantsSchema.extend({
  kind: z.literal('revoke-assignment'), operationId: id<OperationId>(), assignmentId: assignmentIdSchema,
  expectedVersion: z.number().int().positive(),
}).strict()
/** Closed approval action set shared by authority and fixed transport consumers. */
export const assignmentCommandSchema = z.discriminatedUnion('kind', [approveAssignmentSchema, revokeAssignmentSchema])
/** Known-assignment read selector with current task authorization. */
export const assignmentReadSchema = workgraphGrantsSchema.extend({ assignmentId: assignmentIdSchema }).strict()
/** Stored approval references the sole immutable plan definition. */
export const assignmentSchema = workgraphGrantsSchema.extend({
  id: assignmentIdSchema, planRevision: planRevisionSchema, taskId: id<OrganizationTaskId>(),
  approvedBy: id<MembershipId>(), assigneeId: id<MembershipId>(),
  state: z.enum(['pending', 'accepted', 'rejected', 'revoked', 'invalidated']), reason: z.enum(['revision-changed', 'authority-lost', 'restored']).nullable(),
  createdAt: z.number().int().nonnegative(), createdRevision: z.number().int().positive(), version: z.number().int().positive(),
}).strict()
/** Minimal acceptance request; the assignment supplies organization, version and participants. */
export const assignmentRequestSchema = z.object({
  id: id<OrganizationHumanRequestId>(), assignmentId: assignmentIdSchema, kind: z.literal('accept-assignment'),
  state: z.enum(['pending', 'cancelled', 'accepted', 'rejected', 'expired']), expiresAt: z.number().int().nonnegative().nullable(),
  answeredRevision: z.number().int().positive().nullable(),
}).strict()
/** Minimal notification points to a request and carries no copied task text. */
export const assignmentNotificationSchema = z.object({
  id: id<OrganizationNotificationId>(), requestId: id<OrganizationHumanRequestId>(),
  createdRevision: z.number().int().positive(), readAt: z.number().int().nonnegative().nullable(),
}).strict()

/** Registered device ID shared by delegation and device commands. */
export const deviceIdSchema = id<OrganizationDeviceId>()
/** Delegation ID retained through revocation and expiry. */
export const delegationIdSchema = id<OrganizationDelegationId>()
const participantBase = assignmentReadSchema.extend({ operationId: id<OperationId>() })
/** Explicit answers cannot be replaced by text or a notification read. */
export const answerAssignmentSchema = participantBase.extend({ kind: z.literal('answer-assignment'),
  requestId: id<OrganizationHumanRequestId>(), expectedVersion: z.number().int().positive(), answer: z.enum(['accepted', 'rejected']),
}).strict()
/** Acknowledgement affects only this assignee's notification. */
export const readNotificationSchema = participantBase.extend({ kind: z.literal('read-notification'), notificationId: id<OrganizationNotificationId>() }).strict()
/** Finite delegation request; limits and registered ownership are checked by the authority. */
export const delegateSchema = participantBase.extend({ kind: z.literal('delegate'), expectedVersion: z.number().int().positive(),
  deviceId: deviceIdSchema, executorId: z.literal('desktop-builtin'),
  capabilities: z.array(z.enum(['task-read', 'draft'])).min(1).max(2).transform(values => [...new Set(values)].sort()),
  budget: z.number().int().positive(), expiresAt: z.number().int().positive(),
}).strict()
/** Optimistic withdrawal by the member who granted the delegation. */
export const revokeDelegationSchema = participantBase.extend({ kind: z.literal('revoke-delegation'),
  delegationId: delegationIdSchema, expectedVersion: z.number().int().positive(),
}).strict()
const executionAnswerBase = participantBase.extend({ requestId: executionHumanSchema.shape.id,
  planRevision: planRevisionSchema, runId: executionHumanSchema.shape.runId })
/** Work information is distinct from approval and formal acceptance. */
export const answerExecutionQuestionSchema = executionAnswerBase.extend({ kind: z.literal('answer-execution-question'),
  answer: z.string().min(1).max(32768) }).strict()
/** Approve only the already granted exact request digest, without expanding capability. */
export const approveExecutionToolSchema = executionAnswerBase.extend({ kind: z.literal('approve-execution-tool'),
  approved: z.boolean() }).strict()
/** Participant actions remain distinct from root-editor approval. */
export const participantCommandSchema = z.discriminatedUnion('kind', [answerAssignmentSchema, readNotificationSchema, delegateSchema, revokeDelegationSchema, answerExecutionQuestionSchema, approveExecutionToolSchema])
/** Pending and processed views share authorization-before-search and cursor rules. */
export const inboxQuerySchema = workgraphGrantsSchema.pick({ organizationId: true }).extend({
  state: z.enum(['pending', 'processed', 'all']).default('all'), search: z.string().max(200).default(''),
  offset: z.number().int().nonnegative().default(0), cursor: z.string().max(4096).optional(),
}).strict()
/** Durable bounded delegation parser. */
export const delegationSchema = z.object({
  id: delegationIdSchema, assignmentId: assignmentIdSchema, planRevision: planRevisionSchema,
  membershipId: id<MembershipId>(), deviceId: deviceIdSchema, executorId: z.literal('desktop-builtin'),
  capabilities: z.array(z.enum(['task-read', 'draft'])).min(1).max(2), budget: z.number().int().positive(),
  expiresAt: z.number().int().positive(), state: z.enum(['active', 'revoked', 'invalidated', 'expired']),
  createdRevision: z.number().int().positive(), version: z.number().int().positive(),
}).strict()

/** Approval preview rechecks definition and visibility without granting or dispatching. */
export const approvalReviewSchema = approveAssignmentSchema.omit({ kind: true, operationId: true }).strict()
/** Visibility result is bound to the reviewed member and immutable revision. */
export const approvalReviewResultSchema = approvalReviewSchema.pick({ planRevision: true, assigneeId: true })
  .extend({ assigneeCanRead: z.boolean() }).strict()
