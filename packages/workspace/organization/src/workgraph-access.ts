/** Current task grants and historical intersections used by every WorkGraph projection. */
import type { DatabaseSync } from 'node:sqlite'
import type { z } from 'zod'
import { assignmentSchema } from './assignment-schema.ts'
import { OrganizationError } from './error.ts'
import { authorizedProject } from './resources.ts'
import { readWorkgraphVersion } from './workgraph.ts'
import { workgraphPlanSchema, taskGrantRowSchema, type workgraphGrantSchema, type workgraphTasksSchema } from './workgraph-schema.ts'
import type { Principal } from './types.ts'
import type { OrganizationPlanDefinition, OrganizationTaskView, OrganizationTaskGrant, OrganizationWorkgraphBatch } from './workgraph-types.ts'

type Plan = z.output<typeof workgraphPlanSchema>
type Grant = z.output<typeof taskGrantRowSchema>
type Query = z.output<typeof workgraphTasksSchema>

/**
 * Resolve known plan identifiers without exposing its content to grant administrators.
 * @param db - Active authority transaction.
 * @param principal - Authenticated member or administrator.
 * @param query - Known organization/project/plan selection.
 * @returns Matching plan head, or a uniform denial.
 */
export function selectedPlan(db: DatabaseSync, principal: Principal, query: { projectId: string; planId: string }): Plan {
  const row = db.prepare('SELECT * FROM organization_plans WHERE id=? AND projectId=? AND organizationId=?')
    .get(query.planId, query.projectId, principal.organizationId ?? null)
  if (!row) throw new OrganizationError('forbidden')
  return workgraphPlanSchema.parse(row)
}

function grants(db: DatabaseSync, principal: Principal, plan: Plan): Grant[] {
  return db.prepare('SELECT * FROM task_grants WHERE planId=? AND membershipId=? AND structureVersion=? AND canRead=1')
    .all(plan.id, principal.membershipId ?? null, plan.structureVersion).map(row => taskGrantRowSchema.parse(row))
}
function covered(definition: OrganizationPlanDefinition, access: Grant[]): Set<string> {
  const tasks = new Map(definition.tasks.map(task => [task.id, task]))
  const nodes = new Set(access.map(grant => grant.taskId))
  const roots = new Set(access.filter(grant => grant.scope === 'subtree').map(grant => grant.taskId))
  return new Set(definition.tasks.filter((task) => {
    if (nodes.has(task.id)) return true
    let parent = task.parentTaskId
    while (parent !== null) {
      if (roots.has(parent)) return true
      parent = tasks.get(parent)?.parentTaskId ?? null
    }
    return false
  }).map(task => task.id))
}
function project(db: DatabaseSync, principal: Principal, plan: Plan, revision: number): OrganizationTaskView[] {
  const access = grants(db, principal, plan)
  if (!access.length) return []
  const current = readWorkgraphVersion(db, plan.id, plan.currentRevision)
  const version = revision === plan.currentRevision ? current : readWorkgraphVersion(db, plan.id, revision)
  const now = covered(current.definition, access)
  const then = covered(version.definition, access)
  const visible = new Set([...now].filter(id => then.has(id)))
  const phases = new Map(version.definition.phases.map(phase => [phase.id, phase.title]))
  return version.definition.tasks.filter(task => visible.has(task.id)).map((task) => {
    const phaseTitle = phases.get(task.phaseId)
    if (phaseTitle === undefined) throw new Error('organization: missing stored task phase')
    const member = task.suggestedMembershipId === null ? undefined : db.prepare(`SELECT m.enabled,a.enabled AS accountEnabled
      FROM memberships m JOIN accounts a ON a.id=m.accountId WHERE m.id=? AND m.organizationId=?`)
      .get(task.suggestedMembershipId, principal.organizationId ?? null)
    return { ...task, parentTaskId: task.parentTaskId !== null && visible.has(task.parentTaskId) ? task.parentTaskId : null,
      dependsOn: task.dependsOn.filter(id => visible.has(id)),
      hasUndisclosedPrerequisite: task.dependsOn.some(id => !visible.has(id)),
      phaseTitle,
      assignable: !!member?.enabled && !!member.accountEnabled, planId: plan.id, revision: version.revision }
  })
}

