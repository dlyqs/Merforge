/** Built private control, Loader and real managed subprocess; no window or account access. */
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { Context } from '../../../vendor/cordis/lib/index.js'
import Loader from '../../../vendor/loader/lib/index.js'
import Include from '../../../vendor/include/lib/index.js'
import Agents from '../../../packages/core/agent/lib/index.js'
import Loop from '../../../packages/core/agent-loop/lib/index.js'
import Sessions from '../../../packages/core/session/lib/index.js'
import Projections from '../../../packages/session/session-projection/lib/index.js'
import Llm from '../../../packages/llm/llm/lib/index.js'
import Tools from '../../../packages/core/tools/lib/index.js'
import Prompt from '../../../packages/core/system-prompt/lib/index.js'
import Subprocess from '../../../packages/subprocess/subprocess-local/lib/index.js'
import { installCodexSetupControl } from '../lib/index.js'
const require = createRequire(new URL('../package.json', import.meta.url))
const Codex = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-agent-codex')).href)
const { codexSetupNativeMessageSchema } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-agent-codex/setup-protocol')).href)
const root = await mkdtemp(join(tmpdir(), 'codex-setup-built-')), ctx = new Context()
const fixture = fileURLToPath(new URL('../../../packages/core/agent-codex/tests/fixtures/setup-peer.mjs', import.meta.url))
const channel = new EventEmitter(), output = [], children = []
try {
  const modules = new Map([['llm', Llm], ['sessions', Sessions], ['projections', Projections], ['agents', Agents],
    ['tools', Tools], ['prompt', Prompt], ['loop', Loop], ['subprocess', Subprocess], ['codex', Codex]])
  const path = join(root, 'cordis.yml')
  await writeFile(path, JSON.stringify([...modules.keys()].map(name => ({ name, ...name === 'loop' ? { config: { agents: [] } } : {} }))))
  await writeFile(join(root, 'setup-mode.json'), '{}')
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader); ctx.loader.builtins.include = Include
  ctx.loader.internal = { version: 'v2', async import(name) { return modules.get(name) } }
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(path).href } }); await ctx.loader.await()
  const spawn = ctx.subprocess.spawn.bind(ctx.subprocess)
  ctx.subprocess.spawn = spec => {
    const child = spawn({ ...spec, cwd: root, env: { HOME: root, CODEX_HOME: root }, argv: [process.execPath, fixture] })
    children.push(child); return child
  }
  installCodexSetupControl(ctx, { on: (event, listener) => channel.on(event, listener), off: (event, listener) => channel.off(event, listener),
    send: message => { output.push(codexSetupNativeMessageSchema.parse(message)); channel.emit('result', message) } })
  const owner = '11111111-1111-4111-8111-111111111111', nonce = '22222222-2222-4222-8222-222222222222'
  let sequence = 0
  const request = operation => new Promise((resolve, reject) => {
    const requestId = `33333333-3333-4333-8333-${String(++sequence).padStart(12, '0')}`
    const timer = setTimeout(() => { channel.off('result', listener); reject(new Error('setup smoke timeout')) }, 5000)
    const listener = result => { if (result.type !== 'codex-setup-result' || result.requestId !== requestId) return
      clearTimeout(timer); channel.off('result', listener); resolve(result) }
    channel.on('result', listener)
    channel.emit('message', { type: 'codex-setup', version: 1, nonce, requestId, owner, operation })
  })
  const waiting = await request({ kind: 'start' })
  assert.equal(waiting.result.snapshot.login.status, 'waiting')
  const attemptId = waiting.result.device.attemptId
  const opened = await request({ kind: 'openVerification', attemptId })
  assert.equal(opened.verificationUrl, 'https://auth.openai.com/codex/device')
  const cancelled = await request({ kind: 'cancel', attemptId })
  assert.deepEqual(cancelled.result.snapshot.login, { status: 'cancelled', cancellation: 'canceled', cleanup: 'done' })
  assert.equal(cancelled.result.device, undefined)
  assert.ok(!JSON.stringify(output.filter(result => result.type === 'codex-setup-changed')).includes('FIXTURE-PRIVATE-CODE'))
  for (const child of children) assert.equal(await child.waitForExit(), true)
  console.log('codex setup built smoke: fixed private IPC, owner view, endpoint, cancel and real child cleanup passed')
} finally { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) }
