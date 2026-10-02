/** Offline organization maintenance. A separate SQLite lock excludes live service writers. */
import { invalidateExecution } from './execution.ts'
import { invalidateDevicesAndLeases } from './device.ts'
import { invalidateDelegations } from './assignment-participant.ts'
import { invalidateAssignments } from './assignment.ts'
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, openSync, closeSync, lstatSync, readFileSync, writeFileSync, copyFileSync, renameSync, rmSync, chmodSync } from 'node:fs'
import { dirname, join, resolve, isAbsolute } from 'node:path'
import { createHash, randomBytes, randomUUID, X509Certificate, createPrivateKey } from 'node:crypto'
import { z } from 'zod'
import { openOrganizationDatabase, ORGANIZATION_SCHEMA_VERSION, transaction } from './database.ts'

const files = ['organization.sqlite', 'tls-identity.json'] as const
const manifestSchema = z.object({ format: z.literal(1), schema: z.union([z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6), z.literal(7), z.literal(8), z.literal(9), z.literal(10), z.literal(11), z.literal(ORGANIZATION_SCHEMA_VERSION)]), hashes: z.object({ 'organization.sqlite': z.string().regex(/^[a-f0-9]{64}$/), 'tls-identity.json': z.string().regex(/^[a-f0-9]{64}$/) }).strict() }).strict()
function regular(path: string): void { if (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink()) throw new Error('invalid-backup-path') }
function directory(path: string): void { if (!isAbsolute(path) || !lstatSync(path).isDirectory() || lstatSync(path).isSymbolicLink()) throw new Error('invalid-backup-path') }
function hash(path: string): string { regular(path); return createHash('sha256').update(readFileSync(path)).digest('hex') }
function identity(path: string): void {
  regular(path)
  const value = z.object({ certificate: z.string(), privateKey: z.string() }).strict().parse(JSON.parse(readFileSync(path, 'utf8')))
  if (!new X509Certificate(value.certificate).checkPrivateKey(createPrivateKey(value.privateKey))) throw new Error('invalid-backup-certificate')
}

/**
 * Claim the dedicated service-directory writer lock, released by the OS after a crash.
 * @param path - Absolute dedicated organization directory.
 * @returns Synchronous release; never delete the lock inode while another opener might use it.
 */
export function lockOrganizationDirectory(path: string): () => void {
  if (!isAbsolute(path)) throw new Error('invalid-backup-path')
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const lockPath = `${path}.owner.sqlite`
  try { closeSync(openSync(lockPath, 'wx', 0o600)) } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error
  }
  regular(lockPath)
  const lock = new DatabaseSync(lockPath)
  try { lock.exec('PRAGMA busy_timeout=0; BEGIN EXCLUSIVE') }
  catch (error) { lock.close(); throw new Error('organization-directory-in-use', { cause: error }) }
  let released = false
  return () => { if (!released) { released = true; lock.close() } }
}

function validate(path: string, busyTimeoutMs: number): void {
  regular(join(path, 'organization.sqlite')); identity(join(path, 'tls-identity.json'))
  const db = openOrganizationDatabase(join(path, 'organization.sqlite'), busyTimeoutMs)
  try {
    if (db.prepare('PRAGMA integrity_check').get()?.integrity_check !== 'ok') throw new Error('incompatible-store')
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
  } finally { db.close() }
}

/**
 * Copy a stopped service to a new owner-only directory, admitting only the database and TLS pair.
 * @param source - Dedicated service directory.
 * @param destination - New absolute backup directory selected by the user.
 * @param busyTimeoutMs - Validated maintenance SQLite deadline.
 * @returns Created backup directory.
 */
export function backupOrganization(source: string, destination: string, busyTimeoutMs: number): string {
  directory(source)
  if (!isAbsolute(destination) || resolve(destination).startsWith(`${resolve(source)}/`)) throw new Error('invalid-backup-path')
  const release = lockOrganizationDirectory(source)
  let created = false
  try {
    validate(source, busyTimeoutMs)
    mkdirSync(destination, { mode: 0o700 }); created = true
    for (const file of files) { copyFileSync(join(source, file), join(destination, file)); chmodSync(join(destination, file), 0o600) }
    const hashes = { 'organization.sqlite': hash(join(destination, files[0])), 'tls-identity.json': hash(join(destination, files[1])) }
    writeFileSync(join(destination, 'manifest.json'), JSON.stringify({ format: 1, schema: ORGANIZATION_SCHEMA_VERSION, hashes }), { flag: 'wx', mode: 0o600 })
    return destination
  } catch (error) { if (created) rmSync(destination, { recursive: true }); throw error }
  finally { release() }
}

/**
 * Validate a backup in staging, revoke old logins and invitations, rotate recovery, then swap directories.
 * @param backup - User-selected backup directory with exact manifest and matching content hashes.
 * @param target - Stopped dedicated service directory; the previous directory remains beside it.
 * @param busyTimeoutMs - Validated maintenance SQLite deadline.
 * @returns New recovery secret and preserved pre-restore directory; no secret is written to the manifest.
 */
export function restoreOrganization(backup: string, target: string, busyTimeoutMs: number): { recoveryToken: string; previous: string } {
  directory(backup)
  if (!isAbsolute(target) || resolve(backup) === resolve(target) || resolve(backup).startsWith(`${resolve(target)}/`)) throw new Error('invalid-backup-path')
  regular(join(backup, 'manifest.json'))
  const manifest = manifestSchema.parse(JSON.parse(readFileSync(join(backup, 'manifest.json'), 'utf8')))
  for (const file of files) if (hash(join(backup, file)) !== manifest.hashes[file]) throw new Error('invalid-backup-hash')
  const release = lockOrganizationDirectory(target)
  const stage = `${target}.restore-${randomUUID()}`
  const previous = `${target}.previous-${randomUUID()}`
  let moved = false
  try {
    directory(target)
    mkdirSync(stage, { mode: 0o700 })
    for (const file of files) { copyFileSync(join(backup, file), join(stage, file)); chmodSync(join(stage, file), 0o600) }
    const sourceDb = new DatabaseSync(join(stage, 'organization.sqlite'), { readOnly: true })
    try {
      if (sourceDb.prepare('PRAGMA user_version').get()?.user_version !== manifest.schema) throw new Error('invalid-backup-schema')
    } finally { sourceDb.close() }
    validate(stage, busyTimeoutMs)
    const recoveryToken = randomBytes(32).toString('base64url')
    const db = openOrganizationDatabase(join(stage, 'organization.sqlite'), busyTimeoutMs)
    try {
      transaction(db, () => {
        db.exec('DELETE FROM login_sessions; DELETE FROM operation_receipts; UPDATE invitations SET consumed=1')
        db.prepare('UPDATE metadata SET recoveryHash=? WHERE rootAccountId IS NOT NULL').run(createHash('sha256').update(recoveryToken).digest('hex'))
        const event = db.prepare("INSERT INTO organization_events(kind,actorId,organizationId,at) VALUES ('restore',NULL,NULL,?)").run(Date.now())
        invalidateAssignments(db, Number(event.lastInsertRowid), true)
        invalidateDelegations(db, Number(event.lastInsertRowid))
        invalidateDevicesAndLeases(db, Number(event.lastInsertRowid), true)
        invalidateExecution(db, Number(event.lastInsertRowid), true)
      })
      db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    } finally { db.close() }
    renameSync(target, previous); moved = true
    try { renameSync(stage, target) } catch (error) { renameSync(previous, target); moved = false; throw error }
    return { recoveryToken, previous }
  } finally { if (!moved) rmSync(stage, { recursive: true, force: true }); release() }
}