/**
 * Project current grants before detail selection, search or pagination.
 * @param db - Active authority transaction.
 * @param principal - Fresh enabled organization identity.
 * @param query - Strict list, detail or historical query.
 * @returns Matching authorized tasks only; an empty permission set is forbidden.
 */
export function visibleTasks(db: DatabaseSync, principal: Principal, query: Query): OrganizationTaskView[] {
  authorizedProject(db, principal, query.projectId, 'read')
  const plans = query.planId ? [selectedPlan(db, principal, { projectId: query.projectId, planId: query.planId })]
    : db.prepare('SELECT * FROM organization_plans WHERE projectId=? AND organizationId=? ORDER BY id')
      .all(query.projectId, principal.organizationId ?? null).map(row => workgraphPlanSchema.parse(row))
  const items = plans.flatMap(plan => project(db, principal, plan, query.revision ?? plan.currentRevision))
  if (!items.length || query.taskId && !items.some(task => task.id === query.taskId)) throw new OrganizationError('forbidden')
  const search = query.search.toLowerCase()
  return items.filter(task => (!query.taskId || task.id === query.taskId)
    && [task.goal, task.scope, ...task.acceptance, ...task.artifacts].some(text => text.toLowerCase().includes(search)))
    .sort((a, b) => a.planId.localeCompare(b.planId) || a.id.localeCompare(b.id))
}

/**
 * Save or revoke an explicit node/subtree grant after administrator authorization.
 * @param db - Active receipt transaction.
 * @param principal - Current administrator.
 * @param request - Strict grant mutation.
 * @param revision - New event position.
 * @param maxGrants - Maximum retained grant records per plan.
 */
export function setTaskGrant(
  db: DatabaseSync, principal: Principal, request: z.output<typeof workgraphGrantSchema>, revision: number, maxGrants: number,
): void {
  const plan = selectedPlan(db, principal, request)
  if (!db.prepare('SELECT taskId FROM plan_tasks WHERE planId=? AND taskId=? AND active=1').get(plan.id, request.taskId)
    || !db.prepare('SELECT id FROM memberships WHERE id=? AND organizationId=?').get(request.membershipId, principal.organizationId ?? null)) {
    throw new OrganizationError('forbidden')
  }
  if (request.actions.includes('edit') && request.taskId !== plan.rootTaskId) throw new OrganizationError('invalid-input')
  const row = db.prepare('SELECT * FROM task_grants WHERE planId=? AND taskId=? AND membershipId=? AND scope=?')
    .get(plan.id, request.taskId, request.membershipId, request.scope)
  if ((row ? taskGrantRowSchema.parse(row).version : 0) !== request.expectedVersion) throw new OrganizationError('version-conflict')
  if (!row && Number(db.prepare('SELECT count(*) AS n FROM task_grants WHERE planId=?').get(plan.id)?.n) >= maxGrants) {
    throw new OrganizationError('invalid-input')
  }
  db.prepare(`INSERT INTO task_grants VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(planId,taskId,membershipId,scope)
    DO UPDATE SET canRead=excluded.canRead,canEdit=excluded.canEdit,structureVersion=excluded.structureVersion,version=excluded.version`)
    .run(plan.id, request.taskId, request.membershipId, request.scope, Number(request.actions.includes('read')),
      Number(request.actions.includes('edit')), plan.structureVersion, revision)
  db.prepare('INSERT INTO workgraph_events VALUES (?,?)').run(revision, plan.id)
}

/**
 * Read bounded grant metadata without task text or member names.
 * @param db - Active authority transaction.
 * @param plan - Administrator-selected plan.
 * @param maxGrants - Deployment ceiling, including retained revocations.
 * @returns Explicit actions and whether each structural epoch is current.
 */
