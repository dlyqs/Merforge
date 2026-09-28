/** Organization replies belong only to the current top frame of the product window. */
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'
import type { ConnectionResult } from '@deepseek-ai/dsh-organization-connection/types'
import { assertDesktopSender } from './ipc.ts'

/**
 * Recheck window ownership before handling an action and before returning its result.
 * @param event - Electron IPC origin, including its initiating frame.
 * @param window - Currently owned product window.
 */
export function assertOrganizationSender(event: IpcMainInvokeEvent, window: BrowserWindow | undefined): void {
  assertDesktopSender(event, ['app'])
  if (!window || window.isDestroyed() || event.sender !== window.webContents
    || event.senderFrame === null || event.senderFrame !== window.webContents.mainFrame) {
    throw new Error('dsh desktop: rejected IPC from an unowned renderer')
  }
}

/**
 * Refuse content or receipts completed under a superseded native generation.
 * @param result - Native fixed-action result.
 * @param generation - Current connection generation at the IPC handoff.
 */
export function assertOrganizationResult(result: ConnectionResult, generation: number): void {
  if (result.generation !== undefined && result.generation !== generation
    || result.workgraph && result.workgraph.generation !== generation
    || result.assignment && result.assignment.generation !== generation) throw new Error('superseded')
}
