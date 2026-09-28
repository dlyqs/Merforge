/** Transaction-local approval, visibility and irreversible authority invalidation. */
import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { z } from 'zod'
import { membershipSchema, metadataSchema } from './schema.ts'
import { OrganizationError } from './error.ts'
import { authorizeWorkgraph, readWorkgraphVersion } from './workgraph.ts'
import { visibleTasks } from './workgraph-access.ts'
import { assignmentSchema, type assignmentCommandSchema, type assignmentReadSchema, type approvalReviewSchema } from './assignment-schema.ts'
import type { OrganizationAssignment } from './assignment-types.ts'
import type { MembershipId, Principal } from './types.ts'

type Command = z.output<typeof assignmentCommandSchema>

function memberPrincipal(db: DatabaseSync, principal: Principal, member: MembershipId): Principal {
  const row = db.prepare(`SELECT m.accountId FROM memberships m JOIN accounts a ON a.id=m.accountId
    WHERE m.id=? AND m.organizationId=? AND m.enabled=1 AND a.enabled=1`).get(member, principal.organizationId ?? null)
  if (!row) throw new OrganizationError('forbidden')
  const accountId = principalAccountSchema.parse(row).accountId
  return { serverId: principal.serverId, accountId, organizationId: principal.organizationId, membershipId: member }
}
const principalAccountSchema = membershipSchema.pick({ accountId: true })

/**
 * Require current task visibility before delivering assignment metadata or request facts.
 * @param db - Active authority transaction.
 * @param principal - Fresh authenticated organization member.
 * @param assignment - Stored exact-version approval.
 */
export function authorizeAssignmentRead(db: DatabaseSync, principal: Principal, assignment: OrganizationAssignment): void {
  visibleTasks(db, principal, { organizationId: assignment.organizationId, projectId: assignment.projectId,
    planId: assignment.planId, taskId: assignment.taskId, revision: assignment.planRevision, search: '', offset: 0 })
}

/**
 * Select a known approval without allowing cross-project or cross-organization identifiers.
 * @param db - Active authority transaction.
 * @param query - Strict selector; caller separately establishes current identity.
 * @returns Stored approval, including terminal history.
 */
export function selectedAssignment(db: DatabaseSync, query: z.output<typeof assignmentReadSchema>): OrganizationAssignment {
  const row = db.prepare('SELECT * FROM task_assignments WHERE id=? AND organizationId=? AND projectId=? AND planId=?')
    .get(query.assignmentId, query.organizationId, query.projectId, query.planId)
  if (!row) throw new OrganizationError('forbidden')
  return assignmentSchema.parse(row)
}

/**
 * Check the exact leaf definition and the proposed employee's existing read grants.
 * @param db - Current authority transaction.
 * @param principal - Current root editor with project write access.
 * @param query - Exact revision, leaf and proposed employee.
 * @returns Whether the employee already has all required visibility; no grant is changed.
 */
export function reviewAssignment(db: DatabaseSync, principal: Principal, query: z.output<typeof approvalReviewSchema>): boolean {
  const plan = authorizeWorkgraph(db, principal, query.projectId, query.planId, true)
  if (plan.currentRevision !== query.planRevision) throw new OrganizationError('version-conflict')
  const definition = readWorkgraphVersion(db, plan.id, plan.currentRevision).definition
  const task = definition.tasks.find(item => item.id === query.taskId)
  if (!task || definition.tasks.some(item => item.parentTaskId === task.id)) throw new OrganizationError('invalid-input')
  // Ancestor prerequisites also block a leaf; this phase has no completed-task authority.
  let ancestor: typeof task | undefined = task
  while (ancestor) {
    if (ancestor.dependsOn.length) throw new OrganizationError('invalid-input')
    const parent: string | null = ancestor.parentTaskId
    ancestor = definition.tasks.find(item => item.id === parent)
  }
  const target = memberPrincipal(db, principal, query.assigneeId)
  try { visibleTasks(db, target, { ...query, revision: query.planRevision, search: '', offset: 0 }) }
  catch (error) {
    if (error instanceof OrganizationError && error.code === 'forbidden') return false
    throw error
  }
  return true
}

/**
 * Apply an approval or revocation inside the caller's audit and receipt transaction.
 * @param db - Authority write transaction.
 * @param principal - Current root editor, checked again by this executor.
 * @param command - Validated action and exact version.
 * @param revision - Audit event allocated for this action.
 * @returns Approval identity and version for the receipt.
 */