export function taskGrants(db: DatabaseSync, plan: Plan, maxGrants: number): OrganizationTaskGrant[] {
  const rows = db.prepare('SELECT * FROM task_grants WHERE planId=? ORDER BY taskId,membershipId,scope').all(plan.id)
  if (rows.length > maxGrants) throw new OrganizationError('invalid-input')
  return rows.map((row) => {
    const grant = taskGrantRowSchema.parse(row)
    const actions: ('read' | 'edit')[] = []
    if (grant.canRead) actions.push('read')
    if (grant.canEdit) actions.push('edit')
    return { planId: plan.id, taskId: grant.taskId, membershipId: grant.membershipId, scope: grant.scope,
      actions, version: grant.version, active: grant.structureVersion === plan.structureVersion }
  })
}

/**
 * Deliver no invalidation for edits confined to hidden tasks or hidden prerequisites.
 * @param db - Active authority transaction.
 * @param principal - Current identity.
 * @param after - Exclusive committed position.
 * @param through - Inclusive committed position.
 * @returns Content-free plan invalidations whose visible projection changed.
 */
export function visibleWorkgraphEvents(db: DatabaseSync, principal: Principal, after: number, through: number): OrganizationWorkgraphBatch['events'] {
  const rows = db.prepare(`SELECT p.*,e.revision AS eventRevision FROM workgraph_events e
    JOIN organization_plans p ON p.id=e.planId JOIN resource_grants g ON g.projectId=p.projectId
    WHERE p.organizationId=? AND g.membershipId=? AND g.canRead=1 AND e.revision>? AND e.revision<=? ORDER BY e.revision`)
    .all(principal.organizationId ?? null, principal.membershipId ?? null, after, through)
  const definitions = rows.flatMap((row) => {
    const { eventRevision, ...head } = row
    const plan = workgraphPlanSchema.parse(head)
    const stored = db.prepare('SELECT revision FROM plan_revisions WHERE planId=? AND eventRevision=?').get(plan.id, Number(eventRevision))
    if (!stored) return []
    const revision = Number(stored.revision)
    const next = project(db, principal, plan, revision)
    if (!next.length) return []
    const previous = revision > 1 ? project(db, principal, plan, revision - 1) : []
    const content = (items: OrganizationTaskView[]) => JSON.stringify(items
      .map(({ revision: _revision, ...task }) => task).sort((a, b) => a.id.localeCompare(b.id)))
    return content(next) === content(previous) ? [] : [{ revision: Number(eventRevision), planId: plan.id }]
  })
  const changes = db.prepare(`SELECT a.*, changes.revision AS eventRevision FROM (
    SELECT id AS assignmentId, createdRevision AS revision FROM task_assignments
    UNION SELECT id,version FROM task_assignments
    UNION SELECT assignmentId,revision FROM assignment_actions
    UNION SELECT assignmentId,version FROM assignment_delegations
    UNION SELECT assignmentId,version FROM assignment_leases
  ) changes JOIN task_assignments a ON a.id=changes.assignmentId
  WHERE a.organizationId=? AND changes.revision>? AND changes.revision<=?`).all(principal.organizationId ?? null, after, through)
  const qualifications = changes.flatMap((row) => {
    const { eventRevision, ...fields } = row
    const assignment = assignmentSchema.parse(fields)
    try {
      visibleTasks(db, principal, { organizationId: assignment.organizationId, projectId: assignment.projectId,
        planId: assignment.planId, taskId: assignment.taskId, revision: assignment.planRevision, search: '', offset: 0 })
    } catch (error) {
      if (error instanceof OrganizationError && error.code === 'forbidden') return []
      throw error
    }
    return [{ revision: Number(eventRevision), planId: assignment.planId }]
  })
  return [...new Map([...definitions, ...qualifications].map(event => [`${event.revision}:${event.planId}`, event])).values()]
    .sort((a, b) => a.revision - b.revision)
}
