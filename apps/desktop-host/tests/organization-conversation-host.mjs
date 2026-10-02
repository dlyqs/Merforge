/** Built private planning Host child; deterministic model network, real Loader/Agent/JSONL. */
import { Context } from '../../../vendor/cordis/lib/index.js'
import Loader from '../../../vendor/loader/lib/index.js'
import Include from '../../../vendor/include/lib/index.js'
import Storage from '../../../packages/storage/storage/lib/index.js'
import * as Json from '../../../packages/storage/storage-json/lib/index.js'
import * as Domain from '../../../packages/storage/storage-domain/lib/index.js'
import Credentials from '../../../packages/credentials/credentials-local/lib/index.js'
import Invariants from '../../../packages/runtime-diagnostics/invariants/lib/index.js'
import Conversation from '../../../packages/workspace/organization-conversation/lib/index.js'
import * as Invariant from '../../../packages/workspace/organization-conversation/lib/invariant.js'
import { installOrganizationConversationControl } from '../lib/types/organization-conversation.js'
import { writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'
const root = process.argv[2], ctx = new Context()
const modules = new Map([['storage', Storage], ['json', Json], ['domain', Domain], ['credentials', Credentials],
  ['invariants', Invariants], ['conversation', Conversation], ['conversation-invariant', Invariant]])
ctx.baseUrl = pathToFileURL(root).href + '/'
const credentials = join(root, 'planning-credentials.yml'), profile = join(root, 'planning-cordis.yml')
await writeFile(credentials, 'PLANNING_SMOKE_KEY: local-only-smoke-key\n', { mode: 0o600 })
await writeFile(profile, JSON.stringify([{ name: 'storage' }, { name: 'json', config: { root: join(root, 'data') } },
  { name: 'domain', config: { backend: 'json' } }, { name: 'credentials', config: { path: credentials, watch: false } },
  { name: 'invariants' }, { name: 'conversation', config: { root: join(root, 'conversations'),
    models: [{ model: 'deepseek-flash', endpoint: 'https://api.deepseek.com/anthropic/v1', credential: 'PLANNING_SMOKE_KEY',
      maxTokens: 1000, contextWindow: 1000000, idleTimeoutMs: 5000 }], maxSteps: 10, recheckMs: 100,
    maxDurationMs: 10000, maxReportBytes: 100000, defaultSettings: { enabled: true, granularity: 'balanced' } } },
  { name: 'conversation-invariant' }]))
await ctx.plugin(Loader); ctx.loader.builtins.include = Include
ctx.loader.internal = { version: 'v2', async import(name) { return modules.get(name) } }
await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(profile).href } })
await ctx.loader.await()
if (!ctx.get('organizationConversation')) throw new Error('planning Loader unavailable')
globalThis.fetch = async (_url, init) => {
  const body = JSON.parse(init.body)
  if (body.tools.some(t => !['workflow_assess', 'planning_authorization'].includes(t.name))) throw new Error('unexpected planning tool')
  const events = [{ type: 'message_start', message: { id: 'smoke-message', model: 'deepseek-flash', usage: { input_tokens: 10, output_tokens: 0 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Private project planning smoke' } },
    { type: 'content_block_stop', index: 0 }, { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 10 } },
    { type: 'message_stop' }]
  return new Response(events.map(e => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } })
}
installOrganizationConversationControl(ctx, { on: (event, listener) => process.on(event, listener),
  off: (event, listener) => process.off(event, listener), send: message => process.send(message) })
let stopping
process.on('message', message => {
  if (message?.type !== 'shutdown') return
  stopping ??= ctx.fiber.dispose().then(() => { process.send({ type: 'shutdown-complete' }, () => process.disconnect()) })
})
process.send({ type: 'planning-ready' })
