/** Approval, answer and delegation records and startup validation of their persisted relations. */
import type { DatabaseSync } from 'node:sqlite'
import { OrganizationError } from './error.ts'
import { assignmentSchema, assignmentRequestSchema, assignmentNotificationSchema } from './assignment-schema.ts'
import { parseDelegation } from './assignment-participant.ts'
import { assignmentInvalidation } from './assignment.ts'
import { readWorkgraphVersion } from './workgraph.ts'

/** Approval, request and notification tables, including explicit answer and read metadata. */
export const assignmentDdl = `
CREATE TABLE task_assignments (id TEXT PRIMARY KEY, organizationId TEXT NOT NULL REFERENCES organizations(id),
  projectId TEXT NOT NULL REFERENCES organization_projects(id), planId TEXT NOT NULL,
  planRevision INTEGER NOT NULL, taskId TEXT NOT NULL, approvedBy TEXT NOT NULL REFERENCES memberships(id),
  assigneeId TEXT NOT NULL REFERENCES memberships(id), state TEXT NOT NULL CHECK(state IN ('pending','accepted','rejected','revoked','invalidated')),
  reason TEXT CHECK(reason IN ('revision-changed','authority-lost','restored')), createdAt INTEGER NOT NULL,
  createdRevision INTEGER UNIQUE NOT NULL REFERENCES organization_events(revision), version INTEGER NOT NULL REFERENCES organization_events(revision),
  FOREIGN KEY(planId,planRevision) REFERENCES plan_revisions(planId,revision),
  FOREIGN KEY(planId,taskId) REFERENCES plan_tasks(planId,taskId)) STRICT;
CREATE UNIQUE INDEX assignment_pending_task ON task_assignments(planId,taskId) WHERE state IN ('pending','accepted');
CREATE TABLE assignment_requests (id TEXT PRIMARY KEY, assignmentId TEXT UNIQUE NOT NULL REFERENCES task_assignments(id),
  kind TEXT NOT NULL CHECK(kind='accept-assignment'), state TEXT NOT NULL CHECK(state IN ('pending','cancelled','accepted','rejected','expired')),
  expiresAt INTEGER, answeredRevision INTEGER REFERENCES organization_events(revision)) STRICT;
CREATE TABLE assignment_notifications (id TEXT PRIMARY KEY, requestId TEXT UNIQUE NOT NULL REFERENCES assignment_requests(id),
  createdRevision INTEGER NOT NULL REFERENCES organization_events(revision), readAt INTEGER) STRICT;
`

/**
 * Reject damaged approvals, missing atomic request/notification facts and live stale authority.
 * @param db - Startup or offline-maintenance transaction after WorkGraph validation.
 */
