import { integrationDdl, validateIntegrationDatabase } from './integration.ts'
import { integrationRecordSchema } from './integration-schema.ts'
/** Organization-only SQLite schema, transaction ownership and durable validation. */
import { acceptanceDdl, validateAcceptanceDatabase } from './acceptance.ts'
import { deliveryDdl, validateDeliveryDatabase } from './delivery.ts'
import { executionHumanDdl, executionDdl, validateExecutionDatabase } from './execution-database.ts'
import { deviceDdl, validateDeviceDatabase } from './device-database.ts'
import { assignmentDdl, delegationDdl, migrateAssignmentV4, validateAssignmentDatabase } from './assignment-database.ts'
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, openSync, closeSync } from 'node:fs'
import { dirname, isAbsolute } from 'node:path'
import { randomUUID } from 'node:crypto'
import { workgraphDdl, validateWorkgraphDatabase } from './workgraph-database.ts'
import { projectSchema, grantSchema, resourceEventSchema } from './resource-schema.ts'
import { OrganizationError } from './error.ts'
import { accountSchema, attemptSchema, eventSchema, invitationSchema, membershipSchema, metadataSchema, organizationSchema, receiptRowSchema, receiptSchema, sessionSchema } from './schema.ts'

/** Organization physical schema; changes never alter the personal Session format. */
export const ORGANIZATION_SCHEMA_VERSION = 11
const applicationId = 0x4d464f52
const ddl = `
CREATE TABLE metadata (singleton INTEGER PRIMARY KEY CHECK(singleton=1), serverId TEXT NOT NULL,
  rootAccountId TEXT REFERENCES accounts(id), rootOrganizationId TEXT REFERENCES organizations(id), recoveryHash TEXT) STRICT;
CREATE TABLE accounts (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, passwordHash TEXT NOT NULL,
  enabled INTEGER NOT NULL CHECK(enabled IN (0,1)), version INTEGER NOT NULL) STRICT;
CREATE TABLE organizations (id TEXT PRIMARY KEY, name TEXT NOT NULL, version INTEGER NOT NULL) STRICT;
CREATE TABLE memberships (id TEXT PRIMARY KEY, organizationId TEXT NOT NULL REFERENCES organizations(id), accountId TEXT NOT NULL REFERENCES accounts(id),
  role TEXT NOT NULL CHECK(role IN ('admin','member')), enabled INTEGER NOT NULL CHECK(enabled IN (0,1)), version INTEGER NOT NULL,
  UNIQUE(organizationId,accountId)) STRICT;
CREATE TABLE invitations (id TEXT PRIMARY KEY, organizationId TEXT NOT NULL REFERENCES organizations(id), issuerId TEXT NOT NULL REFERENCES memberships(id),
  role TEXT NOT NULL CHECK(role IN ('admin','member')), tokenHash TEXT UNIQUE NOT NULL, expiresAt INTEGER NOT NULL,
  consumed INTEGER NOT NULL CHECK(consumed IN (0,1)), version INTEGER NOT NULL) STRICT;
CREATE TABLE login_sessions (tokenHash TEXT PRIMARY KEY, accountId TEXT NOT NULL REFERENCES accounts(id), expiresAt INTEGER NOT NULL) STRICT;
CREATE TABLE login_attempts (key TEXT PRIMARY KEY, startedAt INTEGER NOT NULL, attempts INTEGER NOT NULL) STRICT;
CREATE TABLE organization_events (revision INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, actorId TEXT REFERENCES accounts(id) DEFERRABLE INITIALLY DEFERRED,
  organizationId TEXT REFERENCES organizations(id) DEFERRABLE INITIALLY DEFERRED, at INTEGER NOT NULL) STRICT;
CREATE TABLE operation_receipts (scope TEXT NOT NULL, operationId TEXT NOT NULL, fingerprint TEXT NOT NULL, response TEXT NOT NULL,
  PRIMARY KEY(scope,operationId)) STRICT;
`

const resourceDdl = `
CREATE TABLE organization_projects (id TEXT PRIMARY KEY, organizationId TEXT NOT NULL REFERENCES organizations(id), name TEXT NOT NULL, version INTEGER NOT NULL) STRICT;
CREATE TABLE resource_grants (projectId TEXT NOT NULL REFERENCES organization_projects(id), membershipId TEXT NOT NULL REFERENCES memberships(id),
  canRead INTEGER NOT NULL CHECK(canRead IN (0,1)), canWrite INTEGER NOT NULL CHECK(canWrite IN (0,1)), version INTEGER NOT NULL,
  PRIMARY KEY(projectId,membershipId)) STRICT;
CREATE TABLE resource_events (revision INTEGER PRIMARY KEY REFERENCES organization_events(revision), projectId TEXT NOT NULL REFERENCES organization_projects(id)) STRICT;
`

