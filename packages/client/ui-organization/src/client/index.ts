/** Desktop organization settings and a personal/organization navigation switch. */
import { sessionFileAddress } from '@deepseek-ai/dsh-util-workspace-path'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/client'
import type {} from '@deepseek-ai/dsh-api-workspace-files/remote'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import { brandString } from '@deepseek-ai/dsh-brand'
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
import type { ISessions, SessionReference } from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ConversationSelection } from './conversation-store.ts'
import { OrganizationProject, type ProjectSelection } from './Project.tsx'
import { OrganizationConversationEntry, type ConversationStartTarget } from './ConversationEntry.tsx'
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

declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap {
    /** Retain an attached conversation until its account lifetime ends. */
    organizationConversation: unknown
  }
}

/** Required UI services; the Desktop preload owns the native IPC capability. */
export const inject = ['slots', 'locale', 'remote', 'remote.session', 'settingsNavigation', 'layout', 'uiWorkspace',
  'sessions', 'uiSession', 'uiConversation', 'remote.workspaceFiles']
/**
 * Register safe native snapshots with framework-created hooks and managed subscriptions.
 * @param ctx - Client plugin context.
 */
export function apply(ctx: Context): void {
  const desktop = (globalThis as typeof globalThis & { dshDesktop?: { organization?: OrganizationDesktopBridge } }).dshDesktop?.organization
  const modelCatalogRevision = createSnapshotStore(0)
  const taskExecutionRevision = createSnapshotStore(0)
  ctx.remote.$on('api-session/status', () => { taskExecutionRevision.set(taskExecutionRevision.getSnapshot() + 1) })
  ctx.remote.$on('api-session/activity', () => { taskExecutionRevision.set(taskExecutionRevision.getSnapshot() + 1) })
  ctx.remote.$on('api-session/model-catalog-changed', (revision) => { modelCatalogRevision.set(revision) })
  const state = createSnapshotStore<OrganizationDesktopSnapshot>({ connection: { revision: 0, generation: 0, identityGeneration: 0,
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
  const deliveryFileKey = (artifactId: Parameters<NonNullable<OrganizationInjected['openDeliveryFile']>>[0]) => {
    const c = state.getSnapshot().connection
    if (!c.principal || !c.organizationId || c.mode !== 'organization') throw new Error('unavailable')
    return `organization-delivery-file:${c.principal.serverId}:${c.principal.accountId}:${c.organizationId}:${artifactId}`
  }
  const bind = (): OrganizationInjected => ({
    rememberDeliveryFile: (artifactId, file) => {
      const bridge = (globalThis as typeof globalThis & { __DSH_HOST_PATHS__?: { pathFor(file: File): string } }).__DSH_HOST_PATHS__
      const path = bridge?.pathFor(file)
      if (path) {
        try { localStorage.setItem(deliveryFileKey(artifactId), path) } catch (error) {
          // Storage quotas must not interrupt an already published attachment.
          console.warn('organization delivery source path could not be retained', error)
        }
      }
    },
    openDeliveryFile: async (artifactId) => {
      const key = deliveryFileKey(artifactId), openedGeneration = state.getSnapshot().connection.generation
      const current = () => {
        if (deliveryFileKey(artifactId) !== key || state.getSnapshot().connection.generation !== openedGeneration) throw new Error('superseded')
      }
      const path = localStorage.getItem(key)
      if (!path) return false
      const sidebar = ctx.get('sidebarRight'), files = ctx.remote.workspaceFiles
      const sessionId = sidebar?.mounted.getSnapshot()
      if (sidebar && sessionId) {
        try {
          const stat = await files.stat(sessionId, path)
          const definitions = ctx.get('documentPreviews')?.getSnapshot() ?? []
          const renderer = definitions.some(definition => definition.extensions.some(extension => path.toLowerCase().endsWith(`.${extension.toLowerCase()}`)))
          const readable = renderer || (await files.read(sessionId, path, { limit: 1 })).ok
          current()
          if (stat.ok && readable) {
            sidebar.openResource(sessionFileAddress(sessionId, path))
            return true
          }
        } catch (error) {
          // Failed preview probes fall through to the native file location action.
          console.warn('organization delivery source preview unavailable', error)
        }
      }
      current()
      const result = await ctx.remote.session.openWorkspacePath({ path, action: 'reveal' })
      if (!result.ok) throw new Error(result.error.message)
      return true
    },
    conversation: request => desktop ? desktop.conversation(request) : unavailable(),
    openProjectTasks: (project) => {
      const c = state.getSnapshot().connection
      if (c.mode !== 'organization' || c.organizationId !== project.organizationId || !c.principal) return
      taskActions?.selectProject({ ...c.principal, project }); ctx.layout.selectPanel('tasks' as MainPanelId)
    },
    openProject: (project) => {
      const c = state.getSnapshot().connection
      if (c.phase !== 'ready' || c.mode !== 'organization' || c.organizationId !== project.organizationId || !c.principal) return
      projectDetails.set({ ...c.principal, project }); ctx.layout.selectPanel('organization-project' as MainPanelId)
    },
    openTask: (project, task) => {
      const c = state.getSnapshot().connection
      if (c.phase !== 'ready' || c.mode !== 'organization' || c.organizationId !== project.organizationId || !c.principal) return
      taskActions?.selectTask({ ...c.principal, organizationId: project.organizationId,
        projectId: project.id, planId: task.planId, taskId: task.id })
      ctx.layout.selectPanel('tasks' as MainPanelId)
    },
    beginConversationNavigation: () => {
      navigationLoading = true; openSequence++
      if (draft) clearView()
      ctx.layout.selectPanel(null)
    },
    showConversationStart: (project, botId) => {
      navigationLoading = false
      conversationStartTarget.set({ ...(project ? { project } : {}), ...(botId ? { botId } : {}) })
      showDraft()
    },
    removeProject: async (project) => {
      const bridge = desktop
      if (!bridge) return unavailable()
      const c = state.getSnapshot().connection
      if (!c.principal || c.organizationId !== project.organizationId || c.phase !== 'ready') throw new Error('superseded')
      if (!c.removedProjects?.includes(project.id)) {
        if (project.createdBy === c.principal.accountId) await bridge.connection({ kind: 'command', command: {
          kind: 'delete-project', organizationId: project.organizationId, projectId: project.id,
          expectedVersion: project.version, operationId: randomUUID() } })
        else await bridge.connection({ kind: 'remove-project', projectId: project.id })
      }
      const current = state.getSnapshot().connection
      if (current.principal?.serverId !== c.principal.serverId || current.principal.accountId !== c.principal.accountId
        || current.organizationId !== project.organizationId) throw new Error('superseded')
      await cleanupProject(project.id, current)
      conversationActions?.refresh()
    },
    manageConversation: (selected, action = 'manage') => { management.set({ selected, action }) },
    selectConversation: async (selected) => { await selectConversation(selected) },
    openConversation: () => { ctx.layout.selectPanel(null) }, available: !!desktop,
    loadModels,
    openCodexSettings: () => { ctx.settingsNavigation.open('models', 'codex') },
    connection: action => desktop ? desktop.connection(action) : unavailable(),
    server: action => desktop ? desktop.server(action) : unavailable(),
    secret: () => desktop ? desktop.secret() : unavailable(),
    context: request => desktop ? desktop.context(request) : unavailable(),
    executionReport: request => desktop ? desktop.executionReport(request) : unavailable(),
    execution: request => desktop ? desktop.execution(request) : unavailable(),
    hooks: { organization: state, modelCatalogRevision, taskExecutionRevision } })
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
  const conversationStartTarget = createSnapshotStore<ConversationStartTarget>({})
  const projectDetails = createSnapshotStore<ProjectSelection | null>(null)
  const management = createSnapshotStore<{ selected: ConversationSelection; action: 'manage' | 'delete' } | null>(null)
  let draft: ReturnType<ISessions['createDraft']> | undefined
  let accountSession: AccountSession | undefined, openSequence = 0
  let currentSelection: ConversationSelection | null = null, navigationLoading = false
  const retainedConversations = new Map<string, { selected: ConversationSelection; account: AccountSession; reference: SessionReference }>()
  const detachments = new Set<Promise<void>>()
  const conversationKey = (selected: ConversationSelection) => JSON.stringify([
    selected.serverId, selected.accountId, selected.organizationId, selected.projectId, selected.conversationId,
  ])
  const projectCleanup = new Map<string, Promise<void>>(), cleanedProjects = new Set<string>()
  const cleanupProject = (projectId: import('@deepseek-ai/dsh-organization/types').OrganizationProjectId,
    c: OrganizationDesktopSnapshot['connection']): Promise<void> => {
    if (!desktop || !c.principal || !c.organizationId) return Promise.reject(new Error('superseded'))
    const key = JSON.stringify([c.principal.serverId, c.principal.accountId, c.organizationId, projectId])
    if (cleanedProjects.has(key)) return Promise.resolve()
    const pending = projectCleanup.get(key)
    if (pending) return pending
    const task = desktop.conversation({ kind: 'project-remove', organizationId: c.organizationId, projectId,
      conversationId: String(projectId) as ConversationRequest['conversationId'],
      operationId: randomUUID() as ConversationRequest['operationId'] }).then(() => { cleanedProjects.add(key) })
      .finally(() => { projectCleanup.delete(key) })
    projectCleanup.set(key, task)
    return task
  }
  const clearView = () => {
    openSequence++
    const reference = accountReference.getSnapshot()
    accountReference.set(undefined)
    draft?.dispose(); draft = undefined; reference?.release()
    accountSession = undefined
  }
  const detach = (account: AccountSession) => {
    const detachment = account.dispose()
    detachments.add(detachment)
    void detachment.then(() => { detachments.delete(detachment) })
  }
  const forgetConversation = (key: string) => {
    const retained = retainedConversations.get(key)
    if (!retained) return
    retainedConversations.delete(key); detach(retained.account)
    retained.reference.release()
  }
  const retire = () => {
    clearView()
    for (const key of retainedConversations.keys()) forgetConversation(key)
    return Promise.all(detachments)
  }
  const selectConversation = async (selected: ConversationSelection | null, publish = true, reload = false) => {
    const c = state.getSnapshot().connection
    if (selected && (c.mode !== 'organization' || c.principal?.serverId !== selected.serverId
      || c.principal.accountId !== selected.accountId || c.organizationId !== selected.organizationId)) throw new Error('organization-conversation: superseded')
    if (publish) {
      if (selected) navigationLoading = false
      currentSelection = selected
      openSequence++; conversationActions?.select(selected); ctx.layout.selectPanel(null)
      if (!selected || draft) clearView()
    }
    const sequence = openSequence
    if (!selected || !desktop || c.phase !== 'ready' || !selected.conversationId) return
    const key = conversationKey(selected), retained = retainedConversations.get(key)
    if (publish && retained && !reload) {
      if (accountSession === retained.account) return
      const previous = accountReference.getSnapshot()
      accountSession = retained.account
      accountReference.set(ctx.sessions.retain(retained.account.sessionId, { source: 'mainView' }))
      previous?.release()
      return
    }
    const query = { organizationId: selected.organizationId, projectId: selected.projectId, conversationId: selected.conversationId,
      ...(selected.botId ? { botId: selected.botId } : {}),
      ...(selected.assignmentId && selected.planId ? { assignment: { assignmentId: selected.assignmentId,
        planId: selected.planId } } : {}) }
    const reply = await desktop.conversation({ ...query, kind: 'attach', operationId: randomUUID() as ConversationRequest['operationId'] })
    const current = state.getSnapshot().connection
    if (sequence !== openSequence || current.mode !== 'organization' || !['ready', 'loading'].includes(current.phase)
      || current.identityGeneration !== c.identityGeneration
      || current.principal?.serverId !== selected.serverId || current.principal.accountId !== selected.accountId
      || current.organizationId !== selected.organizationId) {
      if (reply.result.attachmentId) await desktop.conversation({ ...query, kind: 'detach',
        attachmentId: reply.result.attachmentId, operationId: randomUUID() as ConversationRequest['operationId'] })
        .catch((_error: unknown) => { /* A retired native generation already cancels its attachment. */ })
      throw new Error('organization-conversation: superseded')
    }
    const sharedSessionId = reply.result.sharedSessionId
    if (!sharedSessionId || !reply.result.attachmentId) throw new Error('organization-conversation: shared-session-required')
    const projectId = selected.projectId
    const attached = new AccountSession(reply, query, desktop, state, () => { conversationActions?.refresh() }, (report) => {
      const a = report.assignment, proposal = report.goals.at(-1)?.proposal
      const taskId = report.execution?.target.taskId ?? a?.taskId ?? proposal?.definition?.taskId,
        planId = report.execution?.target.planId ?? a?.planId ?? proposal?.planId
      if (taskId && planId && projectId) taskActions?.selectTask({ ...selected, projectId, planId, taskId,
        ...(a ? { assignmentId: a.id } : {}) })
      ctx.layout.selectPanel('tasks' as MainPanelId)
    }, () => { management.set({ selected, action: 'manage' }) }, loadModels,
    async (selection) => {
      const result = await ctx.remote.session.selectModel({ sessionId: sharedSessionId, ...selection })
      if (publish && 'value' in result && result.value.sessionId !== undefined) await selectConversation(selected, true, true)
      return result
    })
    const reference = ctx.sessions.retain(attached, { source: 'organizationConversation' })
    const commit = () => {
      if (retainedConversations.get(key)?.reference === reference) return
      if (sequence !== openSequence) throw new Error('organization-conversation: superseded')
      const previous = accountReference.getSnapshot()
      const previousDraft = draft; draft = undefined
      forgetConversation(key)
      retainedConversations.set(key, { selected, account: attached, reference })
      accountSession = attached; currentSelection = selected; navigationLoading = false
      conversationActions?.select(selected)
      accountReference.set(ctx.sessions.retain(sharedSessionId, { source: 'mainView' }))
      previousDraft?.dispose(); previous?.release()
      if (!publish) conversationActions?.refresh()
    }
    if (publish) {
      try { await reference.ready; commit() }
      catch (error: unknown) { detach(attached); reference.release(); throw error }
    }
    return { reference, commit, dispose: () => { detach(attached); reference.release() } }
  }
  ctx.effect(() => () => retire(), 'organization.account-session')
  ctx.on('api-session/activity', (id) => {
    if ([...retainedConversations.values()].some(retained => retained.account.sessionId === id)) conversationActions?.refresh()
  })
  ctx.on('api-session/status', (id, running) => {
    if (!running && [...retainedConversations.values()].some(retained => retained.account.sessionId === id)) conversationActions?.refresh()
  })
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'organization-conversation-manager',
    locale: 'organization', inject: () => ({ ...bind(), hooks: { ...bind().hooks, conversationManagement: management },
      dismiss: () => { management.set(null) }, committed: (selected: ConversationSelection, deleted: boolean) => {
        const c = state.getSnapshot().connection
        if (c.mode !== 'organization' || c.principal?.accountId !== selected.accountId || c.principal.serverId !== selected.serverId
          || c.organizationId !== selected.organizationId) return
        if (deleted) forgetConversation(conversationKey(selected))
        if (conversationActions && currentSelection && currentSelection.conversationId === selected.conversationId
          && currentSelection.projectId === selected.projectId) {
          if (deleted) { currentSelection = null; clearView(); conversationActions.select(null) }
          else { const { botId: _previousBot, ...updated } = selected; void selectConversation(updated, true, true) }
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
  const showDraft = () => {
    const c = state.getSnapshot().connection, target = conversationStartTarget.getSnapshot()
    if (c.mode !== 'organization' || c.phase !== 'ready' || !c.principal || !c.organizationId) return
    clearView(); currentSelection = null; conversationActions?.select(null)
    const selected: ConversationSelection = { ...c.principal, organizationId: c.organizationId,
      conversationId: randomUUID() as ConversationRequest['conversationId'],
      ...(target.project ? { projectId: target.project.id } : {}), ...(target.botId ? { botId: target.botId } : {}) }
    const sequence = openSequence
    draft = ctx.sessions.createDraft({ eventSource: ctx.sessions.createEventSource(), title: ctx.locale.bind('organization')('newConversation'),
      loadPermissions: async () => {
        const result = await ctx.remote.permissionPresets.catalog()
        if (!result.ok) throw new Error(result.error.message)
        return result.value
      },
      loadModels: async () => {
        const catalog = await loadModels()
        if (!target.botId || !target.project || !desktop) return catalog
        const result = await desktop.conversation({ kind: 'catalog', organizationId: selected.organizationId, projectId: target.project.id,
          conversationId: randomUUID() as ConversationRequest['conversationId'], operationId: randomUUID() as ConversationRequest['operationId'] })
        const bot = result.result.catalog?.bots.find(item => item.id === target.botId)
        if (!bot || !('provider' in bot.selection)) return catalog
        const choice = bot.selection
        const selection = { provider: choice.provider, model: choice.model,
          ...(choice.backend ? { backend: choice.backend } : {}),
          ...(choice.reasoningEffort ? { reasoningEffort: choice.reasoningEffort } : {}) }
        return { ...catalog, default: selection }
      },
      listTasks: async () => {
        if (!target.project || !desktop) return []
        const tasks: Awaited<ReturnType<import('@deepseek-ai/dsh-api-session-controller/client').SessionControls['listTasks']>>[number][] = []
        let offset = 0, cursor: string | undefined
        while (sequence === openSequence) {
          const result = await desktop.connection({ kind: 'workgraph-tasks', request: { organizationId: selected.organizationId,
            projectId: target.project.id, offset, ...(cursor ? { cursor } : {}) } })
          if (sequence !== openSequence || result.workgraph?.result.kind !== 'tasks') throw new Error('organization-conversation: superseded')
          const page = result.workgraph.result.value
          tasks.push(...page.items.map(task => ({ id: brandString<import('@deepseek-ai/dsh-api-session-controller/client').SessionTaskChoiceId>(task.id),
            title: task.goal, scope: task.scope, acceptance: task.acceptance, artifacts: task.artifacts })))
          offset += page.items.length; cursor = page.cursor
          if (!page.items.length || offset >= page.total) break
        }
        return tasks
      },
      openExecution: () => { ctx.layout.selectPanel('tasks' as MainPanelId) }, materialize: async () => {
        if (sequence !== openSequence) throw new Error('organization-conversation: superseded')
        const attached = await selectConversation(selected, false)
        if (!attached) throw new Error('organization-conversation: unavailable')
        return attached
      } })
    accountReference.set(ctx.sessions.retain(draft, { source: 'mainView' })); ctx.layout.selectPanel(null)
  }
  ctx.effect(() => ctx.uiWorkspace.registerSessionStarter(() => {
    if (state.getSnapshot().connection.mode !== 'organization') return false
    conversationStartTarget.set({}); navigationLoading = false; showDraft(); return true
  }, () => {
    if (state.getSnapshot().connection.mode !== 'organization') return false
    ctx.layout.selectPanel(null); return true
  }), 'organization.new-conversation')
  ctx.effect(() => {
    let stop: (() => void)[] = [], active = false, identity = '', generation = -1, identityGeneration = -1, phase = ''
    const update = () => {
      const c = state.getSnapshot().connection, organization = c.mode === 'organization'
      const nextIdentity = `${c.mode}:${c.principal?.serverId}:${c.principal?.accountId}:${c.organizationId}`
      if (identity !== nextIdentity) {
        const changed = identity !== ''
        identity = nextIdentity
        void retire()
        management.set(null)
        projectDetails.set(null); conversationStartTarget.set({})
        currentSelection = null; navigationLoading = false
        conversationActions?.select(null)
        taskActions?.selectTask(null)
        if (changed) ctx.layout.selectPanel(null)
      }
      if (generation !== c.generation) {
        generation = c.generation
        conversationActions?.refresh()
      }
      const identityGenerationChanged = identityGeneration !== c.identityGeneration
      if (identityGenerationChanged) {
        identityGeneration = c.identityGeneration
        void retire()
      }
      if (!organization || !['ready', 'loading'].includes(c.phase)) void retire()
      if (currentSelection?.projectId && c.removedProjects?.includes(currentSelection.projectId)) {
        clearView(); currentSelection = null; conversationActions?.select(null)
      }
      for (const [key, retained] of retainedConversations) {
        if (retained.selected.projectId && c.removedProjects?.includes(retained.selected.projectId)) forgetConversation(key)
      }
      for (const projectId of c.removedProjects ?? []) taskActions?.removeProject(projectId)
      const viewedProject = projectDetails.getSnapshot()
      if (viewedProject && c.removedProjects?.includes(viewedProject.project.id)) {
        projectDetails.set(null); ctx.layout.selectPanel(null)
      }
      const phaseChanged = phase !== c.phase
      phase = c.phase
      if (organization && c.phase === 'ready' && !currentSelection && !draft && !navigationLoading) showDraft()
      if ((phaseChanged || identityGenerationChanged) && organization && c.phase === 'ready' && currentSelection && !accountSession)
        void selectConversation(currentSelection).catch((_error: unknown) => { /* Reopening history never replays a prompt. */ })
      if (active === organization) return
      active = organization
      for (const dispose of stop) dispose()
      stop = organization ? [
        ctx.uiSession.registerMainSource(accountReference),
        ctx.slots.inject('main.conversation.entry', () => ctx.slots.register({ name: 'main.conversation.entry',
          locale: 'organization', inject: () => ({ ...bind(), hooks: { ...bind().hooks, conversationReference: accountReference } }) }, OrganizationConversationEntry)),
        ctx.slots.inject('sidebar.tasks', () => ctx.slots.register({ name: 'sidebar.tasks', priority: -10,
          locale: 'organization', store: taskStore, inject: bindTasks }, OrganizationTaskList)),
        ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'tasks', priority: -10,
          locale: 'organization', store: taskStore, inject: bindTasks }, OrganizationTasks)),
        ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'organization-project',
          locale: 'organization', inject: () => ({ ...bind(), hooks: { ...bind().hooks, projectDetails } }) }, OrganizationProject)),
      ] : []
    }
    const unsubscribe = state.subscribe(update); update()
    return () => { unsubscribe(); for (const dispose of stop) dispose() }
  }, 'organization.task-navigation')
  ctx.effect(() => {
    let closed = false, tail = Promise.resolve()
    const isClosed = () => closed
    const update = () => {
      const c = state.getSnapshot().connection
      if (c.phase !== 'ready' || c.mode !== 'organization') return
      tail = tail.then(async () => {
        if (closed) return
        for (const projectId of c.removedProjects ?? []) {
          const current = state.getSnapshot().connection
          if (isClosed() || current.phase !== 'ready' || current.generation !== c.generation) return
          await cleanupProject(projectId, c)
        }
      }).catch((error: unknown) => { if (!closed) console.warn('Organization project cleanup failed', error) })
    }
    const unsubscribe = state.subscribe(update); update()
    return () => { closed = true; unsubscribe(); return tail }
  }, 'organization.project-cleanup')
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
            if (c.removedProjects?.includes(a.projectId) || c.removedPlans?.includes(a.planId)) continue
            const review = item.request.kind === 'accept-delivery' && item.request.handlerId === member
              && item.request.reviewState === 'pending' ? item.request : undefined
            if (!review && (a.assigneeId !== member || !['pending', 'accepted'].includes(a.state))) continue
            if (isClosed() || state.getSnapshot().connection.generation !== c.generation) break
            await desktop.conversation({ operationId: randomUUID() as ConversationRequest['operationId'],
              organizationId: a.organizationId, projectId: a.projectId,
              ...(review ? { kind: 'open-review', conversationId: String(review.id) as ConversationRequest['conversationId'],
                review: { planId: a.planId, assignmentId: a.id, submissionId: review.id } }
                : { kind: 'open', conversationId: String(a.id) as ConversationRequest['conversationId'],
                  assignment: { planId: a.planId, assignmentId: a.id } }) }).catch((_error: unknown) => {
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
