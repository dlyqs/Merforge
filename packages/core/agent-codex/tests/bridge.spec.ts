/** Loader + JSONL + native protocol composition; no login, model network or windows. */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { PassThrough } from 'node:stream'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import Agents from '@deepseek-ai/dsh-agent'
import type { AgentBackendSelection } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import Sessions, { SessionId } from '@deepseek-ai/dsh-session'
import Projections from '@deepseek-ai/dsh-session-projection'
import Jsonl from '@deepseek-ai/dsh-session-persistence-jsonl'
import Llm, { createUserMessage } from '@deepseek-ai/dsh-llm'
import Tools from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import Workspaces from '@deepseek-ai/dsh-workspace'
import Query from '@deepseek-ai/dsh-session-query'
import Personal from '@deepseek-ai/dsh-personal-project'
import Subprocess from '@deepseek-ai/dsh-subprocess-local'
import { JsonRpcLineTransport } from '@deepseek-ai/dsh-codex-runtime'
import type { SubprocessHandle, SubprocessOutcome } from '@deepseek-ai/dsh-subprocess'
import { afterEach, expect, it, vi } from 'vitest'
import * as Codex from '../src/index.ts'
import Commands from '@deepseek-ai/dsh-commands'
import { BasicCompactionEngine } from '@deepseek-ai/dsh-compaction-basic'
import { SessionLogOffset } from '@deepseek-ai/dsh-session'
import FileUploads from '../../../client/file-upload/src/index.ts'
import { MockAdapter } from '../../agent-loop/tests/mock-adapter.ts'
import { createSessionTestRemote } from '../../../api/session-controller/tests/test-remote.ts'
import type { SessionRequestId } from '../../../api/session-controller/src/types.ts'

const selection: AgentBackendSelection = { kind: 'codex', model: 'native-test', effort: 'medium', runtimeVersion: '0.153.4' }
const cleanup: Array<() => Promise<void>> = []
afterEach(async () => { for (const release of cleanup.splice(0).reverse()) await release() })

