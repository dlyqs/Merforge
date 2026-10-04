/** Durable local ownership, input intents and planning evidence validators. */
import { z } from 'zod'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { defineDomain } from '@deepseek-ai/dsh-storage-domain'
import { planningCommandSchema } from '@deepseek-ai/dsh-organization/planning'
import { conversationOwnerSchema, conversationResultSchema, conversationSettingsSchema,
  conversationBotSchema, conversationBotIdSchema, conversationInputSchema } from './protocol.ts'
/** Durable ownership and deliberate deletion of an account-private Session. */
interface ConversationBinding {
  owner: z.output<typeof conversationOwnerSchema>
  sessionId: SessionId
  createdAt: number
  ready: boolean
  deleted?: boolean | undefined
  sharedSessionId?: SessionId | undefined
  activeSessionId?: SessionId | undefined
}
/** Reservations precede creation of the separately durable JSONL. */
export const conversationBindingSchema: z.ZodType<ConversationBinding> = z.object({ owner: conversationOwnerSchema,
  sessionId: conversationResultSchema.shape.sessionId,
  sharedSessionId: conversationResultSchema.shape.sharedSessionId,
  activeSessionId: conversationResultSchema.shape.sharedSessionId,
  createdAt: z.number().int().nonnegative(), ready: z.boolean(), deleted: z.boolean().optional() }).strict()
/** A received input is never automatically retried after model dispatch or a crash. */
export const conversationIntentSchema = z.object({ owner: conversationOwnerSchema,
  operationId: planningCommandSchema.options[0].shape.operationId,
  digest: z.string().regex(/^[a-f0-9]{64}$/), input: conversationInputSchema,
  state: z.enum(['received', 'sending', 'completed', 'stopped']) }).strict()
/** Private installation-local preferences are partitioned by all three identity components. */
export const conversationStateSchema = z.object({ bindings: z.array(conversationBindingSchema), intents: z.array(conversationIntentSchema),
  controls: z.array(z.object({ owner: conversationOwnerSchema, operationId: planningCommandSchema.options[0].shape.operationId,
    digest: z.string().regex(/^[a-f0-9]{64}$/) }).strict()),
  preferences: z.array(z.object({ owner: conversationOwnerSchema.pick({ serverId: true, accountId: true, organizationId: true }),
    settings: conversationSettingsSchema }).strict()) }).strict()
/** Independent local domain; organization authority never stores private conversation text. */
export const conversationDomain = defineDomain({ name: 'organization_conversation', version: 1, tables: {},
  global: { schema: conversationStateSchema, initial: { bindings: [], intents: [], controls: [], preferences: [] } } })
/** Independent account-private Bot definitions and conversation associations, retained across restarts. */
export const navigationStateSchema = z.object({
  bots: z.array(z.object({ owner: conversationOwnerSchema, bot: conversationBotSchema }).strict()),
  metadata: z.array(z.object({ owner: conversationOwnerSchema, title: z.string().max(120) }).strict()).default([]),
  selections: z.array(z.object({ owner: conversationOwnerSchema, botId: conversationBotIdSchema }).strict()),
  operations: z.array(z.object({ owner: conversationOwnerSchema, operationId: planningCommandSchema.options[0].shape.operationId,
    digest: z.string().regex(/^[a-f0-9]{64}$/) }).strict()),
}).strict()
/** Navigation has no personal data and does not share the organization SQL authority. */
export const navigationDomain = defineDomain({ name: 'organization_navigation', version: 1, tables: {},
  global: { schema: navigationStateSchema, initial: { bots: [], metadata: [], selections: [], operations: [] } } })
export { conversationInputSchema, conversationAssessmentSchema, conversationOperationSchema,
  conversationProposalSchema } from './protocol.ts'
