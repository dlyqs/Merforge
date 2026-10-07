/** Transactional acceptance and notification acknowledgement. */
import { submissionView } from './acceptance.ts'
import { submissionSchema } from './delivery-schema.ts'
import { executionHumanSchema } from './execution-human-schema.ts'
import type { DatabaseSync } from 'node:sqlite'
import type { z } from 'zod'
import { OrganizationError } from './error.ts'
import { authorizeAssignmentRead, selectedAssignment, assignmentInvalidation } from './assignment.ts'
import { assignmentSchema, assignmentRequestSchema, assignmentNotificationSchema, delegationSchema, type participantCommandSchema } from './assignment-schema.ts'
import { visibleTasks } from './workgraph-access.ts'
import type { OrganizationAssignment, OrganizationDelegation, OrganizationInboxItem } from './assignment-types.ts'
import type { Principal } from './types.ts'

/**
 * Require the designated employee and current task visibility even on receipt replay.
 * @param db - Authority transaction.
 * @param principal - Fresh member identity.
 * @param assignment - Selected approval.
 */
export function authorizeParticipant(db: DatabaseSync, principal: Principal, assignment: OrganizationAssignment): void {
  if (principal.membershipId !== assignment.assigneeId) throw new OrganizationError('forbidden')
  authorizeAssignmentRead(db, principal, assignment)
}

/**
 * Decode a persisted delegation's JSON capabilities through the durable parser.
 * @param row - SQLite row or absent selector result.
 * @returns Validated delegation.
 */
export function parseDelegation(row: Record<string, unknown> | undefined): OrganizationDelegation {
  if (!row) throw new OrganizationError('forbidden')
  const capabilities: unknown = JSON.parse(String(row.capabilities))
  return delegationSchema.parse({ ...row, capabilities })
}

/**
 * Apply an explicit participant action in the receipt transaction.
 * @param db - Current write transaction.
 * @param principal - Current authenticated employee.
 * @param command - Strict participant request.
 * @param revision - Allocated audit revision.
 * @returns Updated assignment.
 */
export function changeParticipant(
  db: DatabaseSync, principal: Principal, command: z.output<typeof participantCommandSchema>, revision: number,
): { assignment: OrganizationAssignment } {
  const assignment = selectedAssignment(db, command)
  if (command.kind === 'answer-execution-question' || command.kind === 'approve-execution-tool') {
    answerExecutionHuman(db, principal, command, revision)
    return { assignment }
  }
  if (command.kind === 'read-inbox') {
    const item = authorizeInboxRead(db, principal, command)
    db.prepare(`INSERT INTO inbox_notification_reads (membershipId,requestId,assignmentId,observedRevision,readAt,eventRevision)
      VALUES (?,?,?,?,?,?)`)
      .run(principal.membershipId ?? null, item.request.id, assignment.id, command.expectedRevision, Date.now(), revision)
    return { assignment }
  }
  authorizeParticipant(db, principal, assignment)
  const now = Date.now()
  if (command.kind === 'read-notification') {
    const row = db.prepare(`SELECT n.* FROM assignment_notifications n JOIN assignment_requests r ON r.id=n.requestId
      WHERE n.id=? AND r.assignmentId=?`).get(command.notificationId, assignment.id)
    if (!row) throw new OrganizationError('forbidden')
    db.prepare('UPDATE assignment_notifications SET readAt=COALESCE(readAt,?) WHERE id=?').run(now, command.notificationId)
    return { assignment }
  }
  if (assignment.version !== command.expectedVersion || assignmentInvalidation(db, assignment) !== null) throw new OrganizationError('version-conflict')
  {
    const row = db.prepare('SELECT * FROM assignment_requests WHERE id=? AND assignmentId=?').get(command.requestId, assignment.id)
    if (!row) throw new OrganizationError('forbidden')
    const request = assignmentRequestSchema.parse(row)
    if (assignment.state !== 'pending' || request.state !== 'pending' || request.expiresAt !== null && request.expiresAt <= now) throw new OrganizationError('version-conflict')
    db.prepare('UPDATE assignment_requests SET state=?,answeredRevision=? WHERE id=?').run(command.answer, revision, request.id)
    db.prepare('UPDATE task_assignments SET state=?,version=? WHERE id=?').run(command.answer, revision, assignment.id)
    // The existing notification is the durable request-state invalidation; the employee has already viewed and answered it.
    db.prepare('UPDATE assignment_notifications SET readAt=? WHERE requestId=?').run(now, request.id)
    return { assignment: { ...assignment, state: command.answer, version: revision } }
  }
}

