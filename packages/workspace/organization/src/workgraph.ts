/** Transaction-local WorkGraph persistence and complete-definition authorization. */
import type { DatabaseSync } from 'node:sqlite'
import type { z } from 'zod'
import { OrganizationError } from './error.ts'
import { authorizedProject } from './resources.ts'
import { taskGrantRowSchema, workgraphPlanSchema, workgraphVersionSchema, type workgraphSaveSchema } from './workgraph-schema.ts'
import type { OrganizationPlanDefinition, OrganizationPlanId, OrganizationPlanVersion } from './workgraph-types.ts'
import type { Principal, OrganizationProjectId } from './types.ts'

type Save = z.output<typeof workgraphSaveSchema>
type Plan = z.output<typeof workgraphPlanSchema>
/** Deployment ceilings applied to a complete stored or delivered version, including metadata. */
export interface WorkgraphLimits {
  workgraphMaxTasks: number
  workgraphMaxDepth: number
  workgraphMaxBytes: number
}

/**
 * Apply deployment ceilings to a complete version without truncating relations or text.
 * @param version - Fully validated definition plus server metadata.
 * @param limits - Owning service configuration.
 */
export function checkWorkgraphLimits(version: OrganizationPlanVersion, limits: WorkgraphLimits): void {
  const definition = version.definition
  if (definition.tasks.length > limits.workgraphMaxTasks || definition.phases.length > limits.workgraphMaxTasks
    || Buffer.byteLength(JSON.stringify(version)) > limits.workgraphMaxBytes) throw new OrganizationError('invalid-input')
  const tasks = new Map(definition.tasks.map(task => [task.id, task]))
  for (const task of definition.tasks) {
    let parent = task.parentTaskId
    let depth = 1
    while (parent !== null) {
      if (++depth > limits.workgraphMaxDepth) throw new OrganizationError('invalid-input')
      parent = tasks.get(parent)?.parentTaskId ?? null
    }
  }
}

/**
 * Require project access plus a current root-subtree grant before full reads or edits.
 * @param db - Active authority transaction.
 * @param principal - Fresh organization membership.
 * @param projectId - Caller-selected project, checked against the stored plan.
 * @param planId - Target plan.
 * @param edit - Whether explicit project write and root edit are also required.
 * @returns Current plan head without materializing its task content before authorization.
 */
export function authorizeWorkgraph(
  db: DatabaseSync, principal: Principal, projectId: OrganizationProjectId, planId: OrganizationPlanId, edit: boolean,
): Plan {
  authorizedProject(db, principal, projectId, 'read')
  if (edit) authorizedProject(db, principal, projectId, 'write')
  const row = db.prepare('SELECT * FROM organization_plans WHERE id=? AND projectId=? AND organizationId=?')
    .get(planId, projectId, principal.organizationId ?? null)
  if (!row) throw new OrganizationError('forbidden')
  const plan = workgraphPlanSchema.parse(row)
  const grant = db.prepare('SELECT * FROM task_grants WHERE planId=? AND taskId=? AND membershipId=? AND scope=\'subtree\'')
    .get(planId, plan.rootTaskId, principal.membershipId ?? null)
  if (!grant) throw new OrganizationError('forbidden')
  const access = taskGrantRowSchema.parse(grant)
  if (access.structureVersion !== plan.structureVersion || !access.canRead || (edit && !access.canEdit)) throw new OrganizationError('forbidden')
  return plan
}

/**
 * Read one immutable version after the caller has established current authorization.
 * @param db - Active authority transaction.
 * @param planId - Authorized plan.
 * @param revision - Exact existing definition revision.
 * @returns Stored version; missing revisions disclose no additional information.
 */
export function readWorkgraphVersion(db: DatabaseSync, planId: OrganizationPlanId, revision: number): OrganizationPlanVersion {
  const row = db.prepare('SELECT value FROM plan_revisions WHERE planId=? AND revision=?').get(planId, revision)
  if (!row) throw new OrganizationError('invalid-input')
  return workgraphVersionSchema.parse(JSON.parse(String(row.value)))
}

/**
 * Canonicalize task membership and parent relations for structural authorization epochs.
 * @param definition - Validated complete tree.
 * @returns Stable key unaffected by presentation order or task text.
 */
export function workgraphStructureKey(definition: OrganizationPlanDefinition): string {
  return JSON.stringify(definition.tasks.map(task => [task.id, task.parentTaskId]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))))
}

