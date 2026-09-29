/** Actual provider dispatch consumes only the current one-use model permission. */
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { expect, it, vi } from 'vitest'
import { LocalCredentialProvider } from '@deepseek-ai/dsh-credentials-local'
import { executionActionSchema } from '@deepseek-ai/dsh-organization/execution'
import { executionAdapter } from '../src/model.ts'
import { boot, fixture } from './harness.ts'
import { textEvents } from '../../../llm/llm-deepseek/tests/mock-server.ts'
import { options } from '../../../llm/llm-deepseek/tests/helpers.ts'

async function setup() {
  const h = await boot(), f = fixture(), cancel = new AbortController()
  const endpoint = 'https://model.example/anthropic/v1'
  f.request.inputs.endpoint = endpoint
  f.authority.execution.modelPolicy = [{ model: f.request.inputs.model, endpoint }]
  f.authority.execution.run.state = 'running'
  const run = f.authority.execution.run
  const { id, state: _state, configDigest: _config, ...owner } = run
  f.authority.execution.actions = [executionActionSchema.parse({ ...owner, runId: id, actionId: randomUUID(),
    capability: 'model', requestDigest: 'a'.repeat(64), state: 'reserved', expiresAt: Date.now() + 10000, evidenceDigest: null })]
  const path = join(h.root, 'credentials.yml')
  await writeFile(path, 'ORGANIZATION_TEST_KEY: sk-organization-test-only-key\n', { mode: 0o600 })
  await h.ctx.plugin(LocalCredentialProvider, { path, watch: false })
  const route = { model: f.request.inputs.model, endpoint, credential: 'ORGANIZATION_TEST_KEY', maxTokens: 100, contextWindow: 10000, idleTimeoutMs: 5000 }
  const adapter = executionAdapter(h.ctx, f.request, [route], async () => f.authority, cancel.signal)
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(textEvents.map(data => `data: ${data}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } }))
  const stream = async () => {
    for await (const _chunk of adapter.stream({ ...options(), provider: 'organization', model: route.model })) { /* Consume the provider response. */ }
  }
  return { ...h, ...f, route, adapter, fetch, stream, cancel }
}
it('sends one exact HTTPS request and refuses reuse of the same action by an adapter-internal retry', async () => {
  const h = await setup()
  await h.stream()
  expect(h.fetch).toHaveBeenCalledTimes(1)
  expect(h.fetch.mock.calls[0]?.[0]).toBe(`${h.route.endpoint}/messages`)
  expect(h.fetch.mock.calls[0]?.[1]?.redirect).toBe('error')
  await expect(h.stream()).rejects.toThrow()
  expect(h.fetch).toHaveBeenCalledTimes(1)
})
it.each(['policy', 'eligibility', 'identity', 'expiry'])('rechecks %s after asynchronous credential resolution, before HTTP dispatch', async (kind) => {
  const h = await setup(), original = h.ctx.credentials.resolve.bind(h.ctx.credentials)
  vi.spyOn(h.ctx.credentials, 'resolve').mockImplementation(async (ref) => {
    const key = await original(ref)
    if (kind === 'policy') h.authority.execution.modelPolicy = []
    if (kind === 'eligibility') h.authority.execution.eligible = false
    if (kind === 'identity') h.cancel.abort()
    if (kind === 'expiry') h.authority.execution.actions[0]!.expiresAt = h.authority.execution.serverTime - 1
    return key
  })
  await expect(h.stream()).rejects.toThrow()
  expect(h.fetch).not.toHaveBeenCalled()
})
it('refuses a server-selected credential destination absent from the local allowlist', async () => {
  const h = await setup()
  expect(() => executionAdapter(h.ctx, { ...h.request, inputs: { ...h.request.inputs, endpoint: 'https://elsewhere.example/v1' } },
    [h.route], async () => h.authority, h.cancel.signal)).toThrow('local-model-policy-denied')
  expect(h.fetch).not.toHaveBeenCalled()
})