export function changeAssignment(db: DatabaseSync, principal: Principal, command: Command, revision: number): OrganizationAssignment {
  const plan = authorizeWorkgraph(db, principal, command.projectId, command.planId, true)
  if (command.kind === 'revoke-assignment') {
    const assignment = selectedAssignment(db, command)
    if (assignment.version !== command.expectedVersion || !['pending', 'accepted'].includes(assignment.state)) throw new OrganizationError('version-conflict')
    db.prepare("UPDATE task_assignments SET state='revoked',version=? WHERE id=?").run(revision, assignment.id)
    db.prepare("UPDATE assignment_requests SET state='cancelled' WHERE assignmentId=? AND state='pending'").run(assignment.id)
    return { ...assignment, state: 'revoked', version: revision }
  }
  if (!reviewAssignment(db, principal, command)) throw new OrganizationError('forbidden')
  if (db.prepare("SELECT id FROM task_assignments WHERE planId=? AND taskId=? AND state IN ('pending','accepted')").get(plan.id, command.taskId)) {
    throw new OrganizationError('version-conflict')
  }
  const assignment = assignmentSchema.parse({ id: randomUUID(), organizationId: command.organizationId, projectId: command.projectId,
    planId: plan.id, planRevision: command.planRevision, taskId: command.taskId, approvedBy: principal.membershipId,
    assigneeId: command.assigneeId, state: 'pending', reason: null, createdAt: Number(db.prepare('SELECT at FROM organization_events WHERE revision=?').get(revision)?.at), createdRevision: revision, version: revision })
  db.prepare('INSERT INTO task_assignments VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run(assignment.id, assignment.organizationId,
    assignment.projectId, assignment.planId, assignment.planRevision, assignment.taskId, assignment.approvedBy, assignment.assigneeId,
    assignment.state, assignment.reason, assignment.createdAt, revision, revision)
  const requestId = randomUUID()
  db.prepare("INSERT INTO assignment_requests VALUES (?,?,'accept-assignment','pending',NULL,NULL)").run(requestId, assignment.id)
  db.prepare('INSERT INTO assignment_notifications VALUES (?,?,?,NULL)').run(randomUUID(), requestId, revision)
  return assignment
}

/**
 * Determine whether an active approval still has both participants' original authority.
 * @param db - Current authority transaction.
 * @param assignment - Stored pending or accepted approval.
 * @returns A terminal reason, or null while all authorization remains valid.
 */
export function assignmentInvalidation(db: DatabaseSync, assignment: OrganizationAssignment): OrganizationAssignment['reason'] {
  if (db.prepare('SELECT currentRevision FROM organization_plans WHERE id=?').get(assignment.planId)?.currentRevision !== assignment.planRevision) {
    return 'revision-changed'
  }
  try {
    const metadata = db.prepare('SELECT serverId FROM metadata').get()
    const serverId = metadataSchema.pick({ serverId: true }).parse(metadata).serverId
    const base: Principal = { serverId, accountId: principalAccountSchema.parse(
      db.prepare('SELECT accountId FROM memberships WHERE id=?').get(assignment.approvedBy)).accountId, organizationId: assignment.organizationId }
    const author = memberPrincipal(db, base, assignment.approvedBy)
    authorizeWorkgraph(db, author, assignment.projectId, assignment.planId, true)
    authorizeAssignmentRead(db, memberPrincipal(db, base, assignment.assigneeId), assignment)
    return null
  } catch (error) {
    if (error instanceof OrganizationError && error.code === 'forbidden') return 'authority-lost'
    throw error
  }
}

/**
 * Retire affected approvals and requests before an authority mutation commits.
 * @param db - Same write transaction as the plan, grant, account or member change.
 * @param revision - Causing audit event; retained as the terminal assignment version.
 * @param restored - Offline restore invalidates every pending or accepted approval regardless of grants.
 */
export function invalidateAssignments(db: DatabaseSync, revision: number, restored = false): void {
  for (const row of db.prepare("SELECT * FROM task_assignments WHERE state IN ('pending','accepted')").all()) {
    const assignment = assignmentSchema.parse(row)
    const reason = restored ? 'restored' : assignmentInvalidation(db, assignment)
    if (!reason) continue
    db.prepare("UPDATE task_assignments SET state='invalidated',reason=?,version=? WHERE id=?").run(reason, revision, assignment.id)
    db.prepare("UPDATE assignment_requests SET state='cancelled' WHERE assignmentId=? AND state='pending'").run(assignment.id)
  }
}
