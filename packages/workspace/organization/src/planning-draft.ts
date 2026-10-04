/** Shared goal links and server-side subtree reads; private conversations never enter this database. */
import type { DatabaseSync } from 'node:sqlite'
import type { z } from 'zod'
import { OrganizationError } from './error.ts'
import { authorizedProject } from './resources.ts'
import { selectedPlan, visibleTasks } from './workgraph-access.ts'
import { readWorkgraphVersion, saveWorkgraph, saveWorkgraphSubtree, type WorkgraphLimits } from './workgraph.ts'
import { planningPlanViewSchema, type planningPlanReadSchema, planningDraftSchema, type planningReceiptSchema } from './planning-schema.ts'
import type { Principal } from './types.ts'

/** Goal association and original reapproval ownership survive local Host loss. */
export const planningDraftDdl = `
CREATE TABLE planning_goals (accountId TEXT NOT NULL REFERENCES accounts(id), conversationId TEXT NOT NULL,
 goalId TEXT NOT NULL, planId TEXT NOT NULL REFERENCES organization_plans(id), taskId TEXT NOT NULL,
 PRIMARY KEY(accountId,conversationId,goalId)) STRICT;
CREATE TABLE planning_reapprovals (planId TEXT NOT NULL REFERENCES organization_plans(id), taskId TEXT NOT NULL,
 membershipId TEXT NOT NULL REFERENCES memberships(id), PRIMARY KEY(planId,taskId)) STRICT;
`
/**
 * Read only the selected currently visible subtree and its edit eligibility.
 * @param db - Authority read transaction.
 * @param principal - Current member.
 * @param query - Exact task and project.
 * @returns Normalized subtree without hidden relatives; parent and external prerequisites stay server-owned.
 */
export function readPlanningPlan(db: DatabaseSync, principal: Principal,
  query: z.output<typeof planningPlanReadSchema>): z.output<typeof planningPlanViewSchema> {
  const plan = selectedPlan(db, principal, query)
  const version = readWorkgraphVersion(db, plan.id, plan.currentRevision)
  const visible = visibleTasks(db, principal, { ...query, search: '', offset: 0, taskId: undefined })
  const ids = new Set([query.taskId]); let size = 0
  while (size !== ids.size) {
    size = ids.size
    for (const t of version.definition.tasks) if (t.parentTaskId && ids.has(t.parentTaskId)) ids.add(t.id)
  }
  if (![...ids].every(id => visible.some(t => t.id === id))) throw new OrganizationError('forbidden')
  const tasks = version.definition.tasks.filter(t => ids.has(t.id)).map(t => ({ ...t,
    parentTaskId: t.id === query.taskId ? null : t.parentTaskId, dependsOn: t.dependsOn.filter(id => ids.has(id)) }))
  const canEdit = !!db.prepare("SELECT 1 FROM task_grants WHERE planId=? AND taskId=? AND membershipId=? AND scope='subtree' AND canRead=1 AND canEdit=1 AND structureVersion=?")
    .get(plan.id, query.taskId, principal.membershipId ?? null, plan.structureVersion)
  const projectWrite = !!db.prepare('SELECT 1 FROM resource_grants WHERE projectId=? AND membershipId=? AND canWrite=1')
    .get(query.projectId, principal.membershipId ?? null)
  return planningPlanViewSchema.parse({ version: { ...version, definition: { taskId: query.taskId, tasks,
    phases: version.definition.phases.filter(p => tasks.some(t => t.phaseId === p.id)) } },
  canEdit: canEdit && (query.taskId !== plan.rootTaskId || projectWrite), structuralEdit: true,
  invalidatesQualifications: true, requiresOriginalApproval: true })
}
/**
 * Save one linked goal draft or replace an explicitly editable subtree atomically.
 * @param db - Receipt transaction.
 * @param principal - Current member, never caller-supplied authorship.
 * @param command - Validated model proposal with exact revision.
 * @param revision - Owning audit event.
 * @param limits - Complete-definition deployment ceilings.
 * @returns Only the saved plan identifiers and revision.
 */
