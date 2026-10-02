/** Fixed setup admission without opening Electron or a browser. */
import { EventEmitter } from 'node:events'
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'
import { expect, it, vi } from 'vitest'
import { createCodexSetupHandler } from '../src/codex-setup-ipc.ts'
import type { CodexSetupOwnerId, CodexSetupOperation, CodexSetupSnapshot, CodexSetupView } from '@deepseek-ai/dsh-agent-codex/setup-types'
const snapshot: CodexSetupSnapshot = { revision: 1, runtime: { version: '0.153.4', status: 'ready' },
  account: { status: 'unknown' }, catalog: { status: 'unknown', models: [] }, login: { status: 'idle' } }
const id = '11111111-1111-4111-8111-111111111111'
function harness() {
  const contents = Object.assign(new EventEmitter(), { mainFrame: { url: 'dsh-app://app/' }, send: vi.fn() })
  const window = Object.assign(new EventEmitter(), { webContents: contents, isDestroyed: () => false }) as BrowserWindow
  const event = { sender: contents, senderFrame: contents.mainFrame } as IpcMainInvokeEvent
  const host = { codexSetup: vi.fn(async (_owner: CodexSetupOwnerId, _operation: CodexSetupOperation | { kind: 'destroyOwner' }) => ({ view: { snapshot } as CodexSetupView, verificationUrl: 'https://auth.openai.com/codex/device' })),
    subscribeCodexSetup: vi.fn((_listener: (value: CodexSetupSnapshot) => void) => vi.fn()) }
  let currentHost: typeof host | undefined = host
  const openExternal = vi.fn(async () => {})
  const invoke = createCodexSetupHandler({ window: () => window, host: () => currentHost, openExternal })
  return { contents, window, event, host, invoke, openExternal, replaceHost: () => { currentHost = undefined } }
}
it('rejects remote documents, iframe/guest callers and extra fields before sending any Host request', async () => {
  const h = harness()
  for (const event of [{ ...h.event, senderFrame: { url: 'https://remote.test' } },
    { ...h.event, senderFrame: { url: 'dsh-app://app/' } }, { ...h.event, sender: {} }]) {
    await expect(h.invoke(event as IpcMainInvokeEvent, { kind: 'start' })).rejects.toThrow()
  }
  await expect(h.invoke(h.event, { kind: 'start', owner: id })).rejects.toThrow()
  await expect(h.invoke(h.event, { kind: 'openVerification', attemptId: 'bad', url: 'https://evil.test' })).rejects.toThrow()
  expect(h.host.codexSetup).not.toHaveBeenCalled()
})
it('opens only the returned official URL and retires the owner after main-frame navigation', async () => {
  const h = harness()
  await h.invoke(h.event, { kind: 'openVerification', attemptId: id })
  expect(h.openExternal).toHaveBeenCalledExactlyOnceWith('https://auth.openai.com/codex/device')
  const owner = h.host.codexSetup.mock.calls[0]![0]
  h.contents.emit('did-start-navigation', {}, 'dsh-app://app/new', false, true)
  expect(h.host.codexSetup).toHaveBeenLastCalledWith(owner, { kind: 'destroyOwner' })
  await h.invoke(h.event, { kind: 'snapshot' })
  expect(h.host.codexSetup.mock.calls.at(-1)![0]).not.toBe(owner)
  h.window.emit('closed')
  expect(h.host.codexSetup.mock.calls.at(-1)![1]).toEqual({ kind: 'destroyOwner' })
})
it.each(['host', 'navigation', 'closed'])('rejects a late code response after %s retirement', async (kind) => {
  const h = harness()
  const response = Promise.withResolvers<{ view: CodexSetupView; verificationUrl: string }>()
  h.host.codexSetup.mockImplementationOnce(() => response.promise)
  const pending = h.invoke(h.event, { kind: 'start' })
  if (kind === 'host') h.replaceHost()
  else if (kind === 'navigation') h.contents.emit('did-start-navigation', {}, 'dsh-app://app/new', false, true)
  else h.window.emit('closed')
  response.resolve({ view: { snapshot }, verificationUrl: 'https://auth.openai.com/codex/device' })
  await expect(pending).rejects.toThrow('closed')
})
