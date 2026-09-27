/** Persistent primary rail and the selected secondary navigation browser. */
import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import {
  IconPlusOutlineRegular, IconBranchOutlineRegular,
  IconFolderCloseRegular, IconAgentPresetOutlineRegular, IconClockOutlineRegular,
  Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { SidebarRootComponentProps } from './contract/slots.ts'
import css from './SidebarRoot.module.css'

const SCROLLBAR_LINGER_MS = 2000

/**
 * Keep primary navigation visible while the secondary browser folds.
 * @param props - Layout geometry, panel metadata and authorized slot renderers.
 * @returns Primary rail and secondary browser.
 */
export function SidebarRoot({
  collapsed, width, startSession, toggleSidebar, selectPanel, usePanels, usePanelInfo, t, renderSlot,
}: SidebarRootComponentProps) {
  const panels = usePanels(snapshot => snapshot)
  const activePanel = usePanelInfo(info => info.activePanelId)
  const [section, setSection] = useState<'projects' | 'bots' | 'recent'>('projects')
  const tasks = panels.find(panel => panel.id === 'tasks')
  const showingTasks = tasks !== undefined && activePanel === tasks.id
  const activeSection = showingTasks ? 'tasks' : section
  const expandSidebar = (): void => { if (collapsed) toggleSidebar() }
  const column = useRef<HTMLDivElement>(null)
  const [pointerInside, setPointerInside] = useState(false)
  const lingerTimer = useRef<number | undefined>(undefined)
  const armLinger = (): void => {
    if (lingerTimer.current !== undefined) return
    lingerTimer.current = window.setTimeout(() => {
      lingerTimer.current = undefined
      setPointerInside(false)
    }, SCROLLBAR_LINGER_MS)
  }
  const cancelLinger = (): void => {
    window.clearTimeout(lingerTimer.current)
    lingerTimer.current = undefined
  }
  // Leaving is decided by the column's BOX, not by DOM containment, and only
  // while the bars are drawn. ui-settings renders its full-viewport panel as a
  // fixed-position DESCENDANT of this column, so a pointer moved onto that
  // panel — or onto the conversation once it closes — fires no `pointerleave`
  // here, and the bars would stay drawn over a column nobody is pointing at.
  // The element's own leave stays as the one signal geometry cannot give: a
  // pointer that leaves the window emits no further moves.
  useEffect(() => {
    if (!pointerInside) return
    const onMove = (event: PointerEvent): void => {
      const rect = column.current?.getBoundingClientRect()
      /* v8 ignore next -- the listener only exists while the column is mounted and revealed. */
      if (rect === undefined) return
      const inside = event.clientX >= rect.left && event.clientX < rect.right
        && event.clientY >= rect.top && event.clientY < rect.bottom
      if (inside) cancelLinger()
      else armLinger()
    }
    document.addEventListener('pointermove', onMove)
    return () => {
      document.removeEventListener('pointermove', onMove)
      cancelLinger()
    }
  }, [pointerInside])

  return <div ref={column} className={clsx(css.root, !pointerInside && css.quietBars)} style={{ width }}
    onPointerEnter={() => { cancelLinger(); setPointerInside(true) }} onPointerLeave={armLinger}>
    <aside className={css.rail}>
      {renderSlot('sidebar.account', {})}
      <Tooltip label={t('session.new.label')} side="right">
        <button type="button" className={css.createButton} aria-label={t('session.new.label')}
          onClick={() => { setSection('recent'); startSession() }}><IconPlusOutlineRegular size={22} /></button>
      </Tooltip>
      <nav className={css.panelList} aria-label={t('panels.label')}>
        {tasks !== undefined && <button type="button" className={css.navButton} aria-current={showingTasks ? 'page' : undefined}
          onClick={() => { selectPanel(tasks.id); expandSidebar() }}><IconBranchOutlineRegular size={21} /><span>{t('nav.tasks')}</span></button>}
        {([
          ['projects', IconFolderCloseRegular], ['bots', IconAgentPresetOutlineRegular], ['recent', IconClockOutlineRegular],
        ] as const).map(([id, Icon]) => <button key={id} type="button" className={css.navButton}
          aria-current={activePanel === null && section === id ? 'page' : undefined}
          onClick={() => { setSection(id); selectPanel(null); expandSidebar() }}><Icon size={21} /><span>{t(`nav.${id}`)}</span></button>)}
        {panels.filter(panel => panel.id !== 'tasks').map(panel => <Tooltip key={panel.id} label={panel.label} side="right">
          <button type="button" className={css.navButton} aria-label={panel.label} aria-current={activePanel === panel.id ? 'page' : undefined}
            onClick={() => { selectPanel(panel.id) }}>
            {renderSlot('sidebar.panellist', { size: 21, active: activePanel === panel.id }, { only: panel.id })}
            <span>{panel.label}</span>
          </button>
        </Tooltip>)}
      </nav>
      <div className={css.footArea}>
        {renderSlot('sidebar.footer.action', { wide: false })}
        <div className={css.settingsArea}>{renderSlot('sidebar.settings', { wide: false })}</div>
      </div>
    </aside>
    {!collapsed && <section className={css.secondary} aria-label={t(`nav.${activeSection}`)}>
      <div className={css.regionArea}>
        {showingTasks ? renderSlot('sidebar.tasks', {}) : renderSlot('sidebar.personal', { wide: true, section, expandSidebar })}
      </div>
    </section>}

  </div>
}