export function savePlanningDraft(db: DatabaseSync, principal: Principal, command: z.output<typeof planningDraftSchema>,
  revision: number, limits: WorkgraphLimits): z.output<typeof planningReceiptSchema> {
  authorizedProject(db, principal, command.projectId, 'read')
  const link = db.prepare('SELECT * FROM planning_goals WHERE accountId=? AND conversationId=? AND goalId=?')
    .get(principal.accountId, command.conversationId, command.goalId)
  if (link && (link.planId !== command.planId || link.taskId !== command.definition.taskId)) throw new OrganizationError('operation-conflict')
  const existing = db.prepare('SELECT rootTaskId,createdBy FROM organization_plans WHERE id=?').get(command.planId)
  const old = existing ? readWorkgraphVersion(db, command.planId,
    Number(db.prepare('SELECT currentRevision FROM organization_plans WHERE id=?').get(command.planId)?.currentRevision)).definition : undefined
  for (const task of command.definition.tasks) if (task.suggestedMembershipId
    && old?.tasks.find(t => t.id === task.id)?.suggestedMembershipId !== task.suggestedMembershipId
    && !db.prepare('SELECT 1 FROM resource_grants WHERE projectId=? AND membershipId=? AND canRead=1')
      .get(command.projectId, task.suggestedMembershipId)) throw new OrganizationError('invalid-input')
  const subtree = existing && existing.rootTaskId !== command.definition.taskId
  const version = subtree
    ? saveWorkgraphSubtree(db, principal, command, revision, limits, command.definition.taskId)
    : saveWorkgraph(db, principal, command, revision, limits)
  if (subtree) {
    for (const task of command.definition.tasks) {
      let ancestor: typeof task | undefined = task
      let original: string | undefined
      while (ancestor && !original) {
        const existingOwner = db.prepare('SELECT approvedBy FROM task_assignments WHERE planId=? AND taskId=? ORDER BY createdRevision LIMIT 1')
          .get(command.planId, ancestor.id)?.approvedBy
          ?? db.prepare('SELECT membershipId FROM planning_reapprovals WHERE planId=? AND taskId=?')
            .get(command.planId, ancestor.id)?.membershipId
        if (typeof existingOwner === 'string') original = existingOwner
        const parent: typeof task.parentTaskId = ancestor.parentTaskId
        ancestor = parent ? command.definition.tasks.find(t => t.id === parent) : undefined
      }
      db.prepare('INSERT OR IGNORE INTO planning_reapprovals VALUES (?,?,?)').run(command.planId, task.id, original ?? String(existing.createdBy))
    }
  }
  if (!link) db.prepare('INSERT INTO planning_goals VALUES (?,?,?,?,?)').run(principal.accountId, command.conversationId,
    command.goalId, command.planId, command.definition.taskId)
  return { conversationId: command.conversationId, planId: command.planId, planRevision: version.revision,
    taskId: command.definition.taskId }
}

/**
 * Compare saved goal and reapproval identities with their independently stored records on startup.
 * @param db - Open database under the startup transaction.
 */
export function validatePlanningDraftDatabase(db: DatabaseSync): void {
  for (const row of db.prepare('SELECT * FROM planning_goals').all()) {
    const goal = planningDraftSchema.shape.goalId.safeParse(row.goalId)
    const plan = db.prepare('SELECT * FROM organization_plans WHERE id=?').get(String(row.planId))
    const task = db.prepare('SELECT planId FROM plan_tasks WHERE taskId=?').get(String(row.taskId))
    if (!goal.success || !plan || task?.planId !== plan.id || !db.prepare(`SELECT 1 FROM planning_events x
        JOIN organization_events e ON e.revision=x.revision WHERE x.accountId=? AND x.conversationId=? AND x.projectId=?
        AND e.kind='save-planning-draft' AND e.actorId=x.accountId AND e.organizationId=?
        AND json_extract(x.result,'$.planId')=? AND json_extract(x.result,'$.taskId')=?`)
      .get(String(row.accountId), String(row.conversationId), String(plan.projectId), String(plan.organizationId),
        String(row.planId), String(row.taskId))) throw new OrganizationError('incompatible-store')
  }
  if (db.prepare(`SELECT 1 FROM planning_reapprovals r LEFT JOIN organization_plans p ON p.id=r.planId
    LEFT JOIN plan_tasks t ON t.taskId=r.taskId LEFT JOIN memberships m ON m.id=r.membershipId
    WHERE p.id IS NULL OR t.planId!=r.planId OR t.taskId IS NULL OR m.organizationId!=p.organizationId OR m.id IS NULL`).get())
    throw new OrganizationError('incompatible-store')
}
