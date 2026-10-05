/** Private project conversation operations and correlated native authorization messages. */
import { z } from 'zod'
import { brandString, type Branded } from '@deepseek-ai/dsh-brand'
import { assignmentReadSchema, assignmentSchema } from '@deepseek-ai/dsh-organization/assignment'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import { assertV4RowAdmission } from '@deepseek-ai/dsh-session-format-current'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { accountConversationReadSchema, accountConversationViewSchema, planningReadSchema, planningCommandSchema, planningOpenSchema,
  planningMutationReceiptSchema, planningPlanReadSchema, planningPlanViewSchema, planningDraftSchema, planningCandidatesSchema, planningCandidatesPageSchema } from '@deepseek-ai/dsh-organization/planning'
const uuid = <T extends Branded<string>>() => z.uuid().transform(brandString<T>)
/** Settings belong to this server/account/organization, independently of personal preferences. */
export const conversationSettingsSchema = z.object({ enabled: z.boolean(), granularity: z.enum(['balanced', 'fine']),
  revision: z.number().int().nonnegative() }).strict()
/** Native identity binds every project read and model admission to its initiating generation. */
export const conversationAuthoritySchema = z.object({ serverId: uuid<Branded<'OrganizationServerId'>>(),
  accountId: uuid<Branded<'OrganizationAccountId'>>(), generation: z.number().int().nonnegative(),
  view: accountConversationViewSchema, assignment: assignmentSchema.optional(),
  candidates: planningCandidatesPageSchema.optional(), plan: planningPlanViewSchema.optional(),
  receipt: planningMutationReceiptSchema.optional() }).strict()
/** Exact assignment selector; the native owner derives the task and original participants online. */
export const conversationAssignmentSchema = assignmentReadSchema.pick({ planId: true, assignmentId: true })
/** Immutable private owner; no personal Project, preset, path or Run identity is accepted. */
export const conversationOwnerSchema = conversationAuthoritySchema.pick({ serverId: true, accountId: true })
  .extend(accountConversationReadSchema.shape).extend({ assignment: conversationAssignmentSchema.optional() }).strict()
/** Identity of a private organization Bot; it never refers to a personal preset. */
export const conversationBotIdSchema = uuid<Branded<'OrganizationConversationBotId'>>()
const commonModelSelectionSchema = z.object({ backend: z.enum(['harness-api', 'codex']).optional(),
  provider: z.string().min(1), model: z.string().min(1), reasoningEffort: z.string().min(1).optional() }).strict()
/** Account-private Bot instructions and ordinary model selection; historical endpoint selections remain readable. */
export const conversationBotSchema = z.object({ id: conversationBotIdSchema, name: z.string().trim().min(1).max(120),
  instructions: z.string().max(8192), selection: z.union([commonModelSelectionSchema, planningOpenSchema.shape.selection]),
  version: z.number().int().nonnegative() }).strict()
/** Project-authorized navigation metadata, without private transcripts. */
export const conversationCatalogSchema = z.object({ bots: z.array(conversationBotSchema),
  conversations: z.array(z.object({ conversationId: planningReadSchema.shape.conversationId,
    title: z.string().max(120), createdAt: z.number().int().nonnegative(),
    botId: conversationBotIdSchema.optional(), assignment: conversationAssignmentSchema.optional() }).strict()) }).strict()
const base = accountConversationReadSchema.extend({ operationId: planningOpenSchema.shape.operationId,
  assignment: conversationAssignmentSchema.optional(), botId: conversationBotIdSchema.optional() })
