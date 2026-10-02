/** Loader + JSONL + native protocol composition; no login, model network or windows. */
import { mkdtemp, rm, writeFile, open } from 'node:fs/promises'
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
import Workflow from '@deepseek-ai/dsh-personal-workflow'
import Skills from '@deepseek-ai/dsh-skill'
import Questions from '@deepseek-ai/dsh-user-questions'
import Approval from '@deepseek-ai/dsh-user-approval'
import * as Method from '../../../skill/skill-dev-workflow/src/index.ts'
import { proposal, ids, phase, operation } from '../../../workspace/personal-workflow/tests/fixture.ts'
import Subprocess from '@deepseek-ai/dsh-subprocess-local'
import { JsonRpcLineTransport } from '@deepseek-ai/dsh-codex-runtime'
import type { SubprocessHandle, SubprocessOutcome, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { afterEach, expect, it, vi } from 'vitest'
import * as Codex from '../src/index.ts'
import Commands from '@deepseek-ai/dsh-commands'
import { BasicCompactionEngine } from '@deepseek-ai/dsh-compaction-basic'
import { SessionLogOffset, type SessionEventMap } from '@deepseek-ai/dsh-session'
import FileUploads from '../../../client/file-upload/src/index.ts'
import { MockAdapter } from '../../agent-loop/tests/mock-adapter.ts'
import { createSessionTestRemote } from '../../../api/session-controller/tests/test-remote.ts'
import type { SessionRequestId } from '../../../api/session-controller/src/types.ts'

const selection: AgentBackendSelection = { kind: 'codex', model: 'native-test', effort: 'medium', runtimeVersion: '0.153.4' }
const cleanup: Array<() => Promise<void>> = []
afterEach(async () => { for (const release of cleanup.splice(0).reverse()) await release() })

function native() {
  const failures: unknown[] = []
  const callbacks = new Set<Promise<void>>()
  cleanup.push(async () => { await Promise.allSettled([...callbacks]); expect(failures).toEqual([]) })
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
  let modelsAvailable = true
  let holdCatalog = false
  let threadCount = 0
  let turnCount = 0
  let onTurn: ((peer: JsonRpcLineTransport, threadId: string, turnId: string) => Promise<void>) | undefined
  let onSend: (() => Promise<void>) | undefined
  const children: Array<{ handle: SubprocessHandle; peer: JsonRpcLineTransport; exited: boolean }> = []
  const spawn = (request: SubprocessSpawnSpec): SubprocessHandle => {
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
          if (!modelsAvailable) return { data: [], nextCursor: null }
          return { data: [{ id: 'native-test', model: 'native-test', displayName: 'Native test', isDefault: true, hidden: false,
            defaultReasoningEffort: 'medium', supportedReasoningEfforts: [{ reasoningEffort: 'medium' }, { reasoningEffort: 'high' }] }], nextCursor: null }
        case 'thread/start': {
          const thread = { id: `thread-${++threadCount}`, cwd: request.cwd, model: 'native-test', cliVersion: '0.153.4', ephemeral: false, historyMode: 'legacy', turns: [] }
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
          const callback = new Promise<void>((resolve) => { setImmediate(() => {
            void (async () => {
              await onTurn?.(peer, thread.id, turn.id)
              if (!hold && !child.exited && !loseAcceptance) {
                peer.notify('item/agentMessage/delta', { threadId: thread.id, turnId: turn.id, itemId: `answer-${turn.id}`, delta: 'live ' })
                peer.notify('item/completed', { threadId: thread.id, turnId: turn.id, item: { id: `tool-${turn.id}`, type: 'commandExecution', command: 'native fixture', status: 'completed', exitCode: 0, aggregatedOutput: 'native output' } })
                complete(thread.id, turn)
              }
            })().catch((error: unknown) => { failures.push(error) }).finally(resolve)
          }) })
          callbacks.add(callback)
          void callback.finally(() => { callbacks.delete(callback) })
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
    set modelsAvailable(value: boolean) { modelsAvailable = value },
    set holdCatalog(value: boolean) { holdCatalog = value },
    set failRead(value: boolean) { failRead = value },
    set onTurn(value: typeof onTurn) { onTurn = value },
    set onSend(value: typeof onSend) { onSend = value } }
}

async function boot(root: string, peer: ReturnType<typeof native>, personal = false, workflow = false, humanTimeoutMs = 300000) {
  const configPath = join(root, 'cordis.yml')
  const modules = new Map<string, unknown>([
    ['llm', Llm], ['sessions', Sessions], ['projections', Projections], ['agents', Agents], ['tools', Tools], ['prompt', SystemPrompt],
    ['loop', AgentLoop], ['jsonl', Jsonl], ['subprocess', Subprocess], ['codex', Codex],
    ['storage', Storage], ['storage-json', StorageJson], ['domain', StorageDomain], ['workspaces', Workspaces], ['query', Query], ['personal', Personal], ['workflow', Workflow], ['skills', Skills], ['method', Method], ['questions', Questions], ['approval', Approval],
  ])
  await writeFile(configPath, [
    '- name: llm', '- name: sessions', '- name: projections', '- name: agents', '- name: tools', '- name: prompt',
    '- name: loop', '  config: { agents: [] }', '- name: jsonl', `  config: { root: ${JSON.stringify(join(root, 'sessions'))}, compression: none }`,
    ...personal ? ['- name: storage', '- name: storage-json', `  config: { root: ${JSON.stringify(join(root, 'data'))} }`,
      '- name: domain', '  config: { backend: json }', '- name: workspaces', '- name: query', '- name: personal'] : [],
    ...workflow ? ['- name: workflow', '- name: skills', '- name: method', '- name: questions', '- name: approval'] : [],
    '- name: subprocess', '- name: codex', `  config: { startupTimeoutMs: 1000, rpcTimeoutMs: 1000, turnTimeoutMs: 2000, humanTimeoutMs: ${humanTimeoutMs}, interruptTimeoutMs: 200, disposeGraceMs: 10 }`, '',
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
async function fixture(personal = false, workflow = false, humanTimeoutMs = 300000) {
  const root = await mkdtemp(join(tmpdir(), 'merforge-codex-'))
  cleanup.push(() => rm(root, { recursive: true, force: true }))
  const peer = native()
  const ctx = await boot(root, peer, personal, workflow, humanTimeoutMs)
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

it('reports empty native model discovery as unavailable and reloads it after account access changes', async () => {
  const { ctx, root, peer } = await fixture()
  const remote = createSessionTestRemote(ctx, { cwd: root, defaultModelSelection: () => ({ provider: 'missing-api', model: 'no-key' }) })
  peer.modelsAvailable = false
  const unavailable = await remote.modelCatalog()
  if (!unavailable.ok) throw unavailable.error
  expect(unavailable.value).toMatchObject({ groups: [], routableProviders: [], failures: [{ id: 'codex' }] })
  expect(unavailable.value.failures[0]?.message).toContain('no available models')
  expect(await remote.create({ selection: { backend: 'codex', provider: 'codex', model: 'native-test' } })).toMatchObject({ ok: false })
  expect(peer.calls.some(call => call.method === 'thread/start')).toBe(false)
  peer.modelsAvailable = true
  expect(await remote.modelCatalog()).toMatchObject({ ok: true, value: { groups: [{ backend: 'codex' }], failures: [] } })
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

it('keeps a Bot conversation discoverable through two Remote turns, cold reads, reopening and archive restoration without an API route', async () => {
  const { ctx, root, peer } = await fixture(true)
  const bot = await ctx.personalProjects.createBot({ name: 'Native', defaultModel: { backend: 'codex', provider: 'codex', model: 'native-test', reasoningEffort: 'high' } })
  const project = await ctx.personalProjects.createProject({ name: 'Project', path: root })
  const remote = createSessionTestRemote(ctx, { cwd: root, defaultModelSelection: () => ({ provider: 'missing-api', model: 'no-key' }) })
  const created = await remote.create({ projectId: project.id, botId: bot.id, selection: { backend: 'codex', provider: 'codex', model: 'native-test', reasoningEffort: 'medium' } })
  if (!created.ok) throw created.error
  const id = created.value.sessionId
  for (const text of ['first remote input', 'second remote input']) {
    expect(await remote.prompt({ sessionId: id, requestId: text as SessionRequestId, mode: 'queue', content: [{ type: 'text', text }] })).toMatchObject({ ok: true })
    await ctx.agents.get(id)!.whenIdle()
  }
  await ctx.fiber.dispose()
  const restarted = await boot(root, peer, true)
  const coldRemote = createSessionTestRemote(restarted, { cwd: root, defaultModelSelection: () => ({ provider: 'missing-api', model: 'no-key' }) })
  expect(restarted.agents.get(id)).toBeUndefined()
  expect(await coldRemote.list({})).toMatchObject({ ok: true, value: {
    items: [expect.objectContaining({ sessionId: id, agentAvailable: false, blank: false })],
  } })
  using observation = await restarted.sessionQuery.observeSession(id)
  expect(observation.events.filter(event => event.type === 'assistant/message')).toHaveLength(2)
  expect(Personal.fold(observation.events).current).toEqual({ projectId: project.id, botId: bot.id })
  expect(await coldRemote.prompt({ sessionId: id, requestId: 'cold third input' as SessionRequestId, mode: 'queue', content: [{ type: 'text', text: 'third' }] })).toMatchObject({ ok: true })
  const reopened = restarted.agents.get(id)!
  await reopened.whenIdle()
  expect(reopened.options.backend).toEqual(selection)
  const events = (await readStored(restarted, id)).events
  expect(events.filter(event => event.type === 'codex/turn-result')).toHaveLength(3)
  expect(peer.calls.filter(call => call.method === 'thread/start')).toHaveLength(1)
  await restarted.workspaceRegistry.archiveSession(id)
  expect(await coldRemote.prompt({ sessionId: id, requestId: 'archived' as SessionRequestId, mode: 'queue', content: [{ type: 'text', text: 'refused' }] })).toMatchObject({ ok: false })
  await restarted.workspaceRegistry.unarchiveSession(id)
  expect(await coldRemote.prompt({ sessionId: id, requestId: 'restored' as SessionRequestId, mode: 'queue', content: [{ type: 'text', text: 'restored' }] })).toMatchObject({ ok: true })
  await reopened.whenIdle()
  expect(peer.calls.filter(call => call.method === 'thread/start')).toHaveLength(1)
  expect(peer.calls.filter(call => call.method === 'turn/start')).toHaveLength(4)
  expect(peer.children.every(child => child.exited)).toBe(true)
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

it('dispatches selected task materials through real workflow admission and records Codex-reported completion without independent artifacts', async () => {
  const { ctx, root, peer } = await fixture(true, true)
  await ctx.personalWorkflow.save(proposal())
  await ctx.personalWorkflow.approve({ taskId: ids[0]!, expectedRevision: 1, operationId: operation(2) })
  const oversized = await open(join(root, 'native-large-result.bin'), 'w')
  try { await oversized.truncate(ctx.personalWorkflow.execution.limits.maxEvidenceBytes + 1) } finally { await oversized.close() }
  const handle = await ctx.agents.create({ sessionId: SessionId('native-selected-task'), agentOptions: { backend: selection }, meta: { cwd: root } })
  await ctx.personalWorkflow.execution.claim(handle.agent.session, {
    sessionId: handle.agent.id, planId: ids[0]!, taskId: ids[1]!, expectedRevision: 1, operationId: operation(3), authorization: { mode: 'manual', stopPhaseId: phase, maxActions: 2, maxTurns: 2, maxDurationMs: 100000 } })
  peer.onTurn = async (server, threadId, turnId) => {
    expect(await server.request('item/tool/call', { threadId, turnId, callId: 'complete', tool: 'workflow_complete',
      arguments: { summary: 'Native report', acceptance: ['Reported criterion met'], callIds: [] } })).toMatchObject({ success: true })
    await expect(server.request('item/tool/call', { threadId, turnId, callId: 'shell', tool: 'shell', arguments: {} })).rejects.toThrow('request rejected')
  }
  handle.agent.followup(input('Use these explicit task materials'))
  await handle.agent.whenIdle()
  const run = ctx.personalWorkflow.execution.forSession(handle.agent.id)!
  expect(run).toMatchObject({ backend: 'codex', status: 'completed', evidence: [{ reportedBy: 'codex', files: [], callIds: [] }] })
  const start = peer.calls.find(call => call.method === 'turn/start')!
  expect(JSON.stringify(start.params.input)).toContain('selected task')
  expect(JSON.stringify(start.params.input)).toContain('Use these explicit task materials')
  const stored = await readStored(ctx, handle.agent.id)
  expect(stored.events.some(event => event.type === 'codex/request')).toBe(true)
  expect(stored.events.some(event => event.type === 'codex/request-result')).toBe(true)
})

it('pauses and explicitly resumes native tasks without reading artifacts or requiring Git', async () => {
  const { ctx, root, peer } = await fixture(true, true)
  const original = proposal()
  const request = { ...original, definition: { ...original.definition,
    tasks: original.definition.tasks.map(task => ({ ...task, artifacts: [] })),
  } }
  await ctx.personalWorkflow.save(request)
  await ctx.personalWorkflow.approve({ taskId: ids[0]!, expectedRevision: 1, operationId: operation(2) })
  const handle = await ctx.agents.create({ sessionId: SessionId('native-directory-only'), agentOptions: { backend: selection }, meta: { cwd: root } })
  const claimed = await ctx.personalWorkflow.execution.claim(handle.agent.session, {
    sessionId: handle.agent.id, planId: ids[0]!, taskId: ids[1]!, expectedRevision: 1, operationId: operation(3), authorization: { mode: 'manual', stopPhaseId: phase, maxActions: 2, maxTurns: 2, maxDurationMs: 100000 } })
  handle.agent.followup(input('Begin the selected task'))
  await handle.agent.whenIdle()
  expect(ctx.personalWorkflow.execution.forSession(handle.agent.id)).toMatchObject({ status: 'paused', turnsUsed: 1, baseline: { files: [] } })
  await writeFile(join(root, 'changed-by-native.txt'), 'Native artifact')
  await ctx.personalWorkflow.execution.resume(handle.agent.session, {
    sessionId: handle.agent.id, runId: claimed.id, ownerEpoch: claimed.ownerEpoch, operationId: operation(4), reconciliation: '' })
  handle.agent.followup(input('Continue explicitly'))
  await handle.agent.whenIdle()
  expect(ctx.personalWorkflow.execution.forSession(handle.agent.id)).toMatchObject({ status: 'paused', turnsUsed: 2, startedAt: claimed.startedAt })
  expect(peer.calls.filter(call => call.method === 'thread/start')).toHaveLength(1)
  expect(peer.calls.filter(call => call.method === 'thread/resume')).toHaveLength(1)
})

it('routes assessments and proposals through the real task pipeline while keeping approval and execution human-owned', async () => {
  const { ctx, root, peer } = await fixture(true, true)
  const handle = await ctx.agents.create({ sessionId: SessionId('native-plan'), agentOptions: { backend: selection }, meta: { cwd: root } })
  await ctx.personalWorkflow.setMode(handle.agent.session, { sessionId: handle.agent.id, enabled: true,
    expectedRevision: 0, operationId: operation(5) })
  peer.onTurn = async (server, threadId, turnId) => {
    const call = (tool: string, args: object) => server.request('item/tool/call', { threadId, turnId, callId: tool, tool, arguments: args })
    expect(await call('workflow_assess', { modeRevision: 1, decision: 'complex', explanation: 'A structured goal' })).toMatchObject({ success: true })
    expect(await call('workflow_propose', { ...proposal(), modeRevision: 1 })).toMatchObject({ success: true })
  }
  handle.agent.followup(input('Plan this explicit goal'))
  await handle.agent.whenIdle()
  expect(ctx.personalWorkflow.list()).toHaveLength(1)
  expect(ctx.personalWorkflow.list()[0]?.snapshot.approval).toBeNull()
  expect(ctx.personalWorkflow.execution.forSession(handle.agent.id)).toBeNull()
  expect(JSON.stringify(peer.calls.find(call => call.method === 'thread/start')?.params.dynamicTools)).toContain('workflow_propose')
  expect(peer.calls.filter(call => call.method === 'turn/start')).toHaveLength(1)
})

it('presents native questions and one-time approvals through current scoped human services and persists their replies', async () => {
  const { ctx, root, peer } = await fixture(true, true)
  const handle = await ctx.agents.create({ sessionId: SessionId('native-human'), agentOptions: { backend: selection }, meta: { cwd: root } })
  ctx.on('user-questions/request', async (request) => {
    expect(request.agent).toBe(handle.agent)
    return { answers: [{ id: 'choice', selected: ['Yes'] }] }
  })
  ctx.on('approval/request', async (request) => {
    expect(request.agent).toBe(handle.agent)
    return 'allowed-once'
  })
  peer.onTurn = async (server, threadId, turnId) => {
    await expect(server.request('item/tool/requestUserInput', { threadId: 'wrong', turnId, itemId: 'q', isBlocking: true, questions: [] })).rejects.toThrow('request rejected')
    expect(await server.request('item/tool/requestUserInput', { threadId, turnId, itemId: 'q', isBlocking: true,
      questions: [{ id: 'choice', header: 'Choice', question: 'Proceed?', options: [{ label: 'Yes', description: 'Proceed once' }] }] })).toEqual({ answers: { choice: { answers: ['Yes'] } } })
    for (const method of ['item/commandExecution/requestApproval', 'item/fileChange/requestApproval']) {
      expect(await server.request(method, { threadId, turnId, itemId: method, startedAtMs: Date.now(), reason: 'Native action', command: 'fixture' })).toEqual({ decision: 'accept' })
    }
  }
  handle.agent.followup(input('Ask for a human decision'))
  await handle.agent.whenIdle()
  const events = (await readStored(ctx, handle.agent.id)).events
  expect(events.filter(event => event.type === 'codex/request-result').map(event => event.data.status)).toEqual(['answered', 'answered', 'answered'])
  expect(events.filter(event => event.type === 'approval/decided')).toHaveLength(2)
})

it('revokes pending native answers on stop and ignores a late human answer after the turn drains', async () => {
  const { ctx, root, peer } = await fixture(true, true)
  const handle = await ctx.agents.create({ sessionId: SessionId('native-revoked-answer'), agentOptions: { backend: selection }, meta: { cwd: root } })
  const late = Promise.withResolvers<{ answers: { id: string; selected: string[] }[] }>()
  let asked = false
  ctx.on('user-questions/request', async () => { asked = true; return late.promise })
  peer.onTurn = async (server, threadId, turnId) => {
    await expect(server.request('item/tool/requestUserInput', { threadId, turnId, itemId: 'q', isBlocking: true,
      questions: [{ id: 'q', header: 'Q', question: 'Wait?' }] })).rejects.toThrow()
  }
  handle.agent.followup(input('Wait for me'))
  await vi.waitFor(() => { expect(asked).toBe(true) })
  handle.agent.cancel({ kind: 'user' })
  await handle.agent.whenIdle()
  late.resolve({ answers: [{ id: 'q', selected: [] }] })
  const events = (await readStored(ctx, handle.agent.id)).events
  expect(events.filter(event => event.type === 'codex/request-result').map(event => event.data.status)).toEqual(['cancelled'])
  expect(peer.children.every(child => child.exited)).toBe(true)
})

it('keeps native task declarations available when enhancement is enabled after the original thread starts', async () => {
  const { ctx, root, peer } = await fixture(true, true)
  const handle = await ctx.agents.create({ sessionId: SessionId('native-mode-transition'), agentOptions: { backend: selection }, meta: { cwd: root } })
  peer.onTurn = async (server, threadId, turnId) => {
    expect(await server.request('item/tool/call', { threadId, turnId, callId: 'assessment', tool: 'workflow_assess',
      arguments: { modeRevision: 0, decision: 'complex', explanation: 'Explicit goal' } })).toMatchObject({ success: false })
  }
  handle.agent.followup(input('Ordinary conversation'))
  await handle.agent.whenIdle()
  await ctx.personalWorkflow.setMode(handle.agent.session, { sessionId: handle.agent.id, enabled: true,
    expectedRevision: 0, operationId: operation(8) })
  peer.onTurn = async (server, threadId, turnId) => {
    expect(await server.request('item/tool/call', { threadId, turnId, callId: 'assessment', tool: 'workflow_assess',
      arguments: { modeRevision: 1, decision: 'complex', explanation: 'Explicit goal' } })).toMatchObject({ success: true })
  }
  handle.agent.followup(input('Plan after enabling enhancement'))
  await handle.agent.whenIdle()
  expect(peer.calls.filter(call => call.method === 'thread/start')).toHaveLength(1)
  expect(peer.calls.filter(call => call.method === 'thread/resume')).toHaveLength(1)
  expect(JSON.stringify(peer.calls.find(call => call.method === 'thread/start')?.params.dynamicTools)).toContain('workflow_assess')
})

it('retains ordinary legacy threads and refuses task context when their original declarations are unavailable', async () => {
  const { ctx, root, peer } = await fixture(true, true)
  const handle = await ctx.agents.create({ sessionId: SessionId('native-legacy-tools'), agentOptions: { backend: selection }, meta: { cwd: root } })
  const append = handle.agent.session.append.bind(handle.agent.session)
  const legacy = vi.spyOn(handle.agent.session, 'append').mockImplementation((type, data, options) => {
    if (type === 'codex/thread-bound') {
      const { dynamicTools: _tools, ...binding } = data as SessionEventMap['codex/thread-bound']
      return append('codex/thread-bound', binding, options)
    }
    return append(type, data, options)
  })
  handle.agent.followup(input('Existing ordinary thread'))
  await handle.agent.whenIdle()
  legacy.mockRestore()
  handle.agent.followup(input('Continue ordinary conversation'))
  await handle.agent.whenIdle()
  await ctx.personalWorkflow.setMode(handle.agent.session, { sessionId: handle.agent.id, enabled: true,
    expectedRevision: 0, operationId: operation(9) })
  const errors: string[] = []
  ctx.on('agent/error', ({ error }) => { errors.push(String(error)) })
  handle.agent.followup(input('Enable planning'))
  await handle.agent.whenIdle()
  expect(errors).toEqual([expect.stringContaining('create a new conversation')])
  expect(peer.calls.filter(call => call.method === 'turn/start')).toHaveLength(2)
  expect(peer.calls.filter(call => call.method === 'thread/start')).toHaveLength(1)
  expect((await readStored(ctx, handle.agent.id)).events.filter(event => event.type === 'assistant/message')).toHaveLength(2)
})

it.each(['timeout', 'provider-unload'] as const)('drains pending native questions on %s before closing the Session turn', async (reason) => {
  const { ctx, root, peer } = await fixture(true, true, reason === 'timeout' ? 100 : 300000)
  const handle = await ctx.agents.create({ sessionId: SessionId(`native-human-${reason}`), agentOptions: { backend: selection }, meta: { cwd: root } })
  const late = Promise.withResolvers<{ answers: { id: string; selected: string[] }[] }>()
  let asked = false
  ctx.on('user-questions/request', async () => { asked = true; return late.promise })
  peer.onTurn = async (server, threadId, turnId) => {
    await expect(server.request('item/tool/requestUserInput', { threadId, turnId, itemId: 'q', isBlocking: true,
      questions: [{ id: 'q', header: 'Q', question: 'Wait?' }] })).rejects.toThrow()
  }
  handle.agent.followup(input('Pending human answer'))
  await vi.waitFor(() => { expect(asked).toBe(true) })
  if (reason === 'provider-unload') await [...ctx.loader.entries()].find(entry => entry.options.name === 'codex')!.fiber!.dispose()
  else await handle.agent.whenIdle()
  late.resolve({ answers: [{ id: 'q', selected: [] }] })
  const events = (await readStored(ctx, handle.agent.id)).events
  const result = events.findIndex(event => event.type === 'codex/request-result')
  expect(result).toBeGreaterThan(0)
  expect(events[result]).toMatchObject({ data: { status: 'cancelled' } })
  expect(events.findIndex(event => event.type === 'turn/end')).toBeGreaterThan(result)
  expect(peer.children.every(child => child.exited)).toBe(true)
})
