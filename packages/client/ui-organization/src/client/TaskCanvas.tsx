/** Organization projection adapter for the shared task canvas; unreadable ancestors stay absent. */
import type { ReactNode } from 'react'
import { TaskMap } from '@deepseek-ai/dsh-client-ui-primitives'
import type { OrganizationTask, OrganizationTaskId } from '@deepseek-ai/dsh-organization'
import type { OrganizationProps } from './contract.ts'

/** @param props - Readable task nodes and the selected-node details. @returns Shared pan-and-zoom task view. */
export function TaskCanvas({ tasks, selected, onSelect, t, children }: {
  tasks: readonly (OrganizationTask & { phaseTitle?: string })[]
  selected: OrganizationTaskId | null
  onSelect: (id: OrganizationTaskId) => void
  t: OrganizationProps['t']
  children?: ReactNode
}) {
  return <TaskMap rootId={tasks.find(task => task.parentTaskId === null)?.id ?? ''} selected={selected}
    onSelect={(id) => { const task = tasks.find(task => task.id === id); if (task) onSelect(task.id) }}
    tasks={tasks.map(task => ({ ...task,
      parentTaskId: tasks.some(parent => parent.id === task.parentTaskId) ? task.parentTaskId : null,
      phaseTitle: task.phaseTitle ?? '', status: '', statusLabel: '',
    }))} labels={{
      mindMap: t('mindMap'), mapCount: t('mapCount', { count: tasks.length }), mapControls: t('mapControls'),
      zoomOut: t('zoomOut'), actualSize: t('actualSize'), zoomLevel: t('zoomLevel', { percent: '{percent}' }),
      zoomIn: t('zoomIn'), fitMap: t('fitMap'), locateTask: t('locateTask'), invalidHierarchy: t('invalidHierarchy'),
      mapHint: t('mapHint'), rootTask: t('rootTask'), requiredNode: t('requiredNode'), optionalNode: t('optionalNode'),
      hierarchyHint: t('mapHierarchyHint'), expandAll: t('expandAll'), expandBranch: t('expandBranch', { goal: '{goal}' }), collapseBranch: t('collapseBranch', { goal: '{goal}' }),
    }}>{children}</TaskMap>
}
