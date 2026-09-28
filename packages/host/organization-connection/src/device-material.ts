/** Native-only Ed25519 material encrypted by the OS vault; no plaintext fallback. */
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomUUID, sign } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { deviceChallengeSchema, deviceChallengeText, provenDeviceCommandSchema } from '@deepseek-ai/dsh-organization'
import type { Principal, Receipt, OperationId } from '@deepseek-ai/dsh-organization/types'

/** Electron safeStorage adapter supplied only by the main-process composition. */
export interface OrganizationDeviceVault {
  /** Whether encryption is available using the OS credential vault. */
  isEncryptionAvailable(): boolean
  /** Linux basic_text is never accepted; other platforms return their secure backend name. */
  getSelectedStorageBackend(): string
  /**
   * Encrypt private material using the unlocked OS vault.
   * @param text - Native private key envelope.
   * @returns Ciphertext safe for owner-only local persistence.
   */
  encryptString(text: string): Buffer
  /**
   * Decrypt local material; a locked or unavailable vault must throw.
   * @param bytes - Previously encrypted local envelope.
   * @returns Native-only plaintext envelope.
   */
  decryptString(bytes: Buffer): string
}
const materialSchema = z.object({ format: z.literal(1), scope: z.string(), privateKey: z.string().max(256),
  publicKey: z.string().max(128), deviceId: z.uuid().nullable(), registrationOperationId: z.uuid(), name: z.string().min(1).max(120),
}).strict()
type Material = z.output<typeof materialSchema>

/** Main-process key owner; every signature is limited to a validated fixed action and identity. */
export class OrganizationDeviceMaterial {
  private readonly scope: string
  private readonly path: string
  /**
   * @param directory - Native application data directory outside profiles and organization backups.
   * @param principal - Current authenticated server/account/organization/member selection.
   * @param vault - Secure OS vault adapter; plaintext Linux backends are refused.
   */
  constructor(directory: string, private readonly principal: Principal, private readonly vault: OrganizationDeviceVault) {
    if (!principal.membershipId || !principal.organizationId) throw new Error('device-identity-required')
    this.scope = JSON.stringify([principal.serverId, principal.accountId, principal.organizationId, principal.membershipId])
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    this.path = join(directory, `${createHash('sha256').update(this.scope).digest('hex')}.device`)
  }
  private assertVault(): void {
    if (!this.vault.isEncryptionAvailable() || ['basic_text', 'unknown'].includes(this.vault.getSelectedStorageBackend())) throw new Error('device-vault-unavailable')
  }
  private read(): Material | null {
    this.assertVault()
    let bytes: Buffer
    try {
      if (statSync(this.path).size > 16384) throw new Error('invalid-device-material')
      bytes = readFileSync(this.path)
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null
      throw error
    }
    const material = materialSchema.parse(JSON.parse(this.vault.decryptString(bytes)))
    const key = createPrivateKey({ key: Buffer.from(material.privateKey, 'base64'), format: 'der', type: 'pkcs8' })
    if (material.scope !== this.scope || key.asymmetricKeyType !== 'ed25519'
      || createPublicKey(key).export({ format: 'der', type: 'spki' }).toString('base64') !== material.publicKey) throw new Error('invalid-device-material')
    return material
  }
  private save(material: Material): void {
    this.assertVault()
    const encrypted = this.vault.encryptString(JSON.stringify(material))
    const temporary = `${this.path}.${randomUUID()}`
    writeFileSync(temporary, encrypted, { flag: 'wx', mode: 0o600 })
    try { renameSync(temporary, this.path) } catch (error) { unlinkSync(temporary); throw error }
  }
  /**
   * Persist encrypted keys before returning the exact replayable registration command.
   * @param name - Explicit user device name.
   * @param operationId - Native operation identity retained before network transmission.
   * @returns Fixed public registration request, without private material.
   */
  registration(name: string, operationId: OperationId): z.output<typeof provenDeviceCommandSchema> {
    let material = this.read()
    if (!material) {
      const pair = generateKeyPairSync('ed25519')
      material = materialSchema.parse({ format: 1, scope: this.scope,
        privateKey: pair.privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'),
        publicKey: pair.publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
        deviceId: null, registrationOperationId: operationId, name })
      this.save(material)
    }
    return provenDeviceCommandSchema.parse({ kind: 'register-device', organizationId: this.principal.organizationId,
      operationId: material.registrationOperationId, publicKey: material.publicKey, keyGeneration: 1, name: material.name })
  }
  /**
   * Persist the server registration returned by the authenticated native transport.
   * @param receipt - Reconciled registration receipt for this material's original operation.
   */
  registered(receipt: Receipt): void {
    const material = this.read()
    if (!material || receipt.operationId !== material.registrationOperationId || receipt.organizationId !== this.principal.organizationId
      || !receipt.deviceId || receipt.lease || material.deviceId && material.deviceId !== receipt.deviceId) throw new Error('device-registration-mismatch')
    this.save({ ...material, deviceId: receipt.deviceId })
  }
  /**
   * Sign a validated action after checking all challenge and native identity bindings.
   * @param input - Fixed action prepared by native code, never arbitrary bytes to sign.
   * @param challengeInput - Authenticated service challenge.
   * @returns Signature envelope; the private key never leaves this owner.
   */
  proof(input: unknown, challengeInput: unknown): { challengeId: string; signature: string } {
    const command = provenDeviceCommandSchema.parse(input)
    const challenge = deviceChallengeSchema.parse(challengeInput)
    const material = this.read()
    const digest = createHash('sha256').update(JSON.stringify(command)).digest('hex')
    if (!material || command.organizationId !== this.principal.organizationId || challenge.serverId !== this.principal.serverId
      || challenge.accountId !== this.principal.accountId || challenge.membershipId !== this.principal.membershipId
      || challenge.organizationId !== this.principal.organizationId || challenge.publicKey !== material.publicKey
      || challenge.operationId !== command.operationId || challenge.action !== command.kind || challenge.requestDigest !== digest
      || (command.kind === 'register-device' ? command.publicKey !== material.publicKey || challenge.deviceId !== null
        : command.deviceId !== material.deviceId || challenge.deviceId !== material.deviceId)) throw new Error('device-challenge-mismatch')
    const privateKey = createPrivateKey({ key: Buffer.from(material.privateKey, 'base64'), format: 'der', type: 'pkcs8' })
    return { challengeId: challenge.challengeId, signature: sign(null, Buffer.from(deviceChallengeText(challenge)), privateKey).toString('base64url') }
  }
  /**
   * Remove old encrypted keys only after explicit, reconciled server revocation.
   * @param receipt - Trusted device-revocation receipt selected by the native coordinator.
   */
  forgetRevoked(receipt: Receipt): void {
    const material = this.read()
    if (!material || !material.deviceId || receipt.deviceId !== material.deviceId
      || receipt.organizationId !== this.principal.organizationId
      || receipt.operationId === material.registrationOperationId || receipt.lease) throw new Error('device-revocation-mismatch')
    unlinkSync(this.path)
  }
}
