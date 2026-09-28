/** Real authority transactions for signed registrations and exclusive, expiring ownership. */
import { generateKeyPairSync, sign } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import { assignmentHarness } from './assignment-harness.ts'
import { openHarness, operationId } from './harness.ts'
import { deviceChallengeText } from '../src/device-schema.ts'
import { openOrganizationDatabase } from '../src/database.ts'
import type { OrganizationService } from '../src/index.ts'
import type { LoginToken } from '../src/types.ts'
import type { OrganizationDeviceChallenge } from '../src/device-types.ts'

const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => { vi.restoreAllMocks(); for (const close of cleanup.splice(0).reverse()) await close() })
async function setup() {
  const h = await assignmentHarness(cleanup)
  const approval = await h.service.assignmentCommand(h.owner.token, h.approve)
  const requestId = String(h.db.prepare('SELECT id FROM assignment_requests').get()?.id)
  const accepted = await h.service.participantCommand(h.other.token, { ...h.query, kind: 'answer-assignment', operationId: operationId(),
    assignmentId: approval.assignmentId, requestId, answer: 'accepted', expectedVersion: approval.revision })
  const selector = { ...h.query, assignmentId: approval.assignmentId }
  return { ...h, approval, accepted, selector }
}
function keys() {
  const pair = generateKeyPairSync('ed25519')
  const publicKey = pair.publicKey.export({ format: 'der', type: 'spki' }).toString('base64')
  const proof = (c: OrganizationDeviceChallenge) => ({ challengeId: c.challengeId,
    signature: sign(null, Buffer.from(deviceChallengeText(c)), pair.privateKey).toString('base64url') })
  return { publicKey, proof }
}
async function register(h: Awaited<ReturnType<typeof setup>>, token = h.other.token) {
  const key = keys()
  const command = { kind: 'register-device', organizationId: h.query.organizationId, operationId: operationId(), publicKey: key.publicKey, keyGeneration: 1, name: 'Workstation' }
  const challenge = await h.service.deviceChallenge(token, command)
  const receipt = await h.service.deviceCommand(token, command, key.proof(challenge))
  return { ...key, receipt, command, challenge }
}
async function delegate(h: Awaited<ReturnType<typeof setup>>, deviceId: string, expiresAt = Date.now() + 120000) {
  return h.service.participantCommand(h.other.token, { ...h.selector, kind: 'delegate', operationId: operationId(), expectedVersion: h.accepted.revision,
    deviceId, executorId: 'desktop-builtin', capabilities: ['task-read', 'draft'], budget: 20, expiresAt })
}
async function proven(service: OrganizationService, token: LoginToken, command: unknown, key: ReturnType<typeof keys>) {
  const challenge = await service.deviceChallenge(token, command)
  return service.deviceCommand(token, command, key.proof(challenge))
}

it('binds proofs to every identity and action, rejects forged IDs and returns only historical replay', async () => {
  const h = await setup(), device = await register(h)
  expect(await h.service.deviceCommand(h.other.token, device.command)).toEqual(device.receipt)
  const changed = { ...device.command, operationId: operationId(), name: 'Changed' }
  await expect(h.service.deviceCommand(h.other.token, changed, device.proof(device.challenge))).rejects.toMatchObject({ code: 'version-conflict' })
  const fresh = await h.service.deviceChallenge(h.other.token, changed)
  await expect(h.service.deviceCommand(h.owner.token, changed, device.proof(fresh))).rejects.toMatchObject({ code: 'forbidden' })
  await expect(h.service.deviceCommand(h.other.token, changed, keys().proof(fresh))).rejects.toMatchObject({ code: 'forbidden' })
  await expect(delegate(h, operationId())).rejects.toMatchObject({ code: 'forbidden' })
  const otherAccount = await register(h, h.owner.token)
  await expect(delegate(h, otherAccount.receipt.deviceId!)).rejects.toMatchObject({ code: 'forbidden' })
  await h.service.deviceCommand(h.other.token, { kind: 'revoke-device', organizationId: h.query.organizationId,
    operationId: operationId(), deviceId: device.receipt.deviceId, expectedVersion: device.receipt.revision })
  await expect(delegate(h, device.receipt.deviceId!)).rejects.toMatchObject({ code: 'forbidden' })
  const reopened = openOrganizationDatabase(h.path, 100); reopened.close()
})