/** Durable goal identity, distinct from the associated WorkGraph task identity. */
export const conversationGoalSchema = uuid<Branded<'OrganizationConversationGoalId'>>()
/** Fixed selectors; opening/reading never wakes a model. */
export const conversationRequestSchema = z.discriminatedUnion('kind', [
  base.extend({ projectId: planningReadSchema.shape.projectId, kind: z.literal('project-remove') }).strict(),
  base.extend({ kind: z.enum(['open', 'read', 'stop', 'catalog', 'attach']) }).strict(),
  base.extend({ kind: z.literal('detach'), attachmentId: planningOpenSchema.shape.operationId }).strict(),
  base.extend({ kind: z.enum(['delete', 'rename']), title: z.string().trim().min(1).max(120).optional() }).strict(),
  base.extend({ kind: z.literal('affiliation'), nextBotId: conversationBotIdSchema.nullable() }).strict(),
  base.extend({ kind: z.literal('select-task'), target: planningPlanReadSchema.pick({ planId: true, taskId: true }) }).strict(),
  base.extend({ kind: z.literal('select-model'), selection: planningOpenSchema.shape.selection }).strict(),
  base.extend({ kind: z.literal('bot-save'), bot: conversationBotSchema, expectedVersion: z.number().int().nonnegative() }).strict(),
  base.extend({ kind: z.literal('suggest'), goalId: conversationGoalSchema,
    taskId: planningPlanReadSchema.shape.taskId, expectedRevision: z.number().int().nonnegative(),
    membershipId: planningDraftSchema.shape.definition.shape.tasks.element.shape.suggestedMembershipId }).strict(),
  base.extend({ kind: z.literal('settings'), expectedRevision: conversationSettingsSchema.shape.revision,
    settings: conversationSettingsSchema.omit({ revision: true }) }).strict(),
  base.extend({ projectId: planningReadSchema.shape.projectId, kind: z.literal('send'), selection: planningOpenSchema.shape.selection, text: z.string().min(1).max(32768),
    route: z.enum(['new_goal', 'clarification', 'modify', 'query']), goalId: conversationGoalSchema.optional(),
    target: planningPlanReadSchema.pick({ planId: true, taskId: true }).optional() }).strict(),
]).superRefine((request, ctx) => {
  if (request.kind === 'project-remove' && (request.assignment || request.botId))
    ctx.addIssue({ code: 'custom', message: 'Project removal cannot select a task or Bot' })
  if (!request.projectId && (request.assignment || request.botId || ['bot-save', 'select-task', 'select-model', 'suggest'].includes(request.kind)))
    ctx.addIssue({ code: 'custom', message: 'Project actions require a project' })
  if (request.assignment && (request.botId || request.kind === 'bot-save' || request.kind === 'catalog'))
    ctx.addIssue({ code: 'custom', message: 'Task conversations cannot manage Bots or project navigation' })
  if (request.assignment && String(request.conversationId) !== String(request.assignment.assignmentId))
    ctx.addIssue({ code: 'custom', message: 'Task conversation identity must equal its original assignment' })
  if (request.assignment && request.kind === 'send' && request.route === 'new_goal')
    ctx.addIssue({ code: 'custom', message: 'Task conversations continue their assigned goal' })
  if (request.kind === 'send' && (request.route !== 'new_goal') !== (request.goalId !== undefined))
    ctx.addIssue({ code: 'custom', message: 'Continuation must reference its original goal' })
})
/** Effective input and method reference enter the same private Session as model dispatch. */
export const conversationInputSchema = z.object({ request: conversationRequestSchema, goalId: conversationGoalSchema,
  settings: conversationSettingsSchema, authority: conversationAuthoritySchema,
  bot: conversationBotSchema.optional(),
  testing: z.object({ forceDecomposition: z.boolean(), revision: z.number().int().nonnegative() }).strict().optional(),
  methodVersion: z.enum(['organization-planning/v1', 'organization-planning/v2']) }).strict()
/** Private assessment remains separate from shared WorkGraph definitions. */
export const conversationAssessmentSchema = z.object({ goalId: conversationGoalSchema,
  operationId: planningCommandSchema.options[0].shape.operationId,
  classification: z.enum(['simple', 'clarify', 'infeasible', 'complex']), rationale: z.string().min(1).max(32768) }).strict()
/** Write intent is flushed before its fixed native command; unknown calls stay charged. */
export const conversationOperationSchema = z.object({ command: planningCommandSchema,
  receipt: planningMutationReceiptSchema.optional() }).strict()
/** Proposal intent is durable before dispatch; unknown outcomes never imply a retry. */
export const conversationProposalSchema = z.object({ command: planningDraftSchema,
  status: z.enum(['private', 'unknown', 'shared', 'conflict']), receipt: planningMutationReceiptSchema.optional() }).strict()
/** Standard Session rows validated before crossing the private IPC result channel. */
const historyEventSchema: z.ZodType<SessionEvent> = z.object({ type: z.string(), seq: z.number().int().nonnegative(),
  time: z.number().nonnegative(), data: z.json() })
  .loose().superRefine((event, ctx) => {
    try { assertV4RowAdmission(event) }
    catch (error: unknown) { ctx.addIssue({ code: 'custom', message: error instanceof Error ? error.message : String(error) }) }
  }).transform(event => event as SessionEvent)
