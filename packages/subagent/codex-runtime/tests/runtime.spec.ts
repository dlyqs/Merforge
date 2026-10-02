import { PassThrough, Writable } from 'node:stream'
import { brandString } from '@deepseek-ai/dsh-brand'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SubprocessHandle, SubprocessOutcome } from '@deepseek-ai/dsh-subprocess'
import {
  JsonRpcLineTransport, openCodexRuntime, type CodexRuntime, type CodexRuntimeSpec,
  type CodexRuntimeLimits, type CodexThreadId, type CodexInputId, type CodexTurnEvent,
} from '../src/index.ts'

const limits: CodexRuntimeLimits = { startupTimeoutMs: 500, rpcTimeoutMs: 500, turnTimeoutMs: 1000,
  interruptTimeoutMs: 20, disposeGraceMs: 10, maxFrameBytes: 65536, maxEarlyEvents: 10, maxTurnBytes: 65536,
  humanTimeoutMs: 1000, modelCacheMs: 1000, modelPageSize: 2, maxModelPages: 4 }
const selection = { mode: 'native', model: 'native-test', effort: 'medium' } as const
const threadId = brandString<CodexThreadId>('thread-1')
const inputId = brandString<CodexInputId>('input-1')
const model = { id: 'native-test', model: 'native-test', displayName: 'Native test', description: 'fixture', hidden: false, isDefault: true,
  defaultReasoningEffort: 'medium', supportedReasoningEfforts: [{ reasoningEffort: 'medium', description: 'fixture' }] }
const thread = { id: threadId, cwd: process.cwd(), model: model.model, cliVersion: '0.153.4', ephemeral: false, historyMode: 'legacy', turns: [] }
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })

function harness(overrides: Partial<CodexRuntimeLimits> = {}) {
  const input = new PassThrough()
  const output = new PassThrough()
  const stderr = new PassThrough()
  const done = Promise.withResolvers<SubprocessOutcome>()
  const calls: Array<{ method: string; params: Record<string, unknown> }> = []
  const peer = new JsonRpcLineTransport(output, input)
  let handler: ((method: string, params: Record<string, unknown>) => Promise<unknown>) | undefined
  let turn = 0
  let terminated = false
  const child: SubprocessHandle = { stdin: output, stdout: input, stderr, control: undefined, collected: {}, done: done.promise,
    terminate() { terminated = true; peer.close(); done.resolve({ exitCode: 0, signal: null }) },
    async waitForExit() { await done.promise; return true } }
  peer.onRequest(async (method, params) => {
    calls.push({ method, params })
    if (handler !== undefined) return handler(method, params)
    switch (method) {
      case 'initialize': return { userAgent: 'codex-cli 0.153.4', platformFamily: 'unix', platformOs: 'macos', codexHome: '/private/native-home' }
      case 'account/read': return { account: { type: 'chatgpt', email: 'secret@example.test', planType: 'secret-plan', accessToken: 'secret-token' }, requiresOpenaiAuth: true }
      case 'model/list': return { data: params.cursor === null ? [model] : [], nextCursor: params.cursor === null ? 'second' : null }
      case 'thread/start': case 'thread/read': case 'thread/resume': return { thread }
      case 'turn/start': return { turn: { id: `turn-${++turn}`, status: 'inProgress', items: [] } }
      case 'turn/interrupt':
        peer.notify('turn/completed', { threadId, turn: { id: params.turnId, status: 'interrupted', items: [] } })
        return {}
      default: throw new Error('unsupported fake client request')
    }
  })
  peer.start()
  const spec: CodexRuntimeSpec = { cwd: process.cwd(), env: {}, limits: { ...limits, ...overrides },
    experimentalApi: true, spawn: () => child }
  cleanups.push(async () => { peer.close(); child.terminate(); input.destroy(); output.destroy(); stderr.destroy() })
  return { spec, calls, peer, input, output, done, child,
    get terminated() { return terminated }, set handler(value: typeof handler) { handler = value } }
}
async function ready(h: ReturnType<typeof harness>): Promise<CodexRuntime> {
  const runtime = await openCodexRuntime(h.spec)
  cleanups.push(() => runtime.dispose())
  return runtime
}
function complete(h: ReturnType<typeof harness>, id: string, text = 'answer') {
  h.peer.notify('turn/completed', { threadId, turn: { id, status: 'completed', items: text ? [{ id: `item-${id}`, type: 'agentMessage', phase: 'final_answer', text }] : [] } })
}

