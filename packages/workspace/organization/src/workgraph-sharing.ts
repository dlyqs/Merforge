/** Creator-owned shared background and explicit read-only whole-tree approval. */
import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { z } from 'zod'
import { OrganizationError } from './error.ts'
import { membershipSchema } from './schema.ts'
import { selectedPlan, visibleTasks, setTaskGrant } from './workgraph-access.ts'
import { treeRequestSchema, workgraphSharingViewSchema, type workgraphSharingCommandSchema,
  type workgraphSharingReadSchema, taskGrantRowSchema } from './workgraph-schema.ts'
import type { Principal } from './types.ts'

/** Schema v20 shares background independently of task-definition revisions. */
export const workgraphSharingDdl = `
CREATE TABLE plan_contexts (planId TEXT PRIMARY KEY REFERENCES organization_plans(id), sharedContext TEXT NOT NULL,
  version INTEGER NOT NULL REFERENCES organization_events(revision)) STRICT;
CREATE TABLE tree_requests (id TEXT PRIMARY KEY, planId TEXT NOT NULL REFERENCES organization_plans(id),
  membershipId TEXT NOT NULL REFERENCES memberships(id), state TEXT NOT NULL CHECK(state IN ('pending','approved','rejected')),
  structureVersion INTEGER NOT NULL, version INTEGER NOT NULL REFERENCES organization_events(revision),
  UNIQUE(planId,membershipId,structureVersion)) STRICT;
INSERT INTO plan_contexts SELECT p.id,COALESCE((SELECT json_extract(t.value,'$.scope')
  FROM json_each(r.value,'$.definition.tasks') t WHERE json_extract(t.value,'$.id')=p.rootTaskId),''),r.eventRevision
  FROM organization_plans p JOIN plan_revisions r ON r.planId=p.id AND r.revision=1;
`
type Query = z.output<typeof workgraphSharingReadSchema>
type Command = z.output<typeof workgraphSharingCommandSchema>

function hasAssignment(db: DatabaseSync, principal: Principal, plan: ReturnType<typeof selectedPlan>): boolean {
  return !!db.prepare("SELECT 1 FROM task_assignments WHERE planId=? AND assigneeId=? AND planRevision=? AND state IN ('pending','accepted')")
    .get(plan.id, principal.membershipId ?? null, plan.currentRevision)
}

/**
 * Recheck current task visibility and creator-only mutation authority.
 * @param db - Current authority transaction.
 * @param principal - Authenticated organization member.
 * @param query - Read selector or fixed human command.
 * @returns Authorized plan head.
 */
export function authorizeSharing(db: DatabaseSync, principal: Principal, query: Query & { kind?: Command['kind'] }): ReturnType<typeof selectedPlan> {
  visibleTasks(db, principal, { organizationId: query.organizationId, projectId: query.projectId, planId: query.planId, search: '', offset: 0 })
  const plan = selectedPlan(db, principal, query)
  if (query.kind === 'edit-context' || query.kind === 'decide-tree') {
    if (plan.createdBy !== principal.membershipId) throw new OrganizationError('forbidden')
  } else if (query.kind === 'request-tree' && !hasAssignment(db, principal, plan)) throw new OrganizationError('forbidden')
  return plan
}

/**
 * Read current background without disclosing hidden tasks or other employees' requests.
 * @param db - Current read transaction.
 * @param principal - Authenticated task reader.
 * @param query - Exact readable plan.
 * @returns Background, creator controls and current structural-epoch requests.
 */
export function readSharing(db: DatabaseSync, principal: Principal, query: Query): z.output<typeof workgraphSharingViewSchema> {
  const plan = authorizeSharing(db, principal, query)
  const context = db.prepare('SELECT sharedContext,version FROM plan_contexts WHERE planId=?').get(plan.id)
  if (!context) throw new OrganizationError('incompatible-store')
  const fullTreeVisible = !!db.prepare("SELECT 1 FROM task_grants WHERE planId=? AND taskId=? AND membershipId=? AND scope='subtree' AND canRead=1 AND structureVersion=?")
    .get(plan.id, plan.rootTaskId, principal.membershipId ?? null, plan.structureVersion)
  const creator = plan.createdBy === principal.membershipId
  const requests = db.prepare(`SELECT r.*,a.username FROM tree_requests r JOIN memberships m ON m.id=r.membershipId
    JOIN accounts a ON a.id=m.accountId WHERE r.planId=? AND r.structureVersion=? AND (? OR r.membershipId=?) ORDER BY r.version`)
    .all(plan.id, plan.structureVersion, Number(creator), principal.membershipId ?? null)
  return workgraphSharingViewSchema.parse({ ...context, canEdit: creator, fullTreeVisible,
    canRequest: !creator && !fullTreeVisible && hasAssignment(db, principal, plan), requests })
}

/**
 * Apply one shared-context edit, employee request or creator decision atomically.
 * @param db - Owning receipt transaction.
 * @param principal - Authenticated human actor.
 * @param command - Validated fixed action.
 * @param revision - Current audit event.
 * @param maxGrants - Deployment ceiling for retained grants and requests per plan.
 */
