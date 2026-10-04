/** OS-encrypted login persistence bound to the explicitly trusted service. */
import { readFileSync, writeFileSync, renameSync, unlinkSync, statSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { loginResultSchema } from './schema.ts'
import type { OrganizationDeviceVault } from './device-material.ts'

const savedLoginSchema = loginResultSchema.extend({ format: z.literal(1), origin: z.url(),
  fingerprint: z.string(), username: z.string().min(1).max(256) }).strict()
type SavedLogin = z.output<typeof savedLoginSchema>

/** Stores one encrypted bearer; passwords and authorized content are never written. */
export class OrganizationLoginSession {
  /** @param path - Private encrypted session file.
   * @param vault - Main-process OS encryption adapter.
   */
  constructor(private readonly path: string, private readonly vault: OrganizationDeviceVault) {}
  private available(): boolean { return this.vault.isEncryptionAvailable() && !['basic_text', 'unknown'].includes(this.vault.getSelectedStorageBackend()) }
  /** Restore the login from the private OS-encrypted file.
   * @returns Validated saved credentials, or no session when absent or the vault is locked.
   */
  read(): SavedLogin | undefined {
    if (!this.available()) return undefined
    try {
      if (statSync(this.path).size > 16384) throw new Error('invalid-login-session')
      return savedLoginSchema.parse(JSON.parse(this.vault.decryptString(readFileSync(this.path))))
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) console.warn('organization component=login-session result=restore-unavailable')
      return undefined
    }
  }
  /** Save the login using the available OS encryption adapter.
   * @param session - Server-issued credentials and their trusted service identity.
   */
  save(session: SavedLogin): void {
    if (!this.available()) return
    const bytes = this.vault.encryptString(JSON.stringify(savedLoginSchema.parse(session)))
    const temporary = `${this.path}.${randomUUID()}`
    writeFileSync(temporary, bytes, { mode: 0o600, flag: 'wx' })
    try { renameSync(temporary, this.path) } catch (error) { unlinkSync(temporary); throw error }
  }
  /** Remove saved credentials on logout, expiry or authority rejection. */
  clear(): void {
    try { unlinkSync(this.path) } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
    }
  }
}
