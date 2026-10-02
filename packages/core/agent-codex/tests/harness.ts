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
import Workflow from '@deepseek-ai/dsh-personal-workflow'
import Skills from '@deepseek-ai/dsh-skill'
import Questions from '@deepseek-ai/dsh-user-questions'
import Approval from '@deepseek-ai/dsh-user-approval'
import * as Method from '../../../skill/skill-dev-workflow/src/index.ts'
import Subprocess from '@deepseek-ai/dsh-subprocess-local'
import { JsonRpcLineTransport } from '@deepseek-ai/dsh-codex-runtime'
import type { SubprocessHandle, SubprocessOutcome, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { afterEach, expect, vi } from 'vitest'
import * as Codex from '../src/index.ts'

export const selection: AgentBackendSelection = { kind: 'codex', model: 'native-test', effort: 'medium', runtimeVersion: '0.153.4' }
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

export async function boot(
  root: string, peer: ReturnType<typeof native>, personal = false, workflow = false,
  humanTimeoutMs = 300000, loginTimeoutMs = 300000,
) {
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
    '- name: subprocess', '- name: codex', `  config: { startupTimeoutMs: 1000, rpcTimeoutMs: 1000, turnTimeoutMs: 2000, humanTimeoutMs: ${humanTimeoutMs}, loginTimeoutMs: ${loginTimeoutMs}, interruptTimeoutMs: 200, disposeGraceMs: 10 }`, '',
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
export async function fixture(personal = false, workflow = false, humanTimeoutMs = 300000, loginTimeoutMs = 300000) {
  const root = await mkdtemp(join(tmpdir(), 'merforge-codex-'))
  cleanup.push(() => rm(root, { recursive: true, force: true }))
  const peer = native()
  const ctx = await boot(root, peer, personal, workflow, humanTimeoutMs, loginTimeoutMs)
  return { ctx, root, peer }
}
export async function readStored(ctx: Context, id: ReturnType<typeof SessionId>) {
  await using handle = await ctx.sessionPersistence.open(id, 'read')
  return await handle.read()
}
export function input(text: string) { return createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }) }