describe('persistent Codex runtime', () => {
  it('handshakes before RPC, redacts account fields and caches complete model pagination', async () => {
    const h = harness(); const runtime = await ready(h)
    const snapshot = await runtime.catalog()
    expect(h.calls[0]).toMatchObject({ method: 'initialize', params: { capabilities: { experimentalApi: true, requestAttestation: false } } })
    expect(snapshot.account).toEqual({ kind: 'chatgpt', requiresOpenaiAuth: true })
    expect(JSON.stringify(snapshot)).not.toMatch(/secret|@|home/)
    expect(snapshot.models[0]?.efforts).toEqual(['medium'])
    expect(h.calls.filter(c => c.method === 'model/list').map(c => c.params.cursor)).toEqual([null, 'second'])
    await runtime.catalog()
    expect(h.calls.filter(c => c.method === 'account/read')).toHaveLength(1)
    h.peer.notify('account/updated', {})
    await runtime.catalog()
    expect(h.calls.filter(c => c.method === 'account/read')).toHaveLength(2)
  })

  it('rejects controlled/organization modes before creating any native thread', async () => {
    const h = harness(); const runtime = await ready(h)
    for (const mode of ['controlled', 'organization'] as const) await expect(runtime.startThread({ ...selection, mode })).rejects.toThrow('unsupported execution mode')
    expect(h.calls.some(c => c.method === 'thread/start')).toBe(false)
    expect(runtime.capabilities.organizationExecution).toBe(false)
  })

  it('persists intent before sending once, filters old turns and retains two-round receipts', async () => {
    const h = harness(); const runtime = await ready(h); await runtime.startThread(selection)
    const gate = Promise.withResolvers<undefined>()
    const persist = vi.fn(async () => { await gate.promise })
    const events: CodexTurnEvent[] = []
    const sending = runtime.send({ inputId, texts: ['first'], persistIntent: persist }, (event) => { events.push(event) })
    expect(h.calls.some(c => c.method === 'turn/start')).toBe(false)
    await expect(runtime.send({ inputId, texts: ['concurrent'], persistIntent: async () => {} })).rejects.toThrow('protocol')
    gate.resolve(undefined)
    const first = await sending
    expect(persist.mock.calls).toHaveLength(1)
    expect(h.calls.at(-1)).toMatchObject({ method: 'turn/start', params: { clientUserMessageId: inputId, effort: 'medium' } })
    complete(h, 'old-turn', 'wrong')
    h.peer.notify('item/agentMessage/delta', { threadId, turnId: first.turnId, itemId: 'item-1', delta: 'live' })
    complete(h, first.turnId)
    expect(await first.terminal).toMatchObject({ status: 'completed', finalText: 'answer', usage: 'unknown' })
    expect(events).toEqual([{ type: 'text-delta', turnId: first.turnId, itemId: 'item-1', text: 'live' }])
    const second = await runtime.send({ inputId: brandString<CodexInputId>('input-2'), texts: ['second'], persistIntent: async () => {} })
    complete(h, first.turnId, 'late')
    complete(h, second.turnId, '')
    expect(await second.terminal).toMatchObject({ status: 'completed', finalText: null })
    expect(h.calls.filter(c => c.method === 'thread/start')).toHaveLength(1)
  })

  it('does not send when durable persistence fails or stop retires a pending persistence', async () => {
    const h = harness(); const runtime = await ready(h); await runtime.startThread(selection)
    await expect(runtime.send({ inputId, texts: ['input'], persistIntent: async () => { throw new Error('disk-failed') } })).rejects.toThrow('disk-failed')
    const gate = Promise.withResolvers<undefined>()
    const pending = runtime.send({ inputId, texts: ['input'], persistIntent: async () => { await gate.promise } })
    await runtime.stop(); gate.resolve(undefined)
    await expect(pending).rejects.toThrow('closed')
    expect(h.calls.some(c => c.method === 'turn/start')).toBe(false)
  })

  it('accepts response-before-terminal and terminal-before-response using exact turn IDs', async () => {
    const h = harness(); const runtime = await ready(h); await runtime.startThread(selection)
    h.handler = async (method) => {
      expect(method).toBe('turn/start')
      complete(h, 'old', 'wrong')
      complete(h, 'early', 'correct')
      return { turn: { id: 'early', status: 'inProgress', items: [] } }
    }
    const receipt = await runtime.send({ inputId, texts: ['input'], persistIntent: async () => {} })
    expect(await receipt.terminal).toMatchObject({ turnId: 'early', finalText: 'correct' })
  })

  it('keeps sends unknown after response loss and disposes without retry or a replacement thread', async () => {
    const h = harness({ rpcTimeoutMs: 15 }); const runtime = await ready(h); await runtime.startThread(selection)
    h.handler = async () => new Promise(() => {})
    await expect(runtime.send({ inputId, texts: ['input'], persistIntent: async () => {} })).rejects.toThrow('unknown-send')
    await runtime.dispose()
    await expect(runtime.send({ inputId, texts: ['again'], persistIntent: async () => {} })).rejects.toThrow('timeout')
    expect(h.calls.filter(c => c.method === 'turn/start')).toHaveLength(1)
    expect(h.terminated).toBe(true)
    expect(h.input.listenerCount('data')).toBe(0)
  })

  it('interrupts before managed-range teardown and preserves terminal versus cleanup outcomes', async () => {
    const h = harness(); const runtime = await ready(h); await runtime.startThread(selection)
    const receipt = await runtime.send({ inputId, texts: ['input'], persistIntent: async () => {} })
    await runtime.stop()
    expect(await receipt.terminal).toMatchObject({ status: 'interrupted' })
    expect(h.calls.at(-1)?.method).toBe('turn/interrupt')
    expect(h.terminated).toBe(true)
  })

  it('awaits owned range exit when interrupt never returns', async () => {
    const h = harness(); const runtime = await ready(h); await runtime.startThread(selection)
    const receipt = await runtime.send({ inputId, texts: ['input'], persistIntent: async () => {} })
    h.handler = async () => new Promise(() => {})
    await runtime.stop()
    await expect(receipt.terminal).rejects.toThrow()
    expect(h.terminated).toBe(true)
  })

  it('reads and verifies original binding before resume, never creates a fallback thread', async () => {
    const h = harness(); const runtime = await ready(h)
    await runtime.resumeThread(threadId, selection)
    expect(h.calls.filter(c => c.method.startsWith('thread/')).map(c => c.method)).toEqual(['thread/read', 'thread/resume'])
    expect(h.calls.at(-1)?.params).not.toHaveProperty('path')
    expect(h.calls.at(-1)?.params).not.toHaveProperty('history')
  })

  it('ignores streamed resume history and duplicate old terminal notifications while the next turn is still running', async () => {
    const h = harness(), runtime = await ready(h)
    h.handler = async (method) => {
      if (method === 'account/read') return { account: null, requiresOpenaiAuth: false }
      if (method === 'model/list') return { data: [model], nextCursor: null }
      h.peer.notify('item/agentMessage/delta', { threadId, turnId: 'historic', itemId: 'historic-item', delta: 'private old output' })
      complete(h, 'historic', 'private old answer')
      return { thread }
    }
    await runtime.resumeThread(threadId, selection)
    h.handler = undefined
    const events: CodexTurnEvent[] = []
    const first = await runtime.send({ inputId, texts: ['first'], persistIntent: async () => {} }, (event) => { events.push(event) })
    complete(h, first.turnId)
    expect(await first.terminal).toMatchObject({ status: 'completed', finalText: 'answer' })
    const second = await runtime.send({ inputId: brandString<CodexInputId>('next-input'), texts: ['next'], persistIntent: async () => {} }, (event) => { events.push(event) })
    let settled = false
    void second.terminal.then(() => { settled = true })
    complete(h, first.turnId, 'duplicate answer')
    h.peer.notify('turn/completed', { threadId, turn: { id: first.turnId, status: 'interrupted', items: [] } })
    h.peer.notify('item/agentMessage/delta', { threadId, turnId: 'historic', itemId: 'historic-item', delta: 'late old output' })
    await new Promise<void>((resolve) => { setImmediate(resolve) })
    expect(settled).toBe(false)
    expect(events).toEqual([])
    complete(h, second.turnId, 'current answer')
    expect(await second.terminal).toMatchObject({ status: 'completed', finalText: 'current answer' })
    expect(h.calls.filter(call => call.method === 'turn/start')).toHaveLength(2)
    expect(h.calls.some(call => call.method === 'thread/start')).toBe(false)
  })

  it('rejects foreign cwd and incomplete native history on resume', async () => {
    for (const invalid of [{ ...thread, cwd: '/foreign' }, { ...thread, historyMode: 'paginated' },
      { ...thread, turns: [{ id: 't', status: 'completed', items: [], itemsView: 'summary' }] },
      { ...thread, turns: [{ id: 't', status: 'inProgress', items: [] }] }]) {
      const h = harness(); const runtime = await ready(h)
      h.handler = async method => method === 'account/read' ? { account: null, requiresOpenaiAuth: false }
        : method === 'model/list' ? { data: [model], nextCursor: null } : { thread: invalid }
      await expect(runtime.resumeThread(threadId, selection)).rejects.toThrow()
      expect(h.calls.some(c => c.method === 'thread/resume' || c.method === 'thread/start')).toBe(false)
    }
  })

  it.each(['turnsBackwardsCursor', 'itemsBackwardsCursor', 'initialTurnsPage'])(
    'retires a paginated resume response with %s without sending or creating a replacement', async (field) => {
      const h = harness(); const runtime = await ready(h)
      h.handler = async method => method === 'account/read' ? { account: null, requiresOpenaiAuth: false }
        : method === 'model/list' ? { data: [model], nextCursor: null }
          : method === 'thread/resume' ? { thread, [field]: field === 'initialTurnsPage' ? { data: [] } : 'cursor' }
            : { thread }
      await expect(runtime.resumeThread(threadId, selection)).rejects.toThrow('unknown-thread')
      await expect(runtime.send({ inputId, texts: ['input'], persistIntent: async () => {} })).rejects.toThrow('unknown-thread')
      expect(h.calls.filter(c => c.method.startsWith('thread/')).map(c => c.method))
        .toEqual(['thread/read', 'thread/resume'])
      expect(h.calls.some(c => c.method === 'turn/start')).toBe(false)
      await runtime.dispose()
      expect(h.terminated).toBe(true)
    },
  )

  it('safely rejects unknown server requests while preserving current-turn settlement', async () => {
    const h = harness(); const runtime = await ready(h); await runtime.startThread(selection)
    await expect(h.peer.request('untrusted-/private-secret', {})).rejects.toThrow('request rejected')
    const receipt = await runtime.send({ inputId, texts: ['input'], persistIntent: async () => {} })
    complete(h, receipt.turnId)
    expect(await receipt.terminal).toMatchObject({ status: 'completed' })
  })

  it('contains event observer failures and diagnoses EOF independently of successful terminal', async () => {
    const h = harness(); const runtime = await ready(h); await runtime.startThread(selection)
    const receipt = await runtime.send({ inputId, texts: ['input'], persistIntent: async () => {} }, () => { throw new Error('observer-broke') })
    h.peer.notify('item/agentMessage/delta', { threadId, turnId: receipt.turnId, itemId: 'item', delta: 'live' })
    complete(h, receipt.turnId)
    h.input.end()
    expect(await receipt.terminal).toMatchObject({ status: 'completed' })
    await runtime.dispose()
  })

  it('rejects EOF and process failure before terminal with safe categories', async () => {
    for (const event of ['eof', 'process'] as const) {
      const h = harness(); const runtime = await ready(h); await runtime.startThread(selection)
      const receipt = await runtime.send({ inputId, texts: ['input'], persistIntent: async () => {} })
      if (event === 'eof') h.input.end(); else h.done.resolve({ exitCode: 7, signal: null })
      await expect(receipt.terminal).rejects.toMatchObject({ category: event })
      await runtime.dispose()
    }
  })

  it('rejects malformed or oversized protocol frames and invalid model pagination', async () => {
    for (const frame of ['not-json\n', `${'a'.repeat(65537)}\n`]) {
      const h = harness(); const runtime = await ready(h)
      const catalog = runtime.catalog(); h.input.write(frame)
      await expect(catalog).rejects.toThrow()
      await runtime.dispose()
    }
    const h = harness(); const runtime = await ready(h)
    h.handler = async method => method === 'account/read' ? { account: null, requiresOpenaiAuth: false }
      : { data: [model], nextCursor: 'repeat' }
    await expect(runtime.catalog()).rejects.toThrow('protocol')
    expect(h.calls.filter(c => c.method === 'model/list')).toHaveLength(2)
  })

  it('invalidates availability on authentication errors instead of retaining cached models', async () => {
    const h = harness(); const runtime = await ready(h); await runtime.catalog()
    h.handler = async () => { throw new Error('secret-token account auth failed') }
    await expect(runtime.catalog(true)).rejects.toThrow('rpc')
    await expect(runtime.catalog()).rejects.toThrow('rpc')
    expect(h.calls.filter(c => c.method === 'account/read')).toHaveLength(3)
  })
  it('rejects unpublished spawn, missing pipes, timeout and pre-abort with owned rollback', async () => {
    const aborted = harness()
    const spawn = vi.fn(aborted.spec.spawn)
    await expect(openCodexRuntime({ ...aborted.spec, spawn }, AbortSignal.abort())).rejects.toThrow('closed')
    expect(spawn).not.toHaveBeenCalled()
    await expect(openCodexRuntime({ ...aborted.spec, spawn: () => { throw new Error('/private/secret-token') } }))
      .rejects.toMatchObject({ message: 'codex-runtime: startup' })
    const missing = harness()
    await expect(openCodexRuntime({ ...missing.spec, spawn: () => ({ ...missing.child, stdout: undefined }) })).rejects.toThrow('startup')
    expect(missing.terminated).toBe(true)
    const stalled = harness({ startupTimeoutMs: 10 })
    stalled.handler = async () => new Promise(() => {})
    await expect(openCodexRuntime(stalled.spec)).rejects.toThrow('timeout')
    expect(stalled.terminated).toBe(true)
  })

  it('bounds early events and the complete terminal value, with timeout cleanup for missing terminals', async () => {
    for (const kind of ['early', 'result', 'timeout'] as const) {
      const h = harness(kind === 'early' ? { maxEarlyEvents: 1 } : kind === 'result' ? { maxTurnBytes: 1 } : { turnTimeoutMs: 10 })
      const runtime = await ready(h); await runtime.startThread(selection)
      if (kind === 'early') {
        h.handler = async () => { complete(h, 'early'); complete(h, 'early'); return { turn: { id: 'early' } } }
        await expect(runtime.send({ inputId, texts: ['input'], persistIntent: async () => {} })).rejects.toThrow('unknown-send')
      } else {
        const receipt = await runtime.send({ inputId, texts: ['input'], persistIntent: async () => {} })
        if (kind === 'result') complete(h, receipt.turnId)
        await expect(receipt.terminal).rejects.toMatchObject({ category: kind === 'result' ? 'frame-limit' : 'timeout' })
      }
      await runtime.dispose()
      expect(h.terminated).toBe(true)
    }
  })

  it('invalidates cached availability when the authoritative turn fails', async () => {
    const h = harness(); const runtime = await ready(h); await runtime.startThread(selection)
    const receipt = await runtime.send({ inputId, texts: ['input'], persistIntent: async () => {} })
    h.peer.notify('turn/completed', { threadId, turn: { id: receipt.turnId, status: 'failed', items: [],
      error: { codexErrorInfo: 'usageLimitExceeded', message: 'private-native-error' } } })
    expect(await receipt.terminal).toMatchObject({ status: 'failed', finalText: null })
    await runtime.catalog()
    expect(h.calls.filter(c => c.method === 'account/read')).toHaveLength(2)
  })

  it('bounds and cancels the initialized write barrier before publishing readiness', async () => {
    for (const cancel of [false, true]) {
      const h = harness({ startupTimeoutMs: cancel ? 1000 : 15 })
      const flushing = Promise.withResolvers<undefined>()
      const output = new Writable({ write(chunk: Buffer, _encoding, callback) {
        if (chunk.length === 0) { flushing.resolve(undefined); return }
        h.output.write(chunk); callback()
      } })
      const controller = new AbortController()
      const starting = openCodexRuntime({ ...h.spec, spawn: () => ({ ...h.child, stdin: output }) }, controller.signal)
      await flushing.promise
      if (cancel) controller.abort()
      await expect(starting).rejects.toThrow(cancel ? 'closed' : 'timeout')
      expect(h.terminated).toBe(true)
      output.destroy()
    }
  })

  it('retires a thread mutation with an unknown response and emits only safe lifecycle facts', async () => {
    const h = harness()
    const diagnostics: object[] = []
    const runtime = await openCodexRuntime({ ...h.spec, onDiagnostic: (diagnostic) => { diagnostics.push(diagnostic) } })
    cleanups.push(() => runtime.dispose())
    h.handler = async method => method === 'account/read' ? { account: null, requiresOpenaiAuth: false }
      : method === 'model/list' ? { data: [model], nextCursor: null } : { thread: { ...thread, model: 'fallback' } }
    await expect(runtime.startThread(selection)).rejects.toThrow('unknown-thread')
    await expect(runtime.startThread(selection)).rejects.toThrow('unknown-thread')
    await runtime.dispose()
    expect(h.calls.filter(c => c.method === 'thread/start')).toHaveLength(1)
    expect(diagnostics).toContainEqual({ stage: 'error', category: 'unknown-thread' })
    expect(JSON.stringify(diagnostics)).not.toMatch(/secret|email|fixture|thread-1|native-test|home/)
  })

  it('requires explicit experimental negotiation for pinned persistent-history and no-fallback fields', async () => {
    const h = harness()
    const runtime = await openCodexRuntime({ ...h.spec, experimentalApi: false })
    cleanups.push(() => runtime.dispose())
    expect(runtime.capabilities.persistentText).toBe(false)
    await expect(runtime.startThread(selection)).rejects.toThrow('persistent threads require experimental negotiation')
    expect(h.calls.some(c => c.method === 'thread/start')).toBe(false)
  })

})

