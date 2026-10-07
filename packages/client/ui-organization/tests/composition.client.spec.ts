// @vitest-environment jsdom
/** Shipped plugin roster registers organization presentation without mounting a page. */
import { expect, vi } from 'vitest'
import { sessionFileAddress } from '@deepseek-ai/dsh-util-workspace-path'
import { ok } from '@deepseek-ai/dsh-remote-mock'
import { createClientTest, webApp } from '@deepseek-ai/dsh-client-test-runtime/src/assembly/index.ts'
import { SESSION_FORMAT_VERSION, type SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionFollowFrame, SessionFollowRequest } from '@deepseek-ai/dsh-api-session-controller/types'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { OrganizationDesktopBridge, OrganizationDesktopSnapshot, ConnectionResult } from '@deepseek-ai/dsh-organization-connection/types'
import type { AccountId, MembershipId, OrganizationId, ServerId } from '@deepseek-ai/dsh-organization/types'
import { OrganizationTaskList, OrganizationTasks } from '../src/client/Tasks.tsx'
import { OrganizationConversationEntry } from '../src/client/ConversationEntry.tsx'
import { ConversationPanel } from '../../ui-conversation/src/client/skeleton/ConversationPanel.tsx'
import { randomUUID } from 'node:crypto'
import { createAssistantMessage, createSystemMessage, MessageId } from '@deepseek-ai/dsh-llm'
import { conversationResultSchema } from '@deepseek-ai/dsh-organization-conversation/protocol'
import type { OrganizationInjected } from '../src/client/contract.ts'
import { createConversationStore } from '../src/client/conversation-store.ts'
import type { BoundActions } from '@deepseek-ai/dsh-client-store'
import { AccountMenu } from '../src/client/AccountMenu.tsx'
import { OrganizationSidebar, OrganizationSettings } from '../src/client/Organization.tsx'
const it = createClientTest({ roster: webApp })
it('registers organization settings while retaining the personal management factory', async ({ mock, start }) => {
  const sessionId = 'organization-composition' as SessionId
  mock.remote.session.create.mockResolvedValue(ok({ sessionId }))
  mock.stream('session/follow', (_request, stream) => {
    stream.push({ type: 'snapshot', header: { version: SESSION_FORMAT_VERSION, id: sessionId, createdAt: 1, isSeeded: false },
      cursor: -1, records: [], hasMore: false, projections: { asOfSeq: -1, values: {} }, assistantStream: { revision: 0 },
    } satisfies SessionFollowFrame)
  })
  const app = await start()
  expect(app.ctx.slots.entries('sidebar.account')[0]?.component).toBe(AccountMenu)
  expect(app.ctx.slots.entries('sidebar.personal')[0]?.component).toBe(OrganizationSidebar)
  expect(app.ctx.slots.entries('settings.section').find(item => item.options.id === 'organization')?.component).toBe(OrganizationSettings)
  expect(app.ctx.slots.entries('main').some(e => e.options.key === 'organization-conversation')).toBe(false)
  const slots = app.ctx.slots
  await app.ctx.fiber.dispose()
  expect(slots.entries('sidebar.personal')).toHaveLength(0)
}, 60000)

