/** Private project conversation operations and correlated native authorization messages. */
import { z } from 'zod'
import { brandString, type Branded } from '@deepseek-ai/dsh-brand'
import { assignmentReadSchema, assignmentSchema } from '@deepseek-ai/dsh-organization/assignment'
import { SessionId } from '@deepseek-ai/dsh-session'
import { planningReadSchema, planningViewSchema, planningCommandSchema, planningOpenSchema,
  planningMutationReceiptSchema, planningPlanReadSchema, planningPlanViewSchema, planningDraftSchema, planningCandidatesSchema, planningCandidatesPageSchema } from '@deepseek-ai/dsh-organization/planning'
const uuid = <T extends Branded<string>>() => z.uuid().transform(brandString<T>)
/** Settings belong to this server/account/organization, independently of personal preferences. */
export const conversationSettingsSchema = z.object({ enabled: z.boolean(), granularity: z.enum(['balanced', 'fine']),
  revision: z.number().int().nonnegative() }).strict()
/** Native identity binds every project read and model admission to its initiating generation. */
export const conversationAuthoritySchema = z.object({ serverId: uuid<Branded<'OrganizationServerId'>>(),
  accountId: uuid<Branded<'OrganizationAccountId'>>(), generation: z.number().int().nonnegative(),
  view: planningViewSchema, assignment: assignmentSchema.optional(),
  candidates: planningCandidatesPageSchema.optional(), plan: planningPlanViewSchema.optional(),
  receipt: planningMutationReceiptSchema.optional() }).strict()
/** Exact assignment selector; the native owner derives the task and original participants online. */
export const conversationAssignmentSchema = assignmentReadSchema.pick({ planId: true, assignmentId: true })
/** Immutable private owner; no personal Project, preset, path or Run identity is accepted. */
export const conversationOwnerSchema = conversationAuthoritySchema.pick({ serverId: true, accountId: true })
  .extend(planningReadSchema.shape).extend({ assignment: conversationAssignmentSchema.optional() }).strict()
const base = planningReadSchema.extend({ operationId: planningOpenSchema.shape.operationId,
  assignment: conversationAssignmentSchema.optional() })
/** Durable goal identity, distinct from the associated WorkGraph task identity. */
export const conversationGoalSchema = uuid<Branded<'OrganizationConversationGoalId'>>()
/** Fixed selectors; opening/reading never wakes a model. */
export const conversationRequestSchema = z.discriminatedUnion('kind', [
  base.extend({ kind: z.enum(['open', 'read', 'stop']) }).strict(),
  base.extend({ kind: z.literal('suggest'), goalId: conversationGoalSchema,
    taskId: planningPlanReadSchema.shape.taskId, expectedRevision: z.number().int().nonnegative(),
    membershipId: planningDraftSchema.shape.definition.shape.tasks.element.shape.suggestedMembershipId }).strict(),
  base.extend({ kind: z.literal('settings'), expectedRevision: conversationSettingsSchema.shape.revision,
    settings: conversationSettingsSchema.omit({ revision: true }) }).strict(),
  base.extend({ kind: z.literal('send'), selection: planningOpenSchema.shape.selection, text: z.string().min(1).max(32768),
    route: z.enum(['new_goal', 'clarification', 'modify', 'query']), goalId: conversationGoalSchema.optional(),
    target: planningPlanReadSchema.pick({ planId: true, taskId: true }).optional() }).strict(),
]).superRefine((request, ctx) => {
  if (request.assignment && String(request.conversationId) !== String(request.assignment.assignmentId))
    ctx.addIssue({ code: 'custom', message: 'Task conversation identity must equal its original assignment' })
  if (request.assignment && request.kind === 'send' && request.route === 'new_goal')
    ctx.addIssue({ code: 'custom', message: 'Task conversations continue their assigned goal' })
  if (request.kind === 'send' && (request.route !== 'new_goal') !== (request.goalId !== undefined))
    ctx.addIssue({ code: 'custom', message: 'Continuation must reference its original goal' })
})
/** Bounded private transcript and currently authorized plan or private proposal details. */
export const conversationResultSchema = z.object({
  sessionId: z.string().regex(/^organization-conversation:[0-9a-f-]{36}$/).transform(SessionId),
  owner: conversationOwnerSchema, assignment: assignmentSchema.optional(), settings: conversationSettingsSchema,
  entries: z.array(z.object({ role: z.enum(['user', 'assistant', 'tool']), text: z.string() }).strict()), truncated: z.boolean(),
  goals: z.array(z.object({ id: conversationGoalSchema, proposal: z.object({ status: z.enum(['shared', 'private', 'conflict', 'unknown', 'unavailable']),
    definition: planningPlanViewSchema.shape.version.shape.definition.optional(),
    planId: planningPlanReadSchema.shape.planId, revision: z.number().int().nonnegative() }).strict().optional(),
  classification: z.enum(['unassessed', 'simple', 'clarify',
    'infeasible', 'complex']) }).strict()),
  state: z.enum(['ready', 'completed', 'stopped', 'unknown']),
}).strict()
/** Validated private local operation. */
export type ConversationRequest = z.output<typeof conversationRequestSchema>
/** Online native proof; never exposed as a reusable authorization callback. */
export type ConversationAuthority = z.output<typeof conversationAuthoritySchema>
/** Local private conversation view. */
export type ConversationResult = z.output<typeof conversationResultSchema>
/** Private reads and draft writes, excluding every approval or execution action. */
export const conversationBridgeCommandSchema = z.union([planningCommandSchema, planningPlanReadSchema,
  planningCandidatesSchema.extend({ kind: z.literal('read-planning-members'), conversationId: planningReadSchema.shape.conversationId }).strict()])
/** Private fixed planning command callback. */
export type ConversationBridge = (command?: z.output<typeof conversationBridgeCommandSchema>) => Promise<ConversationAuthority>
const correlation = z.object({ requestId: uuid<Branded<'OrganizationConversationRequestId'>>(),
  nonce: uuid<Branded<'OrganizationConversationNonce'>>() })
const authorizationId = uuid<Branded<'OrganizationConversationAuthorizationId'>>()
/** Only the owned parent IPC channel can supply authority. */
export const conversationHostMessageSchema = z.discriminatedUnion('type', [
  correlation.extend({ type: z.literal('organization-conversation-operation'), request: conversationRequestSchema,
    timeoutMs: z.number().int().positive() }).strict(),
  correlation.extend({ type: z.literal('organization-conversation-authorized'), authorizationId,
    authority: conversationAuthoritySchema.optional(), error: z.string().optional() }).strict(),
  correlation.extend({ type: z.literal('organization-conversation-cancel') }).strict(),
])
/** Child responses echo exact nonce/request and ask only for the closed planning command set. */
export const conversationNativeMessageSchema = z.discriminatedUnion('type', [
  correlation.extend({ type: z.literal('organization-conversation-authorize'), authorizationId,
    command: conversationBridgeCommandSchema.optional() }).strict(),
  correlation.extend({ type: z.literal('organization-conversation-result'),
    result: conversationResultSchema.optional(), error: z.string().optional() }).strict(),
])
