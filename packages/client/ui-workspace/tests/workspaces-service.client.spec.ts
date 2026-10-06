import { createConversationDraft } from '../../../api/session-controller/src/client/sessions/conversation-draft.ts'
import { Context, Service } from '@deepseek-ai/cordis'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  ISessions, SessionFace, SessionListState, SessionReference, SessionSummary,
} from '@deepseek-ai/dsh-api-session-controller/client'
import { MutableSessionEventSource, SessionCreateError } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SubagentAddress } from '@deepseek-ai/dsh-subagent/client'
import type {
  IWorkspaces, WorkspaceId, WorkspaceSnapshot, WorkspaceView,
} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { ClientRemote, DirectoryListing } from '@deepseek-ai/dsh-api-remotes/client'
import { RemoteError, TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import type { RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import type { ProjectId, BotId } from '@deepseek-ai/dsh-personal-project/types'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { LayoutController } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import { DirectoryBrowseError, UiWorkspaceService } from '../src/client/navigation.ts'
import { createWorkspaceViewStore, FLAT_SESSION_ORDER_KEY } from '../src/client/stores.ts'
import { UNGROUPED_KEY } from '../src/client/tree.ts'

const sid = (id: string): SessionId => SessionId(id)
const wid = (id: string): WorkspaceId => id as WorkspaceId

const contexts: Context[] = []

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function persistSelection(selection: {
  readonly sessionId?: SessionId
  readonly subagentAddress?: SubagentAddress
}): Map<string, string> {
  const backing = new Map([['dsh.sessions.current', JSON.stringify(selection)]])
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => backing.get(key) ?? null,
    setItem: (key: string, value: string) => { backing.set(key, value) },
    removeItem: (key: string) => { backing.delete(key) },
  })
  return backing
}

function workspace(
  id: string,
  sessionIds: readonly SessionId[] = [],
  createdAt = '2026-01-01T00:00:00.000Z',
): WorkspaceView {
  return {
    workspaceId: wid(id),
    path: `/w/${id}`,
    title: id,
    sessionIds,
    createdAt,
    updatedAt: createdAt,
  }
}

function summary(id: string, overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: sid(id),
    displayTitle: id,
    running: false,
    blank: false,
    updatedAt: 0,
    ...overrides,
    retainedBy: overrides.retainedBy ?? {},
  }
}

function sessionState(
  summaries: readonly SessionSummary[] = [],
  phase: SessionListState['phase'] = 'ready',
): SessionListState {
  return {
    ids: summaries.map(item => item.id),
    byId: Object.fromEntries(summaries.map(item => [item.id, item])),
    phase,
    projectionsBySession: {},
  }
}

function workspaceState(
  items: WorkspaceSnapshot['items'] = [],
  archivedSessionIds: readonly SessionId[] = [],
  phase: WorkspaceSnapshot['phase'] = 'ready',
): WorkspaceSnapshot {
  return {
    items,
    archivedSessionIds,
    pinnedSessionIds: [],
    phase,
    state: phase === 'ready' ? 'idle' : 'loading',
    error: null,
  }
}

class MutableSource<T> {
  private readonly listeners = new Set<() => void>()

  constructor(private value: T) {}

  getSnapshot(): T {
    return this.value
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  set(value: T): void {
    this.value = value
    for (const listener of [...this.listeners]) listener()
  }

  update(update: (value: T) => T): void {
    this.set(update(this.value))
  }

  listenersSnapshot(): readonly (() => void)[] {
    return [...this.listeners]
  }
}

interface RetainedSession {
  readonly reference: SessionReference
  readonly release: ReturnType<typeof vi.fn<() => void>>
}

class FakeSessions implements ISessions {
  createDraft: ISessions['createDraft'] = createConversationDraft
  createEventSource(): MutableSessionEventSource { return new MutableSessionEventSource() }
  readonly list: MutableSource<SessionListState>
  readonly create: ReturnType<typeof vi.fn<ISessions['create']>>
  readonly fork = vi.fn<ISessions['fork']>(async () => sid('forked'))
  readonly retained: RetainedSession[] = []
  readonly command = vi.fn<SessionFace['command']>(async () => ({ ok: true, value: { matched: true } }))
  readonly prompt = vi.fn<SessionFace['prompt']>(async () => ({ ok: true, value: { accepted: true } }))
  readonly refreshProjections = vi.fn<ISessions['refreshProjections']>(() => Promise.resolve())
  readonly retain = vi.fn<ISessions['retain']>((target) => {
    const release = vi.fn<() => void>()
    const sessionId = typeof target === 'string' ? target : 'kind' in target ? target.kind === 'external' ? target.session.sessionId : target.sessionId : target.childSessionId
    const binding = { sessionId, session: typeof target !== 'string' && 'kind' in target && target.kind === 'external' ? target.session
      : { prompt: this.prompt, command: this.command } } as SessionReference['binding']
    const reference: SessionReference = {
      sessionId,
      binding,
      ready: Promise.resolve(binding),
      release,
      [Symbol.dispose]: release,
    }
    this.retained.push({ reference, release })
    return reference
  })
  readonly subagentAddress = vi.fn<ISessions['subagentAddress']>()
  declare readonly using: ISessions['using']
  declare readonly retainInfo: ISessions['retainInfo']
  declare readonly searchResultLimit: ISessions['searchResultLimit']
  declare readonly refresh: ISessions['refresh']
  declare readonly search: ISessions['search']
  declare readonly scope: ISessions['scope']
  declare readonly scopeOf: ISessions['scopeOf']
  declare readonly sessionOf: ISessions['sessionOf']
  declare readonly binding: ISessions['binding']