function native(cwd: string) {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = []
  const threads = new Map<string, {
    id: string
    cwd: string
    model: string
    cliVersion: string
    ephemeral: boolean
    historyMode: string
    turns: Array<{ id: string; status: string; items: Array<Record<string, unknown>> }>
  }>()
  let hold = false
  let loseAcceptance = false
  let failRead = false
  let loseTerminal = false
  let toolOnly = false
  let loggedIn = true
  let holdCatalog = false
  let threadCount = 0
  let turnCount = 0
  let onSend: (() => Promise<void>) | undefined
  const children: Array<{ handle: SubprocessHandle; peer: JsonRpcLineTransport; exited: boolean }> = []
  const spawn = (): SubprocessHandle => {
    const input = new PassThrough(), output = new PassThrough(), stderr = new PassThrough()
    const done = Promise.withResolvers<SubprocessOutcome>()
    const peer = new JsonRpcLineTransport(output, input)
    const child = { handle: undefined as SubprocessHandle | undefined, peer, exited: false }
    const handle: SubprocessHandle = { stdin: output, stdout: input, stderr, control: undefined, collected: {}, done: done.promise,
      terminate() {
        child.exited = true; peer.close(); input.end(); output.end(); stderr.end()
        done.resolve({ exitCode: 0, signal: null })
      },
      async waitForExit() { await done.promise; return true } }
    const complete = (threadId: string, turn: { id: string; status: string; items: Array<Record<string, unknown>> }, status = 'completed'): void => {
      turn.status = status
      turn.items = status === 'completed' ? [{ id: `answer-${turn.id}`, type: 'agentMessage', phase: 'final_answer', text: `answer ${turn.id}` },
        { id: `tool-${turn.id}`, type: 'commandExecution', command: 'native fixture', status: 'completed', exitCode: 0, aggregatedOutput: 'native output' }] : []
      if (toolOnly) turn.items = turn.items.filter(item => item.type !== 'agentMessage')
      if (loseTerminal) input.end()
      else peer.notify('turn/completed', { threadId, turn })
    }
    peer.onRequest(async (method, params) => {
      calls.push({ method, params })
      switch (method) {
        case 'initialize': return { userAgent: 'codex-cli 0.153.4', platformFamily: 'unix', platformOs: 'macos', codexHome: '/private/native' }
        case 'account/read': return { account: loggedIn ? { type: 'chatgpt', email: 'private@example.test' } : null, requiresOpenaiAuth: true }
        case 'model/list':
          if (holdCatalog) return new Promise<never>(() => {})
          return { data: [{ id: 'native-test', model: 'native-test', displayName: 'Native test', isDefault: true, hidden: false,
            defaultReasoningEffort: 'medium', supportedReasoningEfforts: [{ reasoningEffort: 'medium' }, { reasoningEffort: 'high' }] }], nextCursor: null }
        case 'thread/start': {
          const thread = { id: `thread-${++threadCount}`, cwd, model: 'native-test', cliVersion: '0.153.4', ephemeral: false, historyMode: 'legacy', turns: [] }
          threads.set(thread.id, thread)
          return { thread }
        }
        case 'thread/read': case 'thread/resume':
          if (failRead) throw new Error('read failed')
          return { thread: threads.get(String(params.threadId)) }
        case 'turn/start': {
          await onSend?.()
          const thread = threads.get(String(params.threadId))!
          const turn = { id: `turn-${++turnCount}`, status: 'inProgress', items: [] as Array<Record<string, unknown>> }
          thread.turns.push(turn)
          setImmediate(() => {
            if (!hold && !child.exited && !loseAcceptance) {
              peer.notify('item/agentMessage/delta', { threadId: thread.id, turnId: turn.id, itemId: `answer-${turn.id}`, delta: 'live ' })
              peer.notify('item/completed', { threadId: thread.id, turnId: turn.id, item: { id: `tool-${turn.id}`, type: 'commandExecution', command: 'native fixture', status: 'completed', exitCode: 0, aggregatedOutput: 'native output' } })
              complete(thread.id, turn)
            }
          })
          if (loseAcceptance) { input.end(); return new Promise<never>(() => {}) }
          return { turn: { id: turn.id, status: 'inProgress', items: [] } }
        }
        case 'turn/interrupt': {
          const thread = threads.get(String(params.threadId))!
          complete(thread.id, thread.turns.find(turn => turn.id === params.turnId)!, 'interrupted')
          return {}
        }
        default: throw new Error(`unexpected ${method}`)
      }
    })
    peer.start()
    children.push({ handle, peer, get exited() { return child.exited } })
    return handle
  }
  return { calls, children, threads, spawn,
    set hold(value: boolean) { hold = value }, set loseAcceptance(value: boolean) { loseAcceptance = value },
    set loseTerminal(value: boolean) { loseTerminal = value }, set toolOnly(value: boolean) { toolOnly = value },
    set loggedIn(value: boolean) { loggedIn = value },
    set holdCatalog(value: boolean) { holdCatalog = value },
    set failRead(value: boolean) { failRead = value },
    set onSend(value: typeof onSend) { onSend = value } }
}