it('routes new and recent conversation navigation to the organization and replaces task readers until identity changes', async ({ mock, start }) => {
  mock.remote.permissionPresets.catalog.mockResolvedValue(ok({ defaultPreset: 'workspace-write',
    options: [{ value: 'workspace-write', name: 'workspace-write' }, { value: 'read-only', name: 'read-only' }],
    defaultOptions: [{ value: 'workspace-write', name: 'workspace-write' }] }))
  const sessionId = 'organization-initial-personal' as SessionId
  mock.remote.session.create.mockResolvedValue(ok({ sessionId }))
  const globalObject = globalThis as typeof globalThis & { dshDesktop?: { organization?: OrganizationDesktopBridge } }
  const previous = globalObject.dshDesktop
  const organizationId = brandString<OrganizationId>('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
  const snapshot: OrganizationDesktopSnapshot = { connection: { identityGeneration: 1, mode: 'organization', phase: 'ready', generation: 1, revision: 1,
    principal: { serverId: brandString<ServerId>('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
      accountId: brandString<AccountId>('cccccccc-cccc-4ccc-8ccc-cccccccccccc') }, organizationId,
    organizations: [{ id: organizationId, name: 'Team', version: 1, role: 'admin', membershipId: brandString<MembershipId>('dddddddd-dddd-4ddd-8ddd-dddddddddddd') }], members: [] },
  server: { phase: 'disabled', settings: { host: 'localhost', port: 19487, names: [], restoreOnLaunch: false } } }
  const report = conversationResultSchema.parse({ sessionId: `organization-conversation:${randomUUID()}`, sharedSessionId: `session-${randomUUID()}`, attachmentId: randomUUID(),
    owner: { ...snapshot.connection.principal,
      organizationId, projectId: randomUUID(), conversationId: randomUUID() }, settings: { enabled: true,
      granularity: 'balanced', revision: 0 },
    entries: [{ role: 'assistant', text: 'ACCOUNT_ASSISTANT' }], history: [
      { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } },
      { type: 'step/start', seq: 1, time: 1, data: { turn: 1, step: 1 } },
      { type: 'system/message', seq: 2, time: 1, surfaceOp: 'append', data: { turn: 1, step: 1, message: createSystemMessage('') } },
      { type: 'assistant/message', seq: 3, time: 1, surfaceOp: 'append', data: { turn: 1, step: 1, stream: [],
        message: createAssistantMessage({ source: { provider: 'organization-assignment', model: 'Agent' },
          content: [{ type: 'text', text: 'ACCOUNT_ASSISTANT' }] }) } },
      { type: 'step/end', seq: 4, time: 1, data: { turn: 1, step: 1 } },
      { type: 'turn/end', seq: 5, time: 1, data: { turn: 1, reason: { kind: 'completed' } } }],
    goals: [], truncated: false, state: 'ready' })
  const nativeConversation = vi.fn<OrganizationDesktopBridge['conversation']>(async () => ({ generation: 1, result: report }))
  mock.stream('session/follow', (args, stream) => {
    const request = args[0] as SessionFollowRequest
    const id = request.address.kind === 'session' ? request.address.sessionId : sessionId
    const events = id === report.sharedSessionId ? report.history : []
    stream.push({ type: 'snapshot', header: { version: SESSION_FORMAT_VERSION, id, createdAt: 1, isSeeded: false },
      cursor: events.at(-1)?.seq ?? -1, records: events.map(event => ({ type: 'event' as const, event })), hasMore: false,
      projections: { asOfSeq: events.at(-1)?.seq ?? -1, values: {} }, assistantStream: { revision: 0 },
    } satisfies SessionFollowFrame)
  })
  let publish: ((snapshot: OrganizationDesktopSnapshot) => void) | undefined
  const bridge: OrganizationDesktopBridge = { snapshot: async () => snapshot,
    subscribe: (listener) => { publish = listener; return () => { publish = undefined } },
    conversation: nativeConversation, context: async () => { throw new Error('not-used') },
    execution: async () => { throw new Error('not-used') }, executionReport: async () => { throw new Error('not-used') },
    connection: async () => ({}), server: async () => ({}), secret: async () => 'not-used' }
  globalObject.dshDesktop = { organization: bridge }
  try {
    const app = await start()
    await vi.waitFor(() => { expect(app.ctx.slots.entries('sidebar.tasks')[0]?.component).toBe(OrganizationTaskList) })
    expect(app.ctx.slots.entries('main').filter(e => e.options.key === 'tasks')[0]?.component).toBe(OrganizationTasks)
    mock.remote.session.create.mockClear()
    const selectPanel = vi.spyOn(app.ctx.layout, 'selectPanel')
    app.ctx.uiWorkspace.startSession()
    app.ctx.uiWorkspace.showConversation()
    expect(mock.remote.session.create).not.toHaveBeenCalled()
    expect(selectPanel).toHaveBeenLastCalledWith(null)
    expect(app.ctx.slots.entries('main').filter(e => e.options.key === 'conversation')[0]?.component).toBe(ConversationPanel)
    expect(app.ctx.slots.entries('main.conversation.entry')[0]?.component).toBe(OrganizationConversationEntry)
    expect(app.ctx.uiSession.adapter.current.getSnapshot().key).toMatch(/^conversation-draft:/)
    const permissionDraftId = app.ctx.uiSession.adapter.current.getSnapshot().key as SessionId
    await vi.waitFor(() => { expect(app.ctx.sessions.binding(permissionDraftId)!.session.projections.faceOf('permissions').getSnapshot())
      .toEqual({ currentValue: 'workspace-write' }) })
    const sidebar = app.ctx.slots.entries('sidebar.personal').find(entry => entry.component === OrganizationSidebar)!
    const bind = sidebar.inject as (actions: BoundActions<ReturnType<typeof createConversationStore>>) => OrganizationInjected
    const actions = createConversationStore().create().actions
    const injected = bind(actions)
    const paths = globalThis as typeof globalThis & { __DSH_HOST_PATHS__?: { pathFor(file: File): string } }
    const previousPaths = paths.__DSH_HOST_PATHS__
    const artifactId = brandString<NonNullable<ConnectionResult['delivery']>['artifacts'][number]['id']>(randomUUID()), path = '/tmp/project-facts.md'
    const fileKey = `organization-delivery-file:${snapshot.connection.principal!.serverId}:${snapshot.connection.principal!.accountId}:${organizationId}:${artifactId}`
    paths.__DSH_HOST_PATHS__ = { pathFor: () => path }
    const mounted = vi.spyOn(app.ctx.sidebarRight.mounted, 'getSnapshot').mockReturnValue(report.sharedSessionId)
    const openResource = vi.spyOn(app.ctx.sidebarRight, 'openResource').mockImplementation(() => {})
    mock.remote.workspaceFiles.stat.mockResolvedValue(ok({ absolutePath: path, version: 'v1', bytes: 20 }))
    mock.remote.workspaceFiles.read.mockResolvedValue(ok({ absolutePath: path, version: 'v1', bytes: 20,
      offset: 1, text: '# Result', lines: 1, eof: true }))
    mock.remote.session.openWorkspacePath.mockResolvedValue(ok(null))
    try {
      injected.rememberDeliveryFile!(artifactId, new File(['# Result'], 'project-facts.md'))
      expect(localStorage.getItem(fileKey)).toBe(path)
      expect(await injected.openDeliveryFile!(artifactId)).toBe(true)
      expect(openResource).toHaveBeenCalledWith(sessionFileAddress(report.sharedSessionId!, path))
      expect(mock.remote.session.openWorkspacePath).not.toHaveBeenCalled()
      mounted.mockReturnValue(undefined)
      expect(await injected.openDeliveryFile!(artifactId)).toBe(true)
      expect(mock.remote.session.openWorkspacePath).toHaveBeenCalledWith({ path, action: 'reveal' })
      expect(await injected.openDeliveryFile!(brandString(randomUUID()))).toBe(false)
    } finally {
      localStorage.removeItem(fileKey)
      paths.__DSH_HOST_PATHS__ = previousPaths
      mounted.mockRestore(); openResource.mockRestore()
    }
    await injected.selectConversation!(report.owner)
    expect(app.ctx.slots.entries('main.conversation.entry')).toHaveLength(1)
    const binding = app.ctx.sessions.binding(report.sharedSessionId!)!
    await vi.waitFor(() => { expect(binding.session.getSnapshot().openError).toBeNull(); expect(binding.session.getSnapshot().openState).toBe('open') })
    expect(binding.session.getSnapshot().sessionId).toBe(report.sharedSessionId!)
    expect(app.ctx.uiSession.adapter.current.getSnapshot().key).toBe(report.sharedSessionId!)
    const conversation = app.ctx.uiConversation.binding(binding)
    conversation.activate('chat')
    expect(JSON.stringify(conversation.target('chat').getSnapshot()?.nodes.values())).toContain('ACCOUNT_ASSISTANT')
    expect(app.ctx.slots.entries('main.conversation')[0]?.children).toHaveProperty('conversation.header')
    expect(app.ctx.slots.entries('conversation.composer.bar')[0]?.children).toHaveProperty('conversation.input.left')
    expect(app.ctx.sessions.list.getSnapshot().ids).not.toContain(report.sharedSessionId!)
    expect(app.ctx.sessions.list.getSnapshot().byId[report.sharedSessionId!]).toBeDefined()
    expect(binding.controls?.planningScope).toBe('account')
    expect(await binding.controls!.readPlanningPreferences()).toEqual(report.settings)
    nativeConversation.mockImplementationOnce(async () => ({ generation: 1, result: { ...report,
      settings: { enabled: true, granularity: 'fine', revision: 1 } } }))
    await binding.controls!.setPlanningPreferences({ enabled: true, granularity: 'fine', expectedRevision: 0 })
    expect(nativeConversation).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'settings',
      expectedRevision: 0, settings: { enabled: true, granularity: 'fine' } }))
    expect(await binding.controls!.readMode()).toEqual({ enabled: true, granularity: 'fine', revision: 1 })
    const nativeCalls = nativeConversation.mock.calls.length
    mock.remote.session.prompt.mockResolvedValue(ok({ accepted: true }))
    const content = [{ type: 'text' as const, text: 'Image question' }, { type: 'image' as const, mediaType: 'image/png' as const, data: 'image-bytes' }]
    await binding.session.prompt(content, 'queue')
    expect(mock.remote.session.prompt).toHaveBeenLastCalledWith(expect.objectContaining({ sessionId: report.sharedSessionId, content, mode: 'queue' }), undefined)
    mock.remote.commands.execute.mockResolvedValue(ok(undefined))
    await binding.session.command('/help')
    expect(mock.remote.commands.execute).toHaveBeenLastCalledWith(report.sharedSessionId, '/help', [])
    mock.remote.session.updateQueue.mockResolvedValue(ok({ accepted: true }))
    const itemId = MessageId(randomUUID())
    await binding.session.updateQueue(itemId, { kind: 'edit', content: [{ type: 'text', text: 'Updated queue item' }] })
    expect(mock.remote.session.updateQueue).toHaveBeenLastCalledWith({ sessionId: report.sharedSessionId, itemId, action: { kind: 'edit', content: [{ type: 'text', text: 'Updated queue item' }] } })
    expect(nativeConversation.mock.calls.length).toBe(nativeCalls)

    publish?.({ ...snapshot, connection: { ...snapshot.connection, phase: 'loading', generation: 2 } })
    expect(app.ctx.uiSession.adapter.current.getSnapshot().key).toBe(report.sharedSessionId!)
    expect(app.ctx.sessions.binding(report.sharedSessionId!)).toBe(binding)
    publish?.({ ...snapshot, connection: { ...snapshot.connection, phase: 'ready', generation: 2 } })
    expect(app.ctx.sessions.binding(report.sharedSessionId!)).toBe(binding)
    expect(nativeConversation.mock.calls.length).toBe(nativeCalls)

    const ownerCount = app.ctx.sessions.retainInfo(report.sharedSessionId!).getSnapshot().referenceCount
    const secondReference = app.ctx.sessions.retain(report.sharedSessionId!, { source: 'mainView' })
    expect(secondReference.binding).toBe(binding)
    const cancel = new AbortController()
    const cancelled = app.ctx.sessions.retain(report.sharedSessionId!, { source: 'controllerOperation', signal: cancel.signal })
    cancel.abort()
    await expect(cancelled.ready).rejects.toThrow()
    cancelled.release()
    expect(app.ctx.sessions.retainInfo(report.sharedSessionId!).getSnapshot().referenceCount).toBe(ownerCount + 1)
    secondReference.release()
    expect(() => secondReference.binding).toThrow('released')
    const priorGeneration = app.ctx.sessions.retain(report.sharedSessionId!, { source: 'controllerOperation' })
    await injected.selectConversation!(report.owner)
    expect(priorGeneration.binding).toBe(binding)
    const replacement = app.ctx.sessions.binding(report.sharedSessionId!)
    expect(replacement).toBe(binding)
    priorGeneration.release()
    expect(app.ctx.sessions.binding(report.sharedSessionId!)).toBe(replacement)
    app.ctx.layout.selectPanel(brandString('tasks'))
    injected.beginConversationNavigation?.()
    expect(app.ctx.uiSession.adapter.current.getSnapshot().key).toBe(report.sharedSessionId)
    injected.showConversationStart?.()
    expect(app.ctx.sessions.binding(report.sharedSessionId!)).toBe(binding)
    await injected.selectConversation!(report.owner)
    expect(app.ctx.uiSession.adapter.current.getSnapshot().key).toBe(report.sharedSessionId)
    expect(nativeConversation.mock.calls.length).toBe(nativeCalls)
    const other = { ...report, sharedSessionId: brandString<SessionId>(`session-${randomUUID()}`),
      attachmentId: brandString<NonNullable<typeof report.attachmentId>>(randomUUID()),
      owner: { ...report.owner, conversationId: brandString<typeof report.owner.conversationId>(randomUUID()) } }
    nativeConversation.mockImplementation(async request => ({ generation: 2,
      result: request.conversationId === other.owner.conversationId ? other : report }))
    await injected.selectConversation!(other.owner)
    expect(app.ctx.sessions.binding(report.sharedSessionId!)).toBe(binding)
    expect(app.ctx.sessions.retainInfo(report.sharedSessionId!).getSnapshot().retainedBy.mainView).toBeUndefined()
    expect(app.ctx.sessions.retainInfo(report.sharedSessionId!).getSnapshot().retainedBy.organizationConversation).toBe(1)
    expect(app.ctx.sessions.binding(other.sharedSessionId)).toBeDefined()
    await injected.selectConversation!(report.owner)
    expect(app.ctx.sessions.binding(other.sharedSessionId)).toBeDefined()
    expect(nativeConversation.mock.calls.filter(([request]) => request.kind === 'detach')).toHaveLength(0)
    const delayed = { ...other, sharedSessionId: brandString<SessionId>(`session-${randomUUID()}`),
      attachmentId: brandString<NonNullable<typeof report.attachmentId>>(randomUUID()),
      owner: { ...report.owner, conversationId: brandString<typeof report.owner.conversationId>(randomUUID()) } }
    let resolveAttachment: ((reply: Awaited<ReturnType<OrganizationDesktopBridge['conversation']>>) => void) | undefined
    nativeConversation.mockImplementation(request => request.kind === 'attach' && request.conversationId === delayed.owner.conversationId
      ? new Promise((resolve) => { resolveAttachment = resolve }) : Promise.resolve({ generation: 2, result: report }))
    const opening = injected.selectConversation!(delayed.owner)
    await injected.selectConversation!(other.owner)
    resolveAttachment?.({ generation: 2, result: delayed })
    await expect(opening).rejects.toThrow('superseded')
    expect(app.ctx.uiSession.adapter.current.getSnapshot().key).toBe(other.sharedSessionId)
    expect(app.ctx.sessions.binding(delayed.sharedSessionId)).toBeUndefined()
    expect(nativeConversation).toHaveBeenCalledWith(expect.objectContaining({ kind: 'detach', attachmentId: delayed.attachmentId }))
    await injected.selectConversation!(report.owner)
    const backendId = brandString<SessionId>(`session-${randomUUID()}`)
    mock.remote.session.selectModel.mockResolvedValue(ok({ selected: { backend: 'codex', provider: 'codex', model: 'native-test' }, sessionId: backendId }))
    nativeConversation.mockImplementation(async request => ({ generation: 1,
      result: request.kind === 'attach' ? { ...report, sharedSessionId: backendId, attachmentId: brandString(randomUUID()) } : report }))
    const openPersonal = vi.spyOn(app.ctx.uiWorkspace, 'openSession')
    await app.ctx.modelDirectories.directoryFor(report.sharedSessionId!).select({ backend: 'codex', provider: 'codex', model: 'native-test' })
    expect(app.ctx.uiSession.adapter.current.getSnapshot().key).toBe(backendId)
    expect(app.ctx.sessions.binding(backendId)?.controls).toBeDefined()
    expect(app.ctx.sessions.list.getSnapshot().ids).not.toContain(backendId)
    expect(openPersonal).not.toHaveBeenCalled()
    nativeConversation.mockImplementation(async () => ({ generation: 1, result: report }))
    await injected.selectConversation!(report.owner)
    const prompts = mock.remote.session.prompt.mock.calls.length
    publish?.({ ...snapshot, connection: { ...snapshot.connection, phase: 'loading', generation: 3, identityGeneration: 2 } })
    expect(app.ctx.sessions.binding(report.sharedSessionId!)).toBeUndefined()
    nativeConversation.mockImplementation(async () => ({ generation: 3, result: report }))
    publish?.({ ...snapshot, connection: { ...snapshot.connection, phase: 'ready', generation: 3, identityGeneration: 2 } })
    await vi.waitFor(() => { expect(app.ctx.sessions.binding(report.sharedSessionId!)).toBeDefined() })
    expect(mock.remote.session.prompt.mock.calls.length).toBe(prompts)
    injected.showConversationStart?.()
    expect(app.ctx.slots.entries('main.conversation.entry')).toHaveLength(1)
    expect(app.ctx.uiSession.adapter.current.getSnapshot().key).toMatch(/^conversation-draft:/)
    const beforeDraft = nativeConversation.mock.calls.filter(([request]) => request.kind === 'attach' || request.kind === 'open').length
    for (let index = 0; index < 3; index++) {
      injected.beginConversationNavigation?.(); injected.showConversationStart?.()
      app.ctx.uiWorkspace.startSession()
    }
    expect(nativeConversation.mock.calls.filter(([request]) => request.kind === 'attach' || request.kind === 'open')).toHaveLength(beforeDraft)
    const draftId = app.ctx.uiSession.adapter.current.getSnapshot().key as SessionId
    const draftBinding = app.ctx.sessions.binding(draftId)!
    expect(app.ctx.sessions.list.getSnapshot().ids).not.toContain(draftId)
    await draftBinding.session.command('/permission read-only')
    expect(draftBinding.session.projections.faceOf('permissions').getSnapshot()).toEqual({ currentValue: 'read-only' })
    expect(nativeConversation.mock.calls.filter(([request]) => request.kind === 'attach' || request.kind === 'open')).toHaveLength(beforeDraft)
    mock.remote.commands.execute.mockResolvedValue(ok({}))
    mock.remote.commands.list.mockResolvedValue(ok([]))
    mock.remote.skills.list.mockResolvedValue(ok({ skills: [] }))
    const input = app.ctx.conversation.input.for(draftBinding.ctx)
    input.setDraft('First submitted message')
    expect(nativeConversation.mock.calls.filter(([request]) => request.kind === 'attach' || request.kind === 'open')).toHaveLength(beforeDraft)
    input.submit()
    await vi.waitFor(() => { expect(mock.remote.session.prompt.mock.calls.at(-1)?.[0]).toMatchObject({
      sessionId: report.sharedSessionId, content: [{ type: 'text', text: 'First submitted message' }],
    }) })
    expect(mock.remote.commands.execute).toHaveBeenLastCalledWith(report.sharedSessionId, '/permission read-only', [])
    expect(mock.remote.commands.execute.mock.invocationCallOrder.at(-1)!)
      .toBeLessThan(mock.remote.session.prompt.mock.invocationCallOrder.at(-1)!)
    expect(nativeConversation.mock.calls.filter(([request]) => request.kind === 'attach')).toHaveLength(beforeDraft + 1)
    expect(app.ctx.uiSession.adapter.current.getSnapshot().key).toBe(report.sharedSessionId)

    publish?.({ ...snapshot, connection: { ...snapshot.connection, mode: 'personal', generation: 2 } })
    await vi.waitFor(() => { expect(app.ctx.slots.entries('sidebar.tasks').some(e => e.component === OrganizationTaskList)).toBe(false) })
    expect(app.ctx.slots.entries('main.conversation.entry')).toHaveLength(0)
    app.ctx.uiWorkspace.showConversation()
    expect(selectPanel).toHaveBeenLastCalledWith(null)
    expect(app.ctx.sessions.binding(report.sharedSessionId!)).toBeUndefined()
    expect(binding.eventSource.getSnapshot().entries).toEqual([])
    publish?.(snapshot)
    await vi.waitFor(() => {
      const key = app.ctx.uiSession.adapter.current.getSnapshot().key as SessionId
      expect(key).toMatch(/^conversation-draft:/)
      expect(app.ctx.sessions.binding(key)!.session.projections.faceOf('permissions').getSnapshot())
        .toEqual({ currentValue: 'workspace-write' })
    })
    await injected.selectConversation!(report.owner)
    const retained = app.ctx.sessions.retain(report.sharedSessionId!, { source: 'controllerOperation' })
    await retained.ready
    const sessions = app.ctx.sessions
    await app.ctx.fiber.dispose()
    expect(() => retained.binding).toThrow('released')
    expect(sessions.retainInfo(report.sharedSessionId!).getSnapshot().referenceCount).toBe(0)
    expect(sessions.list.getSnapshot().byId[report.sharedSessionId!]).toBeUndefined()
    retained.release()
    expect(publish).toBeUndefined()
  } finally {
    if (previous === undefined) delete globalObject.dshDesktop
    else globalObject.dshDesktop = previous
  }
}, 60000)