  constructor(initial: SessionListState) {
    this.list = new MutableSource(initial)
    this.create = vi.fn<ISessions['create']>(async options =>
      options?.sessionId ?? sid(`created-${options?.cwd?.split('/').at(-1) ?? 'none'}`))
  }
}

class FakeWorkspaces implements IWorkspaces {
  readonly initializeDefault = vi.fn<IWorkspaces['initializeDefault']>(async () => undefined)
  readonly list: MutableSource<WorkspaceSnapshot>
  readonly archiveCalls: SessionId[] = []
  readonly unarchiveCalls: SessionId[] = []
  onArchive: IWorkspaces['archiveSession'] = async (sessionId) => {
    this.list.update(state => ({
      ...state,
      archivedSessionIds: [...state.archivedSessionIds, sessionId],
    }))
  }

  onUnarchive: IWorkspaces['unarchiveSession'] = async (sessionId) => {
    this.list.update(state => ({
      ...state,
      archivedSessionIds: state.archivedSessionIds.filter(id => id !== sessionId),
    }))
  }

  declare readonly create: IWorkspaces['create']
  declare readonly rename: IWorkspaces['rename']
  declare readonly delete: IWorkspaces['delete']
  declare readonly insertBefore: IWorkspaces['insertBefore']
  declare readonly insertSessionBefore: IWorkspaces['insertSessionBefore']
  readonly pinCalls: SessionId[] = []
  readonly unpinCalls: SessionId[] = []
  onPin: IWorkspaces['pinSession'] = async (sessionId) => {
    this.list.update(state => ({
      ...state,
      pinnedSessionIds: [sessionId, ...state.pinnedSessionIds.filter(id => id !== sessionId)],
    }))
  }

  constructor(initial: WorkspaceSnapshot) {
    this.list = new MutableSource(initial)
  }

  archiveSession(sessionId: SessionId): Promise<void> {
    this.archiveCalls.push(sessionId)
    return this.onArchive(sessionId)
  }

  unarchiveSession(sessionId: SessionId): Promise<void> {
    this.unarchiveCalls.push(sessionId)
    return this.onUnarchive(sessionId)
  }

  pinSession(sessionId: SessionId): Promise<void> {
    this.pinCalls.push(sessionId)
    return this.onPin(sessionId)
  }

  async unpinSession(sessionId: SessionId): Promise<void> {
    this.unpinCalls.push(sessionId)
    this.list.update(state => ({
      ...state,
      pinnedSessionIds: state.pinnedSessionIds.filter(id => id !== sessionId),
    }))
  }
}

const listing: DirectoryListing = {
  path: '/home/u',
  home: '/home/u',
  crumbs: [{ name: '/', path: '/', hidden: false }],
  entries: [{ name: 'project', path: '/home/u/project', hidden: false }],
  truncated: false,
}

/** The directory-picking Remote namespace, recorded and scripted per case. */
class FakeDirectoryPicker {
  readonly calls: { method: string; payload: unknown }[] = []

  onPick: () => Promise<RemoteResult<string | null>> = () => Promise.resolve({ ok: true, value: null })
  onList: () => Promise<RemoteResult<DirectoryListing>> = () => Promise.resolve({ ok: true, value: listing })
  onCreateDirectory: () => Promise<RemoteResult<string>> =
    () => Promise.resolve({ ok: true, value: '/home/u/new' })

  readonly remote: ClientRemote['directoryPicker'] = {
    pick: () => this.record('pick', {}, this.onPick()),
    list: (path?: string) => this.record('list', { path }, this.onList()),
    createDirectory: (path: string, name: string) =>
      this.record('createDirectory', { path, name }, this.onCreateDirectory()),
  }

  callsOf(method: string): unknown[] {
    return this.calls.filter(call => call.method === method).map(call => call.payload)
  }

