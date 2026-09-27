/** Zoomable task hierarchy with native scrolling, mouse panning and selectable cards. */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { Button, IconBranchOutlineRegular, IconPlusOutlineRegular, IconChevronUpOutlineRegular, IconChevronDownOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PlanDefinition, TaskId, TaskView } from '@deepseek-ai/dsh-personal-workflow/types'
import type { WorkflowProps } from './contract.ts'
import { layoutMindMap, mapGeometry, taskAncestors } from './mind-map-layout.ts'
import css from './TaskMindMap.module.css'

/** Render the hierarchy without changing plan approval or execution state.
 * @param props - Current draft, Host statuses and the existing task selection callback.
 * @returns Pan-and-zoom canvas with accessible task and collapse buttons.
 */
export function TaskMindMap({ definition, statuses, selected, onSelect, t, children }: {
  definition: PlanDefinition
  statuses: readonly TaskView[]
  selected: TaskId | null
  onSelect: (id: TaskId) => void
  t: WorkflowProps['t']
  children?: ReactNode
}) {
  const viewport = useRef<HTMLDivElement>(null)
  const drag = useRef<{ pointerId: number; x: number; y: number; left: number; top: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const [collapsed, setCollapsed] = useState<ReadonlySet<TaskId>>(new Set())
  const [manualZoom, setManualZoom] = useState<number | null>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const ancestors = useMemo(() => taskAncestors(definition.tasks, selected), [definition.tasks, selected])
  const visibleCollapsed = useMemo(() => new Set([...collapsed].filter(id => !ancestors.has(id))), [collapsed, ancestors])
  useEffect(() => {
    setCollapsed(previous => [...previous].some(id => ancestors.has(id))
      ? new Set([...previous].filter(id => !ancestors.has(id))) : previous)
  }, [ancestors])
  const layout = useMemo(() => layoutMindMap(definition.tasks, visibleCollapsed), [definition.tasks, visibleCollapsed])
  const byId = useMemo(() => new Map(statuses.map(status => [status.taskId, status])), [statuses])
  const phases = useMemo(() => new Map(definition.phases.map(phase => [phase.id, phase.title])), [definition.phases])
  const fitted = size.width > 0 && size.height > 0 ? Math.min(1, size.width / layout.width, size.height / layout.height) : 1
  const zoom = manualZoom ?? fitted
  const current = layout.nodes.find(node => node.task.id === selected)
  useLayoutEffect(() => {
    const element = viewport.current
    if (!element) return
    const measure = () => { setSize({ width: element.clientWidth, height: element.clientHeight }) }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => { observer.disconnect() }
  }, [])
  const center = () => {
    const element = viewport.current
    if (!element || !current) return
    const insetX = Math.max(0, (element.scrollWidth - layout.width * zoom) / 2)
    const insetY = Math.max(0, (element.scrollHeight - layout.height * zoom) / 2)
    element.scrollLeft = insetX + (current.x + mapGeometry.nodeWidth / 2) * zoom - element.clientWidth / 2
    element.scrollTop = insetY + (current.y + mapGeometry.nodeHeight / 2) * zoom - element.clientHeight / 2
  }
  useEffect(() => { center() }, [selected, zoom, current?.x, current?.y])
  const changeZoom = (delta: number) => { setManualZoom(Math.min(1.5, Math.max(0.25, Math.round((zoom + delta) * 100) / 100))) }
  const toggle = (id: TaskId) => {
    if (!visibleCollapsed.has(id)) onSelect(id)
    setCollapsed((previous) => {
      const next = new Set(previous)
      if (visibleCollapsed.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  return <section className={css.map} aria-label={t('mindMap')}>
    <header className={css.toolbar}>
      <div className={css.heading}><IconBranchOutlineRegular /><h3>{t('mindMap')}</h3><span>{t('mapCount', { count: definition.tasks.length })}</span></div>
      <div className={css.controls} role="group" aria-label={t('mapControls')}>
        <Button size="sm" aria-label={t('zoomOut')} title={t('zoomOut')} disabled={zoom <= 0.25} onClick={() => { changeZoom(-0.1) }}><span aria-hidden="true">−</span></Button>
        <button type="button" className={css.zoom} title={t('actualSize')} aria-label={t('zoomLevel', { percent: Math.round(zoom * 100) })} onClick={() => { setManualZoom(1) }}>{Math.round(zoom * 100)}%</button>
        <Button size="sm" aria-label={t('zoomIn')} title={t('zoomIn')} icon={<IconPlusOutlineRegular />} disabled={zoom >= 1.5} onClick={() => { changeZoom(0.1) }} />
        <span className={css.separator} aria-hidden="true" />
        <Button size="sm" onClick={() => { setManualZoom(null); if (viewport.current) { viewport.current.scrollLeft = 0; viewport.current.scrollTop = 0 } }}>{t('fitMap')}</Button>
        <Button size="sm" disabled={!current} onClick={center}>{t('locateTask')}</Button>
      </div>
    </header>
    {layout.invalidHierarchy && <p className={css.warning} role="status">{t('invalidHierarchy')}</p>}
    <div className={css.canvas}>
      <div ref={viewport} className={css.viewport} data-dragging={dragging} tabIndex={0} role="region" aria-label={t('mapHint')}
        onPointerDown={(event) => {
          if (event.pointerType !== 'mouse' || event.button !== 0 || (event.target instanceof Element && event.target.closest('button'))) return
          drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY,
            left: event.currentTarget.scrollLeft, top: event.currentTarget.scrollTop }
          event.currentTarget.setPointerCapture(event.pointerId)
          event.currentTarget.focus({ preventScroll: true })
          setDragging(true)
        }}
        onPointerMove={(event) => {
          const start = drag.current
          if (!start || start.pointerId !== event.pointerId) return
          event.currentTarget.scrollLeft = start.left - (event.clientX - start.x)
          event.currentTarget.scrollTop = start.top - (event.clientY - start.y)
        }}
        onPointerUp={(event) => {
          if (drag.current?.pointerId !== event.pointerId) return
          event.currentTarget.releasePointerCapture(event.pointerId)
          drag.current = null; setDragging(false)
        }}
        onLostPointerCapture={() => { drag.current = null; setDragging(false) }}
        onPointerCancel={() => { drag.current = null; setDragging(false) }}>
        <div className={css.surface} style={{ '--map-width': `${layout.width}px`, '--map-height': `${layout.height}px`, '--zoom': zoom,
          '--scaled-width': `${layout.width * zoom}px`, '--scaled-height': `${layout.height * zoom}px`,
          '--node-width': `${mapGeometry.nodeWidth}px`, '--node-height': `${mapGeometry.nodeHeight}px` } as CSSProperties}>
          <div className={css.world}>
            <svg className={css.connections} viewBox={`0 0 ${layout.width} ${layout.height}`} aria-hidden="true">
              {layout.edges.map(edge => <path key={edge.child} d={edge.path} data-branch={edge.branch}
                data-active={edge.child === selected || ancestors.has(edge.child)} />)}
            </svg>
            {layout.nodes.map((node) => {
              const state = byId.get(node.task.id)?.status ?? 'pending_review'
              const folded = visibleCollapsed.has(node.task.id)
              return <div key={node.task.id} className={css.node} data-root={node.task.id === definition.taskId}
                data-branch={node.branch} data-selected={selected === node.task.id}
                style={{ '--node-x': `${node.x}px`, '--node-y': `${node.y}px` } as CSSProperties}>
                <button type="button" className={css.nodeButton} aria-pressed={selected === node.task.id} title={node.task.goal} onClick={() => { onSelect(node.task.id) }}>
                  <span className={css.nodeStage}>{node.task.id === definition.taskId ? t('rootTask') : phases.get(node.task.phaseId)}</span>
                  <strong className={css.goal}>{node.task.goal}</strong>
                  <span className={css.nodeFooter}><span className={css.status} data-status={state}>{t(state)}</span><span>{node.task.required ? t('requiredNode') : t('optionalNode')}</span></span>
                </button>
                {node.children.length > 0 && <button type="button" className={css.fold} aria-expanded={!folded} aria-label={t(folded ? 'expandBranch' : 'collapseBranch', { goal: node.task.goal })} title={t(folded ? 'expandBranch' : 'collapseBranch', { goal: node.task.goal })} onClick={() => { toggle(node.task.id) }}>
                  {folded ? <IconChevronDownOutlineRegular size={12} /> : <IconChevronUpOutlineRegular size={12} />}
                  <span>{node.children.length}</span>
                </button>}
              </div>
            })}
          </div>
        </div>
      </div>
      {children && <div className={css.overlay}>{children}</div>}
    </div>
    <footer className={css.footer}><span>{t('mapHint')}</span><span>{t('hierarchyHint')}</span>
      <Button size="sm" disabled={visibleCollapsed.size === 0} onClick={() => { setCollapsed(new Set()) }}>{t('expandAll')}</Button>
    </footer>
  </section>
}
