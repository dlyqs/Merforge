/** Workspace archive and directory UI capability. */

import { Service, type Context } from '@deepseek-ai/cordis'
import type { ClientRemote, DirectoryListing, RemoteFailure } from '@deepseek-ai/dsh-api-remotes/client'
import type {
  ISessions,
  SessionCreateError,
  SessionReference,
  SessionTarget,
  SessionListState,
  SessionControls,
} from '@deepseek-ai/dsh-api-session-controller/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SubagentAddress } from '@deepseek-ai/dsh-subagent/client'
import type {
  IWorkspaces, WorkspaceId, WorkspaceSnapshot, WorkspaceView,
} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { pinOrderAccounts, pinOrderSource } from './pin-order.ts'
import type { WorkspaceViewStoreActions } from './stores.ts'

interface MainSelection {
  readonly sessionId?: SessionId
  readonly subagentAddress?: SubagentAddress
}

/** Workspace archive and directory operations consumed by Client UI domains. */
export interface UiWorkspace {
  /**
   * Select a Session and show its Conversation as one UI navigation action.
   * @param target - known Session identity or durable direct-parent subagent address to display.
   */
  openSession(target: SessionTarget): void
  /**
   * Show an unsaved composer in a Workspace unless preparation supersedes it.
   * @param workspaceId - target Workspace.
   * @param beforeOpen - optional synchronous preparation for the local composer identity.
   * @returns completion after selecting the composer; persistence waits for submission.
   * @throws on an unknown Workspace or preparation failure.
   */
  openWorkspace(workspaceId: WorkspaceId, beforeOpen?: (sessionId: SessionId) => void): Promise<void>
  /**
   * Fork a Session without changing the current selection.
   * @param sessionId - source Session.
   * @returns completion after child creation and inherited-title increment.
   */
  forkSession(sessionId: SessionId): Promise<void>
  /**
   * Resolve the reusable or newly created blank Session for a Workspace.
   * @param workspaceId - target Workspace.
   * @returns a Session already addressable through the Session Controller.
   */
  connectWorkspace(workspaceId: WorkspaceId): Promise<SessionId>
  /**
   * Show an unsaved composer; the first submitted input creates its Session.
   * @param workspaceId - explicit directory target; absent opens an unaffiliated draft.
   */
  startSession(workspaceId?: WorkspaceId): void
  /**
   * Show an unsaved personal composer; the first submitted input creates its Session.
   * @param options - Explicit Project, Bot, or working directory for that submission.
   */
  startPersonalSession(options: Parameters<ISessions['create']>[0]): void
  /**
   * Register an identity-specific new-conversation consumer; true means it owns this gesture.
   * @param start - Synchronous admission and navigation for the selected identity.
   * @param show - Optional consumer of navigation back to the current conversation.
   * @returns Disposer restoring personal navigation.
   */
  registerSessionStarter(start: () => boolean, show?: () => boolean): () => void
  /** Show the current identity's conversation surface without creating another conversation. */
  showConversation(): void
  /**
   * Archive a Session and clear it when it is the current selection.
   * @param sessionId - Session to archive.
   * @param options - `stopActivity` asks the Host to stop the Session's running work instead of refusing.
   */
  archiveSession(sessionId: SessionId, options?: { readonly stopActivity?: boolean }): Promise<void>
  /**
   * Unarchive a Session, restoring it to its recorded Workspace position.
   * @param sessionId - Session to unarchive.
   */
  unarchiveSession(sessionId: SessionId): Promise<void>
  /**
   * Pin a Session on the Host, then lead it in its accounts' saved orders
   * (its Workspace group or Ungrouped, and the flat list). The order write
   * reads the memberships current at completion, so reorders that landed
   * while the Host call was pending keep their positions.
   * @param sessionId - Session to pin.
   */
  pinSession(sessionId: SessionId): Promise<void>
  /**
   * Unpin a Session on the Host; saved positions stay as they are.
   * @param sessionId - Session to unpin.
   */
  unpinSession(sessionId: SessionId): Promise<void>
  /**
   * Open the Host-native directory picker.
   * @returns the selected directory, or null when cancelled.
   */
  pickDirectory(): Promise<string | null>
  /**
   * List one Host directory level.
   * @param path - directory path; absent selects the Host home.
   * @param signal - cancellation for a superseded scan.
   * @returns directory entries and breadcrumb ancestry.
   */
  listDirectory(path?: string, signal?: AbortSignal): Promise<DirectoryListing>
  /**
   * Create a child directory.
   * @param path - existing parent directory.
   * @param name - child directory name.
   * @returns created absolute path.
   */
  createDirectory(path: string, name: string): Promise<string>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Cross-Controller Workspace navigation and directory UI capability. */
    uiWorkspace: UiWorkspace
  }
}