  private record<T>(method: string, payload: unknown, result: Promise<T>): Promise<T> {
    this.calls.push({ method, payload })
    return result
  }
}

interface BenchOptions {
  readonly language?: string
  readonly configureWorkspaces?: (workspaces: FakeWorkspaces) => void
  readonly workspaces?: WorkspaceSnapshot
  readonly sessions?: SessionListState
  readonly configureSessions?: (sessions: FakeSessions) => void
}

function bench(options: BenchOptions = {}) {
  const ctx = new Context()
  contexts.push(ctx)
  const locale = new LocaleRuntime(ctx)
  if (options.language === 'fr') locale.addLanguage({ id: 'fr', label: 'Français', fallback: 'en' })
  locale.setLocale(options.language ?? 'en')
  ctx.provide('locale', locale)
  const layout = new LayoutController({
    selectPanel: vi.fn(), retainMainPanels: vi.fn(),
    setSidebar: vi.fn(), toggleSidebar: vi.fn(), setViewportWidth: vi.fn(),
    setRightbar: vi.fn(), openRightbar: vi.fn(), closeRightbar: vi.fn(),
  }, () => true)
  const selectPanel = vi.spyOn(layout, 'selectPanel')
  ctx.provide('layout', layout)
  ctx.effect(() => () => { layout.dispose() })
  const directoryPicker = new FakeDirectoryPicker()
  const workspaces = new FakeWorkspaces(options.workspaces ?? workspaceState([], [], 'pending'))
  const sessions = new FakeSessions(options.sessions ?? sessionState([], 'pending'))
  options.configureWorkspaces?.(workspaces)
  options.configureSessions?.(sessions)
  const view = createWorkspaceViewStore().create()
  const uiWorkspace = new UiWorkspaceService(
    ctx,
    directoryPicker.remote,
    workspaces,
    sessions,
    view.actions,
  )
  return { ctx, directoryPicker, sessions, uiWorkspace, workspaces, layout, selectPanel, view }
}

describe('UiWorkspaceService', () => {
  it('routes new conversations through the active identity consumer and restores the personal draft on disposal', async () => {
    const b = bench()
    const start = vi.fn(() => true)
    const show = vi.fn(() => true)
    const off = b.uiWorkspace.registerSessionStarter(start, show)
    b.uiWorkspace.startSession()
    expect(start).toHaveBeenCalledOnce()
    expect(b.sessions.create).not.toHaveBeenCalled()
    b.uiWorkspace.showConversation()
    expect(show).toHaveBeenCalledOnce()
    off()
    b.uiWorkspace.showConversation()
    expect(b.selectPanel).toHaveBeenCalledWith(null)
    b.uiWorkspace.startSession()
    expect(b.sessions.create).not.toHaveBeenCalled()
    expect(b.sessions.retain).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'external' }), { source: 'mainView' })
  })

  it('waits for both startup catalogs and retains one unsaved composer across later updates', () => {
    for (const first of ['sessions', 'workspaces'] as const) {
      const b = bench()
      const sessions = sessionState([summary('history')])
      const workspaces = workspaceState([workspace('a')])
      if (first === 'sessions') b.sessions.list.set(sessions)
      else b.workspaces.list.set(workspaces)
      expect(b.sessions.retain).not.toHaveBeenCalled()
      if (first === 'sessions') b.workspaces.list.set(workspaces)
      else b.sessions.list.set(sessions)
      expect(b.sessions.retain).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ kind: 'external' }), { source: 'mainView' })
      b.sessions.list.set(sessions)
      b.workspaces.list.set(workspaces)
      expect(b.sessions.retain).toHaveBeenCalledOnce()
      expect(b.sessions.create).not.toHaveBeenCalled()
      expect(b.workspaces.initializeDefault).not.toHaveBeenCalled()
    }
  })

  it('materializes personal affiliation only on first submission and keeps the same Session on retry', async () => {
    const backing = persistSelection({})
    const b = bench()
    const affiliation = { projectId: 'project' as ProjectId, botId: 'bot' as BotId }
    for (let index = 0; index < 5; index++) b.uiWorkspace.startPersonalSession(affiliation)
    expect(b.sessions.create).not.toHaveBeenCalled()
    expect(JSON.parse(backing.get('dsh.sessions.current')!)).toEqual({})
    const draft = b.sessions.retained.at(-1)!.reference.binding.session
    await draft.prompt([{ type: 'text', text: '  ' }], 'queue')
    expect(b.sessions.create).not.toHaveBeenCalled()
    b.sessions.prompt.mockResolvedValueOnce({ ok: false, error: { code: 'gateway/internal', message: 'offline', data: {} } })
    await draft.prompt([{ type: 'text', text: 'First input' }], 'queue')
    expect(b.sessions.create).toHaveBeenCalledExactlyOnceWith(affiliation)
    await draft.prompt([{ type: 'text', text: 'Retry input' }], 'queue')
    expect(b.sessions.create).toHaveBeenCalledOnce()
    expect(b.sessions.prompt).toHaveBeenLastCalledWith([{ type: 'text', text: 'Retry input' }], 'queue', undefined, undefined)
    expect(JSON.parse(backing.get('dsh.sessions.current')!)).toEqual({ sessionId: sid('created-none') })
  })

  it('retains an explicit main target before revealing its Conversation', () => {
    const b = bench()
    b.uiWorkspace.openSession(sid('target'))
    expect(b.selectPanel).toHaveBeenCalledWith(null)
    expect(b.sessions.retain).toHaveBeenCalledWith(sid('target'), { source: 'mainView' })
    expect(b.sessions.refreshProjections).not.toHaveBeenCalled()
  })

  it('keeps the current panel when retaining the target fails', () => {
    const b = bench()
    b.sessions.retain.mockImplementationOnce(() => { throw new Error('open failed') })
    expect(() => { b.uiWorkspace.openSession(sid('target')) }).toThrow('open failed')
    expect(b.selectPanel).not.toHaveBeenCalled()
  })

  it('releases the unsaved Workspace composer when preparation throws', async () => {
    const b = bench({ workspaces: workspaceState([workspace('a')]) })
    b.uiWorkspace.openSession(sid('current'))
    const failure = new Error('preparation failed')
    await expect(b.uiWorkspace.openWorkspace(wid('a'), () => { throw failure })).rejects.toBe(failure)
    expect(b.sessions.retained[0]!.release).not.toHaveBeenCalled()
    expect(b.sessions.retained[1]!.release).toHaveBeenCalledOnce()
    expect(b.sessions.create).not.toHaveBeenCalled()
  })

  it('selects the latest Workspace draft without creating either Session', async () => {
    const b = bench({ workspaces: workspaceState([workspace('a'), workspace('b')]) })
    const prepareA = vi.fn(), prepareB = vi.fn()
    await b.uiWorkspace.openWorkspace(wid('a'), prepareA)
    await b.uiWorkspace.openWorkspace(wid('b'), prepareB)
    expect(b.sessions.create).not.toHaveBeenCalled()
    expect(prepareA).toHaveBeenCalledWith(b.sessions.retained[0]!.reference.sessionId)
    expect(prepareB).toHaveBeenCalledWith(b.sessions.retained[1]!.reference.sessionId)
    expect(b.sessions.retained[0]!.release).toHaveBeenCalledOnce()
    await b.sessions.retained[1]!.reference.binding.session.prompt([{ type: 'text', text: 'In workspace B' }], 'queue')
    expect(b.sessions.create).toHaveBeenCalledExactlyOnceWith({ cwd: '/w/b' })
  })

  it('does not commit a Workspace send after another Session navigation', async () => {
    const b = bench({ workspaces: workspaceState([workspace('a')]) })
    const created = Promise.withResolvers<SessionId>()
    b.sessions.create.mockReturnValueOnce(created.promise)
    await b.uiWorkspace.openWorkspace(wid('a'))
    const draft = b.sessions.retained[0]!.reference.binding.session
    const sending = draft.prompt([{ type: 'text', text: 'Submitted' }], 'queue')
    b.uiWorkspace.openSession(sid('chosen'))
    created.resolve(sid('late'))
    await expect(sending).rejects.toThrow('superseded')
    expect(b.sessions.prompt).not.toHaveBeenCalled()
    expect(b.sessions.retain).toHaveBeenLastCalledWith(sid('chosen'), { source: 'mainView' })
  })

  it('rejects sending a disposed Workspace draft', async () => {
    const b = bench({ workspaces: workspaceState([workspace('a')]) })
    await b.uiWorkspace.openWorkspace(wid('a'))
    const draft = b.sessions.retained[0]!.reference.binding.session
    await b.ctx.fiber.dispose()
    await expect(draft.prompt([{ type: 'text', text: 'Unsent' }], 'queue')).rejects.toThrow('superseded')
    expect(b.sessions.create).not.toHaveBeenCalled()
  })

  it('ignores stale startup catalog callbacks after disposal', async () => {
    const b = bench({ workspaces: workspaceState([workspace('a')]), sessions: sessionState([], 'pending') })
    const staleReconcile = b.sessions.list.listenersSnapshot()[0]!
    await b.ctx.fiber.dispose()
    b.sessions.list.set(sessionState())
    staleReconcile()
    expect(b.sessions.retain).not.toHaveBeenCalled()
    expect(b.sessions.create).not.toHaveBeenCalled()
  })

  it('does not run startup selection after a main Session was chosen while catalogs loaded', () => {
    const b = bench()
    b.uiWorkspace.openSession(sid('chosen'))

    b.workspaces.list.set(workspaceState([workspace('a')]))
    b.sessions.list.set(sessionState())

    expect(b.sessions.retain).toHaveBeenCalledExactlyOnceWith(sid('chosen'), { source: 'mainView' })
    expect(b.sessions.create).not.toHaveBeenCalled()
  })

  it('forks with title increment without selecting or retaining the child, and rejects failure', async () => {
    const b = bench()
    b.uiWorkspace.openSession(sid('source'))
    b.sessions.retain.mockClear()
    b.selectPanel.mockClear()
    await b.uiWorkspace.forkSession(sid('source'))
    expect(b.sessions.fork).toHaveBeenCalledWith({ sessionId: sid('source'), increaseTitle: true })
    expect(b.sessions.retain).not.toHaveBeenCalled()
    b.sessions.fork.mockRejectedValueOnce(new Error('fork failed'))
    await expect(b.uiWorkspace.forkSession(sid('source'))).rejects.toThrow('fork failed')
    expect(b.sessions.retain).not.toHaveBeenCalled()
    expect(b.selectPanel).not.toHaveBeenCalled()
    expect(b.sessions.retained[0]!.release).not.toHaveBeenCalled()
  })

  it('keeps the Workspace draft selected when a sidebar fork completes', async () => {
    const b = bench({ workspaces: workspaceState([workspace('a')]) })
    await b.uiWorkspace.openWorkspace(wid('a'))
    const reference = b.sessions.retained[0]!
    await b.uiWorkspace.forkSession(sid('source'))
    expect(b.sessions.create).not.toHaveBeenCalled()
    expect(b.sessions.retain).toHaveBeenCalledOnce()
    expect(reference.release).not.toHaveBeenCalled()
  })

  it('pins on the Host, then leads the Session in its group and flat saved orders; unpin leaves them', async () => {
    const b = bench({
      workspaces: workspaceState([workspace(wid('a'), [sid('one'), sid('two'), sid('three')])]),
      sessions: sessionState([summary('one', { updatedAt: 3 }), summary('two', { updatedAt: 2 }), summary('three', { updatedAt: 1 })]),
    })
    b.view.actions.setSessionOrder('a', ['one', 'two', 'three'], {})
    await b.uiWorkspace.pinSession(sid('three'))
    expect(b.workspaces.pinCalls).toEqual([sid('three')])
    expect(b.view.getSnapshot().sessionOrderByAccount).toMatchObject({
      a: ['three', 'one', 'two'],
      [FLAT_SESSION_ORDER_KEY]: ['three', 'one', 'two'],
    })
    // Unpin is a Host fact only: the saved positions do not move.
    await b.uiWorkspace.unpinSession(sid('three'))
    expect(b.workspaces.unpinCalls).toEqual([sid('three')])
    expect(b.view.getSnapshot().sessionOrderByAccount.a).toEqual(['three', 'one', 'two'])
    // A rejected pin writes no order.
    b.workspaces.onPin = async () => { throw new Error('pin failed') }
    await expect(b.uiWorkspace.pinSession(sid('one'))).rejects.toThrow('pin failed')
    expect(b.view.getSnapshot().sessionOrderByAccount.a).toEqual(['three', 'one', 'two'])
  })

  it('keeps newer saved orders when a pending pin completes', async () => {
    const b = bench({
      workspaces: workspaceState([workspace('a', [sid('one'), sid('two'), sid('three')])]),
      sessions: sessionState([summary('one', { updatedAt: 3 }), summary('two', { updatedAt: 2 }), summary('three', { updatedAt: 1 })]),
    })
    const pending = Promise.withResolvers<undefined>()
    const hostPin = b.workspaces.onPin
    b.workspaces.onPin = async (sessionId) => { await pending.promise; await hostPin(sessionId) }
    const pin = b.uiWorkspace.pinSession(sid('three'))
    b.view.actions.setSessionOrder('a', ['two', 'one', 'three'], {})
    b.view.actions.setSessionOrder(FLAT_SESSION_ORDER_KEY, ['two', 'one', 'three'], {})
    pending.resolve(undefined)
    await pin
    expect(b.view.getSnapshot().sessionOrderByAccount).toMatchObject({
      a: ['three', 'two', 'one'],
      [FLAT_SESSION_ORDER_KEY]: ['three', 'two', 'one'],
    })
  })

  it('uses the membership current at completion when a Workspace disappears during a pending pin', async () => {
    const b = bench({
      workspaces: workspaceState([workspace('a', [sid('one'), sid('two')])]),
      sessions: sessionState([summary('one', { updatedAt: 2 }), summary('two', { updatedAt: 1 })]),
    })
    const pending = Promise.withResolvers<undefined>()
    const hostPin = b.workspaces.onPin
    b.workspaces.onPin = async (sessionId) => { await pending.promise; await hostPin(sessionId) }
    const pin = b.uiWorkspace.pinSession(sid('two'))
    b.workspaces.list.update(state => ({ ...state, items: [] }))
    pending.resolve(undefined)
    await pin
    expect(b.view.getSnapshot().sessionOrderByAccount).not.toHaveProperty('a')
    expect(b.view.getSnapshot().sessionOrderByAccount).toMatchObject({
      [UNGROUPED_KEY]: ['two', 'one'],
      [FLAT_SESSION_ORDER_KEY]: ['two', 'one'],
    })
  })

  it('keeps saved Workspace members whose summaries are temporarily missing when pinning in Last updated', async () => {
    const b = bench({
      workspaces: workspaceState([workspace('a', [sid('one'), sid('two'), sid('three')])]),
      sessions: sessionState([summary('one', { updatedAt: 3 }), summary('two', { updatedAt: 2 }), summary('three', { updatedAt: 1 })]),
    })
    await b.uiWorkspace.pinSession(sid('one'))
    expect(b.view.getSnapshot().sessionOrderByAccount.a).toEqual(['one', 'two', 'three'])
    b.sessions.list.set(sessionState([summary('one', { updatedAt: 3 }), summary('three', { updatedAt: 1 })]))
    await b.uiWorkspace.pinSession(sid('three'))
    expect(b.view.getSnapshot().orderBy).toBe('updated')
    expect(b.view.getSnapshot().sessionOrderByAccount.a).toEqual(['three', 'one', 'two'])
  })

  it('reuses only an unarchived member blank and coalesces concurrent creation', async () => {
    const b = bench({
      sessions: sessionState([
        summary('stray', { blank: true, cwd: '/w/a' }),
        summary('blank', { blank: true, cwd: '/w/a' }),
        summary('archived', { blank: true, cwd: '/w/b' }),
      ], 'pending'),
      workspaces: workspaceState([workspace('a', [sid('blank')]), workspace('b', [sid('archived')])], [sid('archived')]),
    })
    await expect(b.uiWorkspace.connectWorkspace(wid('a'))).resolves.toBe(sid('blank'))
    expect(b.sessions.create).toHaveBeenCalledExactlyOnceWith({ cwd: '/w/a', sessionId: sid('blank') })
    b.sessions.create.mockClear()
    b.sessions.retain.mockClear()
    const created = Promise.withResolvers<SessionId>()
    b.sessions.create.mockReturnValue(created.promise)
    const first = b.uiWorkspace.connectWorkspace(wid('b'))
    const second = b.uiWorkspace.connectWorkspace(wid('b'))
    expect(b.sessions.create).toHaveBeenCalledOnce()
    created.resolve(sid('new'))
    await expect(Promise.all([first, second])).resolves.toEqual([sid('new'), sid('new')])
    await expect(b.uiWorkspace.connectWorkspace(wid('missing'))).rejects.toThrow('unknown workspace')
    expect(b.sessions.retain).not.toHaveBeenCalled()
  })

  it('keeps the composer after a refused first send and creates only when retried', async () => {
    const b = bench({ workspaces: workspaceState([workspace('a')]) })
    await b.uiWorkspace.openWorkspace(wid('a'))
    const draft = b.sessions.retained[0]!.reference.binding.session
    b.sessions.create.mockRejectedValueOnce(new Error('create failed'))
    await expect(draft.prompt([{ type: 'text', text: 'First send' }], 'queue')).rejects.toThrow('create failed')
    expect(b.sessions.retained[0]!.release).not.toHaveBeenCalled()
    await draft.prompt([{ type: 'text', text: 'Retry' }], 'queue')
    expect(b.sessions.create.mock.calls).toEqual([[{ cwd: '/w/a' }], [{ cwd: '/w/a' }]])
    expect(b.sessions.prompt).toHaveBeenCalledOnce()
  })

  it('shows an unsaved composer unless an explicit directory target was requested', async () => {
    const b = bench({
      sessions: sessionState([summary('current', { cwd: '/w/a' })]),
      workspaces: workspaceState([workspace('a', [sid('current')])]),
    })
    b.uiWorkspace.startSession(wid('a'))
    await vi.waitFor(() => {
      expect(b.sessions.retain).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'external' }), { source: 'mainView' })
    })
    b.uiWorkspace.startSession()
    await vi.waitFor(() => {
      expect(b.sessions.retain).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'external' }), { source: 'mainView' })
    })
    expect(b.sessions.create).not.toHaveBeenCalled()
  })

  it('releases a prepared Workspace draft when preparation selects another Session', async () => {
    const b = bench({ workspaces: workspaceState([workspace('a')]) })
    await b.uiWorkspace.openWorkspace(wid('a'), () => { b.uiWorkspace.openSession(sid('override')) })
    expect(b.sessions.retained[0]!.release).toHaveBeenCalledOnce()
    expect(b.sessions.retained[1]!.release).not.toHaveBeenCalled()
    expect(b.sessions.create).not.toHaveBeenCalled()
  })

  it('uses catalog order for Workspace connects without reading the saved selection', async () => {
    persistSelection({ sessionId: sid('saved') })
    const b = bench({
      sessions: sessionState([
        summary('first', { blank: true, cwd: '/w/a' }),
        summary('saved', { blank: true, cwd: '/w/a' }),
      ], 'pending'),
      workspaces: workspaceState([workspace('a', [sid('first'), sid('saved')])]),
    })
    await expect(b.uiWorkspace.connectWorkspace(wid('a'))).resolves.toBe(sid('first'))
  })

  it('shows an unsaved composer when the saved Session is archived', () => {
    persistSelection({ sessionId: sid('saved') })
    const b = bench({ sessions: sessionState([summary('saved', { blank: true, cwd: '/w/a' })]),
      workspaces: workspaceState([workspace('a', [sid('saved')])], [sid('saved')]) })
    expect(b.sessions.retain).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ kind: 'external' }), { source: 'mainView' })
    expect(b.sessions.create).not.toHaveBeenCalled()
  })

  it('restores the saved Workspace blank without creating or acquiring another Session', () => {
    persistSelection({ sessionId: sid('saved') })
    const b = bench({ sessions: sessionState([summary('other', { blank: true }), summary('saved', { blank: true })]),
      workspaces: workspaceState([workspace('a', [sid('other'), sid('saved')])]) })
    expect(b.sessions.retain).toHaveBeenCalledExactlyOnceWith(sid('saved'), { source: 'mainView' })
    b.sessions.list.set(b.sessions.list.getSnapshot())
    expect(b.sessions.retain).toHaveBeenCalledOnce()
    expect(b.sessions.create).not.toHaveBeenCalled()
  })

  it('creates after the first Workspace blank is held without trying another blank', async () => {
    const b = bench({
      sessions: sessionState([
        summary('held', { blank: true, cwd: '/w/a' }),
        summary('free', { blank: true, cwd: '/w/a' }),
      ], 'pending'),
      workspaces: workspaceState([workspace('a', [sid('held'), sid('free')])]),
      configureSessions: (sessions) => {
        sessions.create.mockRejectedValueOnce(new SessionCreateError(
          new RemoteError('session/writer-held', 'held', { sessionId: sid('held') }), sid('held'),
        ))
      },
    })
    await expect(b.uiWorkspace.connectWorkspace(wid('a'))).resolves.toBe(sid('created-a'))
    expect(b.sessions.create.mock.calls).toEqual([
      [{ cwd: '/w/a', sessionId: sid('held') }],
      [{ cwd: '/w/a' }],
    ])
  })

  it.each(['workspace', 'panel'])('preserves a later %s navigation after restoring saved history', async (target) => {
    persistSelection({ sessionId: sid('saved') })
    const b = bench({ sessions: sessionState([summary('saved', { blank: true, cwd: '/w/a' })]),
      workspaces: workspaceState([workspace('a', [sid('saved')]), workspace('b')]) })
    if (target === 'workspace') {
      await b.uiWorkspace.openWorkspace(wid('b'))
      expect(b.sessions.retained[0]!.release).toHaveBeenCalledOnce()
    } else b.layout.selectPanel('other-panel' as MainPanelId)
    expect(b.sessions.create).not.toHaveBeenCalled()
  })

  it.each([
    new Error('filesystem denied'),
    'failed transport',
    new SessionCreateError(new RemoteError('gateway/internal', 'read failed', {}), sid('blank')),
  ])('does not replace a blank after a non-contention failure: %s', async (error) => {
    const b = bench({
      sessions: sessionState([summary('blank', { blank: true, cwd: '/w/a' })], 'pending'),
      workspaces: workspaceState([workspace('a', [sid('blank')])]),
      configureSessions: (sessions) => { sessions.create.mockRejectedValue(error) },
    })
    await expect(b.uiWorkspace.connectWorkspace(wid('a'))).rejects.toBe(error)
    expect(b.sessions.create).toHaveBeenCalledOnce()
    expect(b.sessions.retain).not.toHaveBeenCalled()
  })

  it('keeps a chosen panel when the saved target becomes discoverable', () => {
    const saved = sid('saved')
    persistSelection({ sessionId: saved })
    const b = bench({ workspaces: workspaceState(), sessions: sessionState([], 'pending') })
    const panel = 'other-panel' as MainPanelId
    b.layout.selectPanel(panel)
    b.sessions.list.set(sessionState([summary('saved')]))
    expect(b.sessions.retained[0]!.reference.sessionId).toBe(saved)
    expect(b.selectPanel.mock.calls).toEqual([[panel]])
  })

  it('restores a persisted subagent address without a parent catalog', () => {
    const address: SubagentAddress = {
      parentSessionId: sid('parent'),
      childSessionId: sid('child'),
      mode: 'continuable',
    }
    persistSelection({ sessionId: address.childSessionId, subagentAddress: address })

    const b = bench({
      workspaces: workspaceState(),
      sessions: sessionState(),
    })

    expect(b.sessions.retain).toHaveBeenCalledExactlyOnceWith(address, { source: 'mainView' })
    expect(b.sessions.refreshProjections).not.toHaveBeenCalled()
  })

  it('persists a catalog-resolved address after string subagent navigation', () => {
    const address: SubagentAddress = {
      parentSessionId: sid('parent'),
      childSessionId: sid('child'),
      mode: 'continuable',
    }
    const backing = persistSelection({})
    const b = bench({
      configureSessions: (sessions) => { sessions.subagentAddress.mockReturnValue(address) },
    })

    b.uiWorkspace.openSession(address.childSessionId)

    expect(JSON.parse(backing.get('dsh.sessions.current')!)).toEqual({
      sessionId: address.childSessionId,
      subagentAddress: address,
    })
  })

  it('reports and retries a failed persisted Session restoration', async () => {
    const failure = new Error('restore failed')
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const sessions = sessionState([summary('saved')])
    persistSelection({ sessionId: sid('saved') })
    const b = bench({
      workspaces: workspaceState(),
      sessions,
      configureSessions: (face) => {
        face.retain.mockImplementationOnce(() => { throw failure })
      },
    })

    await vi.waitFor(() => {
      expect(warning).toHaveBeenCalledWith('initial Session restoration failed:', failure)
    })
    b.sessions.list.set(sessions)

    expect(b.sessions.retain).toHaveBeenCalledTimes(2)
    expect(b.sessions.retained).toHaveLength(1)
    expect(b.sessions.retained[0]!.reference.sessionId).toBe(sid('saved'))
  })

  it('releases the main conversation when deletion removes it from the catalog', () => {
    const b = bench()
    b.sessions.list.set(sessionState([summary('current')]))
    b.uiWorkspace.openSession(sid('current'))
    b.sessions.list.set(sessionState([]))
    expect(b.sessions.retained[0]!.release).toHaveBeenCalledOnce()
    expect(b.selectPanel).toHaveBeenCalledTimes(2)
  })

  it('clears a selected Session when an external archive snapshot arrives', () => {
    const b = bench()
    b.uiWorkspace.openSession(sid('current'))

    b.workspaces.list.set(workspaceState([], [sid('current')]))

    expect(b.sessions.retained[0]!.release).toHaveBeenCalledOnce()
    expect(b.selectPanel).toHaveBeenCalledTimes(2)
  })

  it('clears a selected Session after archiving it without an intervening snapshot', async () => {
    const b = bench()
    b.workspaces.onArchive = async () => {}
    b.uiWorkspace.openSession(sid('current'))

    await b.uiWorkspace.archiveSession(sid('current'))

    expect(b.sessions.retained[0]!.release).toHaveBeenCalledOnce()
    expect(b.selectPanel).toHaveBeenCalledTimes(2)
  })

  it('forwards archive commands and preserves failures', async () => {
    const idle = sid('idle')
    const b = bench()

    await b.uiWorkspace.archiveSession(idle)
    expect(b.workspaces.archiveCalls).toEqual([idle])

    b.workspaces.onArchive = () => Promise.reject(new Error('archive rejected'))
    await expect(b.uiWorkspace.archiveSession(idle)).rejects.toThrow('archive rejected')
    expect(b.workspaces.archiveCalls).toEqual([idle, idle])
  })

  it('forwards unarchive commands and preserves failures', async () => {
    const idle = sid('idle')
    const b = bench()

    await b.uiWorkspace.unarchiveSession(idle)
    expect(b.workspaces.unarchiveCalls).toEqual([idle])

    b.workspaces.onUnarchive = () => Promise.reject(new Error('unarchive rejected'))
    await expect(b.uiWorkspace.unarchiveSession(idle)).rejects.toThrow('unarchive rejected')
    expect(b.workspaces.unarchiveCalls).toEqual([idle, idle])
  })

  it('passes directory operations to the Host and preserves structured browse failures', async () => {
    const b = bench()
    b.directoryPicker.onPick = () => Promise.resolve({ ok: true, value: '/w/alpha' })
    await expect(b.uiWorkspace.pickDirectory()).resolves.toBe('/w/alpha')
    b.directoryPicker.onPick = () => Promise.resolve({ ok: true, value: null })
    await expect(b.uiWorkspace.pickDirectory()).resolves.toBeNull()
    expect(b.directoryPicker.callsOf('pick')).toEqual([{}, {}])

    await expect(b.uiWorkspace.listDirectory()).resolves.toEqual(listing)
    await expect(b.uiWorkspace.listDirectory('/home/u')).resolves.toEqual(listing)
    expect(b.directoryPicker.callsOf('list')).toEqual([{ path: undefined }, { path: '/home/u' }])
    await expect(b.uiWorkspace.createDirectory('/home/u', 'new')).resolves.toBe('/home/u/new')
    expect(b.directoryPicker.callsOf('createDirectory')).toEqual([{ path: '/home/u', name: 'new' }])
    b.directoryPicker.onPick = () => Promise.resolve({
      ok: false, error: new RemoteError('gateway/internal', 'no chooser', {}),
    })
    await expect(b.uiWorkspace.pickDirectory()).rejects.toThrow('directory picker failed: no chooser')
    b.directoryPicker.onList = () => Promise.resolve({
      ok: false, error: new RemoteError('directory-picker/unreadable', 'denied', { path: '/private' }),
    })
    const listFailure = b.uiWorkspace.listDirectory('/private')
    await expect(listFailure).rejects.toBeInstanceOf(DirectoryBrowseError)
    await expect(listFailure).rejects.toMatchObject({ rpcError: { code: 'directory-picker/unreadable' } })
    b.directoryPicker.onCreateDirectory = () => Promise.resolve({
      ok: false, error: new RemoteError('directory-picker/exists', 'taken', { path: '/home/u/new' }),
    })
    await expect(b.uiWorkspace.createDirectory('/home/u', 'new')).rejects.toMatchObject({
      rpcError: { code: 'directory-picker/exists' },
    })
  })
})

