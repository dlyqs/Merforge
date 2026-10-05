/** Shared personal management entries for sidebar and settings. */
import type { PropsRuntime, PropsRenderFactories, PropsRenderSlots, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from './contract.ts'
import { accountNavigationStyles as css } from '@deepseek-ai/dsh-client-ui-primitives'

/** Mount the shared manager using the sidebar's geometry.
 * @param props - Sidebar owner and framework factory renderer.
 * @returns Personal navigation.
 */
export function PersonalSidebarEntry(props: PropsRuntime<'sidebar.personal'> & PropsRenderFactories) {
  return props.renderFactorySlot('personal.manager', { wide: props.wide, expandSidebar: props.expandSidebar,
    ...(props.section === undefined ? {} : { section: props.section }),
    ...(props.navigationRevision === undefined ? {} : {
      navigationRevision: props.navigationRevision, onNavigationHandled: props.onNavigationHandled,
    }) })
}

/** Expose persistent personal records and temporary workflow testing controls.
 * @param props - Settings shell, locale and authorized child renderers.
 * @returns Personal management settings.
 */
export function PersonalSettings(props: PropsRuntime<'settings.section'> & PropsRenderFactories & PropsRenderSlots<'settings.personal.testing'> & PropsLocale<'personal'>) {
  return <section className={css.settings}>
    <h2>{props.t('settingsTitle')}</h2>
    <p>{props.t('settingsDescription')}</p>
    {props.renderSlot('settings.personal.testing', {})}
    {props.renderFactorySlot('personal.manager', { wide: true, expandSidebar: () => {}, management: true, onNavigate: props.close })}
  </section>
}