/** Structured directory failure exposed to directory UI consumers. */
export class DirectoryBrowseError extends Error {
  override readonly name = 'DirectoryBrowseError'

  /** @param rpcError - Host directory business failure. */
  constructor(readonly rpcError: RemoteFailure) {
    super(`directory browse failed: ${rpcError.code}: ${rpcError.message}`)
  }
}

/** Implements Workspace archive and directory UI operations. */
class UiWorkspaceService extends Service implements UiWorkspace {
  private readonly connecting = new Map<WorkspaceId, Promise<SessionId>>()
  private readonly lifetime = new AbortController()
  private readonly selection = createSnapshotStore<MainSelection>(
    {}, { persist: { name: 'dsh.sessions.current' } },
  )
  private readonly sessionStarters = new Map<() => boolean, (() => boolean) | undefined>()
  private mainReference: SessionReference | undefined
  private draft: ReturnType<ISessions['createDraft']> | undefined

  /**
   * @param ctx - Client root Context.
   * @param directoryPicker - the directory-picking Remote namespace.
   * @param workspaces - pure Workspace Controller.
   * @param sessions - pure Session Controller.
   * @param view - the browser's viewing-store write set (one instance shared with its registration).
   */
  constructor(
    ctx: Context,
    private readonly directoryPicker: ClientRemote['directoryPicker'],
    private readonly workspaces: IWorkspaces,
    private readonly sessions: ISessions,
    private readonly view: Pick<WorkspaceViewStoreActions, 'pinSessionOrder'>,
  ) {
    super(ctx, 'uiWorkspace')
    ctx.effect(() => {
      const stop = this.watchNavigation()
      return () => {
        stop()
        this.lifetime.abort()
        const reference = this.mainReference
        this.mainReference = undefined
        this.draft?.dispose(); this.draft = undefined
        reference?.release()
      }
    }, 'ui-workspace: Workspace navigation policy')
  }

  async connectWorkspace(workspaceId: WorkspaceId): Promise<SessionId> {
    const workspace = this.workspaces.list.getSnapshot().items
      .find(item => item.workspaceId === workspaceId)
    if (workspace === undefined) {
      throw new Error(`uiWorkspace.connectWorkspace: unknown workspace ${workspaceId}`)
    }
    const inflight = this.connecting.get(workspaceId)
    if (inflight !== undefined) return inflight

    const attempt = this.reuseOrCreateBlank(workspace)
      .finally(() => { this.connecting.delete(workspaceId) })
    this.connecting.set(workspaceId, attempt)
    return attempt
  }

  private reuseOrCreateBlank(workspace: WorkspaceView): Promise<SessionId> {
    const archived = this.workspaces.list.getSnapshot().archivedSessionIds
    const sessions = this.sessions.list.getSnapshot()
    for (const id of sessions.ids) {
      const summary = sessions.byId[id]
      if (summary === undefined || !summary.blank || summary.cwd !== workspace.path
        || !workspace.sessionIds.includes(id) || archived.includes(id)) continue
      return this.reuseBlank(workspace.path, id)
    }
    return this.sessions.create({ cwd: workspace.path })
  }

  private async reuseBlank(path: string, sessionId: SessionId): Promise<SessionId> {
    try {
      return await this.sessions.create({ cwd: path, sessionId })
    } catch (error: unknown) {
      if (sessionCreateErrorOf(error)?.rpcError.code !== 'session/writer-held') throw error
      return this.sessions.create({ cwd: path })
    }
  }

  openSession(target: SessionTarget): void {
    this.replaceMain(target, this.lifetime.signal, 'reveal')
  }

  openWorkspace(workspaceId: WorkspaceId, beforeOpen?: (sessionId: SessionId) => void): Promise<void> {
    try {
      const workspace = this.workspaces.list.getSnapshot().items.find(item => item.workspaceId === workspaceId)
      if (!workspace) throw new Error(`uiWorkspace.openWorkspace: unknown workspace ${workspaceId}`)
      const navigation = AbortSignal.any([this.ctx.layout.beginNavigation(), this.lifetime.signal])
      this.showDraft({ cwd: workspace.path }, navigation, 'reveal', beforeOpen)
      return Promise.resolve()
    } catch (error: unknown) { return Promise.reject(error instanceof Error ? error : new Error(String(error))) }
  }

  async forkSession(sessionId: SessionId): Promise<void> {
    await this.sessions.fork({ sessionId, increaseTitle: true })
  }

  registerSessionStarter(start: () => boolean, show?: () => boolean): () => void {
    this.sessionStarters.set(start, show)
    return () => { this.sessionStarters.delete(start) }
  }

