/** Authority-owned key registrations, bounded challenges and transaction-local leases. */
import type { executionCommandSchema } from './execution-schema.ts'
import { createPublicKey, randomUUID, verify } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { z } from 'zod'
import { OrganizationError } from './error.ts'
import { authorizeParticipant, parseDelegation } from './assignment-participant.ts'
import { selectedAssignment, assignmentInvalidation } from './assignment.ts'
import { deviceSchema, leaseSchema, deviceChallengeSchema, deviceChallengeText, type provenDeviceCommandSchema, type deviceCommandSchema, type deviceProofSchema } from './device-schema.ts'
import type { OrganizationDevice, OrganizationDeviceChallenge, OrganizationLease, OrganizationServerEpoch } from './device-types.ts'
import type { Principal } from './types.ts'
import type { OrganizationDeviceId } from './assignment-types.ts'

/**
 * Admit only canonical Ed25519 SPKI public keys.
 * @param encoded - Base64 public key supplied at registration or loaded from SQLite.
 */
export function validateDeviceKey(encoded: string): void {
  try {
    const key = createPublicKey({ key: Buffer.from(encoded, 'base64'), format: 'der', type: 'spki' })
    if (key.asymmetricKeyType !== 'ed25519' || key.export({ format: 'der', type: 'spki' }).toString('base64') !== encoded) throw new Error('key')
  } catch (error) {
    // Crypto parser failures are deliberately hidden from callers.
    void error
    throw new OrganizationError('invalid-input')
  }
}

/**
 * Require a current registration owned by this exact account and organization member.
 * @param db - Authority transaction.
 * @param principal - Current member identity.
 * @param deviceId - Known registration ID, never trusted without ownership checks.
 * @param active - Whether revoked history must be rejected.
 * @returns Matching device metadata.
 */
export function ownedDevice(db: DatabaseSync, principal: Principal, deviceId: string, active = true): OrganizationDevice {
  const row = db.prepare('SELECT * FROM organization_devices WHERE id=? AND organizationId=? AND accountId=? AND membershipId=?')
    .get(deviceId, principal.organizationId ?? null, principal.accountId, principal.membershipId ?? null)
  if (!row) throw new OrganizationError('forbidden')
  const device = deviceSchema.parse(row)
  if (active && device.state !== 'active') throw new OrganizationError('forbidden')
  return device
}

