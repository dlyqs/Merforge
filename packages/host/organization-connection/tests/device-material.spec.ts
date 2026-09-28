/** Native encrypted-material lifecycle against the real Loader/SQLite device authority. */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { OperationId, Principal } from '@deepseek-ai/dsh-organization/types'
import { OrganizationDeviceMaterial, type OrganizationDeviceVault } from '../src/device-material.ts'
import { assignmentHarness } from '../../../workspace/organization/tests/assignment-harness.ts'
import { operationId } from '../../../workspace/organization/tests/harness.ts'

const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })
function vault(): OrganizationDeviceVault {
  // The OS vault is the nondeterministic boundary; keys, files, signing and authority stay real.
  const key = randomBytes(32)
  return {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => 'test-os-vault',
    encryptString(text) {
      const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv)
      const bytes = Buffer.concat([cipher.update(text), cipher.final()])
      return Buffer.concat([iv, cipher.getAuthTag(), bytes])
    },
    decryptString(bytes) {
      const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12))
      decipher.setAuthTag(bytes.subarray(12, 28))
      return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8')
    },
  }
}

it('persists only encrypted keys, reopens for proof, and rotates only after reconciled revocation', async () => {
  const h = await assignmentHarness(cleanup), osVault = vault(), directory = join(h.root, 'native-device')
  const principal: Principal = { ...h.other.principal, organizationId: h.query.organizationId, membershipId: h.other.membershipId! }
  const material = new OrganizationDeviceMaterial(directory, principal, osVault)
  const command = material.registration('Laptop', brandString<OperationId>(operationId()))
  expect(command.kind).toBe('register-device')
  const challenge = await h.service.deviceChallenge(h.other.token, command)
  const receipt = await h.service.deviceCommand(h.other.token, command, material.proof(command, challenge))
  material.registered(receipt)
  const encrypted = readFileSync(join(directory, readdirSync(directory)[0]!)).toString('utf8')
  expect(encrypted).not.toContain('privateKey')
  expect(encrypted).not.toContain('Laptop')
  const reopened = new OrganizationDeviceMaterial(directory, principal, osVault)
  expect(reopened.registration('Ignored retry name', brandString<OperationId>(operationId()))).toEqual(command)
  const retryChallenge = await h.service.deviceChallenge(h.other.token, command)
  expect(await h.service.deviceCommand(h.other.token, command, reopened.proof(command, retryChallenge))).toEqual(receipt)
  expect(() => reopened.proof(command, { ...retryChallenge, accountId: h.owner.accountId })).toThrow('device-challenge-mismatch')
  expect(() => reopened.proof({ ...command, name: 'Different action' }, retryChallenge)).toThrow('device-challenge-mismatch')
  expect(() => new OrganizationDeviceMaterial(directory, principal, vault()).registration('Laptop', brandString<OperationId>(operationId()))).toThrow()
  expect(() =>{  material.forgetRevoked(receipt) }).toThrow('device-revocation-mismatch')
  const revoked = await h.service.deviceCommand(h.other.token, { kind: 'revoke-device', operationId: operationId(), organizationId: h.query.organizationId,
    deviceId: receipt.deviceId, expectedVersion: receipt.revision })
  material.forgetRevoked(revoked)
  const rotated = material.registration('Laptop', brandString<OperationId>(operationId()))
  expect(rotated).not.toEqual(command)
  if (rotated.kind === 'register-device' && command.kind === 'register-device') expect(rotated.publicKey).not.toBe(command.publicKey)
})

it('refuses unavailable or plaintext vaults and another native account cannot reuse a device proof', async () => {
  const h = await assignmentHarness(cleanup), directory = join(h.root, 'native-device'), osVault = vault()
  const principal: Principal = { ...h.other.principal, organizationId: h.query.organizationId, membershipId: h.other.membershipId! }
  const unavailableVaults = [{ ...osVault, isEncryptionAvailable: () => false },
    { ...osVault, getSelectedStorageBackend: () => 'basic_text' }]
  for (const unavailable of unavailableVaults) {
    expect(() => new OrganizationDeviceMaterial(directory, principal, unavailable).registration('Laptop', brandString<OperationId>(operationId()))).toThrow('device-vault-unavailable')
  }
  const material = new OrganizationDeviceMaterial(directory, principal, osVault)
  const command = material.registration('Laptop', brandString<OperationId>(operationId()))
  const challenge = await h.service.deviceChallenge(h.other.token, command)
  const other = new OrganizationDeviceMaterial(directory, { ...h.owner.principal,
    organizationId: h.query.organizationId, membershipId: h.owner.membershipId }, osVault)
  other.registration('Owner laptop', brandString<OperationId>(operationId()))
  expect(() => other.proof(command, challenge)).toThrow('device-challenge-mismatch')
})
