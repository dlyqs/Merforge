/** Transactional organization byte storage and explicit employee submission. */
import { createHash, randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { z } from 'zod'
import { artifactSchema, acceptanceSchema, submissionSchema, gitChangeSchema, deliveryReceiptSchema, type deliveryCommandSchema, type deliveryLimitsSchema } from './delivery-schema.ts'
import { selectedAssignment, authorizeAssignmentRead, assignmentInvalidation } from './assignment.ts'
import { authorizeParticipant } from './assignment-participant.ts'
import { executionRunSchema } from './execution-schema.ts'
import { OrganizationError } from './error.ts'
import type { OrganizationArtifactId } from './delivery-types.ts'
import type { Principal } from './types.ts'

/** Published bytes and their index commit in the same SQLite transaction and backup. */
export const deliveryDdl = `
CREATE TABLE organization_artifacts (id TEXT PRIMARY KEY, assignmentId TEXT NOT NULL REFERENCES task_assignments(id),
 runId TEXT REFERENCES execution_runs(id), data TEXT NOT NULL, bytes BLOB NOT NULL) STRICT;
CREATE TABLE organization_submissions (id TEXT PRIMARY KEY, assignmentId TEXT NOT NULL REFERENCES task_assignments(id),
 runId TEXT REFERENCES execution_runs(id), data TEXT NOT NULL) STRICT;
CREATE TABLE delivery_events (revision INTEGER PRIMARY KEY REFERENCES organization_events(revision),
 assignmentId TEXT NOT NULL REFERENCES task_assignments(id), result TEXT NOT NULL) STRICT;
`
function digest(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex') }
function decode(encoded: string): Buffer {
  const bytes = Buffer.from(encoded, 'base64')
  if (bytes.toString('base64') !== encoded) throw new OrganizationError('invalid-input')
  return bytes
}
function verifyGit(bytes: Buffer, maxFiles: number): void {
  const parsed = gitChangeSchema.safeParse(JSON.parse(bytes.toString('utf8')))
  if (!parsed.success || parsed.data.files.length > maxFiles) throw new OrganizationError('invalid-input')
  const files = parsed.data.files
  if (new Set(files.map(f => f.path)).size !== files.length) throw new OrganizationError('invalid-input')
  for (const f of files) {
    if ((f.operation === 'add') !== (f.oldSha256 === null)
      || (f.operation === 'delete') !== (f.newSha256 === null)
      || (f.newSha256 === null ? f.bytes !== null : f.bytes === null || digest(decode(f.bytes)) !== f.newSha256)) throw new OrganizationError('invalid-input')
  }
}
/**
 * Re-read and hash immutable bytes before download, reference, startup or backup.
 * @param db - Organization authority database.
 * @param artifactId - Published identifier.
 * @returns Metadata and verified bytes.
 */
export function readArtifact(db: DatabaseSync,
  artifactId: OrganizationArtifactId): { artifact: z.output<typeof artifactSchema>; bytes: Buffer } {
  const row = db.prepare('SELECT * FROM organization_artifacts WHERE id=?').get(artifactId)
  if (!row) throw new OrganizationError('incompatible-store')
  const artifact = artifactSchema.parse(JSON.parse(String(row.data)))
  if (!(row.bytes instanceof Uint8Array) || row.id !== artifact.id || row.assignmentId !== artifact.assignmentId
    || row.runId !== artifact.runId || row.bytes.byteLength !== artifact.size || digest(row.bytes) !== artifact.sha256) throw new OrganizationError('incompatible-store')
  return { artifact, bytes: Buffer.from(row.bytes) }
}
/**
 * Apply a human sharing decision inside the authority receipt transaction.
 * @param db - Organization write transaction.
 * @param principal - Currently authenticated member.
 * @param command - Parsed explicit upload or submission.
 * @param revision - Committed audit position if this transaction succeeds.
 * @param limits - Deployment file count and byte ceilings.
 * @returns Immutable references for the operation receipt.
 */
export function changeDelivery(db: DatabaseSync, principal: Principal, command: Exclude<z.output<typeof deliveryCommandSchema>, { kind: 'accept-delivery' | 'reject-delivery' }>,
  revision: number, limits: z.output<typeof deliveryLimitsSchema>): z.output<typeof deliveryReceiptSchema> {
  const a = selectedAssignment(db, command)
  authorizeParticipant(db, principal, a)
  if (a.state !== 'accepted' || assignmentInvalidation(db, a) || a.planRevision !== command.planRevision) throw new OrganizationError('version-conflict')
  const row = command.runId === null ? undefined : db.prepare('SELECT data FROM execution_runs WHERE id=? AND assignmentId=?').get(command.runId, a.id)
  if (command.runId !== null && !row) throw new OrganizationError('forbidden')
  const run = row ? executionRunSchema.parse(JSON.parse(String(row.data))) : undefined
  if (run && run.planRevision !== a.planRevision) throw new OrganizationError('version-conflict')
  const { organizationId, projectId, planId, assignmentId, runId, planRevision } = command
  const base = { organizationId, projectId, planId, assignmentId, runId, planRevision, employeeId: a.assigneeId, createdRevision: revision }
  if (command.kind === 'publish-artifact') {
    if (command.size > limits.artifactMaxFileBytes || command.bytes.length > Math.ceil(limits.artifactMaxFileBytes / 3) * 4) throw new OrganizationError('invalid-input')
    const bytes = decode(command.bytes)
    if (bytes.length !== command.size || digest(bytes) !== command.sha256) throw new OrganizationError('invalid-input')
    const used = db.prepare('SELECT count(*) AS n,COALESCE(sum(length(bytes)),0) AS size FROM organization_artifacts WHERE assignmentId=? AND runId IS ?').get(a.id, command.runId)
    if (Number(used?.n) >= limits.artifactMaxFiles || Number(used?.size) + bytes.length > limits.artifactMaxTotalBytes) throw new OrganizationError('invalid-input')
    if (command.artifactKind === 'git-change') {
      try { verifyGit(bytes, limits.artifactMaxFiles) } catch (error) {
        if (error instanceof SyntaxError) throw new OrganizationError('invalid-input')
        throw error
      }
    }
    const artifact = artifactSchema.parse({ ...base, id: randomUUID(), path: command.path, kind: command.artifactKind,
      mediaType: command.mediaType, description: command.description,
      ...(command.modifiedAt === undefined ? {} : { modifiedAt: command.modifiedAt }), size: bytes.length, sha256: command.sha256 })
    db.prepare('INSERT INTO organization_artifacts VALUES (?,?,?,?,?)').run(artifact.id, a.id, command.runId, JSON.stringify(artifact), bytes)
    return { artifactId: artifact.id }
  }
  if (run && (run.state === 'running' || run.state === 'prepared' || run.state === 'waiting-human'
    || db.prepare("SELECT 1 FROM execution_actions WHERE runId=? AND json_extract(data,'$.state') IN ('reserved','unknown')").get(run.id)
    || db.prepare("SELECT 1 FROM execution_human_requests WHERE runId=? AND json_extract(data,'$.state')='pending'").get(run.id))) throw new OrganizationError('version-conflict')
  if (command.artifactIds.length > limits.artifactMaxFiles || new Set(command.artifactIds).size !== command.artifactIds.length) throw new OrganizationError('invalid-input')
  let size = 0
  const paths = new Set<string>()
  for (const id of command.artifactIds) {
    const { artifact } = readArtifact(db, id)
    if (artifact.assignmentId !== a.id || artifact.runId !== command.runId || artifact.planRevision !== a.planRevision
      || artifact.employeeId !== principal.membershipId) throw new OrganizationError('forbidden')
    size += artifact.size
    paths.add(artifact.path)
  }
  if (size > limits.artifactMaxTotalBytes || paths.size !== command.artifactIds.length) throw new OrganizationError('invalid-input')
  const submission = submissionSchema.parse({ ...base, id: randomUUID(), kind: 'accept-delivery', handlerId: a.approvedBy,
    state: 'submitted', submittedAt: Date.now(), artifactIds: command.artifactIds, summary: command.summary, target: command.target })
  db.prepare('INSERT INTO organization_submissions VALUES (?,?,?,?)').run(submission.id, a.id, command.runId, JSON.stringify(submission))
  return { submissionId: submission.id }
}
/**
 * Validate persisted byte/index and exact-version submission relationships before serving or backing up.
 * @param db - Open organization database.
 */
export function validateDeliveryDatabase(db: DatabaseSync): void {
  for (const row of db.prepare('SELECT id FROM organization_artifacts').all()) {
    const { artifact } = readArtifact(db, artifactSchema.shape.id.parse(row.id))
    const a = selectedAssignment(db, artifact)
    const r = db.prepare('SELECT data FROM execution_runs WHERE id=? AND assignmentId=?').get(artifact.runId, a.id)
    if ((artifact.runId !== null && (!r || executionRunSchema.parse(JSON.parse(String(r.data))).planRevision !== artifact.planRevision)) || artifact.planRevision !== a.planRevision || artifact.employeeId !== a.assigneeId) throw new OrganizationError('incompatible-store')
    validateCreation(db, artifact, 'publish-artifact', { artifactId: artifact.id })
    if (artifact.kind === 'git-change') verifyGit(readArtifact(db, artifact.id).bytes, Number.MAX_SAFE_INTEGER)
  }
  for (const row of db.prepare('SELECT * FROM organization_submissions').all()) {
    const s = submissionSchema.parse(JSON.parse(String(row.data)))
    const a = selectedAssignment(db, s)
    if (row.id !== s.id || row.assignmentId !== s.assignmentId || row.runId !== s.runId || s.employeeId !== a.assigneeId
      || s.handlerId !== a.approvedBy || s.planRevision !== a.planRevision || new Set(s.artifactIds).size !== s.artifactIds.length) throw new OrganizationError('incompatible-store')
    validateCreation(db, s, 'submit-delivery', { submissionId: s.id })
    const paths = new Set<string>()
    for (const id of s.artifactIds) {
      const { artifact } = readArtifact(db, id)
      paths.add(artifact.path)
      if (artifact.runId !== s.runId || artifact.assignmentId !== s.assignmentId || artifact.createdRevision >= s.createdRevision) throw new OrganizationError('incompatible-store')
    }
    if (paths.size !== s.artifactIds.length) throw new OrganizationError('incompatible-store')
  }
  for (const row of db.prepare('SELECT * FROM delivery_events').all()) {
    const result = deliveryReceiptSchema.parse(JSON.parse(String(row.result)))
    const table = result.artifactId ? 'organization_artifacts' : result.acceptanceId ? 'organization_acceptances' : 'organization_submissions'
    const item = db.prepare(`SELECT data,assignmentId FROM ${table} WHERE id=?`).get(result.artifactId ?? result.submissionId ?? result.acceptanceId ?? null)
    if (!item || item.assignmentId !== row.assignmentId
      || (result.artifactId ? artifactSchema : result.acceptanceId ? acceptanceSchema : submissionSchema).parse(JSON.parse(String(item.data))).createdRevision !== row.revision) throw new OrganizationError('incompatible-store')
  }
  if (db.prepare(`SELECT 1 FROM organization_events e LEFT JOIN delivery_events d ON d.revision=e.revision
    WHERE e.kind IN ('publish-artifact','submit-delivery','accept-delivery','reject-delivery') AND d.revision IS NULL`).get()) throw new OrganizationError('incompatible-store')
}
function validateCreation(db: DatabaseSync,
  record: { createdRevision: number; employeeId: string; assignmentId: string; organizationId: string },
  kind: string, result: z.output<typeof deliveryReceiptSchema>): void {
  const event = db.prepare(`SELECT e.*, m.id AS memberId FROM organization_events e
    JOIN memberships m ON m.accountId=e.actorId AND m.organizationId=e.organizationId WHERE e.revision=?`).get(record.createdRevision)
  const delivery = db.prepare('SELECT * FROM delivery_events WHERE revision=?').get(record.createdRevision)
  if (!event || event.kind !== kind || event.memberId !== record.employeeId || event.organizationId !== record.organizationId
    || delivery?.assignmentId !== record.assignmentId || delivery.result !== JSON.stringify(result)) throw new OrganizationError('incompatible-store')
}
/**
 * Authorize an artifact selector against its exact task before revealing metadata or bytes.
 * @param db - Current authority transaction.
 * @param principal - Fresh login and membership.
 * @param query - Exact assignment and artifact identifier.
 * @returns Verified shared evidence.
 */
export function downloadArtifact(db: DatabaseSync, principal: Principal,
  query: z.output<typeof import('./delivery-schema.ts').artifactReadSchema>): z.output<typeof import('./delivery-schema.ts').artifactDownloadSchema> {
  const a = selectedAssignment(db, query)
  authorizeAssignmentRead(db, principal, a)
  const row = db.prepare('SELECT id FROM organization_artifacts WHERE id=? AND assignmentId=?').get(query.artifactId, a.id)
  if (!row) throw new OrganizationError('forbidden')
  const { artifact, bytes } = readArtifact(db, query.artifactId)
  return { artifact, bytes: bytes.toString('base64') }
}
