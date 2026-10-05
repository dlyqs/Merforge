/** Schema v6 key registrations, ownership history and persisted cross-record validation. */
import { z } from 'zod'
import type { DatabaseSync } from 'node:sqlite'
import { OrganizationError } from './error.ts'
import { deviceSchema, leaseSchema } from './device-schema.ts'
import { createPublicKey } from 'node:crypto'
import { parseDelegation } from './assignment-participant.ts'

/** Device actions retain their original lease result even after another owner takes over. */
export const deviceDdl = `
CREATE TABLE organization_devices (id TEXT PRIMARY KEY, organizationId TEXT NOT NULL REFERENCES organizations(id),
  accountId TEXT NOT NULL REFERENCES accounts(id), membershipId TEXT NOT NULL REFERENCES memberships(id),
  publicKey TEXT UNIQUE NOT NULL, keyGeneration INTEGER NOT NULL, name TEXT NOT NULL, registeredAt INTEGER NOT NULL,
  createdRevision INTEGER NOT NULL REFERENCES organization_events(revision), version INTEGER NOT NULL REFERENCES organization_events(revision),
  state TEXT NOT NULL CHECK(state IN ('active','revoked'))) STRICT;
CREATE TABLE assignment_leases (assignmentId TEXT NOT NULL REFERENCES task_assignments(id),
  delegationId TEXT NOT NULL REFERENCES assignment_delegations(id), deviceId TEXT NOT NULL REFERENCES organization_devices(id),
  fencingEpoch INTEGER NOT NULL, serverEpoch TEXT NOT NULL, expiresAt INTEGER NOT NULL,
  createdRevision INTEGER NOT NULL REFERENCES organization_events(revision), version INTEGER NOT NULL REFERENCES organization_events(revision),
  state TEXT NOT NULL CHECK(state IN ('held','released','expired','invalidated')), PRIMARY KEY(assignmentId,fencingEpoch)) STRICT;
CREATE UNIQUE INDEX lease_held ON assignment_leases(assignmentId) WHERE state='held';
CREATE TABLE device_actions (revision INTEGER PRIMARY KEY REFERENCES organization_events(revision),
  deviceId TEXT NOT NULL REFERENCES organization_devices(id), lease TEXT) STRICT;
`

/**
 * Reject malformed keys, cross-account registrations and mismatched ownership history.
 * @param db - Startup or offline maintenance transaction.
 */
