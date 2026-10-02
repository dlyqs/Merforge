/** Real Loader, credential provider, invariant and private IPC composition for planning tests. */
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import Storage from '@deepseek-ai/dsh-storage'
import * as Json from '@deepseek-ai/dsh-storage-json'
import * as Domain from '@deepseek-ai/dsh-storage-domain'
import Sessions from '@deepseek-ai/dsh-session'
import Agents from '@deepseek-ai/dsh-agent'
import Projections from '@deepseek-ai/dsh-session-projection'
import Query from '@deepseek-ai/dsh-session-query'
import Jsonl from '@deepseek-ai/dsh-session-persistence-jsonl'
import Invariants from '@deepseek-ai/dsh-invariants'
import Credentials from '@deepseek-ai/dsh-credentials-local'
import Conversation from '../src/index.ts'
import * as Invariant from '../src/invariant.ts'
import { installOrganizationConversationControl } from '../../../../apps/desktop-host/src/organization-conversation.ts'
import { conversationNativeMessageSchema, type ConversationRequest, type ConversationBridge,
  type ConversationResult } from '../src/protocol.ts'

import { EventEmitter } from 'node:events'
import { writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { expect } from 'vitest'
import type { Config } from '../src/index.ts'
import type { ConversationHost } from '../../../../apps/desktop/src/organization-conversation.ts'
export const selection = { model: 'deepseek-flash', endpoint: 'https://api.deepseek.com/anthropic/v1' }
export const config = (root: string): Config => ({ root: join(root, 'conversations'), models: [{ ...selection,
  credential: 'PLANNING_TEST_KEY', maxTokens: 1000, contextWindow: 1000000, idleTimeoutMs: 5000 }],
maxSteps: 10, recheckMs: 50, maxDurationMs: 10000, maxReportBytes: 100000,
defaultSettings: { enabled: true, granularity: 'balanced' } })
export async function boot(root: string) {
  const ctx = new Context(), bus = new EventEmitter()
  ctx.baseUrl = pathToFileURL(root).href + '/'
  const modules = new Map<string, unknown>([['storage', Storage], ['json', Json], ['domain', Domain],
    ['sessions', Sessions], ['agents', Agents], ['projections', Projections], ['query', Query], ['jsonl', Jsonl],
    ['credentials', Credentials], ['invariants', Invariants], ['conversation', Conversation], ['conversation-invariant', Invariant]])
  const credentialPath = join(root, 'credentials.yml')
  await writeFile(credentialPath, 'PLANNING_TEST_KEY: local-only-test-key\n', { mode: 0o600 })
  const configPath = join(root, 'conversation-cordis.yml')
  await writeFile(configPath, JSON.stringify([{ name: 'storage' }, { name: 'json', config: { root: join(root, 'data') } },
    { name: 'domain', config: { backend: 'json' } }, { name: 'sessions' }, { name: 'agents' }, { name: 'projections' }, { name: 'query' },
    { name: 'jsonl', config: { root: join(root, 'personal'), compression: 'none' } },
    { name: 'credentials', config: { path: credentialPath, watch: false } }, { name: 'invariants' },
    { name: 'conversation', config: config(root) }, { name: 'conversation-invariant' }]))
  try {
    await ctx.plugin(Loader); ctx.loader.builtins.include = Include
    ctx.loader.internal = { version: 'v2', async import(name: string) { return modules.get(name) } } as never
    await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
    await ctx.loader.await()
    expect(ctx.get('organizationConversation')).toBeDefined()
    const pending = new Map<string, {
      authorize: ConversationBridge
      resolve: (result: ConversationResult) => void
      reject: (error: Error) => void }>()
    const nonce = randomUUID()
    installOrganizationConversationControl(ctx, { on: (event, listener) => bus.on(event, listener),
      off: (event, listener) => bus.off(event, listener), send: (input) => {
        const response = conversationNativeMessageSchema.parse(input)
        if (response.nonce !== nonce) return
        const query = pending.get(response.requestId)
        if (!query) return
        if (response.type === 'organization-conversation-result') {
          if (response.result) query.resolve(response.result); else query.reject(new Error(response.error))
        } else {
          void query.authorize(response.command).then(authority => bus.emit('message',
            { requestId: response.requestId, nonce, authorizationId: response.authorizationId,
              type: 'organization-conversation-authorized', authority }), () => bus.emit('message', {
            type: 'organization-conversation-authorized', requestId: response.requestId, nonce,
            authorizationId: response.authorizationId, error: 'denied' }))
        }
      } })
    const host: ConversationHost = { organizationConversation: async (request: ConversationRequest, authorize: ConversationBridge,
      timeoutMs: number, signal: AbortSignal) => {
      const requestId = randomUUID()
      const abort = () => { bus.emit('message', { type: 'organization-conversation-cancel', requestId, nonce }) }
      signal.addEventListener('abort', abort, { once: true })
      try {
        return await new Promise<ConversationResult>((resolve, reject) => {
          pending.set(requestId, { authorize, resolve, reject })
          bus.emit('message', { type: 'organization-conversation-operation', requestId, nonce, timeoutMs, request })
        })
      } finally { signal.removeEventListener('abort', abort); pending.delete(requestId) }
    } }
    return { ctx, host, bus, root, service: ctx.organizationConversation, close: () => ctx.fiber.dispose() }
  } catch (error) { await ctx.fiber.dispose(); throw error }
}
export function reply(classification?: 'simple' | 'clarify' | 'complex', text = 'Private planning answer'): Response {
  const events: object[] = [{ type: 'message_start', message: { id: 'msg-' + randomUUID(), model: selection.model,
    usage: { input_tokens: 10, output_tokens: 0 } } }]
  if (classification) events.push({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use',
    id: 'assessment-' + randomUUID(), name: 'workflow_assess', input: {} } },
  { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta',
    partial_json: JSON.stringify({ classification, rationale: 'Current goal requirements' }) } },
  { type: 'content_block_stop', index: 0 })
  else events.push({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }, { type: 'content_block_stop', index: 0 })
  events.push({ type: 'message_delta', delta: { stop_reason: classification ? 'tool_use' : 'end_turn' },
    usage: { output_tokens: 10 } }, { type: 'message_stop' })
  return new Response(events.map(event => `event: ${Reflect.get(event, 'type')}\ndata: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } })
}
