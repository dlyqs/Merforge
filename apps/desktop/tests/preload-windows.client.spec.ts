// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { DESKTOP_IPC } from '../src/ipc.ts'
import { syncWindowsAppearance } from '../src/preload-windows.ts'

const send = vi.hoisted(() => vi.fn())
vi.mock('electron', () => ({ ipcRenderer: { send } }))

afterEach(() => {
  window.dispatchEvent(new Event('pagehide'))
  document.documentElement.lang = 'en'
  vi.restoreAllMocks()
  send.mockClear()
})

it.each(['darwin', 'linux'] as const)('does not install Windows controls on %s', (platform) => {
  vi.spyOn(process, 'platform', 'get').mockReturnValue(platform)
  syncWindowsAppearance()
  expect(document.querySelector('[data-windows-window-controls]')).toBeNull()
  expect(send).not.toHaveBeenCalled()
})

it('dispatches window actions, follows language changes and removes controls on document close', async () => {
  vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
  vi.spyOn(document, 'readyState', 'get').mockReturnValue('loading')
  const attach = vi.spyOn(HTMLElement.prototype, 'attachShadow')
  document.documentElement.lang = 'en'
  syncWindowsAppearance()
  expect(send).not.toHaveBeenCalled()
  window.dispatchEvent(new Event('DOMContentLoaded'))
  const shadow = attach.mock.results[0]!.value as ShadowRoot
  const buttons = shadow.querySelectorAll('button')
  expect([...buttons].map(button => button.getAttribute('aria-label'))).toEqual([
    'Close window', 'Minimize window', 'Maximize or restore window',
  ])
  for (const [index, action] of ['close', 'minimize', 'maximize'].entries()) {
    buttons[index]!.click()
    expect(send).toHaveBeenLastCalledWith(DESKTOP_IPC.windowControl, action)
  }
  document.documentElement.lang = 'zh-CN'
  await vi.waitFor(() => { expect(send).toHaveBeenLastCalledWith(DESKTOP_IPC.windowsAppearance, 'zh-CN') })
  expect(buttons[0]!.getAttribute('aria-label')).toBe('关闭窗口')
  window.dispatchEvent(new Event('pagehide'))
  expect(document.querySelector('[data-windows-window-controls]')).toBeNull()
  send.mockClear()
  document.documentElement.lang = 'en'
  await new Promise<void>(resolve => { queueMicrotask(resolve) })
  expect(send).not.toHaveBeenCalled()
})
