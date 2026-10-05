/** Fixed assignment transport requests and authorized response validation. */
import { z } from 'zod'
import { submissionViewSchema } from './delivery-schema.ts'
import { executionHumanSchema } from './execution-human-schema.ts'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { OrganizationCursor } from './types.ts'
import { assignmentSchema, assignmentRequestSchema, assignmentNotificationSchema } from './assignment-schema.ts'
export * from './assignment-schema.ts'
const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const cursor = z.string().max(4096).transform(brandString<OrganizationCursor>)
/** Current task selector and bounded historical assignment page. */
export const taskAssignmentsQuerySchema = assignmentSchema.pick({ organizationId: true, projectId: true, planId: true, taskId: true })
  .extend({ offset: integer.default(0), cursor: cursor.optional() }).strict()
/** Authorized assignment history; no task body is copied. */
export const taskAssignmentsPageSchema = z.object({ items: z.array(assignmentSchema), total: integer,
  offset: integer, revision: integer, cursor }).strict()
/** Persistent inbox page, reconstructed after every stream reset. */
export const inboxPageSchema = z.object({ items: z.array(z.object({
  request: z.union([assignmentRequestSchema, executionHumanSchema, submissionViewSchema]), assignment: assignmentSchema,
  notificationId: assignmentNotificationSchema.shape.id.nullable(), readAt: integer.nullable() }).strict()),
total: integer, unread: integer, offset: integer, revision: integer, cursor }).strict()
/** Assignment acceptance facts under current task visibility. */
export const preparationSchema = z.object({ serverTime: integer, assignment: assignmentSchema, request: assignmentRequestSchema }).strict()
/** Ordered content-free inbox invalidations, including the prior cursor. */
export const inboxBatchSchema = z.object({ from: cursor, cursor, revision: integer,
  events: z.array(z.object({ assignmentId: assignmentSchema.shape.id, revision: integer }).strict()) }).strict()