export function validateAssignmentDatabase(db: DatabaseSync): void {
  const fail = () => { throw new OrganizationError('incompatible-store') }
  for (const row of db.prepare('SELECT * FROM task_assignments').all()) {
    const assignment = assignmentSchema.parse(row)
    const version = readWorkgraphVersion(db, assignment.planId, assignment.planRevision)
    const task = version.definition.tasks.find(item => item.id === assignment.taskId)
    if (!task || version.organizationId !== assignment.organizationId || version.projectId !== assignment.projectId
      || version.definition.tasks.some(item => item.parentTaskId === assignment.taskId)
      || assignment.version < assignment.createdRevision) fail()
    let ancestor = task
    while (ancestor) {
      if (ancestor.dependsOn.length) fail()
      const parent = ancestor.parentTaskId
      ancestor = version.definition.tasks.find(item => item.id === parent)
    }
    for (const member of [assignment.approvedBy, assignment.assigneeId]) {
      if (!db.prepare('SELECT id FROM memberships WHERE id=? AND organizationId=?').get(member, assignment.organizationId)) fail()
    }
    const event = db.prepare('SELECT * FROM organization_events WHERE revision=?').get(assignment.createdRevision)
    const author = db.prepare('SELECT accountId FROM memberships WHERE id=?').get(assignment.approvedBy)
    if (event?.kind !== 'approve-assignment' || event.organizationId !== assignment.organizationId
      || event.actorId !== author?.accountId || event.at !== assignment.createdAt) fail()
    const request = assignmentRequestSchema.parse(db.prepare('SELECT * FROM assignment_requests WHERE assignmentId=?').get(assignment.id))
    const notification = assignmentNotificationSchema.parse(db.prepare('SELECT * FROM assignment_notifications WHERE requestId=?').get(request.id))
    if (notification.createdRevision !== assignment.createdRevision
      || (assignment.state === 'pending' && request.state !== 'pending')
      || (assignment.state === 'accepted' && request.state !== 'accepted')
      || (assignment.state === 'rejected' && request.state !== 'rejected')
      || (['revoked', 'invalidated'].includes(assignment.state) && request.state === 'pending')
      || (assignment.state === 'invalidated') !== (assignment.reason !== null)) fail()
    if (assignment.state === 'accepted' && assignmentInvalidation(db, assignment) !== null) fail()
    if (assignment.state === 'pending' && (assignment.version !== assignment.createdRevision || assignmentInvalidation(db, assignment) !== null)) fail()
    if (assignment.state !== 'pending') {
      const terminal = db.prepare('SELECT kind,organizationId FROM organization_events WHERE revision=?').get(assignment.version)
      if (assignment.version <= assignment.createdRevision || !terminal) fail()
      if (['accepted', 'rejected'].includes(assignment.state) && terminal?.kind !== 'answer-assignment') fail()
      if (assignment.state === 'revoked' && (terminal?.kind !== 'revoke-assignment' || terminal.organizationId !== assignment.organizationId)) fail()
      if (assignment.reason === 'restored' && terminal?.kind !== 'restore') fail()
      if (assignment.reason === 'revision-changed' && (!['save-plan', 'reject-delivery'].includes(String(terminal?.kind))
        || !db.prepare('SELECT 1 FROM plan_revisions WHERE planId=? AND eventRevision=? AND revision>?')
          .get(assignment.planId, assignment.version, assignment.planRevision))) fail()
      if (assignment.reason === 'authority-lost' && !['set-grant', 'set-task-grant', 'set-membership', 'set-account'].includes(String(terminal?.kind))) fail()
    }
  }
  for (const row of db.prepare('SELECT * FROM assignment_requests').all()) {
    const request = assignmentRequestSchema.parse(row)
    if (['accepted', 'rejected'].includes(request.state)) {
      const event = db.prepare(`SELECT e.kind,e.actorId,e.organizationId,a.assigneeId,m.accountId,a.organizationId AS org
        FROM organization_events e JOIN task_assignments a ON a.id=? JOIN memberships m ON m.id=a.assigneeId WHERE e.revision=?`)
        .get(request.assignmentId, request.answeredRevision)
      if (!event || event.kind !== 'answer-assignment' || event.actorId !== event.accountId || event.organizationId !== event.org) fail()
    } else if (request.answeredRevision !== null) fail()
  }
  for (const row of db.prepare('SELECT * FROM assignment_notifications').all()) assignmentNotificationSchema.parse(row)
  for (const row of db.prepare('SELECT * FROM assignment_delegations').all()) {
    const d = parseDelegation(row)
    const a = assignmentSchema.parse(db.prepare('SELECT * FROM task_assignments WHERE id=?').get(d.assignmentId))
    const event = db.prepare('SELECT * FROM organization_events WHERE revision=?').get(d.createdRevision)
    const member = db.prepare('SELECT accountId FROM memberships WHERE id=?').get(d.membershipId)
    if (a.assigneeId !== d.membershipId || a.planRevision !== d.planRevision || d.version < d.createdRevision
      || event?.kind !== 'delegate' || event.actorId !== member?.accountId || event.organizationId !== a.organizationId
      || d.expiresAt <= Number(event.at) || d.state === 'active' && (a.state !== 'accepted' || d.version !== d.createdRevision)) fail()
    if (d.state !== 'active') {
      const terminal = db.prepare('SELECT kind,at FROM organization_events WHERE revision=?').get(d.version)
      if (!terminal || d.version <= d.createdRevision) fail()
      if (d.state === 'revoked' && (terminal?.kind !== 'revoke-delegation'
        || !db.prepare('SELECT 1 FROM assignment_actions WHERE revision=? AND delegationId=?').get(d.version, d.id))) fail()
      if (d.state === 'expired' && Number(terminal?.at) < d.expiresAt) fail()
    }
  }
  for (const action of db.prepare(`SELECT x.*,e.kind,e.actorId,e.organizationId FROM assignment_actions x
    JOIN organization_events e ON e.revision=x.revision`).all()) {
    const a = assignmentSchema.parse(db.prepare('SELECT * FROM task_assignments WHERE id=?').get(String(action.assignmentId)))
    const member = db.prepare('SELECT accountId FROM memberships WHERE id=?').get(a.assigneeId)
    const human = db.prepare("SELECT m.accountId FROM execution_human_requests h JOIN memberships m ON m.id=json_extract(h.data,'$.handlerId') WHERE json_extract(h.data,'$.answeredRevision')=? AND h.assignmentId=?").get(action.revision ?? null, a.id)
    const actor = ['answer-execution-question', 'approve-execution-tool'].includes(String(action.kind)) ? human?.accountId : member?.accountId
    if (action.actorId !== actor || action.organizationId !== a.organizationId
      || !['answer-assignment','read-notification','delegate','revoke-delegation','answer-execution-question','approve-execution-tool'].includes(String(action.kind))) fail()
    if (['delegate','revoke-delegation'].includes(String(action.kind))) {
      const d = parseDelegation(db.prepare('SELECT * FROM assignment_delegations WHERE id=?').get(String(action.delegationId)))
      if (d.assignmentId !== a.id || action.kind === 'delegate' && d.createdRevision !== action.revision) fail()
    } else if (action.delegationId !== null) fail()
  }
  if (db.prepare(`SELECT 1 FROM organization_events e LEFT JOIN assignment_actions x ON x.revision=e.revision
    WHERE e.kind IN ('answer-assignment','read-notification','delegate','revoke-delegation','answer-execution-question','approve-execution-tool') AND x.revision IS NULL LIMIT 1`).get()) fail()
  if (db.prepare(`SELECT 1 FROM organization_events e LEFT JOIN task_assignments a ON a.createdRevision=e.revision
    WHERE e.kind='approve-assignment' AND a.id IS NULL LIMIT 1`).get()) fail()
  if (db.prepare(`SELECT 1 FROM organization_events e LEFT JOIN task_assignments a ON a.version=e.revision AND a.state='revoked'
    WHERE e.kind='revoke-assignment' AND a.id IS NULL LIMIT 1`).get()) fail()
}

