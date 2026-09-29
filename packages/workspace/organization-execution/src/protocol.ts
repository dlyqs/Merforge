/** Private execution-session preparation; no renderer-supplied identity or Session ID. */
import { z } from 'zod'
import { brandString, type Branded } from '@deepseek-ai/dsh-brand'
import { SessionId } from '@deepseek-ai/dsh-session'
import { executionReadSchema, executionViewSchema, executionCapabilitySchema } from '@deepseek-ai/dsh-organization/execution'
import { contextAuthoritySchema, contextResultSchema, contextRequestSchema } from '@deepseek-ai/dsh-organization-context/protocol'
/** Non-secret local model selection and exact user-authorized inputs. */
export const executionInputsSchema = z.object({ model: z.string().min(1).max(200),
  capabilities: z.array(executionCapabilitySchema).min(1).max(4),
  materials: z.array(z.string().max(32768)).max(32), messages: z.array(z.string().max(32768)).max(32),
}).strict()
/** Fixed prepare selector; no model invocation or side-effect flag exists. */
export const executionRequestSchema = executionReadSchema.extend({ operationId: contextRequestSchema.shape.operationId,
  inputs: executionInputsSchema }).strict()
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
  sessionId: z.string().regex(/^organization-execution:[0-9a-f-]{36}$/).transform(SessionId), mode: z.literal('prepared'),
}).strict()
/** Native prepare request. */
export type ExecutionRequest = z.output<typeof executionRequestSchema>
/** Online native proof projection, never a reusable permission. */
export type ExecutionAuthority = z.output<typeof executionAuthoritySchema>
/** Durable prepared execution context. */
export type ExecutionResult = z.output<typeof executionResultSchema>
const correlation = z.object({ requestId: z.uuid().transform(brandString<Branded<'OrganizationExecutionRequestId'>>),
  nonce: z.uuid().transform(brandString<Branded<'OrganizationExecutionNonce'>>) })
/** Parent-only messages; callbacks and bearer credentials cannot be serialized here. */
export const executionHostMessageSchema = z.discriminatedUnion('type', [
  correlation.extend({ type: z.literal('organization-execution-open'), request: executionRequestSchema, timeoutMs: z.number().int().positive() }).strict(),
  correlation.extend({ type: z.literal('organization-execution-authorized'), authorizationId: z.uuid().transform(brandString<Branded<'OrganizationExecutionAuthorizationId'>>), authority: executionAuthoritySchema.optional(), error: z.string().optional() }).strict(),
  correlation.extend({ type: z.literal('organization-execution-cancel') }).strict(),
])
/** Child responses matched against the active Host nonce and exact authorization request. */
export const executionNativeMessageSchema = z.discriminatedUnion('type', [
  correlation.extend({ type: z.literal('organization-execution-authorize'), authorizationId: z.uuid().transform(brandString<Branded<'OrganizationExecutionAuthorizationId'>>) }).strict(),
  correlation.extend({ type: z.literal('organization-execution-result'), result: executionResultSchema.optional(), error: z.string().optional() }).strict(),
])