  showConversation(): void {
    if ([...this.sessionStarters.values()].some(show => show?.())) return
    this.ctx.layout.selectPanel(null)
  }

  startSession(workspaceId?: WorkspaceId): void {
    if (workspaceId === undefined && [...this.sessionStarters.keys()].some(start => start())) return
    if (workspaceId !== undefined) {
      const workspace = this.workspaces.list.getSnapshot().items.find(item => item.workspaceId === workspaceId)
      if (!workspace) throw new Error(`uiWorkspace.startSession: unknown workspace ${workspaceId}`)
      this.startPersonalSession({ cwd: workspace.path })
      return
    }
    this.startPersonalSession({})
  }

  startPersonalSession(options: Parameters<ISessions['create']>[0]): void {
    const navigation = AbortSignal.any([this.ctx.layout.beginNavigation(), this.lifetime.signal])
    this.showDraft(options, navigation, 'reveal')
  }

  private showDraft(options: Parameters<ISessions['create']>[0], navigation: AbortSignal, panel: 'reveal' | 'preserve',
    beforeOpen?: (sessionId: SessionId) => void): void {
    let durableId: SessionId | undefined
    const assertCurrent = () => {
      if (this.draft !== draft || this.lifetime.signal.aborted) throw new Error('conversation-draft: superseded')
    }
    const unwrap = <T>(result: import('@deepseek-ai/dsh-api-remotes/client').RemoteResult<T>): T => {
      if (!result.ok) throw new Error(result.error.message)
      return result.value
    }
    const draft = this.sessions.createDraft({
      eventSource: this.sessions.createEventSource(), title: this.ctx.locale.bind('workspace')('actions.newSession'),
      loadModels: async () => {
        const catalog = unwrap(await this.ctx.remote.session.modelCatalog())
        if (!options?.botId) return catalog
        const bot = unwrap(await this.ctx.remote.session.personalList()).bots.find(item => item.id === options.botId)
        const model = bot?.defaultModel
        return model ? { ...catalog, default: { provider: model.provider, model: model.model,
          ...(model.backend ? { backend: model.backend } : {}),
          ...(model.reasoningEffort ? { reasoningEffort: model.reasoningEffort } : {}),
        } } : catalog
      },
      listTasks: () => Promise.resolve([]), openExecution: () => { this.ctx.layout.selectPanel('tasks' as import('@deepseek-ai/dsh-client-ui-layout/client').MainPanelId) },
      materialize: async () => {
        assertCurrent()
        durableId ??= await this.sessions.create(options)
        assertCurrent()
        const reference = this.sessions.retain(durableId, { source: 'mainView' })
        const controls: SessionControls = {
          ...draft.controls,
          selectModel: async (selection) => {
            const result = await this.ctx.remote.session.selectModel({ sessionId: reference.sessionId, ...selection })
            if (result.ok && result.value.sessionId) durableId = result.value.sessionId
            return result
          },
          readMode: async () => unwrap(await this.ctx.remote.session.workflowMode(reference.sessionId)),
          setMode: async (enabled, expectedRevision, operationId) => unwrap(await this.ctx.remote.session.workflowSetMode({
            sessionId: reference.sessionId, enabled, expectedRevision, operationId,
          })),
        }
        return { reference, controls, dispose: () => { reference.release() }, commit: () => {
          assertCurrent()
          const previous = this.mainReference
          this.mainReference = reference; this.selection.set({ sessionId: reference.sessionId })
          this.draft = undefined; draft.dispose(); previous?.release()
        } }
      },
    })
    let selected: boolean
    try { selected = this.replaceMain(draft, navigation, panel, beforeOpen) }
    catch (error: unknown) { draft.dispose(); throw error }
    if (!selected) { draft.dispose(); return }
    this.draft = draft
  }

  async archiveSession(sessionId: SessionId, options: { readonly stopActivity?: boolean } = {}): Promise<void> {
    await this.workspaces.archiveSession(sessionId, options)
    if (this.mainReference?.sessionId === sessionId) this.clearMain()
  }

  async unarchiveSession(sessionId: SessionId): Promise<void> {
    await this.workspaces.unarchiveSession(sessionId)
  }

  async pinSession(sessionId: SessionId): Promise<void> {
    await this.workspaces.pinSession(sessionId)
    const { items, pinnedSessionIds, archivedSessionIds } = this.workspaces.list.getSnapshot()
    this.view.pinSessionOrder(
      sessionId,
      pinOrderAccounts(items, sessionId),
      pinOrderSource(items, this.sessions.list.getSnapshot(), { pinnedSessionIds, archivedSessionIds }),
    )
  }

  async unpinSession(sessionId: SessionId): Promise<void> {
    await this.workspaces.unpinSession(sessionId)
  }

