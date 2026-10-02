/** Private project conversation operations and correlated native authorization messages. */
import { z } from 'zod'
import { brandString, type Branded } from '@deepseek-ai/dsh-brand'
import { SessionId } from '@deepseek-ai/dsh-session'
import { planningReadSchema, planningViewSchema, planningCommandSchema, planningOpenSchema,
  planningMutationReceiptSchema } from '@deepseek-ai/dsh-organization/planning'
const uuid = <T extends Branded<string>>() => z.uuid().transform(brandString<T>)
/** Settings belong to this server/account/organization, independently of personal preferences. */
export const conversationSettingsSchema = z.object({ enabled: z.boolean(), granularity: z.enum(['balanced', 'fine']),
  revision: z.number().int().nonnegative() }).strict()
/** Native identity binds every project read and model admission to its initiating generation. */
export const conversationAuthoritySchema = z.object({ serverId: uuid<Branded<'OrganizationServerId'>>(),
  accountId: uuid<Branded<'OrganizationAccountId'>>(), generation: z.number().int().nonnegative(),
  view: planningViewSchema, receipt: planningMutationReceiptSchema.optional() }).strict()
/** Immutable private owner; no personal Project, preset, path, Run or task identity is accepted. */
export const conversationOwnerSchema = conversationAuthoritySchema.pick({ serverId: true, accountId: true })
  .extend(planningReadSchema.shape).strict()
const base = planningReadSchema.extend({ operationId: planningOpenSchema.shape.operationId })
/** Durable goal identity, distinct from task definitions created in later phases. */
export const conversationGoalSchema = uuid<Branded<'OrganizationConversationGoalId'>>()
/** Fixed selectors; opening/reading never wakes a model. */
export const conversationRequestSchema = z.discriminatedUnion('kind', [
  base.extend({ kind: z.enum(['open', 'read']) }).strict(),
  base.extend({ kind: z.literal('settings'), expectedRevision: conversationSettingsSchema.shape.revision,
    settings: conversationSettingsSchema.omit({ revision: true }) }).strict(),
  base.extend({ kind: z.literal('send'), selection: planningOpenSchema.shape.selection, text: z.string().min(1).max(32768),
    route: z.enum(['new_goal', 'clarification']), goalId: conversationGoalSchema.optional() }).strict(),
]).superRefine((request, ctx) => {
  if (request.kind === 'send' && (request.route === 'clarification') !== (request.goalId !== undefined))
    ctx.addIssue({ code: 'custom', message: 'Clarification must reference its original goal' })
})
/** Bounded private transcript; no shared task mutation occurs here. */
export const conversationResultSchema = z.object({
  sessionId: z.string().regex(/^organization-conversation:[0-9a-f-]{36}$/).transform(SessionId),
  owner: conversationOwnerSchema, settings: conversationSettingsSchema,
  entries: z.array(z.object({ role: z.enum(['user', 'assistant', 'tool']), text: z.string() }).strict()), truncated: z.boolean(),
  goals: z.array(z.object({ id: conversationGoalSchema, classification: z.enum(['unassessed', 'simple', 'clarify',
    'infeasible', 'complex']) }).strict()),
  state: z.enum(['ready', 'completed', 'stopped', 'unknown']),
}).strict()
/** Validated private local operation. */
export type ConversationRequest = z.output<typeof conversationRequestSchema>
/** Online native proof; never exposed as a reusable authorization callback. */
export type ConversationAuthority = z.output<typeof conversationAuthoritySchema>
/** Local private conversation view. */
export type ConversationResult = z.output<typeof conversationResultSchema>
/** Private fixed planning command callback. */
export type ConversationBridge = (command?: z.output<typeof planningCommandSchema>) => Promise<ConversationAuthority>
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
    command: planningCommandSchema.optional() }).strict(),
  correlation.extend({ type: z.literal('organization-conversation-result'),
    result: conversationResultSchema.optional(), error: z.string().optional() }).strict(),
])
