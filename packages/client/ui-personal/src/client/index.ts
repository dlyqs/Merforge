/** Client registration and Remote adapter for personal navigation. */
import type { Context } from '@deepseek-ai/cordis'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { PersonalSidebarEntry, PersonalSettings } from './PersonalSettings.tsx'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-personal-project/types'
import type { PersonalActions, PersonalInjected, PersonalRecordsState } from './contract.ts'
import { PersonalSidebar } from './PersonalSidebar.tsx'
import { en, zh } from './locales.ts'

/** Required services for records, Session identity, navigation, and copy. */
export const inject = ['slots', 'sessions', 'workspaces', 'uiWorkspace', 'remote', 'remote.session', 'locale', 'settingsNavigation']

/** Unwrap a generated business result while preserving its error message. */
function valueOf<T>(result: RemoteResult<T>): T {
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

/** Register the personal sidebar and bind its mutations to Host authority.
 * @param ctx - Client root context.
 */
export function apply(ctx: Context): void {
  const modelCatalogRevision = createSnapshotStore(0)
  ctx.remote.$on('api-session/model-catalog-changed', (revision) => { modelCatalogRevision.set(revision) })
  const records = createSnapshotStore<PersonalRecordsState>({ phase: 'loading', projects: [], bots: [] })
  const refresh: PersonalActions['refresh'] = async () => {
    try {
      const value = valueOf(await ctx.remote.session.personalList())
      records.set({ phase: 'ready', projects: value.projects, bots: value.bots })
    } catch (error: unknown) {
      records.set({ ...records.getSnapshot(), phase: 'error', error: String(error) })
    }
  }
  const mutate = async (operation: () => Promise<unknown>): Promise<void> => {
    await operation()
    await refresh()
  }
  const loadModels: NonNullable<PersonalActions['loadModels']> = async () => {
    const revision = modelCatalogRevision.getSnapshot()
    const value = valueOf(await ctx.remote.session.modelCatalog())
    return revision === modelCatalogRevision.getSnapshot() ? value : loadModels()
  }
  const actions: PersonalActions = {
    refresh,
    loadModels,
    openCodexSettings: () => { ctx.settingsNavigation.open('models', 'codex') },
    createProject: input => mutate(async () => { valueOf(await ctx.remote.session.personalCreateProject(input)) }),
    updateProject: input => mutate(async () => { valueOf(await ctx.remote.session.personalUpdateProject(input)) }),
    pickDirectory: () => ctx.uiWorkspace.pickDirectory(),
    deleteProject: id => mutate(async () => {
      valueOf(await ctx.remote.session.personalDeleteProject(id))
      await ctx.sessions.refresh()
    }),
    createBot: input => mutate(async () => { valueOf(await ctx.remote.session.personalCreateBot(input)) }),
    updateBot: input => mutate(async () => { valueOf(await ctx.remote.session.personalUpdateBot(input)) }),
    deleteBot: id => mutate(async () => {
      valueOf(await ctx.remote.session.personalDeleteBot(id))
      await ctx.sessions.refresh()
    }),
    createSession: async (input) => {
      const sessionId = await ctx.sessions.create(input)
      await ctx.sessions.refreshProjections(sessionId)
      ctx.uiWorkspace.openSession(sessionId)
      return sessionId
    },
    deleteSession: async (sessionId) => {
      valueOf(await ctx.remote.session.delete(sessionId))
      await ctx.sessions.refresh()
    },
    moveSession: async (input) => {
      valueOf(await ctx.remote.session.personalMove(input))
      await ctx.sessions.refresh()
    },
    refreshAffiliation: sessionId => ctx.sessions.refreshProjections(sessionId),
    openSession: (sessionId) => { ctx.uiWorkspace.openSession(sessionId) },
    unarchiveSession: sessionId => ctx.uiWorkspace.unarchiveSession(sessionId),
  }
  ctx.effect(() => ctx.locale.register('personal', { zh, en }), 'ui-personal: dictionaries')
  ctx.effect(() => ctx.on('connection/reset', () => {
    if (records.getSnapshot().phase !== 'loading') void refresh()
  }), 'ui-personal: reconnect records')
  ctx.slots.registerFactory({
    name: 'personal.manager', scope: 'root', locale: 'personal',
    children: { 'personal.manager.workflow': { kind: 'single', scope: 'root' } },
    inject: (): PersonalInjected => ({
      ...actions, hooks: { records, modelCatalogRevision, settingsNavigation: ctx.settingsNavigation.view },
    }),
  }, PersonalSidebar)
  ctx.slots.inject('sidebar.personal', () => ctx.slots.register({ name: 'sidebar.personal' }, PersonalSidebarEntry))
  const t = ctx.locale.bind('personal')
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'personal', order: 25, locale: 'personal', label: () => t('settingsTitle'),
    children: { 'settings.personal.testing': { kind: 'single', scope: 'root' } },
  }, PersonalSettings))
}

export type { PersonalSidebarProps } from './contract.ts'
