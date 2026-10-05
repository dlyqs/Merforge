/** Zoomable task hierarchy with native scrolling, mouse panning and selectable cards. */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { Button } from './Button.tsx'
import { IconBranchOutlineRegular, IconPlusOutlineRegular, IconChevronUpOutlineRegular, IconChevronDownOutlineRegular, IconFullscreenOutlineRegular } from './icons/index.tsx'
type TaskId = string

/** Account-independent task card fields; labels are supplied by the owning locale. */
export interface TaskMapNode {
  id: string
  parentTaskId: string | null
  goal: string
  phaseTitle: string
  required: boolean
  status: string
  statusLabel: string
  /** Optional localized badge for the viewer's assigned node. */
  assignmentLabel?: string
}

/** Localized canvas controls and task-card text. */
export interface TaskMapLabels {
  mindMap: string
  mapCount: string
  mapControls: string
  zoomOut: string
  actualSize: string
  zoomLevel: string
  zoomIn: string
  fitMap: string
  locateTask: string
  invalidHierarchy: string
  mapHint: string
  rootTask: string
  requiredNode: string
  optionalNode: string
  hierarchyHint: string
  expandAll: string
  expandBranch: string
  collapseBranch: string
  fullscreen: string
  exitFullscreen: string
}
import { layoutMindMap, mapGeometry, taskAncestors } from './task-map-layout.ts'
import css from './TaskMap.module.css'

/** Render the hierarchy without changing plan approval or execution state.
 * @param props - Current draft, Host statuses and the existing task selection callback.
 * @returns Pan-and-zoom canvas with accessible task and collapse buttons.
 */
