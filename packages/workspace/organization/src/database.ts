/** Organization-only SQLite schema, transaction ownership and durable validation. */
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, openSync, closeSync } from 'node:fs'
import { dirname, isAbsolute } from 'node:path'
import { randomUUID } from 'node:crypto'
import { workgraphDdl, validateWorkgraphDatabase } from './workgraph-database.ts'
import { projectSchema, grantSchema, resourceEventSchema } from './resource-schema.ts'
import { OrganizationError } from './error.ts'
import { accountSchema, attemptSchema, eventSchema, invitationSchema, membershipSchema, metadataSchema, organizationSchema, receiptRowSchema, receiptSchema, sessionSchema } from './schema.ts'

/** Organization physical schema; changes never alter the personal Session format. */
export const ORGANIZATION_SCHEMA_VERSION = 3
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
        db.exec(ddl + resourceDdl + workgraphDdl)
        db.prepare('INSERT INTO metadata VALUES (1,?,NULL,NULL,NULL)').run(randomUUID())
        db.exec(`PRAGMA user_version=${ORGANIZATION_SCHEMA_VERSION}; PRAGMA application_id=${applicationId}`)
      } else if ((stamp === 1 || stamp === 2) && app === applicationId) {
        validateDatabase(db, stamp === 2, false)
        if (stamp === 1) db.exec(resourceDdl)
        db.exec(workgraphDdl)
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

function validateDatabase(db: DatabaseSync, resources = true, workgraph = true): void {
  try {
    if (workgraph) validateWorkgraphDatabase(db)
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
      const receipt = receiptSchema.parse(JSON.parse(receiptRowSchema.strict().parse(row).response))
      if (receipt.planId !== undefined || receipt.planRevision !== undefined) {
        if (!workgraph || !db.prepare(`SELECT 1 FROM plan_revisions r JOIN organization_plans p ON p.id=r.planId
          WHERE r.planId=? AND r.revision=? AND r.eventRevision=? AND p.organizationId=? AND p.projectId=?`)
          .get(receipt.planId ?? null, receipt.planRevision ?? null, receipt.revision,
            receipt.organizationId ?? null, receipt.projectId ?? null)) throw new OrganizationError('incompatible-store')
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