export function validateDeviceDatabase(db: DatabaseSync): void {
  const fail = () => { throw new OrganizationError('incompatible-store') }
  for (const row of db.prepare('SELECT * FROM organization_devices').all()) {
    const d = deviceSchema.parse(row)
    try { validateHistoricalKey(d.publicKey) } catch (error) {
      if (error instanceof OrganizationError && error.code === 'invalid-input') fail()
      throw error
    }
    const member = db.prepare('SELECT m.*,a.enabled AS accountEnabled FROM memberships m JOIN accounts a ON a.id=m.accountId WHERE m.id=?').get(d.membershipId)
    const event = db.prepare('SELECT * FROM organization_events WHERE revision=?').get(d.createdRevision)
    if (member?.accountId !== d.accountId || member.organizationId !== d.organizationId || d.version < d.createdRevision
      || event?.kind !== 'register-device' || event.actorId !== d.accountId || event.organizationId !== d.organizationId
      || !db.prepare('SELECT 1 FROM device_actions WHERE revision=? AND deviceId=?').get(d.createdRevision, d.id)
      || event.at !== d.registeredAt || d.state === 'active' && (member.enabled !== 1 || member.accountEnabled !== 1)) fail()
    if (d.state === 'revoked') {
      const terminal = db.prepare('SELECT kind FROM organization_events WHERE revision=?').get(d.version)
      if (d.version <= d.createdRevision || !['revoke-device', 'set-membership', 'set-account', 'restore', 'simplify-task-workflow'].includes(String(terminal?.kind))) fail()
    }
  }
  for (const row of db.prepare('SELECT * FROM assignment_delegations').all()) {
    const d = parseDelegation(row)
    const device = db.prepare('SELECT membershipId,state FROM organization_devices WHERE id=?').get(d.deviceId)
    if (device?.membershipId !== d.membershipId || d.state === 'active' && device.state !== 'active') fail()
  }
  const epochs = new Map<string, number>()
  for (const row of db.prepare('SELECT * FROM assignment_leases ORDER BY assignmentId,fencingEpoch').all()) {
    const lease = leaseSchema.parse(row)
    const d = parseDelegation(db.prepare('SELECT * FROM assignment_delegations WHERE id=?').get(lease.delegationId))
    const event = db.prepare('SELECT e.*,m.accountId FROM organization_events e JOIN memberships m ON m.id=? WHERE e.revision=?').get(d.membershipId, lease.createdRevision)
    const a = db.prepare('SELECT organizationId FROM task_assignments WHERE id=?').get(d.assignmentId)
    if (lease.assignmentId !== d.assignmentId || lease.deviceId !== d.deviceId || lease.expiresAt > d.expiresAt
      || lease.version < lease.createdRevision || event?.kind !== 'claim' || event.actorId !== event.accountId || event.organizationId !== a?.organizationId
      || lease.expiresAt <= Number(event.at) || lease.state === 'held' && d.state !== 'active'
      || lease.fencingEpoch !== (epochs.get(lease.assignmentId) ?? 0) + 1) fail()
    epochs.set(lease.assignmentId, lease.fencingEpoch)
    const terminal = db.prepare('SELECT kind FROM organization_events WHERE revision=?').get(lease.version)
    if (lease.state === 'released' && terminal?.kind !== 'release') fail()
    if (lease.state === 'held' && !['claim', 'renew'].includes(String(terminal?.kind))) fail()
    if (lease.state === 'held' || lease.state === 'released') {
      const action = db.prepare('SELECT lease FROM device_actions WHERE revision=?').get(lease.version)
      if (action?.lease !== JSON.stringify(lease)) fail()
    }
  }
  if (db.prepare(`SELECT 1 FROM organization_events e LEFT JOIN device_actions x ON x.revision=e.revision
    WHERE e.kind IN ('register-device','revoke-device','claim','renew','release') AND x.revision IS NULL LIMIT 1`).get()) fail()
  for (const row of db.prepare('SELECT * FROM device_actions').all()) {
    const action = z.object({ revision: z.number().int().positive(),
      deviceId: deviceSchema.shape.id, lease: z.string().nullable() }).strict().parse(row)
    const d = deviceSchema.parse(db.prepare('SELECT * FROM organization_devices WHERE id=?').get(action.deviceId))
    const e = db.prepare('SELECT * FROM organization_events WHERE revision=?').get(action.revision)
    if (e?.actorId !== d.accountId || e.organizationId !== d.organizationId) fail()
    if (row.lease !== null) {
      const lease = leaseSchema.parse(JSON.parse(String(row.lease)))
      if (!['claim','renew','release'].includes(String(e?.kind)) || lease.deviceId !== d.id || lease.version !== row.revision
        || lease.state !== (e?.kind === 'release' ? 'released' : 'held')
        || !db.prepare('SELECT 1 FROM assignment_leases WHERE assignmentId=? AND fencingEpoch=? AND createdRevision=?')
          .get(lease.assignmentId, lease.fencingEpoch, lease.createdRevision)) fail()
    } else if (!['register-device','revoke-device'].includes(String(e?.kind))) fail()
  }
}

function validateHistoricalKey(encoded: string): void {
  const key = createPublicKey({ key: Buffer.from(encoded, 'base64'), format: 'der', type: 'spki' })
  if (key.asymmetricKeyType !== 'ed25519' || key.export({ format: 'der', type: 'spki' }).toString('base64') !== encoded) {
    throw new OrganizationError('incompatible-store')
  }
}
