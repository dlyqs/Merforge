/** Electron ownership decisions exercised without creating a window. */
import { expect, it } from 'vitest'
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'
import { assertOrganizationResult, assertOrganizationSender } from '../src/organization-ipc.ts'

function fixture() {
  const frame = { url: 'dsh-app://app/index.html' }
  const webContents = { mainFrame: frame }
  const window = { webContents, isDestroyed: () => false } as BrowserWindow
  const event = { sender: webContents, senderFrame: frame } as IpcMainInvokeEvent
  return { window, event }
}
it('admits only the owning top frame and rejects other windows, subframes and navigated origins', () => {
  const h = fixture()
  expect(() =>{  assertOrganizationSender(h.event, h.window) }).not.toThrow()
  expect(() =>{  assertOrganizationSender(h.event, fixture().window) }).toThrow('unowned renderer')
  expect(() =>{  assertOrganizationSender(h.event, undefined) }).toThrow('unowned renderer')
  const other = fixture()
  other.event.senderFrame = h.event.senderFrame
  expect(() =>{  assertOrganizationSender(other.event, other.window) }).toThrow('unowned renderer')
  const navigated = fixture()
  Object.assign(navigated.event.senderFrame!, { url: 'https://untrusted.example/' })
  expect(() =>{  assertOrganizationSender(navigated.event, navigated.window) }).toThrow('unowned renderer')
})
it('rechecks a destroyed window and discards late receipts and task metadata', () => {
  const h = fixture()
  h.window.isDestroyed = () => true
  expect(() =>{  assertOrganizationSender(h.event, h.window) }).toThrow('unowned renderer')
  expect(() =>{  assertOrganizationResult({ generation: 1 }, 2) }).toThrow('superseded')
  expect(() =>{  assertOrganizationResult({ assignment: { generation: 1, result: { kind: 'device', value: null } } }, 2) }).toThrow('superseded')
  expect(() =>{  assertOrganizationResult({ generation: 2 }, 2) }).not.toThrow()
})