it('shows the Host permission default on a new personal draft and applies a local change on first send', async () => {
  const b = bench()
  const catalog = vi.fn(async () => ({ ok: true as const, value: { defaultPreset: 'read-only',
    options: [{ value: 'read-only' }, { value: 'workspace-write' }], defaultOptions: [] } }))
  b.ctx.provide('remote', { permissionPresets: { catalog } })
  b.uiWorkspace.startPersonalSession({})
  const target = b.sessions.retain.mock.calls.at(-1)![0]
  if (typeof target === 'string' || !('kind' in target) || target.kind !== 'external') throw new Error('expected external draft')
  await vi.waitFor(() => { expect(target.session.projections.faceOf('permissions').getSnapshot()).toEqual({ currentValue: 'read-only' }) })
  await target.session.command('/permission workspace-write')
  expect(b.sessions.create).not.toHaveBeenCalled()
  await target.session.prompt([{ type: 'text', text: 'Start' }], 'queue')
  expect(b.sessions.command).toHaveBeenCalledExactlyOnceWith('/permission workspace-write')
  expect(b.sessions.prompt).toHaveBeenCalledOnce()
  await b.ctx.fiber.dispose()
})

it('loads and selects a personal draft model through a caller without the session Remote injection', async () => {
  const b = bench()
  const selected = { provider: 'codex', backend: 'codex', model: 'native', reasoningEffort: 'medium' } as const
  const modelCatalog = vi.fn(async () => ({ ok: true as const, value: {
    default: selected, groups: [], failures: [], routableProviders: ['codex'],
  } }))
  const sessionRemote = { modelCatalog }
  const permissionRemote = { catalog: vi.fn(async () => ({ ok: true as const, value: {
    defaultPreset: 'read-only', options: [], defaultOptions: [],
  } })) }
  const remote = Object.assign(new TestRemote(b.ctx), { session: sessionRemote, permissionPresets: permissionRemote })
  Object.defineProperty(remote, Service.tracker, { value: { property: 'ctx', associate: 'remote' } })
  await b.ctx.plugin((scope: Context) => {
    scope.provide('remote.session', sessionRemote)
    scope.provide('remote.permissionPresets', permissionRemote)
  }).await()
  await b.ctx.plugin({ inject: ['uiWorkspace', 'layout', 'locale', 'remote', 'remote.permissionPresets'], apply: async (scope: Context) => {
    expect(() => scope.remote.session).toThrow('without inject')
    scope.uiWorkspace.startPersonalSession({})
    const target = b.sessions.retain.mock.calls.at(-1)![0]
    if (typeof target === 'string' || !('kind' in target) || target.kind !== 'external') throw new Error('expected draft')
    expect((await target.controls.catalog.load()).default).toEqual(selected)
    expect(await target.controls.selectModel(selected)).toMatchObject({ ok: true, value: { selected } })
    expect(b.sessions.create).not.toHaveBeenCalled()
  } }).await()
  expect(modelCatalog).toHaveBeenCalledOnce()
})
