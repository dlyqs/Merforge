/** Transactional acceptance, notification acknowledgement and bounded delegation. */
import { submissionSchema } from './delivery-schema.ts'
import { executionHumanSchema } from './execution-human-schema.ts'
import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { z } from 'zod'
import { ownedDevice } from './device.ts'
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
 * @param limits - Deployment ceilings for finite delegations.
 * @returns Updated assignment and optional delegation identity.
 */
export function changeParticipant(
  db: DatabaseSync, principal: Principal, command: z.output<typeof participantCommandSchema>, revision: number,
  limits: { delegationMaxDurationMs: number; delegationMaxBudget: number },
): { assignment: OrganizationAssignment; delegationId?: OrganizationDelegation['id'] } {
  const assignment = selectedAssignment(db, command)
  if (command.kind === 'answer-execution-question' || command.kind === 'approve-execution-tool') {
    answerExecutionHuman(db, principal, command, revision)
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
  if (command.kind === 'revoke-delegation') {
    const delegation = parseDelegation(db.prepare('SELECT * FROM assignment_delegations WHERE id=? AND assignmentId=?').get(command.delegationId, assignment.id))
    if (delegation.membershipId !== principal.membershipId) throw new OrganizationError('forbidden')
    if (delegation.state !== 'active' || delegation.version !== command.expectedVersion || delegation.expiresAt <= now) throw new OrganizationError('version-conflict')
    db.prepare("UPDATE assignment_delegations SET state='revoked',version=? WHERE id=?").run(revision, delegation.id)
    return { assignment, delegationId: delegation.id }
  }
  if (assignment.version !== command.expectedVersion || assignmentInvalidation(db, assignment) !== null) throw new OrganizationError('version-conflict')
  if (command.kind === 'answer-assignment') {
    const row = db.prepare('SELECT * FROM assignment_requests WHERE id=? AND assignmentId=?').get(command.requestId, assignment.id)
    if (!row) throw new OrganizationError('forbidden')
    const request = assignmentRequestSchema.parse(row)
    if (assignment.state !== 'pending' || request.state !== 'pending' || request.expiresAt !== null && request.expiresAt <= now) throw new OrganizationError('version-conflict')
    db.prepare('UPDATE assignment_requests SET state=?,answeredRevision=? WHERE id=?').run(command.answer, revision, request.id)
    db.prepare('UPDATE task_assignments SET state=?,version=? WHERE id=?').run(command.answer, revision, assignment.id)
    // The existing notification is the durable request-state invalidation; no duplicate body is retained.
    db.prepare('UPDATE assignment_notifications SET readAt=NULL WHERE requestId=?').run(request.id)
    return { assignment: { ...assignment, state: command.answer, version: revision } }
  }
  if (assignment.state !== 'accepted') throw new OrganizationError('version-conflict')
  ownedDevice(db, principal, command.deviceId)
  if (command.expiresAt <= now || command.expiresAt - now > limits.delegationMaxDurationMs || command.budget > limits.delegationMaxBudget) throw new OrganizationError('invalid-input')
  db.prepare("UPDATE assignment_delegations SET state='expired',version=? WHERE assignmentId=? AND state='active' AND expiresAt<=?").run(revision, assignment.id, now)
  if (db.prepare("SELECT id FROM assignment_delegations WHERE assignmentId=? AND deviceId=? AND state='active'").get(assignment.id, command.deviceId)) throw new OrganizationError('version-conflict')
  const delegation = delegationSchema.parse({ id: randomUUID(), assignmentId: assignment.id, planRevision: assignment.planRevision,
    membershipId: principal.membershipId, deviceId: command.deviceId, executorId: command.executorId,
    capabilities: command.capabilities, budget: command.budget, expiresAt: command.expiresAt, state: 'active', createdRevision: revision, version: revision })
  db.prepare('INSERT INTO assignment_delegations VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(delegation.id, delegation.assignmentId,
    delegation.planRevision, delegation.membershipId, delegation.deviceId, delegation.executorId, JSON.stringify(delegation.capabilities),
    delegation.budget, delegation.expiresAt, delegation.state, revision, revision)
  return { assignment, delegationId: delegation.id }
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
  for (const row of db.prepare('SELECT * FROM task_assignments WHERE organizationId=? AND assigneeId=? ORDER BY createdRevision DESC')
    .all(principal.organizationId ?? null, principal.membershipId ?? null)) {
    const assignment = assignmentSchema.parse(row)
    try {
      const tasks = visibleTasks(db, principal, { ...assignment, revision: assignment.planRevision, search: query.search, offset: 0 })
      if (!tasks.length) continue
    } catch (error) {
      if (error instanceof OrganizationError && error.code === 'forbidden') continue
      throw error
    }
    const request = assignmentRequestSchema.parse(db.prepare('SELECT * FROM assignment_requests WHERE assignmentId=?').get(assignment.id))
    if (request.state === 'pending' && request.expiresAt !== null && request.expiresAt <= Date.now()) request.state = 'expired'
    if (query.state === 'pending' && request.state !== 'pending'
      || query.state === 'processed' && request.state === 'pending') continue
    const notification = assignmentNotificationSchema.parse(db.prepare('SELECT * FROM assignment_notifications WHERE requestId=?').get(request.id))
    items.push({ assignment, request, notificationId: notification.id, readAt: notification.readAt })
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
  if (query.state !== 'processed') for (const row of db.prepare("SELECT data FROM organization_submissions WHERE json_extract(data,'$.handlerId')=?")
    .all(principal.membershipId ?? null)) {
    const request = submissionSchema.parse(JSON.parse(String(row.data)))
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
  return items
}

/**
 * Retire delegations when the approval ceases to be accepted; authorization restoration cannot revive them.
 * @param db - Same transaction as the causing mutation.
 * @param revision - Causing audit event.
 */
export function invalidateDelegations(db: DatabaseSync, revision: number): void {
  db.prepare(`UPDATE assignment_delegations SET state='invalidated',version=? WHERE state='active'
    AND assignmentId IN (SELECT id FROM task_assignments WHERE state<>'accepted')`).run(revision)
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
