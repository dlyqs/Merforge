/** Explicit text-only organization model routes and per-dispatch online qualification. */
import { randomUUID } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import type { Context } from '@deepseek-ai/cordis'
import { z } from 'zod'
import { brandString } from '@deepseek-ai/dsh-brand'
import { assertUsableApiKey } from '@deepseek-ai/dsh-llm'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { DeepSeekAdapter, resolveAdapterOptions, type DeepSeekAdapterOptions } from '@deepseek-ai/dsh-llm-deepseek'
import { executionModelSchema } from '@deepseek-ai/dsh-organization/execution'
import type { ExecutionRequest } from './protocol.ts'
import type { ExecutionBridge } from './action-guard.ts'

/** Local credentials are usable only for an explicitly configured exact endpoint/model pair. */
export const localModelSchema = executionModelSchema.extend({
  credential: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/),
  maxTokens: z.number().int().positive(), contextWindow: z.number().int().positive(),
  idleTimeoutMs: z.number().int().positive().max(2147483647),
}).strict()
/**
 * Resolve an isolated adapter without personal presets, model settings or attachment providers.
 * @param ctx - Credential service owner; secrets never leave its local process.
 * @param request - Exact employee model and endpoint selection.
 * @param routes - Deployment-approved credential destinations.
 * @param bridge - Fresh authority read at every actual Messages dispatch.
 * @param signal - Native identity and window lifetime.
 * @returns A text-only adapter with one HTTP request per action permit.
 */
export function executionAdapter(ctx: Context, request: ExecutionRequest, routes: z.output<typeof localModelSchema>[],
  bridge: ExecutionBridge, signal: AbortSignal): DeepSeekAdapter {
  const route = routes.find(r => r.model === request.inputs.model && r.endpoint === request.inputs.endpoint)
  if (!route) throw new Error('organization-execution: local-model-policy-denied')
  const options = resolveAdapterOptions({ baseURL: route.endpoint, apiKeyEnv: route.credential,
    models: [{ id: route.model, inputModalities: ['text'], contextWindow: route.contextWindow, maxTokens: route.maxTokens }],
    maxTokens: route.maxTokens, defaultContextWindow: route.contextWindow, streamIdleTimeoutMs: route.idleTimeoutMs })
  const used = new Set<string>()
  const userId = brandString<ReturnType<DeepSeekAdapterOptions['resolveUserId']>>(randomUUID())
  return new DeepSeekAdapter({ options: () => options, resolveUserId: () => userId,
    prepareExtensions: () => Promise.resolve({ fields: {}, accept: () => Promise.resolve() }),
    resolveApiKey: async () => {
      signal.throwIfAborted()
      const hit = await ctx.get('credentials')?.resolve(credentialRef(route.credential))
      if (!hit) throw new Error('organization-execution: credential-unavailable')
      signal.throwIfAborted()
      return assertUsableApiKey(hit.value, 'organization-execution', route.credential)
    },
    beforeRequest: async ({ url, model, signal: requestSignal }) => {
      signal.throwIfAborted(); requestSignal.throwIfAborted()
      if (model !== route.model || url !== `${route.endpoint}/messages`) throw new Error('organization-execution: model-route-denied')
      const started = performance.now(), authority = await bridge(), view = authority.execution, run = view.run
      if (!view.eligible || run.state !== 'running' || run.id !== request.runId || run.assignmentId !== request.assignmentId
        || !view.modelPolicy.some(p => p.model === route.model && p.endpoint === route.endpoint)) {
        throw new Error('organization-execution: organization-model-policy-denied')
      }
      const permits = view.actions.filter(a => a.state === 'reserved' && a.capability === 'model')
      const permit = permits[0]
      if (permits.length !== 1 || !permit || used.has(permit.actionId) || permit.runId !== run.id
        || permit.serverEpoch !== run.serverEpoch || permit.fencingEpoch !== run.fencingEpoch
        || permit.deviceId !== run.deviceId || permit.executionDelegationId !== run.executionDelegationId) {
        throw new Error('organization-execution: model-permit-required')
      }
      const expires = started + permit.expiresAt - view.serverTime
      return () => {
        signal.throwIfAborted(); requestSignal.throwIfAborted()
        if (performance.now() >= expires || used.has(permit.actionId)) throw new Error('organization-execution: model-permit-expired')
        used.add(permit.actionId)
      }
    },
  })
}
