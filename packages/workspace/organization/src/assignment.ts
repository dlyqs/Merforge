import { authorizeHierarchyAssignment } from './hierarchy.ts'
/** Transaction-local approval, visibility and irreversible authority invalidation. */
import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { z } from 'zod'
import { membershipSchema, metadataSchema } from './schema.ts'
import { OrganizationError } from './error.ts'
import { authorizeWorkgraph, readWorkgraphVersion } from './workgraph.ts'
import { visibleTasks, setTaskGrant } from './workgraph-access.ts'
import { taskGrantRowSchema } from './workgraph-schema.ts'
import { grantSchema } from './resource-schema.ts'
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
 * Check the exact leaf definition, issuer authority and reporting relationship.
 * @param db - Current authority transaction.
 * @param principal - Current root editor with project write access.
 * @param query - Exact revision, leaf and proposed employee.
 * @returns Whether the task can be assigned; approval supplies employee access atomically.
 */
export function reviewAssignment(db: DatabaseSync, principal: Principal, query: z.output<typeof approvalReviewSchema>): boolean {
  const plan = authorizeWorkgraph(db, principal, query.projectId, query.planId, true)
  if (plan.currentRevision !== query.planRevision) throw new OrganizationError('version-conflict')
  const required = db.prepare('SELECT membershipId FROM planning_reapprovals WHERE planId=? AND taskId=?').get(plan.id, query.taskId)
  if (required && required.membershipId !== principal.membershipId) throw new OrganizationError('forbidden')
  const definition = readWorkgraphVersion(db, plan.id, plan.currentRevision).definition
  const task = definition.tasks.find(item => item.id === query.taskId)
  if (!task || definition.tasks.some(item => item.parentTaskId === task.id)) throw new OrganizationError('invalid-input')
  authorizeHierarchyAssignment(db, principal, query.assigneeId)
  memberPrincipal(db, principal, query.assigneeId)
  return true
}

/**
 * Apply an approval or revocation inside the caller's audit and receipt transaction.
 * @param db - Authority write transaction.
 * @param principal - Current root editor, checked again by this executor.
 * @param command - Validated action and exact version.
 * @param revision - Audit event allocated for this action.
 * @param maxGrants - Deployment ceiling for retained task access records.
 * @returns Approval identity and version for the receipt.
 */
export function changeAssignment(
  db: DatabaseSync, principal: Principal, command: Command, revision: number, maxGrants: number,
): OrganizationAssignment {
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
  const projectRow = db.prepare('SELECT * FROM resource_grants WHERE projectId=? AND membershipId=?')
    .get(command.projectId, command.assigneeId)
  const projectAccess = projectRow && grantSchema.parse(projectRow)
  if (!projectAccess?.canRead || !projectAccess.canWrite) {
    db.prepare(`INSERT INTO resource_grants VALUES (?,?,1,1,?) ON CONFLICT(projectId,membershipId)
      DO UPDATE SET canRead=1,canWrite=1,version=excluded.version`).run(command.projectId, command.assigneeId, revision)
    db.prepare('INSERT INTO resource_events VALUES (?,?)').run(revision, command.projectId)
  }
  const taskRow = db.prepare("SELECT * FROM task_grants WHERE planId=? AND taskId=? AND membershipId=? AND scope='subtree'")
    .get(plan.id, command.taskId, command.assigneeId)
  const taskAccess = taskRow && taskGrantRowSchema.parse(taskRow)
  if (!taskAccess?.canRead || !taskAccess.canEdit || taskAccess.structureVersion !== plan.structureVersion) {
    setTaskGrant(db, principal, { organizationId: command.organizationId, projectId: command.projectId, planId: plan.id,
      taskId: command.taskId, membershipId: command.assigneeId, scope: 'subtree', actions: ['read', 'edit'],
      expectedVersion: taskAccess?.version ?? 0, operationId: command.operationId }, revision, maxGrants)
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
    authorizeHierarchyAssignment(db, author, assignment.assigneeId)
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