async function boot(root: string, peer: ReturnType<typeof native>, personal = false) {
  const configPath = join(root, 'cordis.yml')
  const modules = new Map<string, unknown>([
    ['llm', Llm], ['sessions', Sessions], ['projections', Projections], ['agents', Agents], ['tools', Tools], ['prompt', SystemPrompt],
    ['loop', AgentLoop], ['jsonl', Jsonl], ['subprocess', Subprocess], ['codex', Codex],
    ['storage', Storage], ['storage-json', StorageJson], ['domain', StorageDomain], ['workspaces', Workspaces], ['query', Query], ['personal', Personal],
  ])
  await writeFile(configPath, [
    '- name: llm', '- name: sessions', '- name: projections', '- name: agents', '- name: tools', '- name: prompt',
    '- name: loop', '  config: { agents: [] }', '- name: jsonl', `  config: { root: ${JSON.stringify(join(root, 'sessions'))}, compression: none }`,
    ...personal ? ['- name: storage', '- name: storage-json', `  config: { root: ${JSON.stringify(join(root, 'data'))} }`,
      '- name: domain', '  config: { backend: json }', '- name: workspaces', '- name: query', '- name: personal'] : [],
    '- name: subprocess', '- name: codex', '  config: { startupTimeoutMs: 1000, rpcTimeoutMs: 1000, turnTimeoutMs: 2000, interruptTimeoutMs: 200, disposeGraceMs: 10 }', '',
  ].join('\n'))
  const ctx = new Context()
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  ctx.loader.internal = { version: 'v2', async import(specifier: string) {
    if (!modules.has(specifier)) throw new Error(`unexpected ${specifier}`)
    return modules.get(specifier)
  } } as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  expect([...ctx.loader.entries()].filter(entry => entry.fiber === undefined && !entry.disabled)).toEqual([])
  vi.spyOn(ctx.subprocess, 'spawn').mockImplementation(peer.spawn)
  cleanup.push(async () => { await ctx.fiber.dispose() })
  return ctx
}
async function fixture(personal = false) {
  const root = await mkdtemp(join(tmpdir(), 'merforge-codex-'))
  cleanup.push(() => rm(root, { recursive: true, force: true }))
  const peer = native(root)
  const ctx = await boot(root, peer, personal)
  return { ctx, root, peer }
}
async function readStored(ctx: Context, id: ReturnType<typeof SessionId>) {
  await using handle = await ctx.sessionPersistence.open(id, 'read')
  return await handle.read()
}
function input(text: string) { return createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }) }

it('drains an in-flight model discovery when the native provider unloads', async () => {
  const { ctx, peer } = await fixture()
  peer.holdCatalog = true
  const discovery = ctx.agents.driver('codex').catalog().then(() => 'resolved', () => 'rejected')
  await vi.waitFor(() => { expect(peer.calls.some(call => call.method === 'model/list')).toBe(true) })
  const entry = [...ctx.loader.entries()].find(entry => entry.options.name === 'codex')!
  await entry.fiber!.dispose()
  expect(await discovery).toBe('rejected')
  expect(peer.children.every(child => child.exited)).toBe(true)
})

it('dispatches two queued sends to one native thread with durable intent before each wire write and cold resume', async () => {
  const { ctx, root, peer } = await fixture()
  const id = SessionId('native-two-turns')
  const handle = await ctx.agents.create({ sessionId: id, agentOptions: { backend: selection }, meta: { cwd: root } })
  peer.onSend = async () => {
    const inspected = await readStored(ctx, id)
    expect(inspected.events.at(-1)?.type).toBe('codex/send-intent')
  }
  const errors: string[] = []
  ctx.on('agent/error', ({ error }) => { errors.push(String(error)) })
  const frames: unknown[] = []
  ctx.on('agent/assistant-stream', ({ frame }) => { frames.push(frame) })
  handle.agent.followup(input('first'))
  handle.agent.followup(input('second'))
  await handle.agent.whenIdle()
  expect(errors).toEqual([])
  expect(peer.calls.filter(call => call.method === 'turn/start')).toHaveLength(2)
  expect(peer.calls.filter(call => call.method === 'thread/start')).toHaveLength(1)
  expect(ctx.sessionProjections.stateOf(handle.agent.session, 'codexBridge')).toMatchObject({ status: 'completed', threadId: 'thread-1', turnId: 'turn-2' })
  expect(frames).toContainEqual(expect.objectContaining({ type: 'chunk' }))
  await handle.dispose()
  const restarted = await boot(root, peer)
  const resumed = await restarted.agents.resume({ resumeSessionId: id, agentOptions: { provider: 'missing-api', model: 'no-key' } })
  resumed.agent.followup(input('third'))
  await resumed.agent.whenIdle()
  const stored = await readStored(restarted, id)
  expect(stored.events.filter(event => event.type === 'user/message')).toHaveLength(3)
  expect(stored.events.filter(event => event.type === 'assistant/message')).toHaveLength(3)
  expect(stored.events.filter(event => event.type === 'codex/turn-result')).toHaveLength(3)
  expect(peer.calls.filter(call => call.method === 'thread/start')).toHaveLength(1)
  expect(peer.children.every(child => child.exited)).toBe(true)
  expect(JSON.stringify(stored.events)).not.toContain('private@example.test')
})

