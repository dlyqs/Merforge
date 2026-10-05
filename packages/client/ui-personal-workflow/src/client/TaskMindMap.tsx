/** Personal workflow adapter for the shared account-independent task canvas. */
import type { ReactNode } from 'react'
import { TaskMap } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PlanDefinition, TaskId, TaskView } from '@deepseek-ai/dsh-personal-workflow/types'
import type { WorkflowProps } from './contract.ts'

/** @param props - Personal plan, authoritative statuses and localized copy. @returns Shared task canvas. */
export function TaskMindMap({ definition, statuses, selected, onSelect, t, children }: {
  definition: PlanDefinition
  statuses: readonly TaskView[]
  selected: TaskId | null
  onSelect: (id: TaskId) => void
  t: WorkflowProps['t']
  children?: ReactNode
}) {
  return <TaskMap rootId={definition.taskId} selected={selected} onSelect={(id) => {
    const task = definition.tasks.find(item => item.id === id)
    if (task) onSelect(task.id)
  }} tasks={definition.tasks.map((task) => {
    const status = statuses.find(item => item.taskId === task.id)?.status ?? 'pending_review'
    return { ...task, phaseTitle: definition.phases.find(phase => phase.id === task.phaseId)?.title ?? '', status, statusLabel: t(status) }
  })} labels={{
    mindMap: t('mindMap'), mapCount: t('mapCount', { count: definition.tasks.length }), mapControls: t('mapControls'),
    zoomOut: t('zoomOut'), actualSize: t('actualSize'), zoomLevel: t('zoomLevel', { percent: '{percent}' }),
    zoomIn: t('zoomIn'), fitMap: t('fitMap'), locateTask: t('locateTask'), invalidHierarchy: t('invalidHierarchy'),
    mapHint: t('mapHint'), rootTask: t('rootTask'), requiredNode: t('requiredNode'), optionalNode: t('optionalNode'),
    hierarchyHint: t('hierarchyHint'), expandAll: t('expandAll'), expandBranch: t('expandBranch', { goal: '{goal}' }), collapseBranch: t('collapseBranch', { goal: '{goal}' }),
    fullscreen: t('fullscreen'), exitFullscreen: t('exitFullscreen'),
  }}>{children}</TaskMap>
}
