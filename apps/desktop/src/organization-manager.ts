/** Main-process organization controls, saved settings and native connection ownership. */
import { readFileSync, writeFileSync, renameSync, existsSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID, randomBytes } from 'node:crypto'
import { isIP } from 'node:net'
import { z } from 'zod'
import { OrganizationConnection, type OrganizationDeviceVault } from '@deepseek-ai/dsh-organization-connection'
import { backupOrganization, restoreOrganization, lockOrganizationDirectory } from '@deepseek-ai/dsh-organization/maintenance'
import type { OrganizationServerAction, OrganizationDesktopSnapshot, OrganizationServerSettings } from '@deepseek-ai/dsh-organization-connection/types'
import type { DesktopOrganizationProcess } from './organization-process.ts'

const settingsSchema = z.object({ host: z.string().refine(v => isIP(v) !== 0),
  port: z.number().int().min(1).max(65535),
  names: z.array(z.string().min(1).max(253)).min(1).max(32),
  restoreOnLaunch: z.boolean() }).strict()
const settingsDefault: OrganizationServerSettings = { host: '0.0.0.0',
  port: 19487,
  names: ['localhost', '127.0.0.1'],
  restoreOnLaunch: false }
const actionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.enum(['start', 'stop', 'backup', 'restore', 'rotate-certificate']) }).strict(),
  z.object({ kind: z.literal('configure'), settings: settingsSchema }).strict(),
  z.object({ kind: z.literal('initialize'),
    username: z.string(),
    password: z.string(),
    organizationName: z.string(),
    recoveryToken: z.string() }).strict(),
  z.object({ kind: z.literal('recover'), recoveryToken: z.string(), newRecoveryToken: z.string(), newPassword: z.string() }).strict(),
])

/** Owns local settings and stopped-service maintenance, independently of the personal Host. */
export class DesktopOrganizationManager {
  readonly connection: OrganizationConnection
  private settings: OrganizationServerSettings = settingsDefault
  private settingsError: string | undefined
  private busy = false
  private readonly directory: string
  private readonly settingsPath: string
  /**
   * @param process - Electron-owned organization subprocess.
   * @param home - Merforge private home; service data always uses its dedicated subdirectory.
   * @param vault - Electron OS-backed encryption adapter.
   * @param pick - Native picker for a new backup destination or existing backup source.
   */
  constructor(readonly process: DesktopOrganizationProcess,
    home: string, private readonly pick: (kind: 'backup' | 'restore') => Promise<string | undefined>, vault?: OrganizationDeviceVault) {
    this.connection = new OrganizationConnection({ trustPath: join(home, 'organization-client-trust.json') }, vault ? { directory: join(home, 'organization-devices'), vault } : undefined)
    this.directory = join(home, 'organization-server')
    this.settingsPath = join(home, 'organization-server-settings.json')
    try { this.settings = settingsSchema.parse(JSON.parse(readFileSync(this.settingsPath, 'utf8'))) }
    catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) this.settingsError = 'invalid-settings' }
  }
  /** @returns Public server and connection facts; no token or private certificate is exposed. */
  snapshot(): OrganizationDesktopSnapshot {
    const processState = this.process.status()
    const state = processState.phase === 'ready'
      ? { phase: processState.phase, port: processState.port, fingerprint: processState.fingerprint,
        expiresAt: processState.expiresAt, renewalDue: processState.renewalDue }
      : processState
    return { connection: this.connection.snapshot(), server: { ...state, settings: this.settings,
      ...(this.settingsError ? { phase: 'failed', error: this.settingsError } : {}) } }
  }
  /** @returns Startup attempt only when the user explicitly saved restoreOnLaunch. */
  async restoreOnLaunch(): Promise<void> {
    if (this.settings.restoreOnLaunch && !this.settingsError) {
      try { await this.perform({ kind: 'start' }) } catch (error) { console.error('organization component=launch result=failed', error instanceof Error ? error.name : 'Error') }
    }
  }
  /**
   * Execute local settings or maintenance under single-operation admission.
   * @param input - Strict IPC control; filesystem paths come exclusively from native dialogs.
   * @returns New recovery material or the completed backup location when applicable.
   */
  async perform(input: OrganizationServerAction): Promise<{ recoveryToken?: string; path?: string }> {
    const action = actionSchema.parse(input)
    if (this.busy) throw new Error('organization-control-busy')
    this.busy = true
    try {
      if (action.kind === 'stop') { await this.process.stop(); return {} }
      if (action.kind === 'initialize' || action.kind === 'recover') {
        const { kind, ...fields } = action
        await this.process.control(kind, { ...fields, operationId: randomUUID() }); return {}
      }
      if (this.process.status().phase !== 'disabled' && this.process.status().phase !== 'failed') throw new Error('stop-required')
      if (action.kind === 'configure') {
        const temporary = `${this.settingsPath}.${randomUUID()}`
        writeFileSync(temporary, JSON.stringify(action.settings), { mode: 0o600, flag: 'wx' })
        try { renameSync(temporary, this.settingsPath) } catch (error) { unlinkSync(temporary); throw error }
        this.settings = action.settings; this.settingsError = undefined; return {}
      }
      if (this.settingsError) throw new Error(this.settingsError)
      if (action.kind === 'start') {
        await this.process.start({ api: { directory: this.directory,
          host: this.settings.host,
          port: this.settings.port,
          names: this.settings.names } }); return {}
      }
      if (action.kind === 'rotate-certificate') {
        const release = lockOrganizationDirectory(this.directory)
        try {
          const path = join(this.directory, 'tls-identity.json')
          if (existsSync(path)) renameSync(path, `${path}.previous-${randomUUID()}`)
        } finally { release() }
        return {}
      }
      const path = await this.pick(action.kind)
      if (!path) return {}
      if (action.kind === 'backup') {
        const saved = backupOrganization(this.directory, path, 5000)
        console.info('organization component=maintenance operation=backup result=completed')
        return { path: saved }
      }
      const restored = restoreOrganization(path, this.directory, 5000)
      console.info('organization component=maintenance operation=restore result=completed')
      await this.connection.perform({ kind: 'logout' })
      return { recoveryToken: restored.recoveryToken, path: restored.previous }
    } catch (error) {
      console.error('organization component=control operation=%s result=failed', action.kind)
      throw error
    } finally { this.busy = false }
  }
  /** @returns A fresh independent recovery/invitation secret for explicit local display. */
  secret(): string { return randomBytes(32).toString('base64url') }
  /** @returns Settlement after native connection cancellation and private child exit. */
  async close(): Promise<void> { await Promise.all([this.connection.close(), this.process.stop()]) }
}