export function changeSharing(db: DatabaseSync, principal: Principal, command: Command, revision: number, maxGrants: number): void {
  const plan = authorizeSharing(db, principal, command)
  switch (command.kind) {
    case 'edit-context': {
      const context = db.prepare('SELECT version FROM plan_contexts WHERE planId=?').get(plan.id)
      if (context?.version !== command.expectedVersion) throw new OrganizationError('version-conflict')
      db.prepare('UPDATE plan_contexts SET sharedContext=?,version=? WHERE planId=?').run(command.sharedContext, revision, plan.id)
      break
    }
    case 'request-tree': {
      const view = readSharing(db, principal, command)
      if (!view.canRequest) throw new OrganizationError('forbidden')
      const previous = view.requests.find(r => r.membershipId === principal.membershipId)
      if (previous?.state === 'pending') throw new OrganizationError('version-conflict')
      if (!previous && Number(db.prepare('SELECT count(*) AS n FROM tree_requests WHERE planId=?').get(plan.id)?.n) >= maxGrants)
        throw new OrganizationError('invalid-input')
      db.prepare(`INSERT INTO tree_requests VALUES (?,?,?,'pending',?,?) ON CONFLICT(planId,membershipId,structureVersion)
        DO UPDATE SET state='pending',version=excluded.version`)
        .run(randomUUID(), plan.id, principal.membershipId ?? null, plan.structureVersion, revision)
      break
    }
    case 'decide-tree': {
      const row = db.prepare('SELECT * FROM tree_requests WHERE id=? AND planId=?').get(command.requestId, plan.id)
      if (!row) throw new OrganizationError('forbidden')
      const request = treeRequestSchema.parse(row)
      if (request.version !== command.expectedVersion || request.state !== 'pending' || request.structureVersion !== plan.structureVersion)
        throw new OrganizationError('version-conflict')
      if (command.answer === 'approved') {
        const member = db.prepare(`SELECT m.accountId FROM memberships m JOIN accounts a ON a.id=m.accountId
          WHERE m.id=? AND m.organizationId=? AND m.enabled=1 AND a.enabled=1`)
          .get(request.membershipId, plan.organizationId)
        if (!member) throw new OrganizationError('forbidden')
        const employee = { ...principal, accountId: membershipSchema.pick({ accountId: true }).parse(member).accountId,
          membershipId: request.membershipId }
        if (!hasAssignment(db, employee, plan)) throw new OrganizationError('forbidden')
        authorizeSharing(db, employee, { organizationId: command.organizationId, projectId: command.projectId, planId: command.planId })
        const previous = db.prepare("SELECT * FROM task_grants WHERE planId=? AND taskId=? AND membershipId=? AND scope='subtree'")
          .get(plan.id, plan.rootTaskId, request.membershipId)
        setTaskGrant(db, principal, { ...command, taskId: plan.rootTaskId, membershipId: request.membershipId,
          scope: 'subtree', actions: ['read'], expectedVersion: previous ? taskGrantRowSchema.parse(previous).version : 0 }, revision, maxGrants)
      }
      db.prepare('UPDATE tree_requests SET state=?,version=? WHERE id=?').run(command.answer, revision, request.id)
      break
    }
    default: assertNever(command)
  }
  if (!db.prepare('SELECT 1 FROM workgraph_events WHERE revision=?').get(revision))
    db.prepare('INSERT INTO workgraph_events VALUES (?,?)').run(revision, plan.id)
}

function assertNever(value: never): never { throw new Error(`organization: unknown sharing command ${String(value)}`) }

/**
 * Verify retained sharing records against plans, members and their audit actors.
 * @param db - Startup or offline-maintenance transaction.
 */
export function validateSharingDatabase(db: DatabaseSync): void {
  if (db.prepare(`SELECT 1 FROM organization_plans p LEFT JOIN plan_contexts c ON c.planId=p.id
    LEFT JOIN organization_events e ON e.revision=c.version LEFT JOIN memberships m ON m.id=p.createdBy
    WHERE c.planId IS NULL OR e.organizationId<>p.organizationId OR e.actorId<>m.accountId
    OR e.kind NOT IN ('save-plan','save-planning-draft','edit-context') LIMIT 1`).get()) throw new OrganizationError('incompatible-store')
  for (const row of db.prepare('SELECT * FROM tree_requests').all()) {
    const r = treeRequestSchema.parse(row)
    const valid = db.prepare(`SELECT 1 FROM organization_plans p JOIN memberships m ON m.id=?
      JOIN memberships creator ON creator.id=p.createdBy JOIN organization_events e ON e.revision=?
      WHERE p.id=? AND m.organizationId=p.organizationId AND e.organizationId=p.organizationId
      AND ?<=p.structureVersion AND ?<=? AND
      ((?='pending' AND e.kind='request-tree' AND e.actorId=m.accountId)
      OR (?<>'pending' AND e.kind='decide-tree' AND e.actorId=creator.accountId))`)
      .get(r.membershipId, r.version, r.planId, r.structureVersion, r.structureVersion, r.version, r.state, r.state)
    if (!valid) throw new OrganizationError('incompatible-store')
    if (r.state === 'approved' && !db.prepare(`SELECT 1 FROM task_grants g JOIN organization_plans p ON p.id=g.planId
      WHERE g.planId=? AND g.taskId=p.rootTaskId AND g.membershipId=? AND g.scope='subtree' AND g.version>=?
      AND (g.version>? OR g.canRead=1 AND g.canEdit=0 AND g.structureVersion=?)`)
      .get(r.planId, r.membershipId, r.version, r.version, r.structureVersion)) throw new OrganizationError('incompatible-store')
  }
}
