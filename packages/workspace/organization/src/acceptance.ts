/** Original-issuer review and atomic whole-plan rework, independent of final integration. */
import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { z } from 'zod'
import { acceptanceSchema, submissionSchema, type submissionViewSchema, type deliveryCommandSchema } from './delivery-schema.ts'
import { selectedAssignment, authorizeAssignmentRead, assignmentInvalidation } from './assignment.ts'
import { authorizeWorkgraph, readWorkgraphVersion, saveWorkgraph, type WorkgraphLimits } from './workgraph.ts'
import { readArtifact } from './delivery.ts'
import { OrganizationError } from './error.ts'
import type { OrganizationAssignment } from './assignment-types.ts'
import type { Principal } from './types.ts'

type Decision = Extract<z.output<typeof deliveryCommandSchema>, { kind: 'accept-delivery' | 'reject-delivery' }>
/** Each submission has at most one decision; accepted task versions have one authoritative artifact set. */
export const acceptanceDdl = `
CREATE TABLE organization_acceptances (id TEXT PRIMARY KEY, submissionId TEXT UNIQUE NOT NULL REFERENCES organization_submissions(id),
 assignmentId TEXT NOT NULL REFERENCES task_assignments(id), data TEXT NOT NULL) STRICT;
CREATE UNIQUE INDEX accepted_assignment ON organization_acceptances(assignmentId) WHERE json_extract(data,'$.state')='accepted';
`

/**
 * Require the original issuer's current root edit and task read authority, including receipt retries.
 * @param db - Authority transaction.
 * @param principal - Fresh authenticated member.
 * @param command - Exact review selector.
 */
export function authorizeAcceptance(db: DatabaseSync, principal: Principal, command: Decision): void {
  const a = selectedAssignment(db, command)
  if (principal.membershipId !== a.approvedBy) throw new OrganizationError('forbidden')
  authorizeAssignmentRead(db, principal, a)
  authorizeWorkgraph(db, principal, a.projectId, a.planId, true)
}

/**
 * Record one explicit decision; rejection authors new acceptance criteria in the same transaction.
 * @param db - Authority write transaction.
 * @param principal - Original issuer.
 * @param command - Confirmed decision with the entire submitted hash set.
 * @param revision - Allocated audit revision.
 * @param limits - WorkGraph deployment ceilings.
 * @returns Immutable acceptance identifier.
 */
export function changeAcceptance(db: DatabaseSync, principal: Principal, command: Decision, revision: number,
  limits: WorkgraphLimits): { acceptanceId: z.output<typeof acceptanceSchema>['id'] } {
  authorizeAcceptance(db, principal, command)
  const a = selectedAssignment(db, command)
  if (a.state !== 'accepted' || assignmentInvalidation(db, a) || a.planRevision !== command.planRevision) throw new OrganizationError('version-conflict')
  const row = db.prepare('SELECT data FROM organization_submissions WHERE id=? AND assignmentId=? AND runId IS ?')
    .get(command.submissionId, a.id, command.runId)
  if (!row) throw new OrganizationError('forbidden')
  const s = submissionSchema.parse(JSON.parse(String(row.data)))
  if (s.planRevision !== command.planRevision || acceptedTask(db, a)
    || db.prepare('SELECT 1 FROM organization_acceptances WHERE submissionId=?').get(s.id)) throw new OrganizationError('version-conflict')
  const artifacts = s.artifactIds.map(artifactId => ({ artifactId, sha256: readArtifact(db, artifactId).artifact.sha256 }))
  if (command.artifacts.length !== artifacts.length || new Set(command.artifacts.map(v => v.artifactId)).size !== artifacts.length
    || artifacts.some(v => !command.artifacts.some(c => c.artifactId === v.artifactId && c.sha256 === v.sha256))) throw new OrganizationError('invalid-input')
  let reworkRevision: number | null = null
  if (command.kind === 'reject-delivery') {
    const previous = readWorkgraphVersion(db, a.planId, a.planRevision)
    const definition = { ...previous.definition, tasks: previous.definition.tasks.map(task => task.id === a.taskId
      ? { ...task, acceptance: [...task.acceptance, command.requirements] } : task) }
    reworkRevision = saveWorkgraph(db, principal, { ...command, expectedRevision: a.planRevision, definition }, revision, limits).revision
  }
  const record = acceptanceSchema.parse({ organizationId: s.organizationId, projectId: s.projectId, planId: s.planId,
    assignmentId: s.assignmentId, runId: s.runId, planRevision: s.planRevision, id: randomUUID(),
    submissionId: s.id, issuerId: principal.membershipId,
    artifacts, createdRevision: revision, state: command.kind === 'accept-delivery' ? 'accepted' : 'rejected',
    reason: command.kind === 'reject-delivery' ? command.reason : null,
    requirements: command.kind === 'reject-delivery' ? command.requirements : null, reworkRevision })
  db.prepare('INSERT INTO organization_acceptances VALUES (?,?,?,?)').run(record.id, s.id, a.id, JSON.stringify(record))
  return { acceptanceId: record.id }
}

