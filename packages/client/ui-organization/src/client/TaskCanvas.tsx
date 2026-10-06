/** Organization projection adapter for the shared task canvas; unreadable ancestors stay absent. */
import type { ReactNode } from 'react'
import { TaskMap } from '@deepseek-ai/dsh-client-ui-primitives'
import type { OrganizationTask, OrganizationTaskView, OrganizationTaskId, OrganizationInboxItem } from '@deepseek-ai/dsh-organization'
import type { OrganizationProps } from './contract.ts'

/** @param props - Readable task nodes and the selected-node details. @returns Shared pan-and-zoom task view. */
export function TaskCanvas({ tasks, pending = [], selected, onSelect, t, children, introduction }: {
  tasks: readonly (OrganizationTask & Partial<Pick<OrganizationTaskView, 'status'>> & { phaseTitle?: string; assignedToMe?: boolean | undefined; hasTreeRequests?: boolean | undefined })[]
  pending?: readonly OrganizationInboxItem[]
  selected: OrganizationTaskId | null
  onSelect: (id: OrganizationTaskId) => void
  t: OrganizationProps['t']
  children?: ReactNode
  introduction?: ReactNode
}) {
  return <>{introduction}<TaskMap rootId={tasks.find(task => task.parentTaskId === null)?.id ?? ''} selected={selected}
    onSelect={(id) => { const task = tasks.find(task => task.id === id); if (task) onSelect(task.id) }}
    tasks={tasks.map(task => ({ ...task,
      parentTaskId: tasks.some(parent => parent.id === task.parentTaskId) ? task.parentTaskId : null,
      phaseTitle: task.phaseTitle ?? '', status: task.status ?? 'pending',
      assignmentLabel: task.assignedToMe ? t('assignedToMe') : '',
      statusLabel: t(`task-status-${task.status ?? 'pending'}`),
      attentionLabel: task.hasTreeRequests ? t('treeRequestsNeedReview') : pending.some(item => item.assignment.taskId === task.id)
        ? t(pending.some(item => item.assignment.taskId === task.id && item.request.kind === 'accept-delivery') ? 'review-pending' : 'taskActionNeeded') : '',
    }))} labels={{
      mindMap: t('mindMap'), mapCount: t('mapCount', { count: tasks.length }), mapControls: t('mapControls'),
      zoomOut: t('zoomOut'), actualSize: t('actualSize'), zoomLevel: t('zoomLevel', { percent: '{percent}' }),
      zoomIn: t('zoomIn'), fitMap: t('fitMap'), locateTask: t('locateTask'), invalidHierarchy: t('invalidHierarchy'),
      mapHint: t('mapHint'), rootTask: t('rootTask'), requiredNode: t('requiredNode'), optionalNode: t('optionalNode'),
      hierarchyHint: t('mapHierarchyHint'), expandAll: t('expandAll'), expandBranch: t('expandBranch', { goal: '{goal}' }), collapseBranch: t('collapseBranch', { goal: '{goal}' }),
      fullscreen: t('fullscreen'), exitFullscreen: t('exitFullscreen'),
    }} />{children}</>
}
