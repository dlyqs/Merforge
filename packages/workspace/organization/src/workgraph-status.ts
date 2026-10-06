/** Dispatch and issuer acceptance projected over a complete immutable task definition. */
import type { OrganizationPlanDefinition, OrganizationTaskId, OrganizationTaskView } from './workgraph-types.ts'

type Status = OrganizationTaskView['status']

/**
 * Derive parent completion before resolving prerequisite readiness; siblings have no implicit order.
 * @param definition - Complete validated task tree, before read filtering.
 * @param dispatched - Tasks with a current assignment or an exact rework decision.
 * @param accepted - Tasks whose current-version delivery the issuer accepted.
 * @returns Status for every task; parents complete only after every child completes.
 */
export function taskStatuses(
  definition: OrganizationPlanDefinition, dispatched: ReadonlySet<string>, accepted: ReadonlySet<string>,
): Map<OrganizationTaskId, Status> {
  const children = new Map<OrganizationTaskId, OrganizationTaskId[]>()
  for (const task of definition.tasks) {
    if (task.parentTaskId !== null) {
      const siblings = children.get(task.parentTaskId) ?? []
      siblings.push(task.id); children.set(task.parentTaskId, siblings)
    }
  }
  const completed = new Map<OrganizationTaskId, boolean>()
  const complete = (id: OrganizationTaskId): boolean => {
    const cached = completed.get(id)
    if (cached !== undefined) return cached
    const descendants = children.get(id)
    const value = descendants ? descendants.every(complete) : accepted.has(id)
    completed.set(id, value)
    return value
  }
  for (const task of definition.tasks) complete(task.id)
  const result = new Map<OrganizationTaskId, Status>()
  const byId = new Map(definition.tasks.map(task => [task.id, task]))
  const resolve = (id: OrganizationTaskId): Status => {
    const cached = result.get(id)
    if (cached) return cached
    const task = byId.get(id)
    if (!task) throw new Error('organization: missing stored prerequisite')
    const descendants = (children.get(id) ?? []).map(resolve)
    const status: Status = completed.get(id) ? 'completed'
      : task.dependsOn.some(dependency => !completed.get(dependency)) ? 'blocked'
        : dispatched.has(id) || descendants.some(value => value === 'running' || value === 'completed') ? 'running'
          : descendants.some(value => value === 'blocked') ? 'blocked' : 'pending'
    result.set(id, status)
    return status
  }
  for (const task of definition.tasks) resolve(task.id)
  return result
}
