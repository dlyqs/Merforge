/** SQLite execution storage and validation of independently persisted relationships. */
import type { DatabaseSync } from 'node:sqlite'
import { executionDelegationSchema, executionRunSchema, executionActionSchema, executionReceiptSchema } from './execution-schema.ts'
import { assignmentSchema } from './assignment-schema.ts'
import { parseDelegation } from './assignment-participant.ts'
import { OrganizationError } from './error.ts'
/** v7 adds execution records without altering or expanding preparation grants. */
export const executionDdl = `
CREATE TABLE execution_delegations (id TEXT PRIMARY KEY, assignmentId TEXT NOT NULL REFERENCES task_assignments(id), data TEXT NOT NULL) STRICT;
CREATE TABLE execution_runs (id TEXT PRIMARY KEY, assignmentId TEXT NOT NULL REFERENCES task_assignments(id), delegationId TEXT NOT NULL REFERENCES execution_delegations(id), data TEXT NOT NULL) STRICT;
CREATE TABLE execution_actions (id TEXT PRIMARY KEY, runId TEXT NOT NULL REFERENCES execution_runs(id), data TEXT NOT NULL) STRICT;
CREATE TABLE execution_events (revision INTEGER PRIMARY KEY REFERENCES organization_events(revision), assignmentId TEXT NOT NULL REFERENCES task_assignments(id), result TEXT NOT NULL) STRICT;
`
/**
 * Reject mismatched identities, owner epochs, charged budgets and missing operation snapshots.
 * @param db - Startup or stopped-maintenance transaction.
 */
export function validateExecutionDatabase(db: DatabaseSync): void {
  const fail = (): never => { throw new OrganizationError('incompatible-store') }
  for (const row of db.prepare('SELECT * FROM execution_delegations').all()) {
    const d = executionDelegationSchema.parse(JSON.parse(String(row.data)))
    const a = assignmentSchema.parse(db.prepare('SELECT * FROM task_assignments WHERE id=?').get(d.assignmentId))
    const p = parseDelegation(db.prepare('SELECT * FROM assignment_delegations WHERE id=?').get(d.delegationId))
    const event = db.prepare('SELECT * FROM organization_events WHERE revision=?').get(d.createdRevision)
    const member = db.prepare('SELECT accountId FROM memberships WHERE id=?').get(a.assigneeId)
    const used = db.prepare('SELECT count(*) AS n FROM execution_actions x JOIN execution_runs r ON r.id=x.runId WHERE r.delegationId=?').get(d.id)?.n
    if (row.id !== d.id || row.assignmentId !== a.id || d.planId !== a.planId || d.projectId !== a.projectId
      || d.organizationId !== a.organizationId
      || d.planRevision !== a.planRevision || p.assignmentId !== a.id || p.deviceId !== d.deviceId || p.membershipId !== a.assigneeId
      || d.expiresAt > p.expiresAt || d.budget > p.budget || d.used !== used || d.used > d.budget || d.version < d.createdRevision
      || db.prepare("SELECT json_extract(result,'$.executionDelegationId') AS id FROM execution_events WHERE revision=?").get(d.createdRevision)?.id !== d.id
      || event?.kind !== 'grant-execution' || event.actorId !== member?.accountId || event.organizationId !== a.organizationId
      || d.state === 'active' && p.state !== 'active') fail()
  }
  for (const row of db.prepare('SELECT * FROM execution_runs').all()) {
    const r = executionRunSchema.parse(JSON.parse(String(row.data)))
    const d = executionDelegationSchema.parse(JSON.parse(String(db.prepare('SELECT data FROM execution_delegations WHERE id=?').get(r.executionDelegationId)?.data)))
    const lease = db.prepare('SELECT * FROM assignment_leases WHERE assignmentId=? AND fencingEpoch=?').get(r.assignmentId, r.fencingEpoch)
    if (row.id !== r.id || row.assignmentId !== r.assignmentId || row.delegationId !== d.id || d.assignmentId !== r.assignmentId
      || r.deviceId !== d.deviceId || r.planRevision !== d.planRevision || r.configDigest !== d.configDigest
      || r.organizationId !== d.organizationId || r.projectId !== d.projectId || r.planId !== d.planId || r.version < r.createdRevision
      || lease?.serverEpoch !== r.serverEpoch || lease.delegationId !== d.delegationId || lease.deviceId !== r.deviceId
      || db.prepare("SELECT json_extract(result,'$.runId') AS id FROM execution_events WHERE revision=?").get(r.createdRevision)?.id !== r.id
      || db.prepare('SELECT kind FROM organization_events WHERE revision=?').get(r.createdRevision)?.kind !== 'create-run') fail()
  }
  for (const row of db.prepare('SELECT * FROM execution_actions').all()) {
    const a = executionActionSchema.parse(JSON.parse(String(row.data)))
    const r = executionRunSchema.parse(JSON.parse(String(db.prepare('SELECT data FROM execution_runs WHERE id=?').get(a.runId)?.data)))
    const d = executionDelegationSchema.parse(JSON.parse(String(db.prepare('SELECT data FROM execution_delegations WHERE id=?').get(r.executionDelegationId)?.data)))
    if (row.id !== a.actionId || row.runId !== r.id || a.assignmentId !== r.assignmentId || a.deviceId !== r.deviceId
      || a.executionDelegationId !== r.executionDelegationId || a.planRevision !== r.planRevision || a.serverEpoch !== r.serverEpoch
      || a.fencingEpoch !== r.fencingEpoch || a.organizationId !== r.organizationId || a.projectId !== r.projectId || a.planId !== r.planId
      || !d.capabilities.includes(a.capability) || a.expiresAt > d.expiresAt || a.version < a.createdRevision
      || a.state === 'reserved' && a.evidenceDigest !== null
      || !['reserved','unknown'].includes(a.state) && a.evidenceDigest === null
      || db.prepare("SELECT json_extract(result,'$.actionId') AS id FROM execution_events WHERE revision=?").get(a.createdRevision)?.id !== a.actionId
      || db.prepare('SELECT kind FROM organization_events WHERE revision=?').get(a.createdRevision)?.kind !== 'reserve-action') fail()
  }
  for (const row of db.prepare('SELECT * FROM execution_events').all()) {
    const result = executionReceiptSchema.parse(JSON.parse(String(row.result)))
    const d = db.prepare('SELECT assignmentId FROM execution_delegations WHERE id=?').get(result.executionDelegationId)
    const e = db.prepare('SELECT * FROM organization_events WHERE revision=?').get(row.revision ?? null)
    const a = db.prepare('SELECT a.organizationId,m.accountId FROM task_assignments a JOIN memberships m ON m.id=a.assigneeId WHERE a.id=?').get(row.assignmentId ?? null)
    if (d?.assignmentId !== row.assignmentId || e?.organizationId !== a?.organizationId || e?.actorId !== a?.accountId
      || !['grant-execution','revoke-execution','create-run','reserve-action','settle-action','transition-run'].includes(String(e?.kind))) fail()
    if (result.runId && db.prepare('SELECT delegationId FROM execution_runs WHERE id=?').get(result.runId)?.delegationId !== result.executionDelegationId) fail()
    if (result.actionId && db.prepare('SELECT runId FROM execution_actions WHERE id=?').get(result.actionId)?.runId !== result.runId) fail()
  }
  if (db.prepare(`SELECT 1 FROM organization_events e LEFT JOIN execution_events x ON x.revision=e.revision
    WHERE e.kind IN ('grant-execution','revoke-execution','create-run','reserve-action','settle-action','transition-run') AND x.revision IS NULL`).get()) fail()
}
