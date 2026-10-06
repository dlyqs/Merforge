/** Localized phase summaries consume authoritative task statuses. */
import type { OrganizationTaskView } from '@deepseek-ai/dsh-organization'
import type { ComponentProps } from 'react'
import type { TaskStages } from '@deepseek-ai/dsh-client-ui-primitives'
import type { OrganizationProps } from './contract.ts'

/**
 * Summarize visible phase membership using the same statuses shown on task cards.
 * @param phases - Visible phase order.
 * @param tasks - Readable task statuses, or unsaved tasks without execution facts.
 * @param t - Organization locale.
 * @returns Phase badges and matching task-entry badges.
 */
export function taskStageView(phases: readonly { id: string; title: string }[], tasks: readonly {
  id: string
  phaseId: string
  goal: string
  dependsOn: readonly string[]
  status?: OrganizationTaskView['status']
  hasUndisclosedPrerequisite?: boolean
}[], t: OrganizationProps['t']): Pick<ComponentProps<typeof TaskStages>, 'tasks' | 'phases'> {
  return {
    tasks: tasks.map(task => ({ ...task, ...(task.status ? { statusLabel: t(`task-status-${task.status}`) } : {}) })),
    phases: phases.map((phase) => {
      const members = tasks.filter(task => task.phaseId === phase.id)
      const status = members.length && members.every(task => task.status === 'completed') ? 'completed'
        : members.some(task => task.status === 'running' || task.status === 'completed') ? 'running'
          : members.some(task => task.status === 'blocked') ? 'blocked' : 'pending'
      return { ...phase, status, statusLabel: t(`task-status-${status}`) }
    }),
  }
}