export function TaskMap({ tasks, rootId, selected, onSelect, labels, children, introduction }: {
  tasks: readonly TaskMapNode[]
  rootId: string
  selected: TaskId | null
  onSelect: (id: TaskId) => void
  labels: TaskMapLabels
  children?: ReactNode
  introduction?: ReactNode
}) {
  const viewport = useRef<HTMLDivElement>(null)
  const fullscreenButton = useRef<HTMLButtonElement>(null)
  const [fullscreen, setFullscreen] = useState(false)
  const zoomAnchor = useRef<{ x: number; y: number; clientX: number; clientY: number }>()
  const drag = useRef<{ pointerId: number; x: number; y: number; left: number; top: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const [collapsed, setCollapsed] = useState<ReadonlySet<TaskId>>(new Set())
  const [manualZoom, setManualZoom] = useState<number | null>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const ancestors = useMemo(() => taskAncestors(tasks, selected), [tasks, selected])
  const visibleCollapsed = useMemo(() => new Set([...collapsed].filter(id => !ancestors.has(id))), [collapsed, ancestors])
  useEffect(() => {
    setCollapsed(previous => [...previous].some(id => ancestors.has(id))
      ? new Set([...previous].filter(id => !ancestors.has(id))) : previous)
  }, [ancestors])
  const layout = useMemo(() => layoutMindMap(tasks, visibleCollapsed), [tasks, visibleCollapsed])
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
  useEffect(() => { center() }, [selected, current?.x, current?.y])
  const setZoomAt = (next: number, clientX: number, clientY: number) => {
    const element = viewport.current
    if (!element) return
    const insetX = Math.max(0, (element.clientWidth - layout.width * zoom) / 2)
    const insetY = Math.max(0, (element.clientHeight - layout.height * zoom) / 2)
    zoomAnchor.current = { x: (element.scrollLeft + clientX - insetX) / zoom,
      y: (element.scrollTop + clientY - insetY) / zoom, clientX, clientY }
    setManualZoom(Math.min(1.5, Math.max(Math.min(0.25, fitted), next)))
  }
  useLayoutEffect(() => {
    const element = viewport.current, anchor = zoomAnchor.current
    if (!element || !anchor) return
    element.scrollLeft = anchor.x * zoom + Math.max(0, (element.clientWidth - layout.width * zoom) / 2) - anchor.clientX
    element.scrollTop = anchor.y * zoom + Math.max(0, (element.clientHeight - layout.height * zoom) / 2) - anchor.clientY
    zoomAnchor.current = undefined
  }, [zoom, layout.width, layout.height])
  useEffect(() => {
    const element = viewport.current
    if (!element) return
    const wheel = (event: WheelEvent) => {
      event.preventDefault()
      const rect = element.getBoundingClientRect()
      const delta = (event.deltaY || event.deltaX) * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1)
      setZoomAt(zoom * Math.exp(-delta * 0.0015), event.clientX - rect.left, event.clientY - rect.top)
    }
    element.addEventListener('wheel', wheel, { passive: false })
    return () => { element.removeEventListener('wheel', wheel) }
  }, [zoom, fitted, layout.width, layout.height])
  useEffect(() => {
    if (!fullscreen) return
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setFullscreen(false); fullscreenButton.current?.focus() }
    }
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('keydown', escape) }
  }, [fullscreen])
  const changeZoom = (delta: number) => { setZoomAt(Math.round((zoom + delta) * 100) / 100,
    (viewport.current?.clientWidth ?? 0) / 2, (viewport.current?.clientHeight ?? 0) / 2) }
  const toggle = (id: TaskId) => {
    if (!visibleCollapsed.has(id)) onSelect(id)
    setCollapsed((previous) => {
      const next = new Set(previous)
      if (visibleCollapsed.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  return <section className={css.map} data-fullscreen={fullscreen} aria-label={labels.mindMap}>
    <header className={css.toolbar}>
      <div className={css.heading}><IconBranchOutlineRegular /><h3>{labels.mindMap}</h3><span>{labels.mapCount}</span></div>
      <div className={css.controls} role="group" aria-label={labels.mapControls}>
        <Button size="sm" aria-label={labels.zoomOut} title={labels.zoomOut} disabled={zoom <= 0.25} onClick={() => { changeZoom(-0.1) }}><span aria-hidden="true">−</span></Button>
        <button type="button" className={css.zoom} title={labels.actualSize} aria-label={labels.zoomLevel.replace('{percent}', String(Math.round(zoom * 100)))} onClick={() => { setManualZoom(1) }}>{Math.round(zoom * 100)}%</button>
        <Button size="sm" aria-label={labels.zoomIn} title={labels.zoomIn} icon={<IconPlusOutlineRegular />} disabled={zoom >= 1.5} onClick={() => { changeZoom(0.1) }} />
        <span className={css.separator} aria-hidden="true" />
        <Button size="sm" onClick={() => { setManualZoom(null); if (viewport.current) { viewport.current.scrollLeft = 0; viewport.current.scrollTop = 0 } }}>{labels.fitMap}</Button>
        <Button size="sm" disabled={!current} onClick={center}>{labels.locateTask}</Button>
        <button ref={fullscreenButton} type="button" className={css.fullscreen} aria-label={fullscreen ? labels.exitFullscreen : labels.fullscreen}
          title={fullscreen ? labels.exitFullscreen : labels.fullscreen} aria-pressed={fullscreen}
          onClick={() => { setFullscreen(value => !value) }}><IconFullscreenOutlineRegular /></button>
      </div>
    </header>
    {introduction}
    {layout.invalidHierarchy && <p className={css.warning} role="status">{labels.invalidHierarchy}</p>}
    <div className={css.canvas}>
      <div ref={viewport} className={css.viewport} data-dragging={dragging} tabIndex={0} role="region" aria-label={labels.mapHint}
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
              const state = node.task.status
              const folded = visibleCollapsed.has(node.task.id)
              return <div key={node.task.id} className={css.node} data-root={node.task.id === rootId}
                data-branch={node.branch} data-selected={selected === node.task.id} data-assigned={!!node.task.assignmentLabel}
                style={{ '--node-x': `${node.x}px`, '--node-y': `${node.y}px` } as CSSProperties}>
                <button type="button" className={css.nodeButton} aria-pressed={selected === node.task.id} aria-label={node.task.goal} title={node.task.goal} onClick={() => { onSelect(node.task.id) }}>
                  <span className={css.nodeStage}>{node.task.id === rootId ? labels.rootTask : node.task.phaseTitle}</span>
                  <strong className={css.goal}>{node.task.goal}</strong>
                  <span className={css.nodeFooter}>
                    {node.task.assignmentLabel && <span className={css.assignment}>{node.task.assignmentLabel}</span>}
                    {node.task.statusLabel && <span className={css.status} data-status={state}>{node.task.statusLabel}</span>}
                    <span>{node.task.required ? labels.requiredNode : labels.optionalNode}</span>
                  </span>
                </button>
                {node.children.length > 0 && <button type="button" className={css.fold} aria-expanded={!folded} aria-label={(folded ? labels.expandBranch : labels.collapseBranch).replace('{goal}', node.task.goal)} title={(folded ? labels.expandBranch : labels.collapseBranch).replace('{goal}', node.task.goal)} onClick={() => { toggle(node.task.id) }}>
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
    <footer className={css.footer}><span>{labels.mapHint}</span><span>{labels.hierarchyHint}</span>
      <Button size="sm" disabled={visibleCollapsed.size === 0} onClick={() => { setCollapsed(new Set()) }}>{labels.expandAll}</Button>
    </footer>
  </section>
}