/**
 * Persist a new immutable revision and its indices in the caller's receipt transaction.
 * @param db - Active write transaction; the caller owns rollback and commit notification.
 * @param principal - Current author established inside this transaction.
 * @param request - Strict complete-definition save request.
 * @param eventRevision - Database audit revision allocated by the caller.
 * @param limits - Deployment ceilings.
 * @returns Server-recorded definition version, never an execution authorization.
 */
export function saveWorkgraph(
  db: DatabaseSync, principal: Principal, request: Save, eventRevision: number, limits: WorkgraphLimits,
): OrganizationPlanVersion {
  const member = principal.membershipId
  if (!member) throw new OrganizationError('forbidden')
  const existing = db.prepare('SELECT id FROM organization_plans WHERE id=?').get(request.planId)
  let plan: Plan | undefined
  if (existing) plan = authorizeWorkgraph(db, principal, request.projectId, request.planId, true)
  else {
    authorizedProject(db, principal, request.projectId, 'read')
    authorizedProject(db, principal, request.projectId, 'write')
  }
  if ((plan?.currentRevision ?? 0) !== request.expectedRevision) throw new OrganizationError('version-conflict')
  if (plan && plan.rootTaskId !== request.definition.taskId) throw new OrganizationError('invalid-input')
  const previous = plan ? readWorkgraphVersion(db, plan.id, plan.currentRevision) : undefined
  const previousTasks = new Set(previous?.definition.tasks.map(task => task.id))
  for (const task of request.definition.tasks) {
    const identity = db.prepare('SELECT planId FROM plan_tasks WHERE taskId=?').get(task.id)
    if (identity && (identity.planId !== request.planId || !previousTasks.has(task.id))) throw new OrganizationError('invalid-input')
    if (task.suggestedMembershipId !== null) {
      const row = db.prepare(`SELECT m.enabled,a.enabled AS accountEnabled FROM memberships m JOIN accounts a ON a.id=m.accountId
        WHERE m.id=? AND m.organizationId=?`).get(task.suggestedMembershipId, request.organizationId)
      if (!row) throw new OrganizationError('invalid-input')
      const retained = previous?.definition.tasks.find(item => item.id === task.id)?.suggestedMembershipId === task.suggestedMembershipId
      if ((!row.enabled || !row.accountEnabled) && !retained) throw new OrganizationError('invalid-input')
    }
  }
  const version = workgraphVersionSchema.parse({ planId: request.planId, organizationId: request.organizationId,
    projectId: request.projectId, revision: request.expectedRevision + 1, definition: request.definition,
    createdBy: member, createdAt: Date.now() })
  checkWorkgraphLimits(version, limits)
  const structuralChange = previous !== undefined
    && workgraphStructureKey(previous.definition) !== workgraphStructureKey(version.definition)
  const structureVersion = !plan || structuralChange ? eventRevision : plan.structureVersion
  if (!plan) {
    db.prepare('INSERT INTO organization_plans VALUES (?,?,?,?,?,?,?)')
      .run(request.planId, request.organizationId, request.projectId, request.definition.taskId, version.revision, structureVersion, member)
  } else {
    db.prepare('UPDATE organization_plans SET currentRevision=?,structureVersion=? WHERE id=?').run(version.revision, structureVersion, plan.id)
  }
  db.prepare('INSERT INTO plan_revisions VALUES (?,?,?,?)').run(request.planId, version.revision, eventRevision, JSON.stringify(version))
  db.prepare('UPDATE plan_tasks SET active=0 WHERE planId=?').run(request.planId)
  for (const task of version.definition.tasks) {
    db.prepare('INSERT INTO plan_tasks VALUES (?,?,1) ON CONFLICT(taskId) DO UPDATE SET active=1').run(task.id, request.planId)
  }
  if (!plan) {
    db.prepare("INSERT INTO task_grants VALUES (?,?,?,'subtree',1,1,?,?)")
      .run(request.planId, request.definition.taskId, member, structureVersion, eventRevision)
  } else if (structuralChange) {
    // Only the editor explicitly supplying this complete new tree retains its root grant.
    db.prepare("UPDATE task_grants SET structureVersion=?,version=? WHERE planId=? AND taskId=? AND membershipId=? AND scope='subtree'")
      .run(structureVersion, eventRevision, plan.id, plan.rootTaskId, member)
  }
  db.prepare('INSERT INTO workgraph_events VALUES (?,?)').run(eventRevision, request.planId)
  return version
}
