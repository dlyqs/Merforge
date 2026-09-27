/** Persistent secondary-browser control in the main workspace. */
import { IconPanelLeftOutlineRegular, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './SidebarToggle.module.css'

/** @param props - Live fold state and badge renderer. @returns Fixed-size navigation control. */
export function SidebarToggle({ collapsed, toggleSidebar, renderSlot, t }: PropsRuntime<'shell.navigation'> & PropsRenderSlots<'shell.navigation.badge'> & PropsLocale<'sidebar'>) {
  const label = t(collapsed ? 'toggle.open' : 'toggle.collapse')
  return <Tooltip label={label}><button type="button" className={css.button} aria-label={label} aria-expanded={!collapsed} onClick={toggleSidebar}>
    <IconPanelLeftOutlineRegular />{renderSlot('shell.navigation.badge', {})}
  </button></Tooltip>
}