/** Short-lived, bounded proof records; they deliberately do not survive service activation. */
export class DeviceChallenges {
  private readonly challenges = new Map<string, { value: OrganizationDeviceChallenge; used: boolean }>()
  /**
   * @param serverEpoch - Current authority activation.
   * @param limits - Configured lifetime and per-account/global issuance ceilings per lifetime window.
   */
  constructor(private readonly serverEpoch: OrganizationServerEpoch,
    private readonly limits: { deviceChallengeTtlMs: number; deviceChallengeMaxPerAccount: number; deviceChallengeMaxTotal: number }) {}
  /**
   * Allocate an action-bound one-use challenge after current device ownership checks.
   * @param db - Authority transaction.
   * @param principal - Current logged-in member.
   * @param command - Normalized fixed command.
   * @param digest - Digest of the normalized command, excluding proof.
   * @returns Challenge fields to be signed in their canonical order.
   */
  issue(
    db: DatabaseSync, principal: Principal, command: z.output<typeof provenDeviceCommandSchema> | z.output<typeof executionCommandSchema>,
    digest: string): OrganizationDeviceChallenge {
    const now = Date.now()
    for (const [id, entry] of this.challenges) if (entry.value.expiresAt <= now) this.challenges.delete(id)
    if (this.challenges.size >= this.limits.deviceChallengeMaxTotal
      || [...this.challenges.values()].filter(entry => entry.value.accountId === principal.accountId).length >= this.limits.deviceChallengeMaxPerAccount) throw new OrganizationError('rate-limited')
    const device = command.kind === 'register-device' ? null : ownedDevice(db, principal, command.deviceId, command.kind !== 'settle-action')
    const publicKey = command.kind === 'register-device' ? command.publicKey : ownedDevice(db, principal, command.deviceId, command.kind !== 'settle-action').publicKey
    validateDeviceKey(publicKey)
    const challenge = deviceChallengeSchema.parse({ protocol: 'merforge-device-v1',
      challengeId: randomUUID(), serverId: principal.serverId,
      serverEpoch: this.serverEpoch, accountId: principal.accountId, membershipId: principal.membershipId,
      organizationId: principal.organizationId,
      action: command.kind, requestDigest: digest, operationId: command.operationId, deviceId: device?.id ?? null,
      publicKey, keyGeneration: 1, issuedAt: now, expiresAt: now + this.limits.deviceChallengeTtlMs })
    this.challenges.set(challenge.challengeId, { value: challenge, used: false })
    return structuredClone(challenge)
  }
  /**
   * Verify every binding inside the write transaction; consume only after commit.
   * @param principal - Revalidated member identity.
   * @param command - Normalized action.
   * @param digest - Stable command fingerprint.
   * @param proof - Strict signature envelope.
   */
  verify(principal: Principal, command: z.output<typeof provenDeviceCommandSchema> | z.output<typeof executionCommandSchema>,
    digest: string, proof: z.output<typeof deviceProofSchema>): void {
    const entry = this.challenges.get(proof.challengeId)
    if (!entry || entry.used || entry.value.expiresAt <= Date.now()) throw new OrganizationError('version-conflict')
    const c = entry.value
    if (c.accountId !== principal.accountId || c.membershipId !== principal.membershipId || c.organizationId !== principal.organizationId
      || c.serverId !== principal.serverId || c.serverEpoch !== this.serverEpoch
      || c.action !== command.kind || c.operationId !== command.operationId
      || c.requestDigest !== digest || c.deviceId !== (command.kind === 'register-device' ? null : command.deviceId)) throw new OrganizationError('forbidden')
    const key = createPublicKey({ key: Buffer.from(c.publicKey, 'base64'), format: 'der', type: 'spki' })
    if (!verify(null, Buffer.from(deviceChallengeText(c)), key, Buffer.from(proof.signature, 'base64url'))) throw new OrganizationError('forbidden')
  }
  /**
   * Consume a verified challenge once its mutation is durable.
   * @param id - Challenge used by the committed write.
   */
  consume(id: string): void { const entry = this.challenges.get(id); if (entry) entry.used = true }
}

/**
 * Apply a device registration/revocation or exact-owner lease command.
 * @param db - Receipt transaction.
 * @param principal - Fresh member identity.
 * @param command - Strict action whose signature was verified when required.
 * @param revision - New audit revision.
 * @param serverEpoch - Current activation identity.
 * @param leaseTtlMs - Validated deployment lease lifetime.
 * @returns Device and optional lease for the durable receipt.
 */
