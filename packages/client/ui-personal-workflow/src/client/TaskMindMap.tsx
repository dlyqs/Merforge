/** Personal workflow adapter for the shared account-independent task canvas. */
import type { ReactNode } from 'react'
import { TaskMap, taskWorkspaceStyles as css } from '@deepseek-ai/dsh-client-ui-primitives'
import phaseCss from './PhaseList.module.css'
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
  if (definition.planningMode === 'phases') {
    const ordered = definition.phases.flatMap(phase => definition.tasks
      .filter(task => task.phaseId === phase.id && task.id !== definition.taskId))
    const root = definition.tasks.find(task => task.id === definition.taskId)
    return <div className={phaseCss.layout}>
      <section className={css.taskPreview} aria-label={t('phaseSequence')}>
        <h3>{t('phaseSequence')}</h3><p className={css.hint}>{t('phaseSequenceHint')}</p>
        <ol className={phaseCss.list}>{[...ordered, ...root === undefined ? [] : [root]].map((task) => {
          const status = statuses.find(item => item.taskId === task.id)?.status ?? 'pending_review'
          return <li key={task.id}><button type="button" className={css.branch} aria-pressed={selected === task.id} onClick={() => { onSelect(task.id) }}>
            <small>{task.id === definition.taskId ? t('rootTask') : definition.phases.find(phase => phase.id === task.phaseId)?.title}</small>
            <strong>{task.goal}</strong><span className={css.status} data-status={status}>{t(status)}</span>
          </button></li>
        })}</ol>
      </section>
      {children && <div className={phaseCss.detail}>{children}</div>}
    </div>
  }
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
    fullscreen: t('fullscreen'), exitFullscreen: t('exitFullscreen'), fullscreenFailed: t('fullscreenFailed'),
  }}>{children}</TaskMap>
}
