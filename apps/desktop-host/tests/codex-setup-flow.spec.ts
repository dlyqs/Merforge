/** Real Loader and managed peer through the fixed native control and Desktop handler to the Client source. */
import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'
import { expect, it, vi, onTestFinished } from 'vitest'
import type { CodexSetupDesktopBridge, CodexSetupOwnerId, CodexSetupOperation, CodexSetupSnapshot, CodexSetupView } from '@deepseek-ai/dsh-agent-codex/setup-types'
import { codexSetupNativeMessageSchema, codexSetupViewSchema } from '@deepseek-ai/dsh-agent-codex/setup-protocol'
import { setup } from '../../../packages/core/agent-codex/tests/setup-harness.ts'
import { CodexSetupSource } from '../../../packages/client/ui-settings-models/src/client/codex-source.ts'
import { buildModelCatalog } from '../../../packages/api/session-controller/src/catalog.ts'
import { createCodexSetupHandler } from '../../desktop/src/codex-setup-ipc.ts'
import { installCodexSetupControl } from '../src/codex-setup.ts'

it('takes a new user from login-required to selectable models without creating a Session, thread, turn or API request', async () => {
  const h = await setup()
  const channel = new EventEmitter()
  const nonce = randomUUID()
  const listeners = new Set<(value: CodexSetupSnapshot) => void>()
  installCodexSetupControl(h.ctx, {
    on: (event, listener) => channel.on(event, listener),
    off: (event, listener) => channel.off(event, listener),
    send: (message) => {
      const result = codexSetupNativeMessageSchema.parse(message)
      if (result.type === 'codex-setup-changed') for (const listener of listeners) listener(result.snapshot)
      channel.emit('result', result)
    },
  })
  const host = {
    subscribeCodexSetup: (listener: (value: CodexSetupSnapshot) => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    codexSetup: (owner: CodexSetupOwnerId, operation: CodexSetupOperation | { kind: 'destroyOwner' }): Promise<{ view: CodexSetupView; verificationUrl?: string }> =>
      new Promise((resolve, reject) => {
        const requestId = randomUUID()
        const listener = (value: unknown): void => {
          const result = codexSetupNativeMessageSchema.parse(value)
          if (result.type !== 'codex-setup-result' || result.requestId !== requestId) return
          channel.off('result', listener)
          if (result.error || !result.result) reject(new Error('codex-setup: closed'))
          else resolve({ view: result.result, ...(result.verificationUrl ? { verificationUrl: result.verificationUrl } : {}) })
        }
        channel.on('result', listener)
        channel.emit('message', { type: 'codex-setup', version: 1, requestId, nonce, owner, operation })
      }),
  }
  const contents = Object.assign(new EventEmitter(), { mainFrame: { url: 'dsh-app://app/' },
    send: (_event: string, snapshot: CodexSetupSnapshot) => { for (const listener of observers) listener(snapshot) } })
  const window = Object.assign(new EventEmitter(), { webContents: contents, isDestroyed: () => false }) as BrowserWindow
  const event = { sender: contents, senderFrame: contents.mainFrame } as IpcMainInvokeEvent
  const observers = new Set<(value: CodexSetupSnapshot) => void>()
  const open = vi.fn(async () => {})
  const invoke = createCodexSetupHandler({ window: () => window, host: () => host, openExternal: open })
  const read = async (operation: CodexSetupOperation): Promise<CodexSetupView> => {
    const result = await invoke(event, operation)
    return codexSetupViewSchema.parse(result)
  }
  const bridge: CodexSetupDesktopBridge = {
    snapshot: () => read({ kind: 'snapshot' }), detect: () => read({ kind: 'detect' }), start: () => read({ kind: 'start' }),
    cancel: attemptId => read({ kind: 'cancel', attemptId }),
    openVerification: async (attemptId) => { await invoke(event, { kind: 'openVerification', attemptId }) },
    subscribe: (listener) => { observers.add(listener); return () => { observers.delete(listener) } },
  }
  const source = new CodexSetupSource(bridge)
  onTestFinished(() => { source.dispose(); window.emit('closed') })
  await source.detect()
  expect(source.store.getSnapshot().view?.snapshot.catalog.category).toBe('login-required')
  const defaultSelection = { provider: 'existing-api', model: 'existing-default' }
  const before = await buildModelCatalog(h.ctx, defaultSelection)
  expect(before.failures).toContainEqual(expect.objectContaining({ id: 'codex', setupReason: 'login-required' }))
  await source.start()
  expect(source.store.getSnapshot().error).toBeUndefined()
  expect(source.store.getSnapshot().view?.device?.userCode).toBe('FIXTURE-PRIVATE-CODE')
  await source.openVerification()
  expect(open).toHaveBeenCalledExactlyOnceWith('https://auth.openai.com/codex/device')
  await h.command({ auth: true })
  await vi.waitFor(() => { expect(source.store.getSnapshot().view?.snapshot.login.status).toBe('succeeded') })
  expect(source.store.getSnapshot().view?.device).toBeUndefined()
  const after = await buildModelCatalog(h.ctx, defaultSelection)
  expect(after.default).toEqual(defaultSelection)
  expect(after.failures).toEqual([])
  expect(after.groups).toContainEqual(expect.objectContaining({ id: 'codex', models: [
    { id: 'fixture', name: 'Fixture', reasoning: { efforts: [{ id: 'medium', name: 'medium' }], defaultEffort: 'medium' } },
  ] }))
  const calls = await h.calls()
  expect(calls.filter(method => method === 'account/read').length).toBeGreaterThanOrEqual(2)
  expect(calls.some(method => /thread|turn/.test(method))).toBe(false)
  expect(h.ctx.agents.list()).toEqual([])
  for (const child of h.children) expect(await child.waitForExit()).toBe(true)
}, 20_000)
