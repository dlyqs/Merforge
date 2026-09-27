/** Pure hierarchy, phase-order and effective completion dependency validation. */

/** Fields shared by personal and organization definitions; no runtime or storage ownership. */
export interface TaskGraph {
  taskId: string
  phases: readonly { id: string }[]
  tasks: readonly {
    id: string
    parentTaskId: string | null
    phaseId: string
    required: boolean
    dependsOn: readonly string[]
  }[]
}

/**
 * Inspect a complete task tree and its explicit and required-child completion edges.
 * @param plan - Complete definition, never an authorization-filtered projection.
 * @returns Violations; an empty array admits a connected tree and satisfiable completion graph.
 */
export function taskGraphErrors(plan: TaskGraph): string[] {
  const errors: string[] = []
  const tasks = new Map(plan.tasks.map(task => [task.id, task]))
  const phases = new Map(plan.phases.map((phase, index) => [phase.id, index]))
  if (tasks.size !== plan.tasks.length) errors.push('duplicate task identity')
  if (phases.size !== plan.phases.length) errors.push('duplicate phase identity')
  const roots = plan.tasks.filter(task => task.parentTaskId === null)
  if (roots.length !== 1 || roots[0]?.id !== plan.taskId || !roots[0].required) errors.push('plan requires exactly one required root matching taskId')
  const parents = new Map<string, readonly string[]>()
  const waits = new Map<string, string[]>()
  for (const task of plan.tasks) {
    parents.set(task.id, task.parentTaskId === null ? [] : [task.parentTaskId])
    waits.set(task.id, [...task.dependsOn])
    if (!phases.has(task.phaseId)) errors.push('unknown phase')
    if (new Set(task.dependsOn).size !== task.dependsOn.length) errors.push('duplicate dependency')
    if (task.parentTaskId !== null && !tasks.has(task.parentTaskId)) errors.push('unknown parent')
    for (const dependency of task.dependsOn) {
      const prerequisite = tasks.get(dependency)
      if (!prerequisite) errors.push('unknown or cross-plan dependency')
      else if ((phases.get(prerequisite.phaseId) ?? -1)
        > (phases.get(task.phaseId) ?? -1)) errors.push('dependency in a later phase')
    }
  }
  for (const task of plan.tasks) {
    if (task.parentTaskId === null || !task.required) continue
    waits.get(task.parentTaskId)?.push(task.id)
    const parent = tasks.get(task.parentTaskId)
    if (parent && (phases.get(task.phaseId) ?? -1)
      > (phases.get(parent.phaseId) ?? -1)) errors.push('required child in a later phase than its parent')
  }
  if (cyclic(parents)) errors.push('task hierarchy cycle')
  if (cyclic(waits)) errors.push('unsatisfiable dependency or parent completion cycle')
  return errors
}

function cyclic(edges: ReadonlyMap<string, readonly string[]>): boolean {
  const pending = new Map([...edges].map(([id, dependencies]) => [id, new Set(dependencies).size]))
  const consumers = new Map<string, string[]>()
  for (const [id, dependencies] of edges) for (const dependency of new Set(dependencies)) {
    const list = consumers.get(dependency) ?? []
    list.push(id)
    consumers.set(dependency, list)
  }
  const ready = [...pending].filter(([, size]) => size === 0).map(([id]) => id)
  let visited = 0
  for (let index = 0; index < ready.length; index++) {
    const id = ready[index]
    if (id === undefined) break
    visited++
    for (const consumer of consumers.get(id) ?? []) {
      const previous = pending.get(consumer)
      if (previous === undefined) continue
      const count = previous - 1
      pending.set(consumer, count)
      if (count === 0) ready.push(consumer)
    }
  }
  return visited !== edges.size
}