/**
 * Run one synchronous transaction; no partially committed records escape on failure.
 * @param db - The owning service's open connection.
 * @param work - Synchronous work under the write lock.
 * @returns The result after successful COMMIT.
 */
export function transaction<T>(db: DatabaseSync, work: () => T): T {
  db.exec('BEGIN IMMEDIATE')
  try {
    const result = work()
    db.exec('COMMIT')
    return result
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

/**
 * Open a dedicated owner-only local database; reject other formats and invalid rows.
 * @param path - Absolute organization database path.
 * @param busyTimeoutMs - Validated SQLite lock wait ceiling.
 * @returns A configured database owned by the caller until close.
 */
export function openOrganizationDatabase(path: string, busyTimeoutMs: number): DatabaseSync {
  if (!isAbsolute(path)) throw new OrganizationError('invalid-input')
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  let fd: number | undefined
  try { fd = openSync(path, 'wx', 0o600) } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
  if (fd !== undefined) closeSync(fd)
  const db = new DatabaseSync(path)
  try {
    db.exec(`PRAGMA busy_timeout=${busyTimeoutMs}; PRAGMA foreign_keys=ON`)
    transaction(db, () => {
      const stamp = db.prepare('PRAGMA user_version').get()?.user_version
      const app = db.prepare('PRAGMA application_id').get()?.application_id
      if (stamp === 0 && app === 0 && db.prepare("SELECT name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'").all().length === 0) {
        db.exec(ddl + resourceDdl + workgraphDdl + assignmentDdl + delegationDdl
          + deviceDdl + executionDdl + executionHumanDdl + deliveryDdl + acceptanceDdl + integrationDdl)
        db.prepare('INSERT INTO metadata VALUES (1,?,NULL,NULL,NULL)').run(randomUUID())
        db.exec(`PRAGMA user_version=${ORGANIZATION_SCHEMA_VERSION}; PRAGMA application_id=${applicationId}`)
      } else if ((stamp === 1 || stamp === 2 || stamp === 3 || stamp === 4 ||
        stamp === 5 || stamp === 6 || stamp === 7 || stamp === 8 || stamp === 9 || stamp === 10) && app === applicationId) {
        if (stamp < 4) validateDatabase(db, stamp >= 2, stamp >= 3, false)
        if (stamp === 1) db.exec(resourceDdl)
        if (stamp < 3) db.exec(workgraphDdl)
        if (stamp === 4) migrateAssignmentV4(db)
        else if (stamp < 4) db.exec(assignmentDdl)
        if (stamp < 5) db.exec(delegationDdl)
        if (stamp < 6) db.exec(deviceDdl)
        if (stamp < 7) db.exec(executionDdl)
        if (stamp < 8) db.exec(executionHumanDdl)
        if (stamp < 9) db.exec(deliveryDdl)
        if (stamp < 10) db.exec(acceptanceDdl)
        db.exec(integrationDdl)
        db.exec(`PRAGMA user_version=${ORGANIZATION_SCHEMA_VERSION}`)
      } else if (stamp !== ORGANIZATION_SCHEMA_VERSION || app !== applicationId) {
        throw new OrganizationError('incompatible-store')
      }
      validateDatabase(db)
    })
    db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL')
    return db
  } catch (error) {
    db.close()
    throw error
  }
}

function validateDatabase(db: DatabaseSync, resources = true, workgraph = true, assignments = true): void {
  try {
    if (workgraph) validateWorkgraphDatabase(db)
    if (assignments) {
      validateAssignmentDatabase(db); validateDeviceDatabase(db); validateExecutionDatabase(db)
      validateDeliveryDatabase(db); validateAcceptanceDatabase(db); validateIntegrationDatabase(db)
    }
    if (resources) {
      for (const row of db.prepare('SELECT * FROM organization_projects').all()) projectSchema.parse(row)
      for (const row of db.prepare('SELECT * FROM resource_grants').all()) grantSchema.parse(row)
      for (const row of db.prepare('SELECT * FROM resource_events').all()) resourceEventSchema.parse(row)
      if (db.prepare(`SELECT 1 FROM resource_events r JOIN organization_events e ON e.revision=r.revision
        JOIN organization_projects p ON p.id=r.projectId WHERE e.organizationId<>p.organizationId
        OR e.kind NOT IN ('create-project','rename-project','set-grant') LIMIT 1`).get()) throw new OrganizationError('incompatible-store')
      if (db.prepare(`SELECT 1 FROM resource_grants g JOIN organization_projects p ON p.id=g.projectId
        JOIN memberships m ON m.id=g.membershipId WHERE p.organizationId<>m.organizationId LIMIT 1`).get()) throw new OrganizationError('incompatible-store')
    }
    const metadata = metadataSchema.strict().parse(db.prepare('SELECT * FROM metadata').get())
    for (const row of db.prepare('SELECT * FROM accounts').all()) accountSchema.strict().parse(row)
    for (const row of db.prepare('SELECT * FROM organizations').all()) organizationSchema.strict().parse(row)
    for (const row of db.prepare('SELECT * FROM memberships').all()) membershipSchema.strict().parse(row)
    for (const row of db.prepare('SELECT * FROM invitations').all()) invitationSchema.strict().parse(row)
    for (const row of db.prepare('SELECT * FROM login_sessions').all()) sessionSchema.strict().parse(row)
    for (const row of db.prepare('SELECT * FROM login_attempts').all()) attemptSchema.strict().parse(row)
    for (const row of db.prepare('SELECT * FROM organization_events').all()) eventSchema.strict().parse(row)
    for (const row of db.prepare('SELECT * FROM operation_receipts').all()) {
      const stored = receiptRowSchema.strict().parse(row)
      const receipt = receiptSchema.parse(JSON.parse(stored.response))
      if (receipt.operationId !== stored.operationId) throw new OrganizationError('incompatible-store')
      if (receipt.integration) {
        const event = db.prepare('SELECT * FROM integration_events WHERE revision=?').get(receipt.revision)
        const r = integrationRecordSchema.parse(JSON.parse(String(db.prepare('SELECT data FROM organization_integrations WHERE id=?').get(receipt.integration.integrationId)?.data)))
        if (event?.result !== JSON.stringify(receipt.integration) || event.integrationId !== r.id
          || receipt.organizationId !== r.organizationId || receipt.projectId !== r.projectId || receipt.planId !== r.planId
          || receipt.planRevision !== r.planRevision) throw new OrganizationError('incompatible-store')
        continue
      }
      if (receipt.delivery) {
        const event = db.prepare('SELECT * FROM delivery_events WHERE revision=?').get(receipt.revision)
        const a = db.prepare('SELECT * FROM task_assignments WHERE id=?').get(receipt.assignmentId ?? null)
        if (!event || event.assignmentId !== receipt.assignmentId || event.result !== JSON.stringify(receipt.delivery)
          || a?.organizationId !== receipt.organizationId || a?.projectId !== receipt.projectId
          || a?.planId !== receipt.planId || a?.planRevision !== receipt.planRevision) throw new OrganizationError('incompatible-store')
        continue
      }
      if (receipt.execution) {
        const x = db.prepare('SELECT * FROM execution_events WHERE revision=?').get(receipt.revision)
        const a = db.prepare('SELECT * FROM task_assignments WHERE id=?').get(receipt.assignmentId ?? null)
        if (!x || x.assignmentId !== receipt.assignmentId || x.result !== JSON.stringify(receipt.execution)
          || a?.organizationId !== receipt.organizationId || a?.projectId !== receipt.projectId
          || a?.planId !== receipt.planId || a?.planRevision !== receipt.planRevision || receipt.deviceId || receipt.lease) throw new OrganizationError('incompatible-store')
        continue
      }
      if (receipt.deviceId !== undefined) {
        if (!assignments) throw new OrganizationError('incompatible-store')
        const action = db.prepare('SELECT x.*,d.organizationId FROM device_actions x JOIN organization_devices d ON d.id=x.deviceId WHERE x.revision=?').get(receipt.revision)
        if (!action || action.deviceId !== receipt.deviceId || action.organizationId !== receipt.organizationId
          || JSON.stringify(receipt.lease ?? null) !== (action.lease ?? 'null')) throw new OrganizationError('incompatible-store')
        if (receipt.lease) {
          const assignment = db.prepare('SELECT * FROM task_assignments WHERE id=?').get(receipt.lease.assignmentId)
          if (!assignment || receipt.assignmentId !== receipt.lease.assignmentId || receipt.delegationId !== receipt.lease.delegationId
            || receipt.projectId !== assignment.projectId || receipt.planId !== assignment.planId
            || receipt.planRevision !== assignment.planRevision) throw new OrganizationError('incompatible-store')
        } else if (receipt.assignmentId || receipt.delegationId || receipt.projectId || receipt.planId || receipt.planRevision) {
          throw new OrganizationError('incompatible-store')
        }
        continue
      }
      if (receipt.assignmentId !== undefined) {
        if (!assignments) throw new OrganizationError('incompatible-store')
        const valid = db.prepare(`SELECT 1 FROM task_assignments a JOIN organization_events e ON e.revision=?
          JOIN memberships m ON m.accountId=e.actorId AND m.organizationId=a.organizationId
          WHERE a.id=? AND a.organizationId=? AND a.projectId=? AND a.planId=? AND a.planRevision=?
          AND ((e.kind='approve-assignment' AND a.createdRevision=e.revision AND a.approvedBy=m.id)
            OR (e.kind='revoke-assignment' AND a.version=e.revision AND a.state='revoked')
            OR (e.kind IN ('answer-execution-question','approve-execution-tool') AND EXISTS (SELECT 1 FROM execution_human_requests h WHERE h.assignmentId=a.id AND json_extract(h.data,'$.handlerId')=m.id AND json_extract(h.data,'$.answeredRevision')=e.revision))
            OR (e.kind IN ('answer-assignment','read-notification','delegate','revoke-delegation') AND a.assigneeId=m.id
              AND EXISTS (SELECT 1 FROM assignment_actions x WHERE x.revision=e.revision AND x.assignmentId=a.id)))`)
          .get(receipt.revision, receipt.assignmentId, receipt.organizationId ?? null, receipt.projectId ?? null,
            receipt.planId ?? null, receipt.planRevision ?? null)
        if (!valid) throw new OrganizationError('incompatible-store')
        const action = db.prepare('SELECT delegationId FROM assignment_actions WHERE revision=?').get(receipt.revision)
        if ((receipt.delegationId ?? null) !== (action?.delegationId ?? null)) throw new OrganizationError('incompatible-store')
        continue
      }
      if (receipt.planId !== undefined || receipt.planRevision !== undefined) {
        const event = db.prepare('SELECT kind FROM organization_events WHERE revision=?').get(receipt.revision)
        const valid = event?.kind === 'set-task-grant' && receipt.planRevision === undefined
          ? db.prepare(`SELECT 1 FROM workgraph_events w JOIN organization_plans p ON p.id=w.planId
            WHERE w.planId=? AND w.revision=? AND p.organizationId=? AND p.projectId=?`)
            .get(receipt.planId ?? null, receipt.revision, receipt.organizationId ?? null, receipt.projectId ?? null)
          : db.prepare(`SELECT 1 FROM plan_revisions r JOIN organization_plans p ON p.id=r.planId
            WHERE r.planId=? AND r.revision=? AND r.eventRevision=? AND p.organizationId=? AND p.projectId=?`)
            .get(receipt.planId ?? null, receipt.planRevision ?? null, receipt.revision,
              receipt.organizationId ?? null, receipt.projectId ?? null)
        if (!workgraph || !valid) throw new OrganizationError('incompatible-store')
      }
    }
    if (db.prepare('PRAGMA foreign_key_check').all().length > 0) throw new OrganizationError('incompatible-store')
    const initialized = metadata.rootAccountId !== null
    if (initialized !== (metadata.rootOrganizationId !== null) || initialized !== (metadata.recoveryHash !== null)) throw new OrganizationError('incompatible-store')
    if (!initialized && db.prepare('SELECT id FROM accounts UNION ALL SELECT id FROM organizations').all().length > 0) throw new OrganizationError('incompatible-store')
    if (db.prepare(`SELECT o.id FROM organizations o WHERE NOT EXISTS (
      SELECT 1 FROM memberships m JOIN accounts a ON a.id=m.accountId
      WHERE m.organizationId=o.id AND m.role='admin' AND m.enabled=1 AND a.enabled=1)`).all().length > 0) throw new OrganizationError('incompatible-store')
  } catch (error) {
    if (error instanceof OrganizationError) throw error
    throw new OrganizationError('incompatible-store')
  }
}