it('retains unknown acceptance after process loss and refuses replay or a replacement thread', async () => {
  const { ctx, root, peer } = await fixture()
  const id = SessionId('native-unknown')
  const handle = await ctx.agents.create({ sessionId: id, agentOptions: { backend: selection }, meta: { cwd: root } })
  peer.loseAcceptance = true
  handle.agent.followup(input('may have executed'))
  await handle.agent.whenIdle()
  expect(ctx.sessionProjections.stateOf(handle.agent.session, 'codexBridge')?.status).toBe('unknown')
  await handle.dispose()
  peer.loseAcceptance = false
  const resumed = await ctx.agents.resume({ resumeSessionId: id })
  resumed.agent.followup(input('do not replay'))
  await resumed.agent.whenIdle()
  expect(peer.calls.filter(call => call.method === 'turn/start')).toHaveLength(1)
  expect(peer.calls.filter(call => call.method === 'thread/start')).toHaveLength(1)
  expect(ctx.sessionProjections.stateOf(resumed.agent.session, 'codexBridge')?.status).toBe('unknown')
  expect(peer.children.every(child => child.exited)).toBe(true)
})

it('stops the native interval, records interrupted separately from process exit, and allows explicit continuation', async () => {
  const { ctx, root, peer } = await fixture()
  const handle = await ctx.agents.create({ sessionId: SessionId('native-stop'), agentOptions: { backend: selection }, meta: { cwd: root } })
  peer.hold = true
  handle.agent.followup(input('hold'))
  await vi.waitFor(() =>{  expect(ctx.sessionProjections.stateOf(handle.agent.session, 'codexBridge')?.status).toBe('running') })
  handle.agent.cancel({ kind: 'user' }, { keepInbox: true })
  await handle.agent.whenIdle()
  expect(ctx.sessionProjections.stateOf(handle.agent.session, 'codexBridge')?.status).toBe('interrupted')
  peer.hold = false
  handle.agent.followup(input('continue'))
  await handle.agent.whenIdle()
  expect(ctx.sessionProjections.stateOf(handle.agent.session, 'codexBridge')?.status).toBe('completed')
  expect(peer.children.every(child => child.exited)).toBe(true)
})

