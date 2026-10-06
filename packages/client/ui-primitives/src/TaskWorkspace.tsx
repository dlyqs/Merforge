/** Shared task details and phase navigation with caller-owned data and localized labels. */
import { useEffect, useId, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Button } from './Button.tsx'
import { SegmentedTabs } from './SegmentedTabs.tsx'
import { IconCloseOutlineRegular, IconEditOutlineRegular } from './icons/index.tsx'
import css from './TaskWorkspace.module.css'

/**
 * Keep task identity and optional section navigation above the detail body.
 * Sections remain mounted when hidden so switching views preserves unfinished forms.
 * @param props - Selected task, localized chrome, optional sections and account-owned controls.
 * @returns Task detail surface.
 */
export function TaskDetail(props: {
  taskId: string
  /** Flow details grow with content in the outer workspace. */
  layout?: 'overlay' | 'flow'
  title: string
  status?: { value: string; label: string }
  metadata?: string
  edit?: { label: string; disabled?: boolean; onClick: () => void } | undefined
  labels: { taskDetail: string; hideDetails: string }
  onClose: () => void
  children?: ReactNode
  sections?: readonly [
    { id: string; label: string; content: ReactNode; hidden?: boolean },
    ...{ id: string; label: string; content: ReactNode; hidden?: boolean }[],
  ]
}) {
  const detail = useRef<HTMLDivElement>(null), id = useId()
  const [selection, setSelection] = useState<{ taskId: string; section: string }>()
  const visibleSections = props.sections?.filter(item => !item.hidden)
  const section = selection?.taskId === props.taskId && visibleSections?.some(item => item.id === selection.section)
    ? selection.section : visibleSections?.[0]?.id
  useEffect(() => { if (detail.current) detail.current.scrollTop = 0 }, [props.taskId, section])
  return <section className={css.detail} data-layout={props.layout} aria-label={props.labels.taskDetail}>
    <header className={css.detailHeader}><div className={css.detailToolbar}><span className={css.eyebrow}>{props.labels.taskDetail}</span>
      <Button size="sm" icon={<IconCloseOutlineRegular />} aria-label={props.labels.hideDetails} onClick={props.onClose} />
    </div>
    <div className={css.detailHeading}><div className={css.titleRow}><h3>{props.title}</h3>
      {props.edit && <Button size="sm" icon={<IconEditOutlineRegular />} aria-label={props.edit.label} title={props.edit.label} disabled={props.edit.disabled} onClick={props.edit.onClick} />}
    </div>
    {props.status && <span className={css.status} data-status={props.status.value}>{props.status.label}</span>}
    {props.metadata && <p className={css.hint}>{props.metadata}</p>}
    </div>
    {visibleSections && section && <SegmentedTabs className={css.detailTabs} label={props.labels.taskDetail} value={section}
      items={visibleSections.map(item => ({ value: item.id, label: item.label, id: `${id}-${item.id}-tab`, panelId: `${id}-${item.id}-panel` })) as [
        { value: string; label: string; id: string; panelId: string }, ...{ value: string; label: string; id: string; panelId: string }[],
      ]}
      onChange={(value) => { setSelection({ taskId: props.taskId, section: value }) }} />}
    </header>
    <div ref={detail} className={css.detailContent}>
      {props.children}
      {props.sections?.map(item => <div key={item.id} id={`${id}-${item.id}-panel`} role="tabpanel"
        aria-labelledby={`${id}-${item.id}-tab`} tabIndex={0} hidden={item.hidden || section !== item.id}>{item.content}</div>)}
    </div>
  </section>
}

/**
 * Render explicit phase membership and prerequisites independently of the parent-child tree.
 * @param props - Visible phases and tasks, localized copy and selection/edit callbacks.
 * @returns Initially expanded phase and dependency navigation.
 */
export function TaskStages(props: {
  phases: readonly { id: string; title: string; progressLabel?: string; status?: string; statusLabel?: string }[]
  tasks: readonly {
    id: string
    phaseId: string
    goal: string
    dependsOn: readonly string[]
    status?: string
    statusLabel?: string
    hasUndisclosedPrerequisite?: boolean
  }[]
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
    {props.phases.map(phase => <section className={css.stage} key={phase.id} data-status={phase.status}>
      {props.onPhaseTitleChange ? <label>{props.labels.phase}<input value={phase.title} disabled={props.disabled}
        onChange={(event) => { props.onPhaseTitleChange?.(phase.id, event.target.value) }} /></label> : <h4>{phase.title}</h4>}
      {phase.statusLabel && <span className={css.status} data-status={phase.status}>{phase.statusLabel}</span>}
      {phase.progressLabel && <p className={css.hint}>{phase.progressLabel}</p>}
      <div className={css.branches}>{props.tasks.filter(task => task.phaseId === phase.id).map(task => <button type="button" key={task.id}
        className={css.branch} aria-pressed={props.selected === task.id} onClick={() => { props.onSelect(task.id) }}>
        <span className={css.branchHeading}>{task.goal}
          {task.statusLabel && <span className={css.status} data-status={task.status}>{task.statusLabel}</span>}
        </span>
        <small>{props.labels.prerequisites}: {task.dependsOn.map(id => props.tasks.find(item => item.id === id)?.goal).filter(Boolean).join(' · ') || props.labels.none}</small>
        {task.hasUndisclosedPrerequisite && <small>{props.labels.hiddenPrerequisite}</small>}
      </button>)}</div>
    </section>)}
  </details>
}
