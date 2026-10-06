/** Execution admission based on readable, approved prerequisite tasks. */
import type { DatabaseSync } from 'node:sqlite'
import { acceptanceSchema } from './delivery-schema.ts'
import { readArtifact } from './delivery.ts'
import { visibleTasks, selectedPlan } from './workgraph-access.ts'
import { readWorkgraphVersion } from './workgraph.ts'
import { OrganizationError } from './error.ts'
import type { Principal, OrganizationId, OrganizationProjectId } from './types.ts'
import type { OrganizationPlanDefinition, OrganizationPlanId, OrganizationTaskId } from './workgraph-types.ts'

function requiredLeaves(definition: OrganizationPlanDefinition, taskId: OrganizationTaskId): OrganizationTaskId[] {
  const children = definition.tasks.filter(task => task.parentTaskId === taskId)
  return children.length ? children.filter(task => task.required).flatMap(task => requiredLeaves(definition, task.id)) : [taskId]
}

/**
 * Require current approved outputs for every prerequisite of the task and its ancestors.
 * @param db - Current authority transaction.
 * @param principal - Executing employee with current task access.
 * @param query - Exact assigned task version.
 */
export function requireDependencies(db: DatabaseSync, principal: Principal, query: {
  organizationId: OrganizationId
  projectId: OrganizationProjectId
  planId: OrganizationPlanId
  taskId: OrganizationTaskId
  planRevision: number
}): void {
  const plan = selectedPlan(db, principal, query)
  if (plan.currentRevision !== query.planRevision) throw new OrganizationError('version-conflict')
  const visible = new Set(visibleTasks(db, principal, { ...query, search: '', offset: 0 }).map(task => task.id))
  if (!visible.has(query.taskId)) throw new OrganizationError('forbidden')
  const definition = readWorkgraphVersion(db, plan.id, plan.currentRevision).definition
  const allVisible = new Set(visibleTasks(db, principal, { organizationId: query.organizationId,
    projectId: query.projectId, planId: query.planId, search: '', offset: 0 }).map(task => task.id))
  let task = definition.tasks.find(task => task.id === query.taskId)
  const dependencies = new Set<OrganizationTaskId>()
  while (task) {
    for (const id of task.dependsOn) dependencies.add(id)
    const parent = task.parentTaskId
    task = definition.tasks.find(task => task.id === parent)
  }
  for (const dependency of dependencies) {
    const leaves = requiredLeaves(definition, dependency)
    if (!leaves.length) throw new OrganizationError('version-conflict')
    for (const id of leaves) {
      if (!allVisible.has(id)) throw new OrganizationError('version-conflict')
      const row = db.prepare(`SELECT r.data FROM organization_acceptances r JOIN task_assignments a ON a.id=r.assignmentId
        WHERE a.planId=? AND a.taskId=? AND a.planRevision=? AND json_extract(r.data,'$.state')='accepted'`)
        .get(query.planId, id, query.planRevision)
      if (!row) throw new OrganizationError('version-conflict')
      const acceptance = acceptanceSchema.parse(JSON.parse(String(row.data)))
      for (const item of acceptance.artifacts) {
        if (readArtifact(db, item.artifactId).artifact.sha256 !== item.sha256) throw new OrganizationError('incompatible-store')
      }
    }
  }
}
