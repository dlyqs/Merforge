/** Durable execution questions and approvals; answers never renew execution authority. */
import { z } from 'zod'
import { brandString, type Branded } from '@deepseek-ai/dsh-brand'
import type { OrganizationHumanRequestId, OrganizationAssignmentId } from './assignment-types.ts'
import type { OrganizationRunId, OrganizationActionId } from './execution-types.ts'
import type { MembershipId } from './types.ts'
const id = <T extends Branded<string>>() => z.uuid().transform(brandString<T>)
/** Run-scoped request shared with its designated handler under current task access. */
export const executionHumanSchema = z.object({
  id: id<OrganizationHumanRequestId>(), assignmentId: id<OrganizationAssignmentId>(), runId: id<OrganizationRunId>(),
  planRevision: z.number().int().positive(), handlerId: id<MembershipId>(),
  kind: z.enum(['work-question', 'tool-approval']), prompt: z.string().min(1).max(32768),
  actionId: id<OrganizationActionId>().nullable(), requestDigest: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  state: z.enum(['pending', 'answered', 'approved', 'denied', 'expired', 'cancelled']),
  expiresAt: z.number().int().positive(), answer: z.string().max(32768).nullable(),
  createdRevision: z.number().int().positive(), version: z.number().int().positive(),
  answeredRevision: z.number().int().positive().nullable(),
}).strict().superRefine((request, ctx) => {
  const answered = ['answered', 'approved', 'denied'].includes(request.state)
  if (request.version < request.createdRevision || (request.answeredRevision !== null && request.version < request.answeredRevision)
    || answered !== (request.answeredRevision !== null)
    || (request.answeredRevision !== null && request.answeredRevision <= request.createdRevision)
    || (request.kind === 'work-question' ? request.requestDigest !== null || ['approved', 'denied'].includes(request.state)
      || (request.state === 'answered' ? !request.answer : request.answer !== null)
      : !request.requestDigest || request.state === 'answered' || request.answer !== null)) {
    ctx.addIssue({ code: 'custom', message: 'Request kind, answer and decision revision must agree' })
  }
})