  async pickDirectory(): Promise<string | null> {
    const result = await this.directoryPicker.pick()
    if (!result.ok) throw new Error(`directory picker failed: ${result.error.message}`)
    return result.value
  }

  async listDirectory(path?: string, signal?: AbortSignal): Promise<DirectoryListing> {
    const result = await this.directoryPicker.list(path, signal)
    if (!result.ok) throw new DirectoryBrowseError(result.error)
    return result.value
  }

  async createDirectory(path: string, name: string): Promise<string> {
    const result = await this.directoryPicker.createDirectory(path, name)
    if (!result.ok) throw new DirectoryBrowseError(result.error)
    return result.value
  }

  private watchNavigation(): () => void {
    let initial: 'waiting' | 'connecting' | 'done' = 'waiting'
    const reconcile = (): void => {
      if (this.lifetime.signal.aborted) return
      if (this.clearUnavailableCurrent()) return
      if (initial !== 'waiting') return
      const workspace = this.workspaces.list.getSnapshot()
      const sessions = this.sessions.list.getSnapshot()
      if (workspace.phase !== 'ready' || sessions.phase !== 'ready') return
      if (this.mainReference !== undefined) {
        initial = 'done'
        return
      }
      initial = 'connecting'
      try { this.restoreSelection(workspace, sessions); initial = 'done' }
      catch (error: unknown) {
        initial = 'waiting'; console.warn('initial Session restoration failed:', error)
      }
    }

    const disposeWorkspaces = this.workspaces.list.subscribe(reconcile)
    const disposeSessions = this.sessions.list.subscribe(reconcile)
    reconcile()
    return () => {
      this.lifetime.abort()
      disposeSessions()
      disposeWorkspaces()
    }
  }

  private restoreSelection(workspaces: WorkspaceSnapshot, sessions: SessionListState): void {
    const saved = this.selection.getSnapshot()
    if (saved.subagentAddress !== undefined) {
      this.replaceMain(saved.subagentAddress, this.lifetime.signal, 'preserve')
      return
    }
    const summary = saved.sessionId === undefined ? undefined : sessions.byId[saved.sessionId]
    if (summary !== undefined && !workspaces.archivedSessionIds.includes(summary.id)) {
      this.replaceMain(summary.id, this.lifetime.signal, 'preserve')
      return
    }
    const navigation = AbortSignal.any([this.ctx.layout.beginNavigation(), this.lifetime.signal])
    this.showDraft({}, navigation, 'preserve')
  }

  /** @returns true when an archived or deleted current selection was cleared. */
  private clearUnavailableCurrent(): boolean {
    const current = this.mainReference?.sessionId
    if (current === undefined || this.draft) return false
    const list = this.sessions.list.getSnapshot()
    const removed = list.phase === 'ready' && list.byId[current] === undefined
      && this.sessions.subagentAddress(current) === undefined
    if (!removed && !this.workspaces.list.getSnapshot().archivedSessionIds.includes(current)) return false
    this.clearMain()
    return true
  }

  private clearMain(): void {
    const previous = this.mainReference
    this.draft?.dispose(); this.draft = undefined
    this.mainReference = undefined
    this.selection.set({})
    previous?.release()
    this.ctx.layout.selectPanel(null)
  }

  private replaceMain(
    target: SessionTarget,
    signal: AbortSignal,
    panel: 'reveal' | 'preserve',
    beforeOpen?: (sessionId: SessionId) => void,
  ): boolean {
    signal.throwIfAborted()
    const reference = this.sessions.retain(target, { source: 'mainView' })
    try {
      signal.throwIfAborted()
      beforeOpen?.(reference.sessionId)
      if (signal.aborted) {
        reference.release()
        return false
      }
      const subagentAddress = typeof target === 'string' || 'kind' in target
        ? this.sessions.subagentAddress(reference.sessionId)
        : target
      this.selection.set(typeof target !== 'string' && 'kind' in target && target.kind === 'external' ? {} : {
        sessionId: reference.sessionId,
        ...(subagentAddress === undefined ? {} : { subagentAddress }),
      })
    } catch (error: unknown) {
      reference.release()
      throw error
    }
    const previous = this.mainReference
    this.draft?.dispose(); this.draft = undefined
    this.mainReference = reference
    previous?.release()
    if (panel === 'reveal') this.ctx.layout.selectPanel(null)
    return true
  }

}

/**
 * `error` as the Session Controller's creation failure, or undefined when it
 * is not one. Client plugin bundles do not share error-class identity, so the
 * name decides.
 */
function sessionCreateErrorOf(error: unknown): SessionCreateError | undefined {
  return error instanceof Error && error.name === 'SessionCreateError' ? error as SessionCreateError : undefined
}

/** Stable tie-breaking follows Host Workspace order. */
export { UiWorkspaceService }