it('allows one of two devices to claim, retains epochs, and denies late renew/release against a new owner', async () => {
  const h = await setup(), a = await register(h), b = await register(h)
  const da = await delegate(h, a.receipt.deviceId!), db = await delegate(h, b.receipt.deviceId!)
  const claimA = { ...h.selector, kind: 'claim', operationId: operationId(), deviceId: a.receipt.deviceId, delegationId: da.delegationId }
  const claimB = { ...h.selector, kind: 'claim', operationId: operationId(), deviceId: b.receipt.deviceId, delegationId: db.delegationId }
  const results = await Promise.allSettled([proven(h.service, h.other.token, claimA, a), proven(h.service, h.other.token, claimB, b)])
  expect(results.filter(item => item.status === 'fulfilled')).toHaveLength(1)
  expect(results[0].status).toBe('fulfilled')
  const first = await h.service.deviceCommand(h.other.token, claimA)
  expect(first.lease?.fencingEpoch).toBe(1)
  const release = { ...h.selector, kind: 'release', operationId: operationId(), deviceId: a.receipt.deviceId,
    fencingEpoch: first.lease!.fencingEpoch, serverEpoch: first.lease!.serverEpoch, expectedVersion: first.revision }
  await proven(h.service, h.other.token, release, a)
  const second = await proven(h.service, h.other.token, { ...claimB, operationId: operationId() }, b)
  expect(second.lease?.fencingEpoch).toBe(2)
  await expect(proven(h.service, h.other.token, { ...release, kind: 'renew', operationId: operationId() }, a)).rejects.toMatchObject({ code: 'version-conflict' })
  await expect(proven(h.service, h.other.token, { ...release, operationId: operationId() }, a)).rejects.toMatchObject({ code: 'version-conflict' })
  expect(await h.service.receipt(h.other.token, claimA.operationId)).toEqual(first)
  expect(h.db.prepare("SELECT count(*) AS n FROM assignment_leases WHERE state='held'").get()?.n).toBe(1)
  const reopened = openOrganizationDatabase(h.path, 100); reopened.close()
})

it('caps leases by delegation expiry and permanently expires them on a late request', async () => {
  const h = await setup(), a = await register(h)
  const now = Date.now(), clock = vi.spyOn(Date, 'now').mockReturnValue(now)
  const d = await delegate(h, a.receipt.deviceId!, now + 2000)
  const first = await proven(h.service, h.other.token, { ...h.selector, kind: 'claim', operationId: operationId(), deviceId: a.receipt.deviceId, delegationId: d.delegationId }, a)
  expect(first.lease?.expiresAt).toBe(now + 2000)
  const renew = { ...h.selector, kind: 'renew', operationId: operationId(), deviceId: a.receipt.deviceId,
    fencingEpoch: first.lease!.fencingEpoch, serverEpoch: first.lease!.serverEpoch, expectedVersion: first.revision }
  const challenge = await h.service.deviceChallenge(h.other.token, renew)
  clock.mockReturnValue(now + 2001)
  await expect(h.service.deviceCommand(h.other.token, renew, a.proof(challenge))).rejects.toMatchObject({ code: 'version-conflict' })
  expect(h.db.prepare('SELECT state FROM assignment_delegations').get()?.state).toBe('expired')
  clock.mockReturnValue(now)
  await expect(proven(h.service, h.other.token, { ...renew, operationId: operationId() }, a)).rejects.toMatchObject({ code: 'version-conflict' })
})

