/** Desktop observation ordering and owner-grant lifetime without a window. */
import { describe, expect, it, vi } from 'vitest'
import type { CodexSetupDesktopBridge, CodexSetupSnapshot, CodexSetupView, CodexSetupAttemptId } from '@deepseek-ai/dsh-agent-codex/setup-types'
import { CodexSetupSource } from '../src/client/codex-source.ts'

function snapshot(revision = 1, login: CodexSetupSnapshot['login'] = { status: 'idle' }): CodexSetupSnapshot {
  return { revision, runtime: { version: '0.153.4', status: 'ready' }, account: { status: 'known', value: { kind: 'none', requiresOpenaiAuth: true } }, catalog: { status: 'error', models: [], category: 'login-required' }, login }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => { resolve = r })
  return { promise, resolve }
}
function bench(report?: ConstructorParameters<typeof CodexSetupSource>[1]) {
  let listener!: (value: CodexSetupSnapshot) => void
  const device = { attemptId: 'attempt-one' as CodexSetupAttemptId, userCode: 'SHORT-CODE' }
  const waiting: CodexSetupView = { snapshot: snapshot(2, { status: 'waiting' }), device }
  const off = vi.fn()
  const bridge = {
    subscribe: (fn) => { listener = fn; return off },
    snapshot: vi.fn(async () => waiting),
    detect: vi.fn(async () => ({ snapshot: snapshot() })),
    start: vi.fn(async () => waiting),
    cancel: vi.fn(async () => ({ snapshot: snapshot(3, { status: 'cancelled', cancellation: 'unconfirmed', cleanup: 'done' }) })),
    openVerification: vi.fn(async () => {}),
  } satisfies CodexSetupDesktopBridge
  const source = new CodexSetupSource(bridge, report)
  return { source, bridge, waiting, off, send: (value: CodexSetupSnapshot) => { listener(value) } }
}
describe('Codex setup observation', () => {
  it('joins repeated gestures, retains owner state on remount and uses only the current ID', async () => {
    const b = bench()
    const pending = deferred<CodexSetupView>()
    vi.mocked(b.bridge.start).mockReturnValue(pending.promise)
    const started = b.source.start()
    await b.source.start()
    expect(b.bridge.start).toHaveBeenCalledTimes(1)
    pending.resolve(b.waiting)
    await started
    await b.source.copy(async (code) => { expect(code).toBe('SHORT-CODE') })
    expect(b.source.store.getSnapshot().copied).toBe(true)
    await b.source.openVerification()
    expect(b.bridge.openVerification).toHaveBeenCalledWith(b.waiting.device!.attemptId)
    await b.source.cancel()
    expect(b.bridge.cancel).toHaveBeenCalledWith(b.waiting.device!.attemptId)
    expect(b.source.store.getSnapshot().view?.device).toBeUndefined()
    expect(b.source.store.getSnapshot().view?.snapshot.login.cancellation).toBe('unconfirmed')
    b.source.dispose()
    expect(b.off).toHaveBeenCalledOnce()
  })
  it('does not allow a late detection or owner reply to restore a code after completion', async () => {
    const b = bench()
    const pending = deferred<CodexSetupView>()
    vi.mocked(b.bridge.detect).mockReturnValue(pending.promise)
    const detect = b.source.detect()
    b.send(snapshot(9, { status: 'succeeded' }))
    pending.resolve(b.waiting)
    await detect
    b.send(snapshot(2, { status: 'waiting' }))
    expect(b.source.store.getSnapshot().view?.snapshot.login.status).toBe('succeeded')
    expect(b.source.store.getSnapshot().view?.device).toBeUndefined()
    b.source.dispose()
  })
  it('invalidates the Host generation before accepting a replacement Host with lower revisions', async () => {
    const b = bench()
    const pending = deferred<CodexSetupView>()
    vi.mocked(b.bridge.start).mockReturnValue(pending.promise)
    const start = b.source.start()
    b.send({ ...snapshot(20, { status: 'failed', category: 'closed' }), runtime: { version: '0.153.4', status: 'error', category: 'closed' } })
    pending.resolve(b.waiting)
    await start
    expect(b.source.store.getSnapshot().view?.device).toBeUndefined()
    await b.source.detect()
    expect(b.source.store.getSnapshot().view?.snapshot.revision).toBe(1)
    b.source.dispose()
  })
  it('hydrates waiting grants only for the owner and crops arbitrary operation or clipboard errors', async () => {
    const report = vi.fn()
    const b = bench(report)
    vi.mocked(b.bridge.snapshot).mockResolvedValue({ snapshot: b.waiting.snapshot })
    b.send(b.waiting.snapshot)
    await Promise.resolve()
    expect(b.source.store.getSnapshot().view?.device).toBeUndefined()
    await b.source.start()
    await b.source.copy(async () => { throw new Error('SECRET clipboard URL') })
    expect(b.source.store.getSnapshot().error).toBe('copy')
    vi.mocked(b.bridge.detect).mockRejectedValue(new Error('SECRET account token'))
    await b.source.detect()
    expect(b.source.store.getSnapshot().error).toBe('operation')
    expect(JSON.stringify(b.source.store.getSnapshot())).not.toContain('SECRET')
    expect(report.mock.calls).toEqual([['copy'], ['detect']])
    b.source.dispose()
    b.send(snapshot(99))
    expect(b.source.store.getSnapshot().view).toBeUndefined()
    expect(b.bridge.cancel).not.toHaveBeenCalled()
  })
})
