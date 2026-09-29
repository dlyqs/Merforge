/** Desktop organization settings and a personal/organization navigation switch. */
import type { Context } from '@deepseek-ai/cordis'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-personal/client'
import type { OrganizationDesktopBridge, OrganizationDesktopSnapshot } from '@deepseek-ai/dsh-organization-connection/types'
import type { OrganizationInjected } from './contract.ts'
import { OrganizationSettings, OrganizationSidebar } from './Organization.tsx'
import { AccountMenu } from './AccountMenu.tsx'
import { zh, en } from './locales.ts'

/** Required UI services; the Desktop preload owns the native IPC capability. */
export const inject = ['slots', 'locale']
/**
 * Register safe native snapshots with framework-created hooks and managed subscriptions.
 * @param ctx - Client plugin context.
 */
export function apply(ctx: Context): void {
  const desktop = (globalThis as typeof globalThis & { dshDesktop?: { organization?: OrganizationDesktopBridge } }).dshDesktop?.organization
  const state = createSnapshotStore<OrganizationDesktopSnapshot>({ connection: { revision: 0, generation: 0,
    phase: 'disconnected',
    mode: 'personal',
    organizations: [],
    members: [] },
  server: { phase: 'disabled',
    settings: { host: '0.0.0.0',
      port: 19487,
      names: ['localhost', '127.0.0.1'],
      restoreOnLaunch: false } } })
  const unavailable = (): never => { throw new Error('desktop-required') }
  const bind = (): OrganizationInjected => ({ available: !!desktop,
    connection: action => desktop ? desktop.connection(action) : unavailable(),
    server: action => desktop ? desktop.server(action) : unavailable(),
    secret: () => desktop ? desktop.secret() : unavailable(),
    context: request => desktop ? desktop.context(request) : unavailable(),
    executionReport: request => desktop ? desktop.executionReport(request) : unavailable(),
    execution: request => desktop ? desktop.execution(request) : unavailable(),
    hooks: { organization: state } })
  ctx.effect(() => ctx.locale.register('organization', { zh, en }), 'organization.locale')
  ctx.effect(() => {
    if (!desktop) return () => {}
    let alive = true
    let observed = false
    const unsubscribe = desktop.subscribe((snapshot) => { observed = true; if (alive) state.set(snapshot) })
    void desktop.snapshot().then((snapshot) => { if (alive && !observed) state.set(snapshot) }).catch(() => {})
    return () => { alive = false; unsubscribe() }
  }, 'organization.native-state')
  const t = ctx.locale.bind('organization')
  ctx.slots.inject('settings.section', () => ctx.slots.register({ name: 'settings.section',
    id: 'organization',
    order: 27,
    label: () => t('settings'),
    locale: 'organization',
    inject: bind }, OrganizationSettings))
  ctx.slots.inject('sidebar.account', () => ctx.slots.register({ name: 'sidebar.account',
    locale: 'organization', inject: bind }, AccountMenu))
  ctx.slots.inject('sidebar.personal', () => ctx.slots.register({ name: 'sidebar.personal',
    priority: -10,
    locale: 'organization',
    inject: bind }, OrganizationSidebar))
}
