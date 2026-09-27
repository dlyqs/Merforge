/** WorkGraph physical tables and cross-record validation used by open and offline maintenance. */
import type { DatabaseSync } from 'node:sqlite'
import { OrganizationError } from './error.ts'
import { taskGrantRowSchema, workgraphPlanSchema } from './workgraph-schema.ts'
import { readWorkgraphVersion, workgraphStructureKey } from './workgraph.ts'

/** Schema v3 additions; all records share the organization authority transaction. */
export const workgraphDdl = `
CREATE TABLE organization_plans (id TEXT PRIMARY KEY, organizationId TEXT NOT NULL REFERENCES organizations(id),
  projectId TEXT NOT NULL REFERENCES organization_projects(id), rootTaskId TEXT NOT NULL,
  currentRevision INTEGER NOT NULL CHECK(currentRevision>0), structureVersion INTEGER NOT NULL,
  createdBy TEXT NOT NULL REFERENCES memberships(id)) STRICT;
CREATE TABLE plan_revisions (planId TEXT NOT NULL REFERENCES organization_plans(id), revision INTEGER NOT NULL,
  eventRevision INTEGER UNIQUE NOT NULL REFERENCES organization_events(revision), value TEXT NOT NULL, PRIMARY KEY(planId,revision)) STRICT;
CREATE TABLE plan_tasks (taskId TEXT PRIMARY KEY, planId TEXT NOT NULL REFERENCES organization_plans(id), active INTEGER NOT NULL CHECK(active IN (0,1)),
  UNIQUE(planId,taskId)) STRICT;
CREATE TABLE task_grants (planId TEXT NOT NULL, taskId TEXT NOT NULL, membershipId TEXT NOT NULL REFERENCES memberships(id),
  scope TEXT NOT NULL CHECK(scope IN ('node','subtree')), canRead INTEGER NOT NULL CHECK(canRead IN (0,1)), canEdit INTEGER NOT NULL CHECK(canEdit IN (0,1)),
  structureVersion INTEGER NOT NULL, version INTEGER NOT NULL, PRIMARY KEY(planId,taskId,membershipId,scope),
  FOREIGN KEY(planId,taskId) REFERENCES plan_tasks(planId,taskId)) STRICT;
CREATE TABLE workgraph_events (revision INTEGER PRIMARY KEY REFERENCES organization_events(revision), planId TEXT NOT NULL REFERENCES organization_plans(id)) STRICT;
CREATE INDEX organization_plans_project ON organization_plans(projectId,id);
CREATE INDEX task_grants_member ON task_grants(membershipId,planId);
CREATE TRIGGER plan_revision_no_update BEFORE UPDATE ON plan_revisions BEGIN SELECT RAISE(ABORT,'immutable plan revision'); END;
CREATE TRIGGER plan_revision_no_delete BEFORE DELETE ON plan_revisions BEGIN SELECT RAISE(ABORT,'immutable plan revision'); END;
`

/**
 * Reject invalid graph history, identity reuse, stale heads and inconsistent authority references.
 * @param db - Open connection under its startup or maintenance transaction.
 */
export function validateWorkgraphDatabase(db: DatabaseSync): void {
  const fail = () => { throw new OrganizationError('incompatible-store') }
  for (const row of db.prepare('SELECT * FROM organization_plans').all()) {
    const plan = workgraphPlanSchema.parse(row)
    if (!db.prepare('SELECT id FROM organization_projects WHERE id=? AND organizationId=?').get(plan.projectId, plan.organizationId)
      || !db.prepare('SELECT id FROM memberships WHERE id=? AND organizationId=?').get(plan.createdBy, plan.organizationId)) fail()
    const revisions = db.prepare('SELECT revision,eventRevision FROM plan_revisions WHERE planId=? ORDER BY revision').all(plan.id)
    if (revisions.length !== plan.currentRevision) fail()
    const seen = new Set<string>()
    let active = new Set<string>()
    let structureKey: string | undefined
    let structuralEvent = 0
    let lastEvent = 0
    for (const [index, revision] of revisions.entries()) {
      if (revision.revision !== index + 1) fail()
      const version = readWorkgraphVersion(db, plan.id, index + 1)
      const key = workgraphStructureKey(version.definition)
      if (typeof revision.eventRevision !== 'number' || revision.eventRevision <= lastEvent) fail()
      lastEvent = Number(revision.eventRevision)
      if (key !== structureKey) structuralEvent = lastEvent
      structureKey = key
      const event = db.prepare('SELECT * FROM organization_events WHERE revision=?').get(revision.eventRevision ?? null)
      const author = db.prepare('SELECT accountId FROM memberships WHERE id=? AND organizationId=?').get(version.createdBy, plan.organizationId)
      if (version.planId !== plan.id || version.revision !== index + 1 || version.projectId !== plan.projectId
        || version.organizationId !== plan.organizationId || version.definition.taskId !== plan.rootTaskId
        || !author || event?.kind !== 'save-plan' || event.organizationId !== plan.organizationId || event.actorId !== author.accountId
        || !db.prepare('SELECT revision FROM workgraph_events WHERE revision=? AND planId=?').get(revision.eventRevision ?? null, plan.id)
        || (index === 0 && version.createdBy !== plan.createdBy)) fail()
      const next = new Set<string>()
      for (const task of version.definition.tasks) {
        if (seen.has(task.id) && !active.has(task.id)) fail()
        seen.add(task.id); next.add(task.id)
        if (task.suggestedMembershipId !== null && !db.prepare('SELECT id FROM memberships WHERE id=? AND organizationId=?')
          .get(task.suggestedMembershipId, plan.organizationId)) fail()
      }
      active = next
    }
    const identities = db.prepare('SELECT taskId,active FROM plan_tasks WHERE planId=?').all(plan.id)
    if (identities.length !== seen.size) fail()
    for (const identity of identities) {
      if (!seen.has(String(identity.taskId)) || identity.active !== Number(active.has(String(identity.taskId)))) fail()
    }
    if (plan.structureVersion !== structuralEvent) fail()
  }
  for (const row of db.prepare('SELECT * FROM task_grants').all()) {
    const grant = taskGrantRowSchema.parse(row)
    const plan = workgraphPlanSchema.parse(db.prepare('SELECT * FROM organization_plans WHERE id=?').get(grant.planId))
    if (!db.prepare('SELECT id FROM memberships WHERE id=? AND organizationId=?').get(grant.membershipId, plan.organizationId)
      || grant.structureVersion > plan.structureVersion || grant.version < grant.structureVersion
      || (grant.canEdit && (!grant.canRead || grant.scope !== 'subtree' || grant.taskId !== plan.rootTaskId))) fail()
  }
  if (db.prepare(`SELECT 1 FROM workgraph_events w LEFT JOIN plan_revisions r ON r.eventRevision=w.revision AND r.planId=w.planId
    JOIN organization_events e ON e.revision=w.revision JOIN organization_plans p ON p.id=w.planId
    WHERE (r.planId IS NULL AND e.kind!='set-task-grant') OR e.organizationId!=p.organizationId LIMIT 1`).get()) fail()
  if (db.prepare(`SELECT 1 FROM organization_events e LEFT JOIN workgraph_events w ON w.revision=e.revision
    WHERE e.kind IN ('save-plan','set-task-grant') AND w.revision IS NULL LIMIT 1`).get()) fail()
}
