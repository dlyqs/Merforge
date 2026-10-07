/** Pure layout inputs derived from one Host projection. */
import type { PlanDefinition, PlanPhase, PlanView, TaskDefinition, TaskId, TaskRun } from '@deepseek-ai/dsh-personal-workflow/types'
import type { BotId, ProjectId } from '@deepseek-ai/dsh-personal-project/types'

/** Select plans by fixed affiliation, without copying or changing identity.
 * @param plans - Host projections.
 * @param projectId - Project entrance, or null.
 * @param botId - Bot entrance, or null.
 * @returns Plans associated with this entrance.
 */
export function selectPlans(plans: readonly PlanView[], projectId: ProjectId | null, botId: BotId | null): PlanView[] {
  return plans.filter(({ snapshot: { definition } }) => {
    if (projectId !== null) return definition.projectId === projectId
    return botId === null || definition.botId === botId
  })
}

/** Find exact shared artifact declarations for a selected task.
 * @param tasks - Tasks from the same revision.
 * @param selected - Task whose declarations are inspected.
 * @returns Repeated declared paths; this is not resource isolation analysis.
 */
export function overlappingArtifacts(tasks: readonly TaskDefinition[], selected: TaskDefinition): string[] {
  const other = new Set(tasks.filter(task => task.id !== selected.id).flatMap(task => task.artifacts))
  return selected.artifacts.filter(path => other.has(path))
}

/** Read task-specific evidence and status from ordinary or ordered-phase attempts.
 * @param runs - Persisted execution attempts.
 * @param taskId - Task selected in the detail view.
 * @returns Execution views retaining original conversation links and budgets.
 */
export function taskExecutions(runs: readonly TaskRun[], taskId: TaskId): Pick<TaskRun, 'id' | 'planRevision' | 'status' | 'evidence' | 'sessions'>[] {
  return runs.flatMap<Pick<TaskRun, 'id' | 'planRevision' | 'status' | 'evidence' | 'sessions'>>((run) => {
    if (run.taskId === taskId) return [run]
    if (!run.sequence?.taskIds.includes(taskId)) return []
    const completed = run.sequence.completed.find(item => item.taskId === taskId)
    return [{ id: run.id, planRevision: run.planRevision, status: completed ? 'completed' as const : 'paused' as const,
      evidence: completed?.evidence ?? [], sessions: run.sessions }]
  })
}

/** Count phase tasks separately from root delivery verification.
 * @param definition - Exact sequential plan revision.
 * @param completed - Task identities with accepted completion.
 * @returns Completed count and last consecutively completed phase.
 */
export function phaseProgress(definition: PlanDefinition, completed: readonly TaskId[]): {
  done: number
  total: number
  through: PlanPhase | undefined
} {
  const accepted = new Set(completed)
  const phases = definition.phases.map(phase => ({ phase,
    task: definition.tasks.find(task => task.parentTaskId === definition.taskId && task.phaseId === phase.id) }))
  let through: typeof definition.phases[number] | undefined
  for (const { phase, task } of phases) {
    if (!task || !accepted.has(task.id)) break
    through = phase
  }
  return { done: phases.filter(({ task }) => task !== undefined && accepted.has(task.id)).length, total: phases.length, through }
}

/** Read verified phases of a Run, including predecessors required at admission.
 * @param definition - The Run's immutable plan revision.
 * @param run - Current task and persisted sequence completions.
 * @returns Accepted phase-task identities, excluding root verification.
 */
export function completedRunPhases(definition: PlanDefinition, run: Pick<TaskRun, 'taskId' | 'status' | 'sequence'>): TaskId[] {
  const current = definition.tasks.find(task => task.id === run.taskId)
  const position = current?.id === definition.taskId ? definition.phases.length
    : definition.phases.findIndex(phase => phase.id === current?.phaseId)
  const completed = new Set(run.sequence?.completed.map(item => item.taskId) ?? [])
  for (const task of definition.tasks) {
    if (task.parentTaskId !== definition.taskId) continue
    if (definition.phases.findIndex(phase => phase.id === task.phaseId) < position || (task.id === run.taskId && run.status === 'completed')) completed.add(task.id)
  }
  return [...completed]
}
