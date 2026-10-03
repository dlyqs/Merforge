/** Durable local ownership, input intents and planning evidence validators. */
import { z } from 'zod'
import { defineDomain } from '@deepseek-ai/dsh-storage-domain'
import { planningCommandSchema, planningDraftSchema, planningMutationReceiptSchema } from '@deepseek-ai/dsh-organization/planning'
import { conversationOwnerSchema, conversationResultSchema, conversationSettingsSchema, conversationGoalSchema,
  conversationBotSchema, conversationBotIdSchema, conversationAuthoritySchema, conversationRequestSchema } from './protocol.ts'
/** Effective input and method reference enter the same private Session as model dispatch. */
export const conversationInputSchema = z.object({ request: conversationRequestSchema, goalId: conversationGoalSchema,
  settings: conversationSettingsSchema, authority: conversationAuthoritySchema,
  bot: conversationBotSchema.optional(),
  methodVersion: z.enum(['organization-planning/v1', 'organization-planning/v2']) }).strict()
/** Private assessment remains separate from shared WorkGraph definitions. */
export const conversationAssessmentSchema = z.object({ goalId: conversationGoalSchema,
  operationId: planningCommandSchema.options[0].shape.operationId,
  classification: z.enum(['simple', 'clarify', 'infeasible', 'complex']), rationale: z.string().min(1).max(32768) }).strict()
/** Write intent is flushed before its fixed native command; unknown calls stay charged. */
export const conversationOperationSchema = z.object({ command: planningCommandSchema,
  receipt: planningMutationReceiptSchema.optional() }).strict()
/** Reservations precede creation of the separately durable JSONL. */
export const conversationBindingSchema = z.object({ owner: conversationOwnerSchema, sessionId: conversationResultSchema.shape.sessionId,
  createdAt: z.number().int().nonnegative(), ready: z.boolean() }).strict()
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

/** Proposal intent is durable before dispatch; unknown outcomes never imply a retry. */
export const conversationProposalSchema = z.object({ command: planningDraftSchema,
  status: z.enum(['private', 'unknown', 'shared', 'conflict']), receipt: planningMutationReceiptSchema.optional() }).strict()

/** Independent account-private Bot definitions and conversation associations, retained across restarts. */
export const navigationStateSchema = z.object({
  bots: z.array(z.object({ owner: conversationOwnerSchema, bot: conversationBotSchema }).strict()),
  selections: z.array(z.object({ owner: conversationOwnerSchema, botId: conversationBotIdSchema }).strict()),
  operations: z.array(z.object({ owner: conversationOwnerSchema, operationId: planningCommandSchema.options[0].shape.operationId,
    digest: z.string().regex(/^[a-f0-9]{64}$/) }).strict()),
}).strict()
/** Navigation has no personal data and does not share the organization SQL authority. */
export const navigationDomain = defineDomain({ name: 'organization_navigation', version: 1, tables: {},
  global: { schema: navigationStateSchema, initial: { bots: [], selections: [], operations: [] } } })
