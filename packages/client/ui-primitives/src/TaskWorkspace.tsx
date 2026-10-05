/** Shared task details and phase navigation with caller-owned data and localized labels. */
import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { Button } from './Button.tsx'
import { IconCloseOutlineRegular } from './icons/index.tsx'
import css from './TaskWorkspace.module.css'

/**
 * Render dismissible details inside a task canvas and reset scrolling when selection changes.
 * @param props - Selected task, optional status, localized chrome and account-owned controls.
 * @returns Task detail surface.
 */
export function TaskDetail(props: {
  taskId: string
  title: string
  status?: { value: string; label: string }
  labels: { taskDetail: string; hideDetails: string }
  onClose: () => void
  children: ReactNode
}) {
  const detail = useRef<HTMLElement>(null)
  useEffect(() => { if (detail.current) detail.current.scrollTop = 0 }, [props.taskId])
  return <section ref={detail} className={css.detail} aria-label={props.labels.taskDetail}>
    <div className={css.detailToolbar}><span className={css.eyebrow}>{props.labels.taskDetail}</span>
      <Button size="sm" icon={<IconCloseOutlineRegular />} aria-label={props.labels.hideDetails} onClick={props.onClose} />
    </div>
    <div className={css.detailHeading}><h3>{props.title}</h3>
      {props.status && <span className={css.status} data-status={props.status.value}>{props.status.label}</span>}
    </div>
    {props.children}
  </section>
}

/**
 * Render explicit phase membership and prerequisites independently of the parent-child tree.
 * @param props - Visible phases and tasks, localized copy and selection/edit callbacks.
 * @returns Initially expanded phase and dependency navigation.
 */
export function TaskStages(props: {
  phases: readonly { id: string; title: string; progressLabel?: string }[]
  tasks: readonly { id: string; phaseId: string; goal: string; dependsOn: readonly string[]; hasUndisclosedPrerequisite?: boolean }[]
  selected: string | null
  labels: {
    dependencies: string
    parallel: string
    phase: string
    prerequisites: string
    none: string
    hiddenPrerequisite?: string
  }
  onSelect: (id: string) => void
  onPhaseTitleChange?: (id: string, title: string) => void
  disabled?: boolean
}) {
  return <details className={css.stages} open><summary>{props.labels.dependencies}</summary>
    <p className={css.hint}>{props.labels.parallel}</p>
    {props.phases.map(phase => <section className={css.stage} key={phase.id}>
      {props.onPhaseTitleChange ? <label>{props.labels.phase}<input value={phase.title} disabled={props.disabled}
        onChange={(event) => { props.onPhaseTitleChange?.(phase.id, event.target.value) }} /></label> : <h4>{phase.title}</h4>}
      {phase.progressLabel && <p className={css.hint}>{phase.progressLabel}</p>}
      <div className={css.branches}>{props.tasks.filter(task => task.phaseId === phase.id).map(task => <button type="button" key={task.id}
        className={css.branch} aria-pressed={props.selected === task.id} onClick={() => { props.onSelect(task.id) }}>
        <span>{task.goal}</span>
        <small>{props.labels.prerequisites}: {task.dependsOn.map(id => props.tasks.find(item => item.id === id)?.goal).filter(Boolean).join(' · ') || props.labels.none}</small>
        {task.hasUndisclosedPrerequisite && <small>{props.labels.hiddenPrerequisite}</small>}
      </button>)}</div>
    </section>)}
  </details>
}
