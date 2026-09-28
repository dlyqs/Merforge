/** Fixed assignment transport requests and authorized response validation. */
import { z } from 'zod'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { OrganizationCursor } from './types.ts'
import { assignmentSchema, assignmentRequestSchema, assignmentNotificationSchema, delegationSchema } from './assignment-schema.ts'
import { deviceSchema, leaseSchema, deviceCommandSchema, deviceProofSchema } from './device-schema.ts'
export * from './assignment-schema.ts'
export * from './device-schema.ts'
const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const cursor = z.string().max(4096).transform(brandString<OrganizationCursor>)
/** Current task selector and bounded historical assignment page. */
export const taskAssignmentsQuerySchema = assignmentSchema.pick({ organizationId: true, projectId: true, planId: true, taskId: true })
  .extend({ offset: integer.default(0), cursor: cursor.optional() }).strict()
/** Authorized assignment history; no task body is copied. */
export const taskAssignmentsPageSchema = z.object({ items: z.array(assignmentSchema), total: integer,
  offset: integer, revision: integer, cursor }).strict()
/** Persistent inbox page, reconstructed after every stream reset. */
export const inboxPageSchema = z.object({ items: z.array(z.object({ request: assignmentRequestSchema, assignment: assignmentSchema,
  notificationId: assignmentNotificationSchema.shape.id, readAt: integer.nullable() }).strict()),
total: integer, unread: integer, offset: integer, revision: integer, cursor }).strict()
/** Preparation metadata never grants execution permission. */
export const preparationSchema = z.object({ serverTime: integer, delegationMaxDurationMs: integer, delegationMaxBudget: integer,
  assignment: assignmentSchema, request: assignmentRequestSchema, delegations: z.array(delegationSchema),
  lease: leaseSchema.nullable() }).strict()
/** Current account device query, with no renderer-selected device identity. */
export const devicesQuerySchema = assignmentSchema.pick({ organizationId: true }).strict()
/** Public registration metadata belonging to the authenticated member. */
export const devicesSchema = z.array(deviceSchema)
/** Signed device HTTP envelope excludes arbitrary extra JSON fields. */
export const deviceEnvelopeSchema = z.object({ command: deviceCommandSchema, proof: deviceProofSchema.optional() }).strict()
/** Ordered content-free inbox invalidations, including the prior cursor. */
export const inboxBatchSchema = z.object({ from: cursor, cursor, revision: integer,
  events: z.array(z.object({ assignmentId: assignmentSchema.shape.id, revision: integer }).strict()) }).strict()
