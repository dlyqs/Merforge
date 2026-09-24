/** Pure layout inputs derived from one Host projection. */
import type { PlanView, TaskDefinition, TaskId } from '@deepseek-ai/dsh-personal-workflow/types'
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

/** Build tree rows without interpreting sibling order as dependencies.
 * @param tasks - Validated tasks from one revision.
 * @param parent - Parent identity, or null for roots.
 * @returns Child definitions in presentation order.
 */
export function childrenOf(tasks: readonly TaskDefinition[], parent: TaskId | null): TaskDefinition[] {
  return tasks.filter(task => task.parentTaskId === parent)
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