/**
 * Filter designated inbox facts through current authority before search, count and pagination.
 * @param db - Read transaction.
 * @param principal - Current enabled member.
 * @param query - State filter and literal task search.
 * @returns Authorized matching facts only.
 */
export function visibleInbox(db: DatabaseSync, principal: Principal,
  query: { state: 'pending' | 'processed' | 'all'; search: string }): OrganizationInboxItem[] {
  const items: OrganizationInboxItem[] = []
  for (const row of db.prepare('SELECT * FROM task_assignments WHERE organizationId=? AND (assigneeId=? OR approvedBy=?) ORDER BY createdRevision DESC')
    .all(principal.organizationId ?? null, principal.membershipId ?? null, principal.membershipId ?? null)) {
    const assignment = assignmentSchema.parse(row)
    try {
      const tasks = visibleTasks(db, principal, { ...assignment, revision: assignment.planRevision, search: query.search, offset: 0 })
      if (!tasks.length) continue
    } catch (error) {
      if (error instanceof OrganizationError && error.code === 'forbidden') continue
      throw error
    }
    const request = assignmentRequestSchema.parse(db.prepare('SELECT * FROM assignment_requests WHERE assignmentId=?').get(assignment.id))
    if (assignment.assigneeId !== principal.membershipId && request.answeredRevision === null) continue
    if (request.state === 'pending' && request.expiresAt !== null && request.expiresAt <= Date.now()) request.state = 'expired'
    if (query.state === 'pending' && request.state !== 'pending'
      || query.state === 'processed' && request.state === 'pending') continue
    const notification = assignmentNotificationSchema.parse(db.prepare('SELECT * FROM assignment_notifications WHERE requestId=?').get(request.id))
    items.push({ assignment, request, notificationId: notification.id,
      readAt: assignment.assigneeId === principal.membershipId ? notification.readAt : null })
  }
  for (const row of db.prepare("SELECT data FROM execution_human_requests WHERE json_extract(data,'$.handlerId')=?").all(principal.membershipId ?? null)) {
    const request = executionHumanSchema.parse(JSON.parse(String(row.data)))
    const assignment = assignmentSchema.parse(db.prepare('SELECT * FROM task_assignments WHERE id=?').get(request.assignmentId))
    if (assignment.organizationId !== principal.organizationId) continue
    try {
      const tasks = visibleTasks(db, principal, { ...assignment, revision: assignment.planRevision, search: query.search, offset: 0 })
      if (!tasks.length) continue
    } catch (error) {
      if (error instanceof OrganizationError && error.code === 'forbidden') continue
      throw error
    }
    if (request.state === 'pending' && request.expiresAt <= Date.now()) request.state = 'expired'
    if (query.state === 'pending' && request.state !== 'pending'
      || query.state === 'processed' && request.state === 'pending') continue
    const answerEvent = db.prepare('SELECT at FROM organization_events WHERE revision=?').get(request.answeredRevision)
    items.push({ assignment, request, notificationId: null, readAt: typeof answerEvent?.at === 'number' ? answerEvent.at : null })
  }
  for (const row of db.prepare("SELECT data FROM organization_submissions WHERE json_extract(data,'$.handlerId')=? OR json_extract(data,'$.employeeId')=?")
    .all(principal.membershipId ?? null, principal.membershipId ?? null)) {
    const request = submissionView(db, submissionSchema.parse(JSON.parse(String(row.data))))
    const needsRework = request.acceptance?.state === 'rejected' && request.employeeId === principal.membershipId
      && !db.prepare('SELECT 1 FROM task_assignments WHERE planId=? AND taskId=(SELECT taskId FROM task_assignments WHERE id=?) AND planRevision>=?')
        .get(request.planId, request.assignmentId, request.acceptance.reworkRevision)
    const pending = request.reviewState === 'pending' && request.handlerId === principal.membershipId || needsRework
    if (request.handlerId !== principal.membershipId && !request.acceptance) continue
    if (query.state === 'pending' && !pending || query.state === 'processed' && pending) continue
    const assignment = selectedAssignment(db, request)
    if (assignment.organizationId !== principal.organizationId) continue
    try {
      const tasks = visibleTasks(db, principal, { ...assignment, revision: assignment.planRevision, search: query.search, offset: 0 })
      if (!tasks.length) continue
    } catch (error) {
      if (error instanceof OrganizationError && error.code === 'forbidden') continue
      throw error
    }
    items.push({ assignment, request, notificationId: null, readAt: null })
  }
  return items.map((item) => {
    const read = db.prepare('SELECT observedRevision,readAt FROM inbox_notification_reads WHERE membershipId=? AND requestId=? ORDER BY eventRevision DESC LIMIT 1')
      .get(principal.membershipId ?? null, item.request.id)
    return read?.observedRevision === notificationRevision(item, principal.membershipId) ? { ...item, readAt: Number(read.readAt) } : item
  })
}
function notificationRevision(item: OrganizationInboxItem, memberId: Principal['membershipId']): number {
  switch (item.request.kind) {
    case 'accept-assignment': return item.assignment.version
    case 'accept-delivery': return item.request.handlerId === memberId ? item.request.createdRevision
      : item.request.acceptance?.createdRevision ?? item.request.createdRevision
    default: return item.request.answeredRevision ?? item.request.createdRevision
  }
}
/**
 * Authorize an exact inbox observation for its current recipient.
 * @param db - Authority transaction.
 * @param principal - Current member.
 * @param command - Request identity and observed revision.
 * @returns The readable inbox fact; changed observations are refused.
 */
