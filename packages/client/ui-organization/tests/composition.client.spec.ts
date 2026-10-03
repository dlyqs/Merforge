// @vitest-environment jsdom
/** Shipped plugin roster registers organization presentation without mounting a page. */
import { expect, vi } from 'vitest'
import { ok } from '@deepseek-ai/dsh-remote-mock'
import { createClientTest, webApp } from '@deepseek-ai/dsh-client-test-runtime/src/assembly/index.ts'
import { SESSION_FORMAT_VERSION, type SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionFollowFrame } from '@deepseek-ai/dsh-api-session-controller/types'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { OrganizationDesktopBridge, OrganizationDesktopSnapshot } from '@deepseek-ai/dsh-organization-connection/types'
import type { AccountId, MembershipId, OrganizationId, ServerId } from '@deepseek-ai/dsh-organization/types'
import { OrganizationTaskList, OrganizationTasks } from '../src/client/Tasks.tsx'
import { ConversationPanel } from '../../ui-conversation/src/client/skeleton/ConversationPanel.tsx'
import { randomUUID } from 'node:crypto'
import { createAssistantMessage, createSystemMessage } from '@deepseek-ai/dsh-llm'
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
  expect(JSON.stringify(app.ctx.slots.snapshot('factory:personal.manager'))).toContain('personal.manager.workflow')
  expect(app.ctx.slots.entries('main').some(e => e.options.key === 'organization-conversation')).toBe(false)
  const slots = app.ctx.slots
  await app.ctx.fiber.dispose()
  expect(slots.entries('sidebar.personal')).toHaveLength(0)
}, 60000)