/** Additional v5 facts are written only by explicit participant actions. */
export const delegationDdl = `
CREATE TABLE assignment_actions (revision INTEGER PRIMARY KEY REFERENCES organization_events(revision),
  assignmentId TEXT NOT NULL REFERENCES task_assignments(id), delegationId TEXT REFERENCES assignment_delegations(id)) STRICT;
CREATE TABLE assignment_delegations (id TEXT PRIMARY KEY, assignmentId TEXT NOT NULL REFERENCES task_assignments(id),
  planRevision INTEGER NOT NULL, membershipId TEXT NOT NULL REFERENCES memberships(id), deviceId TEXT NOT NULL,
  executorId TEXT NOT NULL, capabilities TEXT NOT NULL, budget INTEGER NOT NULL, expiresAt INTEGER NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('active','revoked','invalidated','expired')),
  createdRevision INTEGER NOT NULL REFERENCES organization_events(revision), version INTEGER NOT NULL REFERENCES organization_events(revision)) STRICT;
CREATE UNIQUE INDEX delegation_active ON assignment_delegations(assignmentId,deviceId) WHERE state='active';
`

/**
 * Rebuild v4 tables without changing their exact-version references or null request deadlines.
 * @param db - Startup transaction before delegation/device tables are added.
 */
export function migrateAssignmentV4(db: DatabaseSync): void {
  const assignments = db.prepare('SELECT * FROM task_assignments').all().map(row => assignmentSchema.parse(row))
  const requests = db.prepare('SELECT * FROM assignment_requests').all().map(row => assignmentRequestSchema.omit({ answeredRevision: true }).parse(row))
  const notifications = db.prepare('SELECT * FROM assignment_notifications').all().map(row => assignmentNotificationSchema.omit({ readAt: true }).parse(row))
  db.exec('DROP TABLE assignment_notifications; DROP TABLE assignment_requests; DROP TABLE task_assignments;')
  db.exec(assignmentDdl)
  for (const a of assignments) db.prepare('INSERT INTO task_assignments VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(a.id, a.organizationId, a.projectId, a.planId, a.planRevision, a.taskId, a.approvedBy, a.assigneeId,
      a.state, a.reason, a.createdAt, a.createdRevision, a.version)
  for (const r of requests) db.prepare('INSERT INTO assignment_requests VALUES (?,?,?,?,?,NULL)').run(r.id,r.assignmentId,r.kind,r.state,r.expiresAt)
  for (const n of notifications) db.prepare('INSERT INTO assignment_notifications VALUES (?,?,?,NULL)').run(n.id,n.requestId,n.createdRevision)
}