it('accepts only pinned callbacks for the current turn, including callbacks before the turn receipt', async () => {
  const h = harness()
  const received: string[] = []
  const runtime = await openCodexRuntime({ ...h.spec, onRequest: async (request) => {
    received.push(String(request.params.callId))
    return { success: true, contentItems: [] }
  }, dynamicTools: [{ type: 'function', name: 'workflow_assess', description: 'Assess task', inputSchema: {} }] })
  cleanups.push(() => runtime.dispose())
  await runtime.startThread(selection)
  let early: Promise<unknown> | undefined
  h.handler = async (method) => {
    expect(method).toBe('turn/start')
    early = h.peer.request('item/tool/call', { threadId, turnId: 'early-turn', callId: 'early', tool: 'workflow_assess', arguments: {} })
    return { turn: { id: 'early-turn', status: 'inProgress', items: [] } }
  }
  const receipt = await runtime.send({ inputId, texts: ['task'], persistIntent: async () => {} })
  expect(await early).toEqual({ success: true, contentItems: [] })
  await expect(h.peer.request('item/tool/call', { threadId, turnId: receipt.turnId, callId: 'early', tool: 'workflow_assess', arguments: {} })).rejects.toThrow('request rejected')
  await expect(h.peer.request('item/tool/call', { threadId, turnId: 'old-turn', callId: 'old', tool: 'workflow_assess', arguments: {} })).rejects.toThrow('request rejected')
  await expect(h.peer.request('unsupported/request', { threadId, turnId: receipt.turnId })).rejects.toThrow('request rejected')
  expect(received).toEqual(['early'])
  expect(h.calls.find(call => call.method === 'thread/start')?.params).toMatchObject({ approvalPolicy: 'on-request', dynamicTools: [{ name: 'workflow_assess' }] })
  complete(h, receipt.turnId)
  await receipt.terminal
  await expect(h.peer.request('item/tool/call', { threadId, turnId: receipt.turnId, callId: 'late', tool: 'workflow_assess', arguments: {} })).rejects.toThrow('request rejected')
  expect(received).toEqual(['early'])
})