it('routes new and recent conversation navigation to the organization and replaces task readers until identity changes', async ({ mock, start }) => {
  const sessionId = 'organization-initial-personal' as SessionId
  mock.remote.session.create.mockResolvedValue(ok({ sessionId }))
  mock.stream('session/follow', (_request, stream) => {
    stream.push({ type: 'snapshot', header: { version: SESSION_FORMAT_VERSION, id: sessionId, createdAt: 1, isSeeded: false },
      cursor: -1, records: [], hasMore: false, projections: { asOfSeq: -1, values: {} }, assistantStream: { revision: 0 },
    } satisfies SessionFollowFrame)
  })
  const globalObject = globalThis as typeof globalThis & { dshDesktop?: { organization?: OrganizationDesktopBridge } }
  const previous = globalObject.dshDesktop
  const organizationId = brandString<OrganizationId>('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
  const snapshot: OrganizationDesktopSnapshot = { connection: { mode: 'organization', phase: 'ready', generation: 1, revision: 1,
    principal: { serverId: brandString<ServerId>('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
      accountId: brandString<AccountId>('cccccccc-cccc-4ccc-8ccc-cccccccccccc') }, organizationId,
    organizations: [{ id: organizationId, name: 'Team', version: 1, role: 'admin', membershipId: brandString<MembershipId>('dddddddd-dddd-4ddd-8ddd-dddddddddddd') }], members: [] },
  server: { phase: 'disabled', settings: { host: 'localhost', port: 19487, names: [], restoreOnLaunch: false } } }
  const report = conversationResultSchema.parse({ sessionId: `organization-conversation:${randomUUID()}`,
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
    const sidebar = app.ctx.slots.entries('sidebar.personal').find(entry => entry.component === OrganizationSidebar)!
    const bind = sidebar.inject as (actions: BoundActions<ReturnType<typeof createConversationStore>>) => OrganizationInjected
    const actions = createConversationStore().create().actions
    const injected = bind(actions)
    await injected.selectConversation!(report.owner)
    const binding = app.ctx.sessions.binding(report.sessionId)!
    expect(binding.session.getSnapshot().sessionId).toBe(report.sessionId)
    expect(app.ctx.uiSession.adapter.current.getSnapshot().key).toBe(report.sessionId)
    const conversation = app.ctx.uiConversation.binding(binding)
    conversation.activate('chat')
    expect(JSON.stringify(conversation.target('chat').getSnapshot()?.nodes.values())).toContain('ACCOUNT_ASSISTANT')
    expect(app.ctx.slots.entries('main.conversation')[0]?.children).toHaveProperty('conversation.header')
    expect(app.ctx.slots.entries('conversation.composer.bar')[0]?.children).toHaveProperty('conversation.input.left')
    expect(app.ctx.sessions.list.getSnapshot().ids).not.toContain(report.sessionId)
    const ownerCount = app.ctx.sessions.retainInfo(report.sessionId).getSnapshot().referenceCount
    const secondReference = app.ctx.sessions.retain(report.sessionId, { source: 'mainView' })
    expect(secondReference.binding).toBe(binding)
    const cancel = new AbortController()
    const cancelled = app.ctx.sessions.retain(report.sessionId, { source: 'controllerOperation', signal: cancel.signal })
    cancel.abort()
    await expect(cancelled.ready).rejects.toThrow()
    cancelled.release()
    expect(app.ctx.sessions.retainInfo(report.sessionId).getSnapshot().referenceCount).toBe(ownerCount + 1)
    secondReference.release()
    expect(() => secondReference.binding).toThrow('released')
    const priorGeneration = app.ctx.sessions.retain(report.sessionId, { source: 'controllerOperation' })
    await injected.selectConversation!(report.owner)
    expect(() => priorGeneration.binding).toThrow('released')
    const replacement = app.ctx.sessions.binding(report.sessionId)
    expect(replacement).not.toBe(binding)
    priorGeneration.release()
    expect(app.ctx.sessions.binding(report.sessionId)).toBe(replacement)
    publish?.({ ...snapshot, connection: { ...snapshot.connection, mode: 'personal', generation: 2 } })
    await vi.waitFor(() => { expect(app.ctx.slots.entries('sidebar.tasks').some(e => e.component === OrganizationTaskList)).toBe(false) })
    app.ctx.uiWorkspace.showConversation()
    expect(selectPanel).toHaveBeenLastCalledWith(null)
    expect(app.ctx.sessions.binding(report.sessionId)).toBeUndefined()
    expect(binding.eventSource.getSnapshot().entries).toEqual([])
    publish?.(snapshot)
    await injected.selectConversation!(report.owner)
    const retained = app.ctx.sessions.retain(report.sessionId, { source: 'controllerOperation' })
    await retained.ready
    const sessions = app.ctx.sessions
    await app.ctx.fiber.dispose()
    expect(() => retained.binding).toThrow('released')
    expect(sessions.retainInfo(report.sessionId).getSnapshot().referenceCount).toBe(0)
    expect(sessions.list.getSnapshot().byId[report.sessionId]).toBeUndefined()
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
  const snapshot: OrganizationDesktopSnapshot = { connection: { mode: 'organization', phase: 'ready', generation: 1, revision: 1,
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
  const items = [item(), item(brandString<MembershipId>(randomUUID())), item(membershipId, 'revoked'), item()]
  const connection = vi.fn<OrganizationDesktopBridge['connection']>(async (action) => {
    if (action.kind !== 'assignment-inbox') return {}
    const offset = inboxQuerySchema.parse(action.request).offset
    return { assignment: { generation: 1, result: { kind: 'inbox', value: inboxPageSchema.parse({ items: items.slice(offset, offset + 2),
      total: 4, unread: 4, offset, revision: 1, cursor: 'assignments' }) } } }
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
    await vi.waitFor(() => { expect(conversation).toHaveBeenCalledTimes(2) })
    expect(connection.mock.calls.filter(([action]) => action.kind === 'assignment-inbox').map(([action]) =>
      action.kind === 'assignment-inbox' ? inboxQuerySchema.parse(action.request).offset : undefined)).toEqual([0, 2])
    expect(conversation.mock.calls.map(([request]) => request.conversationId)).toEqual([items[0]!.assignment.id, items[3]!.assignment.id])
    expect(conversation.mock.calls.every(([request]) => request.kind === 'open' && request.assignment)).toBe(true)
    expect(execution).not.toHaveBeenCalled()
    expect(app.ctx.uiSession.adapter.current.getSnapshot().key).not.toBe(report.sessionId)
    publish?.({ ...snapshot, connection: { ...snapshot.connection, revision: 2 } })
    await Promise.resolve(); await Promise.resolve()
    expect(conversation).toHaveBeenCalledTimes(2)
    await app.ctx.fiber.dispose()
  } finally {
    if (previous === undefined) delete globalObject.dshDesktop
    else globalObject.dshDesktop = previous
  }
}, 60000)