/**
 * Project current review eligibility and historical decisions without changing submitted evidence.
 * @param db - Current authority transaction after task read authorization.
 * @param submission - Immutable employee submission.
 * @returns Review state; accepted is never a final delivery or parent completion.
 */
export function submissionView(db: DatabaseSync, submission: z.output<typeof submissionSchema>): z.output<typeof submissionViewSchema> {
  const row = db.prepare('SELECT data FROM organization_acceptances WHERE submissionId=?').get(submission.id)
  const acceptance = row ? acceptanceSchema.parse(JSON.parse(String(row.data))) : null
  const a = selectedAssignment(db, submission)
  const invalid = assignmentInvalidation(db, a)
  const other = acceptedTask(db, a)
  const reviewState = acceptance?.state ?? (invalid === 'revision-changed' || other ? 'superseded'
    : invalid || a.state !== 'accepted' ? 'blocked' : 'pending')
  return { ...submission, acceptance, reviewState }
}

function acceptedTask(db: DatabaseSync, a: OrganizationAssignment): boolean {
  return !!db.prepare(`SELECT 1 FROM organization_acceptances r JOIN task_assignments a ON a.id=r.assignmentId
    WHERE a.planId=? AND a.taskId=? AND a.planRevision=? AND json_extract(r.data,'$.state')='accepted'`)
    .get(a.planId, a.taskId, a.planRevision)
}

/**
 * Verify decisions, immutable artifact hashes, authorship and rework versions on startup and backup.
 * @param db - Open database under its validation transaction.
 */
export function validateAcceptanceDatabase(db: DatabaseSync): void {
  if (db.prepare(`SELECT 1 FROM organization_acceptances r JOIN task_assignments a ON a.id=r.assignmentId
    WHERE json_extract(r.data,'$.state')='accepted' GROUP BY a.planId,a.taskId,a.planRevision HAVING count(*)>1`).get()) throw new OrganizationError('incompatible-store')
  for (const row of db.prepare('SELECT * FROM organization_acceptances').all()) {
    const r = acceptanceSchema.parse(JSON.parse(String(row.data)))
    const srow = db.prepare('SELECT data FROM organization_submissions WHERE id=?').get(r.submissionId)
    if (!srow) throw new OrganizationError('incompatible-store')
    const s = submissionSchema.parse(JSON.parse(String(srow.data)))
    const event = db.prepare(`SELECT e.*,m.id AS memberId FROM organization_events e JOIN memberships m
      ON m.accountId=e.actorId AND m.organizationId=e.organizationId WHERE e.revision=?`).get(r.createdRevision)
    const delivery = db.prepare('SELECT * FROM delivery_events WHERE revision=?').get(r.createdRevision)
    if (row.id !== r.id || row.submissionId !== s.id || row.assignmentId !== s.assignmentId
      || r.assignmentId !== s.assignmentId || r.runId !== s.runId || r.planRevision !== s.planRevision
      || r.organizationId !== s.organizationId || r.projectId !== s.projectId || r.planId !== s.planId
      || r.issuerId !== s.handlerId || r.createdRevision <= s.createdRevision || event?.memberId !== r.issuerId
      || event.kind !== (r.state === 'accepted' ? 'accept-delivery' : 'reject-delivery')
      || delivery?.assignmentId !== r.assignmentId || delivery.result !== JSON.stringify({ acceptanceId: r.id })
      || r.artifacts.length !== s.artifactIds.length || new Set(r.artifacts.map(v => v.artifactId)).size !== s.artifactIds.length
      || r.artifacts.some(v => !s.artifactIds.includes(v.artifactId) || readArtifact(db, v.artifactId).artifact.sha256 !== v.sha256)) throw new OrganizationError('incompatible-store')
    if (r.reworkRevision !== null) {
      const a = selectedAssignment(db, r)
      const previous = readWorkgraphVersion(db, r.planId, r.planRevision)
      const next = readWorkgraphVersion(db, r.planId, r.reworkRevision)
      const expected = { ...previous.definition, tasks: previous.definition.tasks.map(t => t.id === a.taskId
        ? { ...t, acceptance: [...t.acceptance, r.requirements] } : t) }
      if (JSON.stringify(next.definition) !== JSON.stringify(expected) || next.createdBy !== r.issuerId
        || db.prepare('SELECT eventRevision FROM plan_revisions WHERE planId=? AND revision=?').get(r.planId, r.reworkRevision)?.eventRevision !== r.createdRevision) throw new OrganizationError('incompatible-store')
    }
  }
}