it('rejects reused RPC identities while draining an admitted callback exactly once', async () => {
  const h = harness()
  const gate = Promise.withResolvers<unknown>()
  const handle = vi.fn(async () => gate.promise)
  const runtime = await openCodexRuntime({ ...h.spec, onRequest: handle })
  cleanups.push(() => runtime.dispose())
  await runtime.startThread(selection)
  const receipt = await runtime.send({ inputId, texts: ['task'], persistIntent: async () => {} })
  const responses: Array<Record<string, unknown>> = []
  h.output.on('data', (chunk) => {
    for (const line of String(chunk).trim().split('\n')) {
      const frame = JSON.parse(line) as Record<string, unknown>
      if (frame.id === 42) responses.push(frame)
    }
  })
  const request = { jsonrpc: '2.0', id: 42, method: 'item/tool/requestUserInput', params: { threadId, turnId: receipt.turnId } }
  h.input.write(JSON.stringify(request) + '\n' + JSON.stringify(request) + '\n')
  await vi.waitFor(() => { expect(responses).toHaveLength(1) })
  expect(responses[0]?.error).toEqual({ code: -32603, message: 'request rejected' })
  gate.resolve({ answers: {} })
  await vi.waitFor(() => { expect(responses).toHaveLength(2) })
  expect(responses[1]?.result).toEqual({ answers: {} })
  expect(handle).toHaveBeenCalledOnce()
  complete(h, receipt.turnId)
  await receipt.terminal
})

it('revokes timed-out callbacks and awaits their cancellation before returning from disposal', async () => {
  const h = harness({ humanTimeoutMs: 30 })
  let cancelled = false
  const runtime = await openCodexRuntime({ ...h.spec, onRequest: async (_request, signal) => {
    await new Promise<void>((resolve) => { signal.addEventListener('abort', () =>{  resolve() }, { once: true }) })
    cancelled = true
    throw new Error('private callback detail')
  } })
  cleanups.push(() => runtime.dispose())
  await runtime.startThread(selection)
  const receipt = await runtime.send({ inputId, texts: ['task'], persistIntent: async () => {} })
  const callback = h.peer.request('item/tool/requestUserInput', { threadId, turnId: receipt.turnId }).catch(() => 'rejected')
  await expect(receipt.terminal).rejects.toMatchObject({ category: 'timeout' })
  await runtime.dispose()
  expect(await callback).toBe('rejected')
  expect(cancelled).toBe(true)
  expect(h.terminated).toBe(true)
})
