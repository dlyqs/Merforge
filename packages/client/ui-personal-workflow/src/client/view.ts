/** Pure layout inputs derived from one Host projection. */
import type { PlanView, TaskDefinition, TaskId, TaskRun } from '@deepseek-ai/dsh-personal-workflow/types'
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