export function authorizeInboxRead(db: DatabaseSync, principal: Principal,
  command: Extract<z.output<typeof participantCommandSchema>, { kind: 'read-inbox' }>): OrganizationInboxItem {
  const item = visibleInbox(db, principal, { state: 'all', search: '' }).find(item => item.assignment.id === command.assignmentId
    && item.request.id === command.requestId)
  if (!item) throw new OrganizationError('forbidden')
  if (notificationRevision(item, principal.membershipId) !== command.expectedRevision) throw new OrganizationError('version-conflict')
  return item
}

/**
 * Authorize the designated request handler, including receipt reads after an answer.
 * @param db - Authority transaction.
 * @param principal - Current authenticated handler.
 * @param command - Exact request selector.
 */
export function authorizeExecutionAnswer(db: DatabaseSync, principal: Principal,
  command: Extract<z.output<typeof participantCommandSchema>, { kind: 'answer-execution-question' | 'approve-execution-tool' }>): void {
  const a = selectedAssignment(db, command)
  authorizeAssignmentRead(db, principal, a)
  const row = db.prepare('SELECT data FROM execution_human_requests WHERE id=? AND assignmentId=?').get(command.requestId, a.id)
  if (!row) throw new OrganizationError('forbidden')
  const h = executionHumanSchema.parse(JSON.parse(String(row.data)))
  if (h.handlerId !== principal.membershipId || h.runId !== command.runId || h.planRevision !== command.planRevision
    || (h.kind === 'work-question') !== (command.kind === 'answer-execution-question')) throw new OrganizationError('forbidden')
}
function answerExecutionHuman(db: DatabaseSync, principal: Principal,
  c: Extract<z.output<typeof participantCommandSchema>, { kind: 'answer-execution-question' | 'approve-execution-tool' }>, revision: number): void {
  authorizeExecutionAnswer(db, principal, c)
  const a = selectedAssignment(db, c)
  const h = executionHumanSchema.parse(JSON.parse(String(db.prepare('SELECT data FROM execution_human_requests WHERE id=?').get(c.requestId)?.data)))
  if (a.state !== 'accepted' || assignmentInvalidation(db, a) || h.expiresAt <= Date.now()
    || h.state !== 'pending') throw new OrganizationError('version-conflict')
  const state = c.kind === 'answer-execution-question' ? 'answered' : c.approved ? 'approved' : 'denied'
  db.prepare('UPDATE execution_human_requests SET data=? WHERE id=?').run(JSON.stringify({ ...h, state,
    answer: c.kind === 'answer-execution-question' ? c.answer : null, answeredRevision: revision, version: revision }), h.id)
}
