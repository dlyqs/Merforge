/** Top-frame-only Electron setup adapter; Renderer never supplies URLs or owners. */
import { randomUUID } from 'node:crypto'
import { brandString } from '@deepseek-ai/dsh-brand'
import { codexSetupOperationSchema } from '@deepseek-ai/dsh-agent-codex/setup-protocol'
import type { CodexSetupOwnerId } from '@deepseek-ai/dsh-agent-codex/setup-types'
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'
import { assertDesktopSender, DESKTOP_IPC } from './ipc.ts'
import type { DesktopHostProcess } from './host-process.ts'
/**
 * Bind fixed controls to the current owned window and Host, rechecking after awaits.
 * @param options - Electron-owned sender, Host and external-open capabilities.
 * @returns invocation handler for the single fixed channel.
 */
export function createCodexSetupHandler(options: {
  window(): BrowserWindow | undefined
  host(): Pick<DesktopHostProcess, 'codexSetup' | 'subscribeCodexSetup'> | undefined
  openExternal(url: string): Promise<void>
}): (event: IpcMainInvokeEvent, input: unknown) => Promise<unknown> {
  let lifetime: { window: BrowserWindow; owner: CodexSetupOwnerId; host: Pick<DesktopHostProcess, 'codexSetup' | 'subscribeCodexSetup'>; unsubscribe: () => void } | undefined
  const retire = (): void => {
    const old = lifetime
    lifetime = undefined
    if (!old) return
    old.unsubscribe()
    void old.host.codexSetup(old.owner, { kind: 'destroyOwner' }).catch((error: unknown) => { void error /* A disconnected Host already owns its teardown. */ })
  }
  return async (event, input) => {
    assertDesktopSender(event, ['app'])
    const window = options.window(), host = options.host()
    if (!window || window.isDestroyed() || !host || event.sender !== window.webContents
      || event.senderFrame !== window.webContents.mainFrame) throw new Error('codex-setup: closed')
    const parsed = codexSetupOperationSchema.safeParse(input)
    if (!parsed.success) throw new Error('codex-setup: protocol')
    const operation = parsed.data
    if (lifetime?.window !== window || lifetime.host !== host) {
      retire()
      const owner = brandString<CodexSetupOwnerId>(randomUUID())
      const unsubscribe = host.subscribeCodexSetup((snapshot) => {
        if (lifetime?.owner === owner && (options.host() === host || snapshot.runtime.category === 'closed')
          && options.window() === window && !window.isDestroyed()) {
          window.webContents.send(DESKTOP_IPC.codexSetupChanged, snapshot)
        }
      })
      lifetime = { window, host, owner, unsubscribe }
      window.once('closed', () => { if (lifetime?.owner === owner) retire() })
      const onNavigate = (_event: unknown, _url: string, _inPlace: boolean, isMainFrame: boolean): void => {
        if (isMainFrame && lifetime?.owner === owner) retire()
      }
      window.webContents.on('did-start-navigation', onNavigate)
      lifetime.unsubscribe = () => { unsubscribe(); window.webContents.off('did-start-navigation', onNavigate) }
    }
    const current = lifetime
    const assertCurrent = (): void => {
      if (lifetime !== current || options.host() !== host || options.window() !== window || window.isDestroyed()
        || event.senderFrame !== window.webContents.mainFrame) throw new Error('codex-setup: closed')
      assertDesktopSender(event, ['app'])
    }
    const result = await host.codexSetup(current.owner, operation)
    assertCurrent()
    if (operation.kind === 'openVerification') {
      if (result.verificationUrl !== 'https://auth.openai.com/codex/device') throw new Error('codex-setup: protocol')
      await options.openExternal(result.verificationUrl)
      assertCurrent()
      return
    }
    return result.view
  }
}
