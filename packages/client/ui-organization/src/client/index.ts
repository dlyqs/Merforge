/** Desktop organization settings and a personal/organization navigation switch. */
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import type { BoundActions } from '@deepseek-ai/dsh-client-store'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { ConversationRequest } from '@deepseek-ai/dsh-organization-conversation/protocol'
import { createOrganizationTaskStore } from './task-store.ts'
import { OrganizationTaskList, OrganizationTasks } from './Tasks.tsx'
import { createConversationStore } from './conversation-store.ts'
import { organizationPlanDefinition } from './conversation-node.ts'
import { OrganizationPlanNode } from './OrganizationPlanNode.tsx'
import { AccountSession } from './account-session.ts'
import type { SessionReference } from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ConversationSelection } from './conversation-store.ts'
import { NewConversation } from './NewConversation.tsx'
import { ConversationManager } from './ConversationManager.tsx'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
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
export const inject = ['slots', 'locale', 'remote', 'remote.session', 'settingsNavigation', 'layout', 'uiWorkspace',
  'sessions', 'uiSession', 'uiConversation']
/**
 * Register safe native snapshots with framework-created hooks and managed subscriptions.
 * @param ctx - Client plugin context.
 */
export function apply(ctx: Context): void {
  const desktop = (globalThis as typeof globalThis & { dshDesktop?: { organization?: OrganizationDesktopBridge } }).dshDesktop?.organization
  const modelCatalogRevision = createSnapshotStore(0)
  ctx.remote.$on('api-session/model-catalog-changed', (revision) => { modelCatalogRevision.set(revision) })
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
  const loadModels: NonNullable<OrganizationInjected['loadModels']> = async () => {
    const revision = modelCatalogRevision.getSnapshot()
    const result = await ctx.remote.session.modelCatalog()
    if (!result.ok) throw new Error(result.error.message)
    return revision === modelCatalogRevision.getSnapshot() ? result.value : loadModels()
  }
  const bind = (): OrganizationInjected => ({
    conversation: request => desktop ? desktop.conversation(request) : unavailable(),
    openProjectTasks: (project) => {
      const c = state.getSnapshot().connection
      if (c.mode !== 'organization' || c.organizationId !== project.organizationId || !c.principal) return
      taskActions?.selectProject({ ...c.principal, project }); ctx.layout.selectPanel('tasks' as MainPanelId)
    },
    manageConversation: (selected, action = 'manage') => { management.set({ selected, action }) },
    selectConversation: selectConversation,
    openConversation: () => { ctx.layout.selectPanel(null) }, available: !!desktop,
    loadModels,
    openCodexSettings: () => { ctx.settingsNavigation.open('models', 'codex') },
    connection: action => desktop ? desktop.connection(action) : unavailable(),
    server: action => desktop ? desktop.server(action) : unavailable(),
    secret: () => desktop ? desktop.secret() : unavailable(),
    context: request => desktop ? desktop.context(request) : unavailable(),
    executionReport: request => desktop ? desktop.executionReport(request) : unavailable(),
    execution: request => desktop ? desktop.execution(request) : unavailable(),
    hooks: { organization: state, modelCatalogRevision } })
  ctx.effect(() => ctx.locale.register('organization', { zh, en }), 'organization.locale')
  ctx.effect(() => {
    if (!desktop) return () => {}
    let alive = true
    let observed = false
    const unsubscribe = desktop.subscribe((snapshot) => { observed = true; if (alive) state.set(snapshot) })
    void desktop.snapshot().then((snapshot) => { if (alive && !observed) state.set(snapshot) }).catch(() => {})
    return () => { alive = false; unsubscribe() }
  }, 'organization.native-state')
  const conversationStore = createConversationStore()
  const taskStore = createOrganizationTaskStore()
  let conversationActions: BoundActions<typeof conversationStore> | undefined
  let taskActions: BoundActions<typeof taskStore> | undefined
  const accountReference = createSnapshotStore<SessionReference | undefined>(undefined)
  const creating = createSnapshotStore(false)
  const management = createSnapshotStore<{ selected: ConversationSelection; action: 'manage' | 'delete' } | null>(null)
  let accountSession: AccountSession | undefined, openSequence = 0
  let currentSelection: ConversationSelection | null = null
  const retire = () => {
    openSequence++
    const reference = accountReference.getSnapshot()
    accountReference.set(undefined); accountSession?.dispose(); accountSession = undefined; reference?.release()
  }
  const selectConversation = async (selected: ConversationSelection | null) => {
    const c = state.getSnapshot().connection
    if (selected && (c.mode !== 'organization' || c.principal?.serverId !== selected.serverId
      || c.principal.accountId !== selected.accountId || c.organizationId !== selected.organizationId)) throw new Error('organization-conversation: superseded')
    currentSelection = selected
    retire(); conversationActions?.select(selected); ctx.layout.selectPanel(null)
    const sequence = openSequence
    if (!selected || !desktop || c.phase !== 'ready' || !selected.conversationId || !selected.projectId) return
    const query = { organizationId: selected.organizationId, projectId: selected.projectId, conversationId: selected.conversationId,
      ...(selected.botId ? { botId: selected.botId } : {}),
      ...(selected.assignmentId && selected.planId ? { assignment: { assignmentId: selected.assignmentId,
        planId: selected.planId } } : {}) }
    const reply = await desktop.conversation({ ...query, kind: 'open', operationId: randomUUID() as ConversationRequest['operationId'] })
    if (sequence !== openSequence || state.getSnapshot().connection.generation !== reply.generation)
      throw new Error('organization-conversation: superseded')
    const projectId = selected.projectId
    accountSession = new AccountSession(reply, query, desktop, state, () => { conversationActions?.refresh() }, (report) => {
      const a = report.assignment, proposal = report.goals.at(-1)?.proposal
      const taskId = report.execution?.target.taskId ?? a?.taskId ?? proposal?.definition?.taskId,
        planId = report.execution?.target.planId ?? a?.planId ?? proposal?.planId
      if (taskId && planId) taskActions?.selectTask({ ...selected, projectId, planId, taskId,
        ...(a ? { assignmentId: a.id } : {}) })
      ctx.layout.selectPanel('tasks' as MainPanelId)
    }, () => { management.set({ selected, action: 'manage' }) }, ctx.locale.bind('organization')('newConversation'), ctx.sessions.createEventSource())
    accountReference.set(ctx.sessions.retain(accountSession, { source: 'mainView' }))
  }
  ctx.effect(() => () => { retire() }, 'organization.account-session')
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'organization-conversation-manager',
    locale: 'organization', inject: () => ({ ...bind(), hooks: { ...bind().hooks, conversationManagement: management },
      dismiss: () => { management.set(null) }, committed: (selected: ConversationSelection, deleted: boolean) => {
        const c = state.getSnapshot().connection
        if (c.mode !== 'organization' || c.principal?.accountId !== selected.accountId || c.principal.serverId !== selected.serverId
          || c.organizationId !== selected.organizationId) return
        if (conversationActions && currentSelection && currentSelection.conversationId === selected.conversationId
          && currentSelection.projectId === selected.projectId) {
          if (deleted) { currentSelection = null; retire(); conversationActions.select(null) }
          else { const { botId: _previousBot, ...updated } = selected; void selectConversation(updated) }
        }
        conversationActions?.refresh()
      } }) }, ConversationManager))
  ctx.effect(() => ctx.uiConversation.events.register(organizationPlanDefinition), 'organization.plan-node')
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({ name: 'conversation.chat.node', key: 'organization-plan',
    locale: 'organization', inject: bind }, OrganizationPlanNode))
  const bindConversation = (actions: BoundActions<typeof conversationStore>): OrganizationInjected => {
    conversationActions = actions
    return bind()
  }
  const bindTasks = (actions: BoundActions<typeof taskStore>) => {
    taskActions = actions
    return { ...bind(), openTasks: () => { ctx.layout.selectPanel('tasks' as MainPanelId) } }
  }
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'organization-new-conversation',
    locale: 'organization', inject: () => ({ ...bind(), hooks: { ...bind().hooks, creating },
      dismiss: () => { creating.set(false) } }) }, NewConversation))
  ctx.effect(() => ctx.uiWorkspace.registerSessionStarter(() => {
    if (state.getSnapshot().connection.mode !== 'organization') return false
    creating.set(true); ctx.layout.selectPanel(null); return true
  }, () => {
    if (state.getSnapshot().connection.mode !== 'organization') return false
    ctx.layout.selectPanel(null); return true
  }), 'organization.new-conversation')
  ctx.effect(() => {
    let stop: (() => void)[] = [], active = false, identity = '', generation = -1
    const update = () => {
      const c = state.getSnapshot().connection, organization = c.mode === 'organization'
      const nextIdentity = `${c.mode}:${c.principal?.serverId}:${c.principal?.accountId}:${c.organizationId}`
      if (identity !== nextIdentity) {
        const changed = identity !== ''
        identity = nextIdentity
        retire()
        management.set(null)
        creating.set(false)
        currentSelection = null
        conversationActions?.select(null)
        taskActions?.selectTask(null)
        if (changed) ctx.layout.selectPanel(null)
      }
      if (generation !== c.generation) {
        generation = c.generation; retire()
        if (organization && c.phase === 'ready' && currentSelection) void selectConversation(currentSelection).catch((_error: unknown) => { /* A revoked selection stays empty until the user chooses another conversation. */ })
      }
      if (!organization || c.phase !== 'ready') retire()
      if (active === organization) return
      active = organization
      for (const dispose of stop) dispose()
      stop = organization ? [
        ctx.uiSession.registerMainSource(accountReference),
        ctx.slots.inject('sidebar.tasks', () => ctx.slots.register({ name: 'sidebar.tasks', priority: -10,
          locale: 'organization', store: taskStore, inject: bindTasks }, OrganizationTaskList)),
        ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'tasks', priority: -10,
          locale: 'organization', store: taskStore, inject: bindTasks }, OrganizationTasks)),
      ] : []
    }
    const unsubscribe = state.subscribe(update); update()
    return () => { unsubscribe(); for (const dispose of stop) dispose() }
  }, 'organization.task-navigation')
  ctx.effect(() => {
    let closed = false, syncing = false, dirty = false, lastKey = ''
    const isClosed = () => closed
    const sync = async () => {
      if (syncing) { dirty = true; return }
      const c = state.getSnapshot().connection
      if (!desktop || c.phase !== 'ready' || c.mode !== 'organization' || !c.principal || !c.organizationId) return
      syncing = true
      try {
        let offset = 0, cursor: string | undefined
        const member = c.organizations.find(org => org.id === c.organizationId)?.membershipId
        while (!closed) {
          const current = state.getSnapshot().connection
          if (current.generation !== c.generation) break
          const page = await desktop.connection({ kind: 'assignment-inbox', request: { organizationId: c.organizationId,
            state: 'all', search: '', offset, ...(cursor ? { cursor } : {}) } })
          if (isClosed() || page.assignment?.result.kind !== 'inbox' || page.assignment.generation !== c.generation) break
          const value = page.assignment.result.value
          for (const item of value.items) {
            const a = item.assignment
            if (a.assigneeId !== member || !['pending', 'accepted'].includes(a.state)) continue
            if (isClosed() || state.getSnapshot().connection.generation !== c.generation) break
            await desktop.conversation({ kind: 'open', operationId: randomUUID() as ConversationRequest['operationId'],
              organizationId: a.organizationId, projectId: a.projectId,
              conversationId: String(a.id) as ConversationRequest['conversationId'],
              assignment: { planId: a.planId,
                assignmentId: a.id } }).catch((_error: unknown) => {
              /* Deleted or revoked Sessions do not stop the remaining assignments. */
            })
          }
          offset += value.items.length; cursor = value.cursor
          if (!value.items.length || offset >= value.total) break
        }
        if (!closed && state.getSnapshot().connection.generation === c.generation) conversationActions?.refresh()
      } catch (_error: unknown) { /* Offline or revoked assignments are retried on the next native snapshot. */ }
      finally { syncing = false; if (dirty && !closed) { dirty = false; void sync() } }
    }
    const observe = () => {
      const c = state.getSnapshot().connection
      const key = JSON.stringify([c.mode, c.phase, c.generation, c.principal, c.organizationId, c.inbox?.cursor])
      if (key === lastKey) return
      lastKey = key; void sync()
    }
    const stop = state.subscribe(observe); observe()
    return () => { closed = true; stop() }
  }, 'organization.assignment-sessions')
  const t = ctx.locale.bind('organization')
  ctx.slots.inject('settings.section', () => ctx.slots.register({ name: 'settings.section',
    id: 'organization',
    order: 27,
    label: () => t('settings'),
    locale: 'organization',
    inject: bind }, OrganizationSettings))
  ctx.slots.inject('sidebar.account', () => ctx.slots.register({ name: 'sidebar.account',
    locale: 'organization', inject: bind }, AccountMenu))
  ctx.slots.inject('sidebar.personal', () => ctx.slots.register({ name: 'sidebar.personal', store: conversationStore,
    priority: -10,
    locale: 'organization',
    inject: bindConversation }, OrganizationSidebar))
}