it('keeps one Session writer and rolls publication failure back without launching a native thread', async () => {
  const { ctx, root, peer } = await fixture()
  const id = SessionId('native-writer')
  const create = () => ctx.agents.create({ sessionId: id, agentOptions: { backend: selection }, meta: { cwd: root } })
  const outcomes = await Promise.allSettled([create(), create()])
  expect(outcomes.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(1)
  expect(peer.calls).toEqual([])
  const stop = ctx.on('agent/created', () => { throw new Error('publication rejected') })
  await expect(ctx.agents.create({ sessionId: SessionId('native-rollback'), agentOptions: { backend: selection }, meta: { cwd: root } })).rejects.toThrow('publication rejected')
  stop()
  expect(ctx.agents.get(SessionId('native-rollback'))).toBeUndefined()
  expect(ctx.sessions.get(SessionId('native-rollback'))).toBeUndefined()
})

it('uses real native catalog and Remote commands without an API route, rejects attachments/steering/fork, and switches to a new empty Session', async () => {
  const { ctx, root, peer } = await fixture()
  const remote = createSessionTestRemote(ctx, { cwd: root, defaultModelSelection: () => ({ provider: 'missing-api', model: 'no-key' }) })
  const catalog = await remote.modelCatalog()
  expect(catalog).toMatchObject({ ok: true, value: { groups: [{ id: 'codex', backend: 'codex' }], routableProviders: ['codex'] } })
  const created = await remote.create({ selection: { backend: 'codex', provider: 'codex', model: 'native-test', reasoningEffort: 'medium' } })
  expect(created.ok).toBe(true)
  if (!created.ok) throw created.error
  const id = created.value.sessionId
  const requestId = 'native-remote-prompt' as SessionRequestId
  expect(await remote.prompt({ sessionId: id, requestId, content: [{ type: 'text', text: 'hello' }], mode: 'queue' })).toEqual({ ok: true, value: { accepted: true } })
  await ctx.agents.get(id)!.whenIdle()
  expect(await remote.prompt({ sessionId: id, requestId, content: [{ type: 'text', text: 'hello' }], mode: 'queue' })).toEqual({ ok: true, value: { accepted: true } })
  expect(peer.calls.filter(call => call.method === 'turn/start')).toHaveLength(1)
  const rejected = await remote.prompt({ sessionId: id, requestId: 'unsupported' as SessionRequestId, mode: 'steer', content: [{ type: 'text', text: 'steer' }] })
  expect(rejected).toMatchObject({ ok: false, error: { code: 'session/attachment-invalid' } })
  expect(await remote.fork({ sessionId: id })).toMatchObject({ ok: false, error: { code: 'session/fork-unavailable' } })
  const switched = await remote.selectModel({ sessionId: id, backend: 'codex', provider: 'codex', model: 'native-test', reasoningEffort: 'high' })
  expect(switched.ok).toBe(true)
  if (!switched.ok) throw switched.error
  expect(switched.value.sessionId).not.toBe(id)
  const newSession = ctx.sessions.get(switched.value.sessionId!)!
  expect(newSession.snapshotEvents().map(event => event.type)).toEqual(['agent/backend', 'agent/backend-handoff'])
  expect(ctx.agents.get(id)!.options.backend).toEqual(selection)
})


it('reconciles a confirmed receipt after terminal loss without replaying its input or duplicating final text', async () => {
  const { ctx, root, peer } = await fixture()
  const id = SessionId('native-receipt-recovery')
  const first = await ctx.agents.create({ sessionId: id, agentOptions: { backend: selection }, meta: { cwd: root } })
  peer.loseTerminal = true
  first.agent.followup(input('already executed'))
  await first.agent.whenIdle()
  expect(ctx.sessionProjections.stateOf(first.agent.session, 'codexBridge')?.status).toBe('unknown')
  await first.dispose()
  peer.loseTerminal = false
  const second = await ctx.agents.resume({ resumeSessionId: id })
  second.agent.followup(input('continue'))
  await second.agent.whenIdle()
  const stored = await readStored(ctx, id)
  expect(stored.events.filter(event => event.type === 'assistant/message')).toHaveLength(1)
  expect(stored.events.find(event => event.type === 'codex/turn-result' && event.data.recovered)?.data).toMatchObject({ finalText: 'answer turn-1' })
  expect(stored.events.filter(event => event.type === 'codex/turn-result' && event.data.recovered)).toHaveLength(1)
  expect(peer.calls.filter(call => call.method === 'turn/start')).toHaveLength(2)
  expect(peer.calls.filter(call => call.method === 'thread/start')).toHaveLength(1)
})

it('shows failed native recovery as unknown while preserving the prior authoritative completion', async () => {
  const { ctx, root, peer } = await fixture()
  const handle = await ctx.agents.create({ sessionId: SessionId('native-read-loss'), agentOptions: { backend: selection }, meta: { cwd: root } })
  handle.agent.followup(input('first'))
  await handle.agent.whenIdle()
  peer.failRead = true
  handle.agent.followup(input('read fails'))
  await handle.agent.whenIdle()
  expect(ctx.sessionProjections.stateOf(handle.agent.session, 'codexBridge')?.status).toBe('unknown')
  const stored = await readStored(ctx, handle.agent.id)
  expect(stored.events.filter(event => event.type === 'codex/turn-result').map(event => event.data.status)).toEqual(['completed'])
  expect(peer.calls.filter(call => call.method === 'turn/start')).toHaveLength(1)
  expect(peer.calls.filter(call => call.method === 'thread/start')).toHaveLength(1)
  expect(peer.children.every(child => child.exited)).toBe(true)
  peer.failRead = false
  handle.agent.followup(input('explicit retry'))
  await handle.agent.whenIdle()
  expect(ctx.sessionProjections.stateOf(handle.agent.session, 'codexBridge')?.status).toBe('completed')
})

it('retains a native tool-only completion with unknown usage and no fabricated assistant message', async () => {
  const { ctx, root, peer } = await fixture()
  peer.toolOnly = true
  const handle = await ctx.agents.create({ sessionId: SessionId('native-tool-only'), agentOptions: { backend: selection }, meta: { cwd: root } })
  handle.agent.followup(input('tool'))
  await handle.agent.whenIdle()
  const stored = await readStored(ctx, handle.agent.id)
  expect(stored.events.filter(event => event.type === 'assistant/message')).toEqual([])
  expect(stored.events.find(event => event.type === 'codex/turn-result')?.data).toMatchObject({ status: 'completed', finalText: null, usage: 'unknown' })
  expect(stored.events.filter(event => event.type === 'codex/item')).toHaveLength(1)
})

it('does not dispatch queued unpublished input when a publication listener fails', async () => {
  const { ctx, root, peer } = await fixture()
  ctx.on('agent/created', () => { throw new Error('reject queued publication') })
  await expect(ctx.agents.create({ sessionId: SessionId('native-queued-rollback'), agentOptions: { backend: selection }, meta: { cwd: root },
    setup(_ctx, agent) { agent.followup(input('never execute')) },
  })).rejects.toThrow('reject queued publication')
  expect(peer.calls).toEqual([])
})

it('rejects missing native login and mismatched providers without invoking an API model', async () => {
  const { ctx, root, peer } = await fixture()
  peer.loggedIn = false
  const remote = createSessionTestRemote(ctx, { cwd: root, defaultModelSelection: () => ({ provider: 'missing-api', model: 'no-key' }) })
  expect(await remote.modelCatalog()).toMatchObject({ ok: true, value: { groups: [], failures: [{ id: 'codex' }] } })
  expect(await remote.create({ selection: { backend: 'codex', provider: 'other', model: 'native-test' } })).toMatchObject({ ok: false, error: { code: 'gateway/bad-request' } })
  expect(JSON.stringify(await remote.modelCatalog())).toContain('login required')
  expect(peer.calls.some(call => call.method === 'turn/start')).toBe(false)
  expect(peer.children.every(child => child.exited)).toBe(true)
})

it('disposes native processes even when the Session durability barrier fails', async () => {
  const { ctx, root, peer } = await fixture()
  const handle = await ctx.agents.create({ sessionId: SessionId('native-flush-failure'), agentOptions: { backend: selection }, meta: { cwd: root } })
  const flush = ctx.sessions.flush.bind(ctx.sessions)
  const failure = vi.spyOn(ctx.sessions, 'flush').mockImplementation(async (session) => {
    if (session === handle.agent.session && session.snapshotEvents().some(event => event.type === 'codex/send-intent')) throw new Error('disk unavailable')
    return flush(session)
  })
  handle.agent.followup(input('must not send'))
  await handle.agent.whenIdle()
  expect(peer.calls.filter(call => call.method === 'turn/start')).toEqual([])
  expect(peer.children.every(child => child.exited)).toBe(true)
  failure.mockRestore()
})


it('inherits native Bot defaults only for fresh conversations and preserves explicit choices during idempotent adoption', async () => {
  const { ctx, root } = await fixture(true)
  const bot = await ctx.personalProjects.createBot({ name: 'Native', defaultModel: { backend: 'codex', provider: 'codex', model: 'native-test', reasoningEffort: 'medium' } })
  const remote = createSessionTestRemote(ctx, { cwd: root, defaultModelSelection: () => ({ provider: 'missing-api', model: 'no-key' }) })
  const first = await remote.create({ botId: bot.id })
  if (!first.ok) throw first.error
  expect(ctx.agents.get(first.value.sessionId)?.options.backend).toEqual(selection)
  const explicit = await remote.create({ botId: bot.id, selection: { backend: 'codex', provider: 'codex', model: 'native-test', reasoningEffort: 'high' } })
  if (!explicit.ok) throw explicit.error
  expect(ctx.agents.get(explicit.value.sessionId)?.options.backend?.effort).toBe('high')
  await ctx.personalProjects.updateBot(bot.id, { defaultModel: { backend: 'codex', provider: 'codex', model: 'native-test', reasoningEffort: 'high' } })
  expect(await remote.create({ sessionId: first.value.sessionId, botId: bot.id })).toMatchObject({ ok: true })
  expect(ctx.agents.get(first.value.sessionId)?.options.backend).toEqual(selection)
  const handle = ctx.agents.get(first.value.sessionId)!
  await ctx.workspaceRegistry.archiveSession(first.value.sessionId)
  expect(() =>{  handle.followup(input('archived input')) }).toThrow('archived')
})


it.each(['cwd', 'model'] as const)('refuses changed native %s without a replacement thread or another send', async (field) => {
  const { ctx, root, peer } = await fixture()
  const handle = await ctx.agents.create({ sessionId: SessionId(`native-mismatch-${field}`), agentOptions: { backend: selection }, meta: { cwd: root } })
  handle.agent.followup(input('first'))
  await handle.agent.whenIdle()
  peer.threads.get('thread-1')![field] = 'changed'
  handle.agent.followup(input('must refuse'))
  await handle.agent.whenIdle()
  expect(ctx.sessionProjections.stateOf(handle.agent.session, 'codexBridge')?.status).toBe('unknown')
  expect(peer.calls.filter(call => call.method === 'turn/start')).toHaveLength(1)
  expect(peer.calls.filter(call => call.method === 'thread/start')).toHaveLength(1)
  expect(peer.children.every(child => child.exited)).toBe(true)
})

it('switches API to native and back through independent empty Sessions while preserving original history', async () => {
  const { ctx, root } = await fixture()
  const adapter = new MockAdapter([])
  ctx.llm.registerAdapter(['api'], adapter)
  const remote = createSessionTestRemote(ctx, { cwd: root, defaultModelSelection: () => ({ provider: 'api', model: 'api-model' }) })
  const api = await remote.create({ selection: { provider: 'api', model: 'api-model' } })
  if (!api.ok) throw api.error
  const source = ctx.agents.get(api.value.sessionId)!.session
  const original = source.snapshotEvents()
  const native = await remote.selectModel({ sessionId: source.id, backend: 'codex', provider: 'codex', model: 'native-test', reasoningEffort: 'medium' })
  if (!native.ok) throw native.error
  expect(native.value.sessionId).not.toBe(source.id)
  const nativeAgent = ctx.agents.get(native.value.sessionId!)!
  expect(nativeAgent.session.snapshotEvents().some(event => event.type === 'user/message')).toBe(false)
  const returned = await remote.selectModel({ sessionId: nativeAgent.id, provider: 'api', model: 'api-model' })
  if (!returned.ok) throw returned.error
  expect(returned.value.sessionId).not.toBe(nativeAgent.id)
  expect(ctx.agents.get(returned.value.sessionId!)?.options.backend).toBeUndefined()
  expect(source.snapshotEvents()).toEqual(original)
  expect(adapter.requests).toEqual([])
})

it('releases the durable writer when explicit resume selection conflicts with the log', async () => {
  const { ctx, root } = await fixture()
  const id = SessionId('native-selection-conflict')
  const first = await ctx.agents.create({ sessionId: id, agentOptions: { backend: selection }, meta: { cwd: root } })
  await first.dispose()
  await expect(ctx.agents.resume({ resumeSessionId: id, agentOptions: { backend: { ...selection, effort: 'high' } } })).rejects.toThrow('differs')
  const resumed = await ctx.agents.resume({ resumeSessionId: id })
  expect(resumed.agent.options.backend).toEqual(selection)
})


it('rejects encoded and streamed native uploads before writing attachment bytes', async () => {
  const { ctx, root } = await fixture()
  const save = vi.fn()
  ctx.provide('commands', { registerFileReceiptResolver: () => () => {} } as never)
  ctx.provide('connection', { fetch: { register: () => () => {} } } as never)
  ctx.provide('attachments', { admitEncodedFile: save, saveFileStream: save } as never)
  const uploads = new FileUploads(ctx)
  const handle = await ctx.agents.create({ sessionId: SessionId('native-upload-rejection'), agentOptions: { backend: selection }, meta: { cwd: root } })
  uploads.registerAgentResolver(async () => handle.agent)
  await expect(uploads.upload(handle.agent, { data: 'YQ==', name: 'file.txt' }, new AbortController().signal)).rejects.toMatchObject({ code: 'session/attachment-invalid' })
  await expect(uploads.uploadStream({ sessionId: handle.agent.id, data: (async function* () { yield Uint8Array.of(1) })() })).rejects.toMatchObject({ code: 'session/attachment-invalid' })
  expect(save).not.toHaveBeenCalled()
})


it('refuses native history seeds and application commands or compaction before any API work', async () => {
  const { ctx, root, peer } = await fixture()
  const handle = await ctx.agents.create({ sessionId: SessionId('native-no-api-operations'), agentOptions: { backend: selection }, meta: { cwd: root } })
  await expect(ctx.agents.create({ sessionId: SessionId('native-forged-fork'), seed: handle.agent.session.snapshotEvents(),
    inheritedEventCount: SessionLogOffset(1), meta: { cwd: root, parentSession: handle.agent.id, isSeeded: true },
  })).rejects.toThrow('cannot inherit')
  const commands = new Commands(ctx)
  const handler = vi.fn(() => ({ kind: 'success' as const }))
  commands.register({ name: 'api-operation', description: 'Fixture', handler })
  expect(await commands.execute(handle.agent, '/api-operation', [], new AbortController().signal)).toMatchObject({ result: { kind: 'error' } })
  expect(handler).not.toHaveBeenCalled()
  expect(() => BasicCompactionEngine.prototype.compactNow.call({} as never, handle.agent, new AbortController().signal)).toThrow('native context')
  await expect(BasicCompactionEngine.prototype.compactRegion.call({} as never, handle.agent.session.snapshotEvents()[0]!.seq,
    handle.agent.session.snapshotEvents()[0]!.seq, handle.agent)).rejects.toMatchObject({ code: 'unsupported-backend' })
  expect(peer.calls).toEqual([])
})


it('runs input submitted after a user stop only after the cancelled activity drains', async () => {
  const { ctx, root, peer } = await fixture()
  const handle = await ctx.agents.create({ sessionId: SessionId('native-send-after-stop'), agentOptions: { backend: selection }, meta: { cwd: root } })
  peer.hold = true
  handle.agent.followup(input('stop this'))
  await vi.waitFor(() => { expect(ctx.sessionProjections.stateOf(handle.agent.session, 'codexBridge')?.status).toBe('running') })
  handle.agent.cancel({ kind: 'user' }, { keepInbox: true })
  peer.hold = false
  handle.agent.followup(input('explicit next turn'))
  await handle.agent.whenIdle()
  expect(peer.calls.filter(call => call.method === 'turn/start')).toHaveLength(2)
  expect(ctx.sessionProjections.stateOf(handle.agent.session, 'codexBridge')?.status).toBe('completed')
  expect(peer.children.every(child => child.exited)).toBe(true)
})

it('keeps a never-dispatched thread unbound on missing login and permits explicit retry after sign-in', async () => {
  const { ctx, root, peer } = await fixture()
  const handle = await ctx.agents.create({ sessionId: SessionId('native-login-retry'), agentOptions: { backend: selection }, meta: { cwd: root } })
  peer.loggedIn = false
  handle.agent.followup(input('not sent'))
  await handle.agent.whenIdle()
  expect(ctx.sessionProjections.stateOf(handle.agent.session, 'codexBridge')?.status).toBe('unbound')
  expect(peer.calls.filter(call => call.method === 'thread/start')).toEqual([])
  peer.loggedIn = true
  handle.agent.followup(input('retry explicitly'))
  await handle.agent.whenIdle()
  expect(ctx.sessionProjections.stateOf(handle.agent.session, 'codexBridge')?.status).toBe('completed')
  expect(peer.calls.filter(call => call.method === 'turn/start')).toHaveLength(1)
})