it('rejects over-budget, over-duration, unaccepted and foreign delegation and retires it on device revocation', async () => {
  const h = await setup(), a = await register(h)
  const input = { ...h.selector, kind: 'delegate', operationId: operationId(), deviceId: a.receipt.deviceId,
    expectedVersion: h.accepted.revision, executorId: 'desktop-builtin', capabilities: ['task-read'], budget: 1, expiresAt: Date.now() + 60000 }
  for (const change of [{ budget: 101 }, { expiresAt: Date.now() + 3700000 }, { capabilities: ['shell'] }, { executorId: 'external' }]) {
    await expect(h.service.participantCommand(h.other.token, { ...input, ...change })).rejects.toMatchObject({ code: 'invalid-input' })
  }
  await expect(h.service.participantCommand(h.owner.token, input)).rejects.toMatchObject({ code: 'forbidden' })
  const d = await h.service.participantCommand(h.other.token, input)
  const claim = await proven(h.service, h.other.token, { ...h.selector, kind: 'claim', operationId: operationId(), deviceId: a.receipt.deviceId, delegationId: d.delegationId }, a)
  const renew = { ...h.selector, kind: 'renew', operationId: operationId(), deviceId: a.receipt.deviceId,
    fencingEpoch: claim.lease!.fencingEpoch, serverEpoch: claim.lease!.serverEpoch, expectedVersion: claim.revision }
  const challenge = await h.service.deviceChallenge(h.other.token, renew)
  await h.service.deviceCommand(h.other.token, { kind: 'revoke-device', organizationId: h.query.organizationId, operationId: operationId(), deviceId: a.receipt.deviceId, expectedVersion: a.receipt.revision })
  await expect(h.service.deviceCommand(h.other.token, renew, a.proof(challenge))).rejects.toMatchObject({ code: 'forbidden' })
  await h.service.readPreparation(h.other.token, h.selector, (value) => {
    expect(value.delegations[0]?.state).toBe('invalidated'); expect(value.lease?.state).toBe('invalidated')
  })
})

it('invalidates held leases and challenges on service restart while preserving acceptance and historical receipts', async () => {
  const h = await setup(), a = await register(h), d = await delegate(h, a.receipt.deviceId!)
  const claimCommand = { ...h.selector, kind: 'claim', operationId: operationId(), deviceId: a.receipt.deviceId, delegationId: d.delegationId }
  const claim = await proven(h.service, h.other.token, claimCommand, a)
  const renew = { ...h.selector, kind: 'renew', operationId: operationId(), deviceId: a.receipt.deviceId,
    fencingEpoch: claim.lease!.fencingEpoch, serverEpoch: claim.lease!.serverEpoch, expectedVersion: claim.revision }
  const challenge = await h.service.deviceChallenge(h.other.token, renew)
  await h.close()
  const restarted = await openHarness(h.root); cleanup.push(restarted.close)
  expect(await restarted.service.receipt(h.other.token, claimCommand.operationId)).toEqual(claim)
  await expect(restarted.service.deviceCommand(h.other.token, renew, a.proof(challenge))).rejects.toMatchObject({ code: 'version-conflict' })
  await expect(proven(restarted.service, h.other.token, { ...renew, operationId: operationId() }, a)).rejects.toMatchObject({ code: 'version-conflict' })
  const next = await proven(restarted.service, h.other.token, { ...claimCommand, operationId: operationId() }, a)
  expect(next.lease?.fencingEpoch).toBe(2)
  expect(next.lease?.serverEpoch).not.toBe(claim.lease?.serverEpoch)
})

it('keeps challenge consumption atomic with receipt writes and enforces expiry and issuance bounds', async () => {
  const h = await setup(), key = keys()
  const command = { kind: 'register-device', organizationId: h.query.organizationId, operationId: operationId(), publicKey: key.publicKey, keyGeneration: 1, name: 'Device' }
  const challenge = await h.service.deviceChallenge(h.other.token, command), proof = key.proof(challenge)
  h.db.exec("CREATE TRIGGER reject_receipt BEFORE INSERT ON operation_receipts BEGIN SELECT RAISE(ABORT,'device fault'); END")
  await expect(h.service.deviceCommand(h.other.token, command, proof)).rejects.toThrow('device fault')
  expect(h.db.prepare('SELECT count(*) AS n FROM organization_devices').get()?.n).toBe(0)
  h.db.exec('DROP TRIGGER reject_receipt')
  await h.service.deviceCommand(h.other.token, command, proof)
  const changed = { ...command, operationId: operationId(), publicKey: keys().publicKey }
  const fresh = await h.service.deviceChallenge(h.other.token, changed)
  vi.spyOn(Date, 'now').mockReturnValue(fresh.expiresAt)
  await expect(h.service.deviceCommand(h.other.token, changed, key.proof(fresh))).rejects.toMatchObject({ code: 'version-conflict' })
  for (let i = 0; i < 30; i++) await h.service.deviceChallenge(h.other.token, changed)
  await expect(h.service.deviceChallenge(h.other.token, changed)).rejects.toMatchObject({ code: 'rate-limited' })
})

