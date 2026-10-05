/** Private execution-session preparation; no renderer-supplied identity or Session ID. */
import { z } from 'zod'
import { brandString, type Branded } from '@deepseek-ai/dsh-brand'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { executionReadSchema, executionActionSchema, executionViewSchema, executionCapabilitySchema, executionModelSchema, executionCommandSchema, executionCodexBackendSchema } from '@deepseek-ai/dsh-organization/execution'
import { contextAuthoritySchema, contextResultSchema, contextRequestSchema } from '@deepseek-ai/dsh-organization-context/protocol'
/** Non-secret local model selection and exact user-authorized inputs. */
export const executionInputsSchema = z.object({ model: z.string().min(1).max(200),
  endpoint: executionModelSchema.shape.endpoint.optional(),
  backend: executionCodexBackendSchema.extend({ dispatch: z.enum(['local', 'device-native']) }).optional(),
  capabilities: z.array(executionCapabilitySchema).min(1).max(4),
  requireWriteApproval: z.boolean().optional(),
  execution: z.object({ directory: z.string().min(1), maxActions: z.number().int().positive(),
    maxSteps: z.number().int().positive(), maxDurationMs: z.number().int().positive() }).strict().optional(),
  materials: z.array(z.string().max(32768)).max(32), messages: z.array(z.string().max(32768)).max(32),
}).strict().superRefine((inputs, ctx) => {
  if (inputs.backend ? inputs.endpoint !== undefined || inputs.model !== inputs.backend.model
    || inputs.capabilities.length !== 1 || inputs.capabilities[0] !== 'codex-turn'
    || inputs.requireWriteApproval !== undefined || !inputs.execution
    || inputs.execution.maxActions !== inputs.backend.maxTurns || inputs.execution.maxSteps !== inputs.backend.maxTurns
    || inputs.execution.maxDurationMs !== inputs.backend.maxDurationMs : inputs.capabilities.includes('codex-turn')) {
    ctx.addIssue({ code: 'custom', message: 'Explicit native selection and turn limits must match' })
  }
})
/** Exact Run and local inputs; execution starts only with the explicit start flag. */
export const executionRequestSchema = executionReadSchema.extend({ operationId: contextRequestSchema.shape.operationId,
  inputs: executionInputsSchema, start: z.boolean().optional(), reconcile: z.boolean().optional(),
  resume: z.object({ baselineDigest: z.string().regex(/^[a-f0-9]{64}$/) }).strict().optional() }).strict().superRefine((request, ctx) => {
  if (!request.resume && request.inputs.backend?.dispatch === 'device-native')
    ctx.addIssue({ code: 'custom', message: 'Historical native dispatch requires an existing recovery binding' })
})
/** Native identity, current task view, original context and online execution qualification. */
export const executionAuthoritySchema = contextAuthoritySchema.extend({ context: contextResultSchema,
  execution: executionViewSchema }).strict()
/** Locally retained immutable binding facts; server state is always read again online. */
export const executionBindingSchema = z.object({ owner: contextResultSchema.shape.owner,
  run: executionViewSchema.shape.run, contextSessionId: contextResultSchema.shape.sessionId,
  snapshot: contextAuthoritySchema.shape.task, inputs: executionInputsSchema,
}).strict()
/** Local-only prepared Session; its ID cannot be used by personal APIs. */
export const executionResultSchema = executionBindingSchema.extend({
  sessionId: z.string().regex(/^organization-execution:[0-9a-f-]{36}$/).transform(SessionId), mode: z.enum(['prepared', 'finished']),
}).strict()
/** Fixed authenticated command accepted only through the native Run channel. */
export type ExecutionCommand = z.output<typeof executionCommandSchema>
/** Native prepare request. */
export type ExecutionRequest = z.output<typeof executionRequestSchema>
/** Online native identity and task projection, never a reusable permission. */
export type ExecutionAuthority = z.output<typeof executionAuthoritySchema>
/** Durable prepared execution context. */
export type ExecutionResult = z.output<typeof executionResultSchema>
/** Fixed local log selector; no caller-supplied Session ID. */
export const executionReportRequestSchema = executionReadSchema
/** Native online identity and exact currently readable Run. */
export const executionReadAuthoritySchema = contextAuthoritySchema.pick({ serverId: true, accountId: true, generation: true })
  .extend({ execution: executionViewSchema }).strict()
/** Bounded local conversation page, visible only to its original employee. */
export const executionReportSchema = z.object({ runId: executionReadSchema.shape.runId,
  entries: z.array(z.object({ role: z.enum(['user', 'assistant', 'tool']), text: z.string() }).strict()),
  native: z.object({ status: z.enum(['unbound', 'preparing', 'ready', 'sending', 'running', 'completed', 'interrupted', 'failed', 'unknown']),
    waitingHuman: z.boolean(), cleanupFailed: z.boolean() }).strict().optional(),
  recovery: z.object({ inputs: executionInputsSchema, baselineDigest: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
    actions: z.array(z.object({ actionId: executionActionSchema.shape.actionId, status: z.enum(['not-issued', 'confirmed', 'unknown']), reason: z.enum(['journal-before-issue', 'durable-result', 'file-matches', 'file-changed', 'missing-evidence', 'unobservable']) }).strict()),
  }).strict().optional(),
  truncated: z.boolean(), state: z.enum(['reserved', 'ready', 'executing', 'stopped']),
}).strict()
/** Exact Run selector for a local report. */
export type ExecutionReportRequest = z.output<typeof executionReportRequestSchema>
/** Native read qualification; never grants execution. */
export type ExecutionReadAuthority = z.output<typeof executionReadAuthoritySchema>
/** Private bounded local transcript. */
export type ExecutionReport = z.output<typeof executionReportSchema>
const correlation = z.object({ requestId: z.uuid().transform(brandString<Branded<'OrganizationExecutionRequestId'>>),
  nonce: z.uuid().transform(brandString<Branded<'OrganizationExecutionNonce'>>) })
/** Parent-only messages; callbacks and bearer credentials cannot be serialized here. */
export const executionHostMessageSchema = z.discriminatedUnion('type', [
  correlation.extend({ type: z.literal('organization-execution-report'), request: executionReportRequestSchema, timeoutMs: z.number().int().positive() }).strict(),
  correlation.extend({ type: z.literal('organization-execution-open'), request: executionRequestSchema, timeoutMs: z.number().int().positive() }).strict(),
  correlation.extend({ type: z.literal('organization-execution-authorized'), authorizationId: z.uuid().transform(brandString<Branded<'OrganizationExecutionAuthorizationId'>>), authority: z.union([executionAuthoritySchema, executionReadAuthoritySchema]).optional(), error: z.string().optional() }).strict(),
  correlation.extend({ type: z.literal('organization-execution-cancel') }).strict(),
])
/** Child responses matched against the active Host nonce and exact authorization request. */
export const executionNativeMessageSchema = z.discriminatedUnion('type', [
  correlation.extend({ type: z.literal('organization-execution-authorize'), command: executionCommandSchema.optional(), authorizationId: z.uuid().transform(brandString<Branded<'OrganizationExecutionAuthorizationId'>>) }).strict(),
  correlation.extend({ type: z.literal('organization-execution-result'), result: executionResultSchema.optional(), report: executionReportSchema.optional(), error: z.string().optional() }).strict(),
])
