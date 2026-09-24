/** Pure task readiness and Markdown views of one exact plan revision. */
import type { PlanRevision, PlanView, TaskId, TaskObservation, TaskView } from './types.ts'

/** Compute ready branches and parent aggregation without assigning executors.
 * @param snapshot - exact approved or proposed plan revision.
 * @param observations - trusted Run/Evidence facts for this revision.
 * @returns view with ready tasks in definition order, without order-induced dependencies.
 */
export function projectPlan(snapshot: PlanRevision, observations: readonly TaskObservation[] = []): PlanView {
  const facts = new Map(observations.map(fact => [fact.taskId, fact]))
  const completed = new Set<TaskId>()
  const children = new Map<TaskId, TaskId[]>()
  for (const task of snapshot.definition.tasks) {
    if (task.parentTaskId === null || !task.required) continue
    const list = children.get(task.parentTaskId) ?? []
    list.push(task.id)
    children.set(task.parentTaskId, list)
  }
  let changed = true
  while (changed) {
    changed = false
    for (const task of snapshot.definition.tasks) {
      const fact = facts.get(task.id)
      if (completed.has(task.id) || fact?.status !== 'completed' || fact.evidence.length === 0) continue
      if ([...task.dependsOn, ...children.get(task.id) ?? []].some(id => !completed.has(id))) continue
      completed.add(task.id)
      changed = true
    }
  }
  const tasks: TaskView[] = snapshot.definition.tasks.map((task) => {
    const required = children.get(task.id) ?? []
    const blockers = [...new Set([...task.dependsOn, ...required])].filter(id => !completed.has(id))
    const fact = facts.get(task.id)
    const status = fact?.status === 'completed'
      ? completed.has(task.id) ? 'completed' : 'needs_reconciliation'
      : fact?.status ?? (snapshot.approval === null ? 'pending_review' : blockers.length ? 'blocked' : 'ready')
    return {
      taskId: task.id, status, candidate: status === 'ready', blockers,
      requiredChildren: required.length, completedChildren: required.filter(id => completed.has(id)).length,
    }
  })
  return { snapshot, tasks, ready: tasks.filter(task => task.candidate).map(task => task.taskId) }
}

/** Render a read-only Markdown view; JSON quoting preserves multiline user text.
 * @param snapshot - exact stored revision to export.
 * @returns Markdown containing the same definition and approval fields.
 */
export function exportPlan(snapshot: PlanRevision): string {
  const { definition } = snapshot
  const lines = [
    '# Personal workflow', '', `Task: ${definition.taskId}`, `Revision: ${snapshot.revision}`,
    `Review: ${snapshot.approval === null ? 'pending_review' : 'approved'}`, '',
  ]
  for (const phase of definition.phases) {
    lines.push(`## ${JSON.stringify(phase.title)}`, `Phase: ${phase.id}`, '')
    for (const task of definition.tasks.filter(task => task.phaseId === phase.id)) {
      lines.push(`### ${JSON.stringify(task.goal)}`, `Task: ${task.id}`, `Parent: ${task.parentTaskId ?? 'none'}`,
        `Required: ${task.required}`, `Depends on: ${task.dependsOn.join(', ') || 'none'}`,
        `Scope: ${JSON.stringify(task.scope)}`, `Directory: ${JSON.stringify(task.cwd)}`,
        `Acceptance: ${JSON.stringify(task.acceptance)}`, `Artifacts: ${JSON.stringify(task.artifacts)}`, '')
    }
  }
  lines.push('## Structured revision', '', '    ' + JSON.stringify(snapshot), '')
  return lines.join('\n')
}