it.each(['delegation', 'lease', 'key', 'action', 'receipt'])('rejects damaged %s records on cold reopen', async (damage) => {
  const h = await setup(), a = await register(h), d = await delegate(h, a.receipt.deviceId!)
  const claim = await proven(h.service, h.other.token, { ...h.selector, kind: 'claim', operationId: operationId(), deviceId: a.receipt.deviceId, delegationId: d.delegationId }, a)
  await h.close()
  h.db.exec('PRAGMA foreign_keys=OFF')
  switch (damage) {
    case 'delegation': h.db.prepare('UPDATE assignment_delegations SET membershipId=?').run(h.owner.membershipId); break
    case 'lease': h.db.exec('UPDATE assignment_leases SET fencingEpoch=3'); break
    case 'key': h.db.exec("UPDATE organization_devices SET publicKey='YWJj'"); break
    case 'action': h.db.exec('DELETE FROM device_actions'); break
    case 'receipt': h.db.prepare("UPDATE operation_receipts SET response=json_set(response,'$.lease.fencingEpoch',3) WHERE operationId=?").run(claim.operationId); break
  }
  expect(() => openOrganizationDatabase(h.path, 100)).toThrow('incompatible-store')
})

it('retires delegations on new definition and rejects delegation before explicit acceptance', async () => {
  const h = await setup(), a = await register(h), d = await delegate(h, a.receipt.deviceId!)
  const revoke = await h.service.participantCommand(h.other.token, { ...h.selector, kind: 'revoke-delegation', operationId: operationId(),
    delegationId: d.delegationId, expectedVersion: d.revision })
  expect(await h.service.receipt(h.other.token, revoke.operationId)).toEqual(revoke)
  const fresh = await delegate(h, a.receipt.deviceId!)
  await h.service.savePlan(h.owner.token, { ...h.save, expectedRevision: 1, operationId: operationId() })
  await expect(proven(h.service, h.other.token, { ...h.selector, kind: 'claim', operationId: operationId(), deviceId: a.receipt.deviceId,
    delegationId: fresh.delegationId }, a)).rejects.toMatchObject({ code: 'version-conflict' })
  const approved = await h.service.assignmentCommand(h.owner.token, { ...h.approve, operationId: operationId(), planRevision: 2 })
  await expect(h.service.participantCommand(h.other.token, { ...h.query, assignmentId: approved.assignmentId, kind: 'delegate',
    operationId: operationId(), expectedVersion: approved.revision, deviceId: a.receipt.deviceId, executorId: 'desktop-builtin',
    capabilities: ['draft'], budget: 1, expiresAt: Date.now() + 10000 })).rejects.toMatchObject({ code: 'version-conflict' })
  expect(h.db.prepare('SELECT state FROM assignment_delegations WHERE id=?').get(fresh.delegationId!)?.state).toBe('invalidated')
  const reopened = openOrganizationDatabase(h.path, 100); reopened.close()
})

it('uses configured lease lifetime for renewal and preserves each operation result after release', async () => {
  const h = await setup(), a = await register(h), d = await delegate(h, a.receipt.deviceId!)
  await h.close()
  const configured = await openHarness(h.root, { leaseTtlMs: 1000 }); cleanup.push(configured.close)
  const now = Date.now(), clock = vi.spyOn(Date, 'now').mockReturnValue(now)
  const claim = await proven(configured.service, h.other.token, { ...h.selector, kind: 'claim', operationId: operationId(),
    deviceId: a.receipt.deviceId, delegationId: d.delegationId }, a)
  expect(claim.lease?.expiresAt).toBe(now + 1000)
  clock.mockReturnValue(now + 500)
  const renewed = await proven(configured.service, h.other.token, { ...h.selector, kind: 'renew', operationId: operationId(),
    deviceId: a.receipt.deviceId, fencingEpoch: claim.lease!.fencingEpoch,
    serverEpoch: claim.lease!.serverEpoch, expectedVersion: claim.revision }, a)
  expect(renewed.lease?.expiresAt).toBe(now + 1500)
  expect(renewed.lease?.fencingEpoch).toBe(claim.lease?.fencingEpoch)
  await proven(configured.service, h.other.token, { ...h.selector, kind: 'release', operationId: operationId(), deviceId: a.receipt.deviceId,
    fencingEpoch: renewed.lease!.fencingEpoch, serverEpoch: renewed.lease!.serverEpoch, expectedVersion: renewed.revision }, a)
  expect(await configured.service.receipt(h.other.token, renewed.operationId)).toEqual(renewed)
  const reopened = openOrganizationDatabase(h.path, 100); reopened.close()
})