/** Bounded private transcript and currently authorized plan or private proposal details. */
export const conversationResultSchema = z.object({
  sessionId: z.string().regex(/^organization-conversation:[0-9a-f-]{36}$/).transform(SessionId),
  sharedSessionId: z.string().regex(/^session-[0-9a-f-]{36}$/).transform(SessionId).optional(),
  attachmentId: planningOpenSchema.shape.operationId.optional(),
  owner: conversationOwnerSchema, assignment: assignmentSchema.optional(), settings: conversationSettingsSchema,
  history: z.array(historyEventSchema).default([]),
  title: z.string().max(120).optional(),
  selection: planningOpenSchema.shape.selection.optional(),
  execution: z.object({ target: planningPlanReadSchema.pick({ planId: true, taskId: true }), title: z.string() }).strict().optional(),
  entries: z.array(z.object({ role: z.enum(['user', 'assistant', 'tool']), text: z.string() }).strict()), truncated: z.boolean(),
  goals: z.array(z.object({ id: conversationGoalSchema, proposal: z.object({ status: z.enum(['shared', 'private', 'conflict', 'unknown', 'unavailable']),
    definition: planningPlanViewSchema.shape.version.shape.definition.optional(),
    planId: planningPlanReadSchema.shape.planId, revision: z.number().int().nonnegative() }).strict().optional(),
  classification: z.enum(['unassessed', 'simple', 'clarify',
    'infeasible', 'complex']) }).strict()),
  catalog: conversationCatalogSchema.optional(),
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
/** Safe authorization outcomes distinguish denied access from temporary or conflicting writes. */
export const conversationAuthorizationErrorSchema = z.enum(['forbidden', 'unauthenticated', 'version-conflict',
  'operation-conflict', 'operation-pending', 'invalid-input', 'invalid-operation-journal', 'rate-limited',
  'superseded', 'unavailable', 'cancelled'])
/**
 * Strip exception details before reporting a private authorization outcome.
 * @param error - Native authorization failure.
 * @returns A fixed code; unclassified failures never imply missing permission.
 */
export function conversationAuthorizationError(error: unknown): z.output<typeof conversationAuthorizationErrorSchema> {
  if (error instanceof z.ZodError) return 'invalid-input'
  if (error instanceof Error && error.name === 'AbortError') return 'cancelled'
  const parsed = conversationAuthorizationErrorSchema.safeParse(error instanceof Error ? error.message : undefined)
  return parsed.success ? parsed.data : 'unavailable'
}
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
  correlation.extend({ type: z.literal('organization-conversation-closed') }).strict(),
])
declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Immutable original account/project/conversation owner in an independent namespace. */
    'organization/conversation-owner': z.output<typeof conversationOwnerSchema>
    /** Authorized task and context synchronized into the assignee's private Session. */
    'organization/assignment-context': { owner: z.output<typeof conversationOwnerSchema>
      assignment: z.output<typeof assignmentSchema>
      plan: z.output<typeof planningPlanViewSchema> }
    /** Explicit execution setting; selecting it does not accept or start work. */
    'organization/task-selection': { digest: string
      operationId: ConversationRequest['operationId']
      target: z.output<typeof planningPlanReadSchema>
      owner: z.output<typeof conversationOwnerSchema> }
    /** Durable correlation for selecting a model through native account controls. */
    'organization/model-selection-operation': { operationId: ConversationRequest['operationId']; digest: string }
    /** Exact accepted input, method, settings and online authorization sent to the planning model. */
    'organization/planning-input': z.output<typeof conversationInputSchema>
    /** Private assessment of one stable goal; never an approved task definition. */
    'organization/planning-assessment': z.output<typeof conversationAssessmentSchema>
    /** Private proposal, dispatch intent and confirmed authority receipt. */
    'organization/planning-proposal': z.output<typeof conversationProposalSchema>
    /** Native permission intent and historical receipt, separate from model-visible user input. */
    'organization/planning-operation': z.output<typeof conversationOperationSchema>
  }
}

/**
 * Require a project identifier before constructing a planning operation.
 * @param owner - Account conversation selectors.
 * @returns Explicit project identifier.
 */
export function conversationProjectId(owner: Pick<ConversationRequest, 'projectId'>): NonNullable<ConversationRequest['projectId']> {
  if (!owner.projectId) throw new Error('organization-conversation: project-required')
  return owner.projectId
}