it('synchronizes paginated assignments for the current member without selecting or executing them', async ({ mock, start }) => {
  const globalObject = globalThis as typeof globalThis & { dshDesktop?: { organization?: OrganizationDesktopBridge } }
  const previous = globalObject.dshDesktop
  const organizationId = brandString<OrganizationId>(randomUUID()), membershipId = brandString<MembershipId>(randomUUID())
  const snapshot: OrganizationDesktopSnapshot = { connection: { identityGeneration: 1, mode: 'organization', phase: 'ready', generation: 1, revision: 1,
    principal: { serverId: brandString<ServerId>(randomUUID()), accountId: brandString<AccountId>(randomUUID()) }, organizationId,
    organizations: [{ id: organizationId, name: 'Team', version: 1, role: 'member', membershipId }], members: [] },
  server: { phase: 'disabled', settings: { host: 'localhost', port: 19487, names: [], restoreOnLaunch: false } } }
  const { inboxPageSchema, inboxQuerySchema } = await import('@deepseek-ai/dsh-organization/assignment')
  const projectId = randomUUID(), planId = randomUUID()
  const item = (assigneeId = membershipId, state = 'pending') => {
    const id = randomUUID()
    return { assignment: { id, organizationId, projectId, planId, taskId: randomUUID(), planRevision: 1,
      approvedBy: randomUUID(), assigneeId, state, reason: null, createdAt: 1, createdRevision: 1, version: 1 },
    request: { id: randomUUID(), assignmentId: id, kind: 'accept-assignment', state: 'pending', expiresAt: null, answeredRevision: null },
    notificationId: null, readAt: null }
  }
  const approval = item(brandString<MembershipId>(randomUUID()), 'accepted')
  const review = { ...approval, request: { organizationId, projectId, planId, assignmentId: approval.assignment.id,
    planRevision: 1, runId: null, id: randomUUID(), employeeId: approval.assignment.assigneeId,
    handlerId: membershipId, kind: 'accept-delivery', state: 'submitted', artifactIds: [],
    summary: 'Employee delivery for review', target: '', createdRevision: 2, reviewState: 'pending', acceptance: null } }
  const items = [item(), item(brandString<MembershipId>(randomUUID())), item(membershipId, 'revoked'), item(), review]
  const connection = vi.fn<OrganizationDesktopBridge['connection']>(async (action) => {
    if (action.kind !== 'assignment-inbox') return {}
    const offset = inboxQuerySchema.parse(action.request).offset
    return { assignment: { generation: 1, result: { kind: 'inbox', value: inboxPageSchema.parse({ items: items.slice(offset, offset + 2),
      total: 5, unread: 5, offset, revision: 1, cursor: 'assignments' }) } } }
  })
  const report = conversationResultSchema.parse({ sessionId: `organization-conversation:${randomUUID()}`,
    owner: { ...snapshot.connection.principal, organizationId, projectId, conversationId: items[3]!.assignment.id },
    settings: { enabled: true, granularity: 'balanced', revision: 0 }, entries: [], goals: [], truncated: false, state: 'ready' })
  const conversation = vi.fn<OrganizationDesktopBridge['conversation']>(async (request) => {
    if (request.conversationId === items[0]!.assignment.id) throw new Error('deleted')
    return { generation: 1, result: report }
  })
  const execution = vi.fn<OrganizationDesktopBridge['execution']>()
  let publish: ((snapshot: OrganizationDesktopSnapshot) => void) | undefined
  globalObject.dshDesktop = { organization: { snapshot: async () => snapshot,
    subscribe: (listener) => { publish = listener; return () => { publish = undefined } }, connection, conversation, execution,
    executionReport: vi.fn(), context: vi.fn(), server: vi.fn(), secret: vi.fn() } }
  mock.remote.session.create.mockResolvedValue(ok({ sessionId: 'sync-personal' as SessionId }))
  try {
    const app = await start()
    await vi.waitFor(() => { expect(conversation.mock.calls.filter(([request]) => request.kind !== 'catalog')).toHaveLength(3) })
    expect(connection.mock.calls.filter(([action]) => action.kind === 'assignment-inbox').map(([action]) =>
      action.kind === 'assignment-inbox' ? inboxQuerySchema.parse(action.request).offset : undefined)).toEqual([0, 2, 4])
    const opened = conversation.mock.calls.filter(([request]) => request.kind !== 'catalog')
    expect(opened.map(([request]) => request.conversationId))
      .toEqual([items[0]!.assignment.id, items[3]!.assignment.id, review.request.id])
    expect(opened.slice(0, 2).every(([request]) => request.kind === 'open' && request.assignment)).toBe(true)
    expect(opened[2]?.[0]).toMatchObject({ kind: 'open-review', review: {
      planId, assignmentId: approval.assignment.id, submissionId: review.request.id } })
    expect(execution).not.toHaveBeenCalled()
    expect(app.ctx.uiSession.adapter.current.getSnapshot().key).not.toBe(report.sessionId)
    publish?.({ ...snapshot, connection: { ...snapshot.connection, revision: 2 } })
    await Promise.resolve(); await Promise.resolve()
    expect(conversation.mock.calls.filter(([request]) => request.kind !== 'catalog')).toHaveLength(3)
    await app.ctx.fiber.dispose()
  } finally {
    if (previous === undefined) delete globalObject.dshDesktop
    else globalObject.dshDesktop = previous
  }
}, 60000)
