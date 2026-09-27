/** Strict private IPC messages; Renderer supplies selectors, never an authorization. */
import { z } from 'zod'
import { brandString, type Branded } from '@deepseek-ai/dsh-brand'
import { workgraphReadSchema, workgraphSaveSchema, workgraphTaskViewSchema } from '@deepseek-ai/dsh-organization/workgraph'
import type { AccountId, ServerId } from '@deepseek-ai/dsh-organization/types'
import { SessionId } from '@deepseek-ai/dsh-session'

/** Local open selector; an existing personal Session cannot be supplied. */
export const contextRequestSchema = workgraphReadSchema.omit({ revision: true }).extend({
  taskId: workgraphTaskViewSchema.shape.id, operationId: workgraphSaveSchema.shape.operationId,
}).strict()
/** Online result minted by Electron for one private Host authorization request. */
export const contextAuthoritySchema = z.object({
  serverId: z.uuid().transform(value => brandString<ServerId>(value)),
  accountId: z.uuid().transform(value => brandString<AccountId>(value)),
  organizationId: workgraphReadSchema.shape.organizationId,
  generation: z.number().int().nonnegative(), requestId: z.uuid().transform(value => brandString<Branded<'OrganizationRequestId'>>(value)),
  task: workgraphTaskViewSchema,
}).strict()
/** Immutable ownership of a local pre-execution context. */
export const contextOwnerSchema = contextAuthoritySchema.pick({ serverId: true, accountId: true, organizationId: true }).extend({
  planId: workgraphReadSchema.shape.planId, taskId: workgraphTaskViewSchema.shape.id, version: z.literal(1),
}).strict()
/** Only the original authorized task facts are retained; reopening never replaces them. */
export const contextResultSchema = z.object({
  sessionId: z.string().regex(/^organization-context:[0-9a-f-]{36}$/).transform(SessionId),
  owner: contextOwnerSchema, snapshot: workgraphTaskViewSchema, mode: z.literal('pre-execution'),
}).strict()
/** Native-selected task and idempotency identifier. */
export type ContextRequest = z.output<typeof contextRequestSchema>
/** Online task read, authenticated outside the personal Host. */
export type ContextAuthority = z.output<typeof contextAuthoritySchema>
/** Read-only local context returned after final online authorization. */
export type ContextResult = z.output<typeof contextResultSchema>
const ipcRequestId = z.uuid().transform(value => brandString<Branded<'OrganizationContextRequestId'>>(value))
const ipcNonce = z.uuid().transform(value => brandString<Branded<'OrganizationContextNonce'>>(value))
const authorizationId = z.uuid().transform(value => brandString<Branded<'OrganizationContextAuthorizationId'>>(value))
/** Parent messages are accepted only on the private child-process IPC channel. */
export const contextHostMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('organization-context-open'), requestId: ipcRequestId, nonce: ipcNonce,
    timeoutMs: z.number().int().positive(), request: contextRequestSchema }).strict(),
  z.object({ type: z.literal('organization-context-authorized'), requestId: ipcRequestId, nonce: ipcNonce,
    authorizationId, authority: contextAuthoritySchema.optional(), error: z.string().optional() }).strict(),
  z.object({ type: z.literal('organization-context-cancel'), requestId: ipcRequestId, nonce: ipcNonce }).strict(),
])
/** Child responses carry no reusable authorization capability. */
export const contextNativeMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('organization-context-authorize'), requestId: ipcRequestId, nonce: ipcNonce, authorizationId, revision: workgraphReadSchema.shape.revision }).strict(),
  z.object({ type: z.literal('organization-context-result'), requestId: ipcRequestId, nonce: ipcNonce,
    result: contextResultSchema.optional(), error: z.string().optional() }).strict(),
])

/**
 * Refuse replay of relationship identifiers removed by current historical projection.
 * @param snapshot - Task facts retained at the original authorized revision.
 * @param current - The same revision projected under current authorization.
 */
export function assertContextSnapshotAccess(snapshot: ContextAuthority['task'], current: ContextAuthority['task']): void {
  if (current.revision !== snapshot.revision || current.parentTaskId !== snapshot.parentTaskId
    || JSON.stringify(current.dependsOn) !== JSON.stringify(snapshot.dependsOn)) {
    throw new Error('organization-context: historical access changed')
  }
}
