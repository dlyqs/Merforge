/** Published Desktop driver composition under plain Node; no native login or window. */
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { PassThrough } from 'node:stream'
import { Context } from '../../../vendor/cordis/lib/index.js'
import Loader from '../../../vendor/loader/lib/index.js'
import Include from '../../../vendor/include/lib/index.js'
import Agents from '../../../packages/core/agent/lib/index.js'
import Loop from '../../../packages/core/agent-loop/lib/index.js'
import Sessions from '../../../packages/core/session/lib/index.js'
import Projections from '../../../packages/session/session-projection/lib/index.js'
import Jsonl from '../../../packages/session/session-persistence-jsonl/lib/index.js'
import Llm, { createUserMessage } from '../../../packages/llm/llm/lib/index.js'
import Tools from '../../../packages/core/tools/lib/index.js'
import Prompt from '../../../packages/core/system-prompt/lib/index.js'
import Subprocess from '../../../packages/subprocess/subprocess-local/lib/index.js'
import Questions from '../../../packages/interaction/user-questions/lib/index.js'
import { JsonRpcLineTransport } from '../../../packages/subagent/codex-runtime/lib/index.js'

const resolveHost = createRequire(new URL('../package.json', import.meta.url))
const Codex = await import(pathToFileURL(resolveHost.resolve('@deepseek-ai/dsh-agent-codex')).href)
const root = await mkdtemp(join(tmpdir(), 'codex-built-smoke-'))
const ctx = new Context()
const calls = []
const children = []
const callbackErrors = []
try {
  const modules = new Map([['agents', Agents], ['loop', Loop], ['sessions', Sessions], ['projections', Projections],
    ['jsonl', Jsonl], ['llm', Llm], ['tools', Tools], ['prompt', Prompt], ['subprocess', Subprocess], ['codex', Codex],
    ['questions', Questions]])
  const path = join(root, 'cordis.yml')
  await writeFile(path, JSON.stringify([{ name: 'llm' }, { name: 'sessions' }, { name: 'projections' }, { name: 'agents' },
    { name: 'tools' }, { name: 'prompt' }, { name: 'loop', config: { agents: [] } },
    { name: 'jsonl', config: { root: join(root, 'sessions'), compression: 'none' } },
    { name: 'questions' }, { name: 'subprocess' }, { name: 'codex' }]))
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  ctx.loader.internal = { version: 'v2', async import(name) { return modules.get(name) } }
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(path).href } })
  await ctx.loader.await()
  assert.equal(ctx.agents.driver('codex').kind, 'codex')
  ctx.subprocess.spawn = () => {
    const input = new PassThrough(), output = new PassThrough(), stderr = new PassThrough()
    const done = Promise.withResolvers()
    const peer = new JsonRpcLineTransport(output, input)
    const child = { exited: false }
    children.push(child)
    peer.onRequest(async (method, params) => {
      calls.push(method)
      const thread = { id: 'native-thread', cwd: root, model: 'native', cliVersion: '0.153.4', ephemeral: false, historyMode: 'legacy', turns: [] }
      switch (method) {
        case 'initialize': return { userAgent: 'codex-cli 0.153.4', platformFamily: 'unix', platformOs: 'macos', codexHome: '/private' }
        case 'account/read': return { account: { type: 'chatgpt', email: 'private@test.invalid' }, requiresOpenaiAuth: true }
        case 'model/list': return { data: [{ id: 'native', model: 'native', displayName: 'Native', isDefault: true, hidden: false,
          defaultReasoningEffort: 'medium', supportedReasoningEfforts: [{ reasoningEffort: 'medium' }] }], nextCursor: null }
        case 'thread/start': case 'thread/read': case 'thread/resume': return { thread }
        case 'turn/start': {
          const id = `turn-${calls.filter(method => method === 'turn/start').length}`
          setImmediate(() => {
            void (async () => {
              const response = await peer.request('item/tool/requestUserInput', { threadId: params.threadId, turnId: id,
                itemId: `question-${id}`, isBlocking: true, questions: [{ id: 'q', header: 'Question', question: 'Proceed?' }] })
              assert.deepEqual(response, { answers: { q: { answers: ['Proceed once'] } } })
              peer.notify('turn/completed', { threadId: params.threadId, turn: { id, status: 'completed',
                items: [{ id: `answer-${id}`, type: 'agentMessage', phase: 'final_answer', text: `answer ${id}` }] } })
            })().catch(error => { callbackErrors.push(error) })
          })
          return { turn: { id, status: 'inProgress', items: [] } }
        }
        default: throw new Error(`unexpected ${method}`)
      }
    })
    peer.start()
    return { stdin: output, stdout: input, stderr, control: undefined, collected: {}, done: done.promise,
      terminate() { child.exited = true; peer.close(); input.end(); output.end(); stderr.end(); done.resolve({ exitCode: 0, signal: null }) },
      async waitForExit() { await done.promise; return true } }
  }
  const selection = await ctx.agents.driver('codex').resolve('native', 'medium')
  const handle = await ctx.agents.create({ sessionId: 'built-native', agentOptions: { backend: selection }, meta: { cwd: root } })
  ctx.on('user-questions/request', async request => {
    assert.equal(request.agent, handle.agent)
    return { answers: [{ id: 'q', selected: [], custom: 'Proceed once' }] }
  })
  for (const text of ['first', 'second']) {
    handle.agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
    await handle.agent.whenIdle()
  }
  const stored = await ctx.sessionPersistence.open(handle.agent.id, 'read')
  try {
    const { events } = await stored.read()
    assert.equal(events.filter(event => event.type === 'assistant/message').length, 2)
    assert.equal(events.filter(event => event.type === 'codex/turn-result').length, 2)
    assert.equal(events.filter(event => event.type === 'codex/request-result' && event.data.status === 'answered').length, 2)
    assert.deepEqual(callbackErrors, [])
    assert.equal(calls.filter(method => method === 'thread/start').length, 1)
    assert.equal(calls.filter(method => method === 'turn/start').length, 2)
    assert.ok(children.every(child => child.exited))
    assert.ok(!JSON.stringify(events).includes('private@test.invalid'))
  } finally { await stored.close() }
  await handle.dispose()
  console.log('codex built smoke: private Host resolution, Loader, two turns, human callbacks, JSONL and cleanup passed')
} finally {
  await ctx.fiber.dispose()
  await rm(root, { recursive: true, force: true })
}
