/** Text-only local credential routes intersected with online finite organization planning permission. */
import { randomUUID, createHash } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import type { Context } from '@deepseek-ai/cordis'
import { z } from 'zod'
import { brandString } from '@deepseek-ai/dsh-brand'
import { assertUsableApiKey } from '@deepseek-ai/dsh-llm'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { DeepSeekAdapter, resolveAdapterOptions, type DeepSeekAdapterOptions } from '@deepseek-ai/dsh-llm-deepseek'
import { planningOpenSchema, planningCommandSchema } from '@deepseek-ai/dsh-organization/planning'
import type { ConversationBridge, ConversationRequest, ConversationAuthority } from './protocol.ts'
/** Local credential destinations never leave the private Host. */
export const conversationModelSchema = planningOpenSchema.shape.selection.extend({ credential: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/),
  maxTokens: z.number().int().positive(), contextWindow: z.number().int().positive(),
  idleTimeoutMs: z.number().int().positive().max(2147483647) }).strict()
/**
 * Resolve an isolated text adapter that reserves and consumes permission for each final HTTP payload.
 * @param ctx - Private local credential service owner.
 * @param request - Explicit native-validated user selection.
 * @param routes - Deployment-approved local credential destinations.
 * @param bridge - Correlated online authority reads and fixed commands.
 * @param record - Durable intent writer, awaited before sending any authority mutation.
 * @param signal - Native identity and window lifetime.
 * @returns Text-only adapter; redirects, personal settings and attachment providers are absent.
 */
export function conversationAdapter(ctx: Context, request: Extract<ConversationRequest, { kind: 'send' }>,
  routes: z.output<typeof conversationModelSchema>[], bridge: ConversationBridge,
  record: (command: z.output<typeof planningCommandSchema>, authority?: ConversationAuthority) => Promise<void>,
  signal: AbortSignal): DeepSeekAdapter {
  const route = routes.find(r => r.model === request.selection.model && r.endpoint === request.selection.endpoint)
  if (!route) throw new Error('organization-conversation: local-model-policy-denied')
  const options = resolveAdapterOptions({ baseURL: route.endpoint, apiKeyEnv: route.credential,
    models: [{ id: route.model, inputModalities: ['text'], contextWindow: route.contextWindow, maxTokens: route.maxTokens }],
    maxTokens: route.maxTokens, defaultContextWindow: route.contextWindow, streamIdleTimeoutMs: route.idleTimeoutMs })
  const userId = brandString<ReturnType<DeepSeekAdapterOptions['resolveUserId']>>(randomUUID()), used = new Set<string>()
  const selector = { organizationId: request.organizationId, projectId: request.projectId, conversationId: request.conversationId }
  return new DeepSeekAdapter({ options: () => options, resolveUserId: () => userId,
    prepareExtensions: () => Promise.resolve({ fields: {}, accept: () => Promise.resolve() }),
    resolveApiKey: async () => {
      signal.throwIfAborted()
      const hit = await ctx.get('credentials')?.resolve(credentialRef(route.credential))
      signal.throwIfAborted()
      if (!hit) throw new Error('organization-conversation: credential-unavailable')
      return assertUsableApiKey(hit.value, 'organization-conversation', route.credential)
    },
    beforeRequest: async ({ url, model, payload, signal: requestSignal }) => {
      signal.throwIfAborted(); requestSignal.throwIfAborted()
      if (model !== route.model || url !== `${route.endpoint}/messages`) throw new Error('organization-conversation: model-route-denied')
      const first = await bridge(), grant = first.view.grant
      if (!first.view.eligible || !grant || grant.selection.model !== route.model || grant.selection.endpoint !== route.endpoint)
        throw new Error('organization-conversation: planning-permission-required')
      const requestDigest = createHash('sha256').update(payload).digest('hex')
      const reserve = planningCommandSchema.parse({ ...selector, kind: 'reserve-planning-request', operationId: randomUUID(),
        requestDigest, inputBytes: Buffer.byteLength(payload), outputBytes: first.view.policy.maxOutputBytes })
      ctx.logger.info('organization component=planning-model operationId=%s generation=%s operation=reserve result=pending',
        reserve.operationId, first.generation)
      await record(reserve)
      const reservationStarted = performance.now()
      const reserved = await bridge(reserve); await record(reserve, reserved)
      const permitId = reserved.receipt?.planning.permitId
      if (!permitId || reserved.receipt?.planning.permitExpiresAt === undefined
        || used.has(permitId)) throw new Error('organization-conversation: planning-permit-required')
      const consume = planningCommandSchema.parse({ ...selector, kind: 'consume-planning-request',
        operationId: randomUUID(), permitId, requestDigest })
      await record(consume)
      const started = performance.now(), admitted = await bridge(consume)
      await record(consume, admitted)
      const final = await bridge()
      const current = final.view.grant
      if (!final.view.eligible || !current || current.serverEpoch !== grant.serverEpoch
        || admitted.receipt?.planning.permitId !== permitId) throw new Error('organization-conversation: superseded')
      const expires = Math.min(started + current.expiresAt - admitted.view.serverTime,
        reservationStarted + reserved.receipt.planning.permitExpiresAt - reserved.view.serverTime)
      return () => {
        signal.throwIfAborted(); requestSignal.throwIfAborted()
        if (performance.now() >= expires || used.has(permitId)) throw new Error('organization-conversation: planning-permit-expired')
        used.add(permitId)
        ctx.logger.info('organization component=planning-model operationId=%s permitId=%s generation=%s result=dispatch',
          consume.operationId, permitId, final.generation)
      }
    },
  })
}