export function changeDevice(db: DatabaseSync, principal: Principal, command: z.output<typeof deviceCommandSchema>, revision: number,
  serverEpoch: OrganizationServerEpoch, leaseTtlMs: number): { deviceId: OrganizationDeviceId; lease?: OrganizationLease } {
  const now = Date.now()
  if (command.kind === 'register-device') {
    validateDeviceKey(command.publicKey)
    if (db.prepare('SELECT id FROM organization_devices WHERE publicKey=?').get(command.publicKey)) throw new OrganizationError('version-conflict')
    const device = deviceSchema.parse({ id: randomUUID(), organizationId: principal.organizationId, accountId: principal.accountId,
      membershipId: principal.membershipId, publicKey: command.publicKey, keyGeneration: command.keyGeneration, name: command.name,
      registeredAt: Number(db.prepare('SELECT at FROM organization_events WHERE revision=?').get(revision)?.at), createdRevision: revision, version: revision, state: 'active' })
    db.prepare('INSERT INTO organization_devices VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(device.id, device.organizationId, device.accountId,
      device.membershipId, device.publicKey, device.keyGeneration, device.name, device.registeredAt, revision, revision, device.state)
    return { deviceId: device.id }
  }
  const device = ownedDevice(db, principal, command.deviceId)
  if (command.kind === 'revoke-device') {
    if (device.version !== command.expectedVersion) throw new OrganizationError('version-conflict')
    db.prepare("UPDATE organization_devices SET state='revoked',version=? WHERE id=?").run(revision, device.id)
    return { deviceId: device.id }
  }
  const assignment = selectedAssignment(db, command)
  authorizeParticipant(db, principal, assignment)
  if (assignment.state !== 'accepted' || assignmentInvalidation(db, assignment) !== null) throw new OrganizationError('version-conflict')
  const row = db.prepare('SELECT * FROM assignment_leases WHERE assignmentId=? ORDER BY fencingEpoch DESC LIMIT 1').get(assignment.id)
  const previous = row ? leaseSchema.parse(row) : undefined
  let delegationId
  if (command.kind === 'claim') {
    if (previous?.state === 'held' && previous.serverEpoch === serverEpoch && previous.expiresAt > now) throw new OrganizationError('version-conflict')
    delegationId = command.delegationId
  } else {
    if (!previous || previous.state !== 'held' || previous.expiresAt <= now || previous.serverEpoch !== serverEpoch
      || command.serverEpoch !== serverEpoch || previous.fencingEpoch !== command.fencingEpoch
      || previous.deviceId !== device.id || previous.version !== command.expectedVersion) throw new OrganizationError('version-conflict')
    delegationId = previous.delegationId
  }
  const delegation = parseDelegation(db.prepare('SELECT * FROM assignment_delegations WHERE id=? AND assignmentId=?').get(delegationId, assignment.id))
  if (delegation.deviceId !== device.id || delegation.membershipId !== principal.membershipId) throw new OrganizationError('forbidden')
  if (delegation.state !== 'active' || delegation.expiresAt <= now || delegation.planRevision !== assignment.planRevision) throw new OrganizationError('version-conflict')
  const lease = leaseSchema.parse({ assignmentId: assignment.id, delegationId, deviceId: device.id,
    fencingEpoch: command.kind === 'claim' ? (previous?.fencingEpoch ?? 0) + 1 : previous?.fencingEpoch,
    serverEpoch, expiresAt: command.kind === 'release' ? previous?.expiresAt : Math.min(now + leaseTtlMs, delegation.expiresAt),
    createdRevision: command.kind === 'claim' ? revision : previous?.createdRevision, version: revision,
    state: command.kind === 'release' ? 'released' : 'held' })
  if (command.kind === 'claim') {
    if (previous?.state === 'held') db.prepare("UPDATE assignment_leases SET state='expired',version=? WHERE assignmentId=? AND fencingEpoch=?").run(revision, assignment.id, previous.fencingEpoch)
    db.prepare('INSERT INTO assignment_leases VALUES (?,?,?,?,?,?,?,?,?)').run(lease.assignmentId, lease.delegationId, lease.deviceId,
      lease.fencingEpoch, lease.serverEpoch, lease.expiresAt, lease.createdRevision, lease.version, lease.state)
  } else db.prepare('UPDATE assignment_leases SET state=?,expiresAt=?,version=? WHERE assignmentId=? AND fencingEpoch=?')
    .run(lease.state, lease.expiresAt, revision, assignment.id, lease.fencingEpoch)
  return { deviceId: device.id, lease }
}

/**
 * Retire device-dependent permissions in the same transaction as their cause.
 * @param db - Authority write transaction.
 * @param revision - Causing audit revision.
 * @param restored - Restore revokes all registrations, even with valid old account tokens.
 */
export function invalidateDevicesAndLeases(db: DatabaseSync, revision: number, restored = false): void {
  db.prepare(`UPDATE organization_devices SET state='revoked',version=? WHERE state='active' AND (?=1 OR membershipId IN
    (SELECT m.id FROM memberships m JOIN accounts a ON a.id=m.accountId WHERE m.enabled=0 OR a.enabled=0))`).run(revision, Number(restored))
  db.prepare(`UPDATE assignment_delegations SET state='invalidated',version=? WHERE state='active' AND deviceId IN
    (SELECT id FROM organization_devices WHERE state='revoked')`).run(revision)
  db.prepare(`UPDATE assignment_leases SET state='invalidated',version=? WHERE state='held' AND delegationId IN
    (SELECT id FROM assignment_delegations WHERE state<>'active')`).run(revision)
}
