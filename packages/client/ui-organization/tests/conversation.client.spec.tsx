// @vitest-environment jsdom
/** Native conversation controls tested in a detached DOM; no application or browser is started. */
import { useSyncExternalStore } from 'react'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { ServerId, AccountId } from '@deepseek-ai/dsh-organization/types'
import { OrganizationBrowser } from '../src/client/OrganizationBrowser.tsx'
import { AccountSession } from '../src/client/account-session.ts'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { createConversationStore } from '../src/client/conversation-store.ts'
import { randomUUID } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { conversationResultSchema } from '@deepseek-ai/dsh-organization-conversation/protocol'
import { planningViewSchema } from '@deepseek-ai/dsh-organization/planning'
import type { OrganizationDesktopSnapshot } from '@deepseek-ai/dsh-organization-connection/types'
import type { OrganizationProps } from '../src/client/contract.ts'
import { zh } from '../src/client/locales.ts'
afterEach(cleanup)
function fixture() {
  const result = conversationResultSchema.parse({ sessionId: `organization-conversation:${randomUUID()}`, sharedSessionId: `session-${randomUUID()}`, attachmentId: randomUUID(),
    owner: { serverId: randomUUID(), accountId: randomUUID(),
      organizationId: randomUUID(), projectId: randomUUID(), conversationId: randomUUID() },
    settings: { enabled: true, granularity: 'balanced', revision: 0 }, entries: [{ role: 'assistant', text: 'Private report' }],
    goals: [], state: 'ready', truncated: false })
  const project = { id: result.owner.projectId!, organizationId: result.owner.organizationId, name: 'Reports', version: 1,
    createdBy: result.owner.accountId, background: '', summary: '', goal: '' }
  const { createdBy: _creator, ...planningProject } = project
  const planning = planningViewSchema.parse({ project: planningProject, grant: null, eligible: false,
    canWrite: true, plans: [], serverTime: 0,
    policy: { models: [{ model: 'test-model', endpoint: 'https://example.test/v1' }], ttlMs: 1000, permitTtlMs: 1000, maxRequests: 10,
      maxInputBytes: 100000, maxOutputBytes: 100000, maxTotalBytes: 1000000, maxDurationMs: 10000 } })
  let state: OrganizationDesktopSnapshot = { connection: { identityGeneration: 1, phase: 'ready', mode: 'organization', revision: 1, generation: 1,
    principal: { serverId: brandString<ServerId>(result.owner.serverId), accountId: brandString<AccountId>(result.owner.accountId) },
    organizationId: project.organizationId, organizations: [], members: [] }, server: { phase: 'disabled',
    settings: { host: 'localhost', port: 19487, names: [], restoreOnLaunch: false } } }
  const conversation = vi.fn<NonNullable<OrganizationProps['conversation']>>(async request => ({ generation: 1,
    result: request.projectId ? result : { ...result, catalog: { bots: [], conversations: [] } } }))
  const connection = vi.fn<OrganizationProps['connection']>(async () => ({ generation: 1, planning }))
  const props: OrganizationProps = { available: true, conversation, connection, server: vi.fn(), secret: vi.fn(), context: vi.fn(),
    execution: vi.fn(), executionReport: vi.fn(), t: makeTranslate(zh), useModelCatalogRevision: f => f(0),
    useTaskExecutionRevision: f => f(0),
    useOrganization: f => f(state) }
  return { result, props, project, conversation, connection, identity: createSnapshotStore(state), change: (generation: number) => {
    state = { ...state, connection: { ...state.connection, generation, phase: 'offline' } }
  } }
}
it.each([true, false])('offers the project removal action and matching confirmation for creator=%s', async (creator) => {
  const h = fixture(), store = createConversationStore().create(), removeProject = vi.fn(async () => {})
  if (!creator) h.project.createdBy = brandString<AccountId>(randomUUID())
  h.connection.mockResolvedValue({ generation: 1, projects: { items: [h.project], total: 1, offset: 0, revision: 1,
    cursor: 'catalog' as import('@deepseek-ai/dsh-organization/types').OrganizationCursor } })
  render(<OrganizationBrowser {...h.props} removeProject={removeProject} section="projects" wide expandSidebar={vi.fn()}
    actions={store.actions} useStore={selector => selector(store.getSnapshot())} />)
  fireEvent.click(await screen.findByRole('button', { name: `${zh.more} ${h.project.name}` }))
  const label = creator ? zh.deleteProject : zh.removeLocalProject
  fireEvent.click(screen.getByRole('menuitem', { name: label }))
  expect(screen.getByText(creator ? zh.deleteSharedProjectHint : zh.removeLocalProjectHint)).toBeTruthy()
  expect(removeProject).not.toHaveBeenCalled()
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: label })) })
  expect(removeProject).toHaveBeenCalledExactlyOnceWith(h.project)
})

it('keeps project rows without a visible refresh message during delayed catalog reads and navigation switches', async () => {
  const h = fixture(), store = createConversationStore().create()
  h.connection.mockResolvedValue({ generation: 1, projects: { items: [h.project], total: 1, offset: 0, revision: 1,
    cursor: 'catalog' as import('@deepseek-ai/dsh-organization/types').OrganizationCursor } })
  h.conversation.mockReturnValue(new Promise(() => {}))
  const props = { ...h.props, wide: true, expandSidebar: vi.fn(), actions: store.actions,
    useStore: <T,>(selector: (state: ReturnType<typeof store.getSnapshot>) => T) => selector(store.getSnapshot()) }
  const view = render(<OrganizationBrowser {...props} section="projects" />)
  expect(await screen.findByRole('button', { name: h.project.name })).toBeTruthy()
  expect(screen.queryByText(zh.loading)).toBeNull()
  view.rerender(<OrganizationBrowser {...props} section="recent" />)
  expect(screen.queryByText(zh.loading)).toBeNull()
  view.rerender(<OrganizationBrowser {...props} section="projects" />)
  expect(screen.getByRole('button', { name: h.project.name })).toBeTruthy()
  expect(screen.queryByText(zh.loading)).toBeNull()
})
it('expands project conversations without creating one and opens the original private conversation in the shared destination', async () => {
  const h = fixture(), store = createConversationStore().create(), openConversation = vi.fn()
  h.result.catalog = { bots: [], conversations: [{ conversationId: h.result.owner.conversationId, title: 'Revenue discussion', createdAt: 1 }] }
  h.connection.mockImplementation(async action => action.kind === 'project-page' ? { generation: 1,
    projects: { items: [h.project], total: 1, offset: 0, revision: 1, cursor: 'catalog' as import('@deepseek-ai/dsh-organization/types').OrganizationCursor } } : {})
  render(<OrganizationBrowser {...h.props} section="projects" wide expandSidebar={vi.fn()} openConversation={openConversation}
    actions={store.actions} useStore={selector =>
      selector(useSyncExternalStore(callback => store.subscribe(callback), () => store.getSnapshot()))} />)
  const project = await screen.findByRole('button', { name: h.project.name })
  await waitFor(() => { expect(h.conversation).toHaveBeenCalledWith(expect.objectContaining({ kind: 'catalog' })) })
  expect(screen.queryByRole('button', { name: 'Revenue discussion' })).toBeNull()
  fireEvent.click(project)
  expect(h.conversation.mock.calls.some(([request]) => request.kind === 'open')).toBe(false)
  fireEvent.click(await screen.findByRole('button', { name: 'Revenue discussion' }))
  await waitFor(() => { expect(openConversation).toHaveBeenCalledOnce() })
  expect(store.getSnapshot().selected).toMatchObject({ organizationId: h.project.organizationId, projectId: h.project.id,
    conversationId: h.result.owner.conversationId })
  expect(h.conversation.mock.calls.find(([request]) => request.kind === 'open')?.[0]).toMatchObject({
    projectId: h.project.id, conversationId: h.result.owner.conversationId })
  expect(h.conversation.mock.calls.some(([request]) => request.kind === 'send')).toBe(false)
})

it('does not navigate to an old account when its delayed conversation open completes after a switch', async () => {
  const h = fixture(), store = createConversationStore().create(), openConversation = vi.fn()
  h.result.catalog = { bots: [], conversations: [{ conversationId: h.result.owner.conversationId, title: 'Old account conversation', createdAt: 1 }] }
  h.connection.mockImplementation(async () => ({ generation: 1,
    projects: { items: [h.project], total: 1, offset: 0, revision: 1, cursor: 'catalog' as import('@deepseek-ai/dsh-organization/types').OrganizationCursor } }))
  const props = { ...h.props, section: 'recent' as const, wide: true, expandSidebar: vi.fn(), openConversation,
    actions: store.actions, useStore: <T,>(selector: (state: ReturnType<typeof store.getSnapshot>) => T) => selector(store.getSnapshot()) }
  const view = render(<OrganizationBrowser {...props} />)
  const button = await screen.findByRole('button', { name: 'Old account conversation' })
  const late = Promise.withResolvers<Awaited<ReturnType<NonNullable<OrganizationProps['conversation']>>>>()
  h.conversation.mockReturnValueOnce(late.promise)
  fireEvent.click(button)
  h.change(2); view.rerender(<OrganizationBrowser {...props} />)
  await act(async () => { late.resolve({ generation: 1, result: h.result }); await late.promise })
  expect(store.getSnapshot().selected).toBeNull()
  expect(openConversation).not.toHaveBeenCalled()
  expect(screen.queryByRole('button', { name: 'Old account conversation' })).toBeNull()
})
it('contributes task controls while leaving message and model operations to the ordinary Session', async () => {
  const h = fixture(), selectModel = vi.fn(async () => ({ ok: true as const, value: { selected: { provider: 'ordinary', model: 'vision' } } }))
  const loadModels = vi.fn(async () => ({ groups: [], failures: [], routableProviders: ['ordinary'], default: { provider: 'ordinary', model: 'vision' } }))
  const adapter = new AccountSession({ generation: 1, result: h.result }, h.result.owner,
    { conversation: h.conversation, connection: h.connection }, h.identity, vi.fn(), vi.fn(), vi.fn(), loadModels, selectModel)
  expect(adapter.kind).toBe('account')
  expect(adapter.sessionId).toBe(h.result.sharedSessionId)
  expect('session' in adapter).toBe(false)
  expect(await adapter.controls.catalog.load()).toEqual(await loadModels())
  await adapter.controls.selectModel({ provider: 'ordinary', model: 'vision' })
  expect(selectModel).toHaveBeenCalledWith({ provider: 'ordinary', model: 'vision' })
  expect(h.conversation).not.toHaveBeenCalled()
  await adapter.dispose()
  expect(h.conversation).toHaveBeenCalledWith(expect.objectContaining({ kind: 'detach' }))
  await expect(adapter.controls.catalog.load()).rejects.toThrow('superseded')
})

it('waits for native attachment cleanup and detaches only once', async () => {
  const h = fixture()
  let complete: ((reply: Awaited<ReturnType<NonNullable<OrganizationProps['conversation']>>>) => void) | undefined
  h.conversation.mockImplementation(() => new Promise((resolve) => { complete = resolve }))
  const adapter = new AccountSession({ generation: 1, result: h.result }, h.result.owner,
    { conversation: h.conversation, connection: h.connection }, h.identity, vi.fn(), vi.fn(), vi.fn(),
    async () => ({ groups: [], failures: [], routableProviders: [], default: { provider: 'ordinary', model: 'default' } }),
    async selection => ({ ok: true, value: { selected: selection } }))
  const disposal = adapter.dispose()
  expect(adapter.dispose()).toBe(disposal)
  let settled = false
  void disposal.then(() => { settled = true })
  await Promise.resolve()
  expect(settled).toBe(false)
  expect(h.conversation).toHaveBeenCalledOnce()
  complete?.({ generation: 1, result: h.result })
  await disposal
  expect(settled).toBe(true)
})
it('uses the same conversation hover menu for account management and deletion', async () => {
  const h = fixture(), store = createConversationStore().create(), manageConversation = vi.fn()
  h.result.catalog = { bots: [], conversations: [{ conversationId: h.result.owner.conversationId, title: 'Revenue discussion', createdAt: 1 }] }
  h.connection.mockResolvedValue({ generation: 1, projects: { items: [h.project], total: 1, offset: 0, revision: 1,
    cursor: 'catalog' as import('@deepseek-ai/dsh-organization/types').OrganizationCursor } })
  render(<OrganizationBrowser {...h.props} manageConversation={manageConversation} section="recent" wide expandSidebar={vi.fn()}
    actions={store.actions} useStore={selector => selector(store.getSnapshot())} />)
  fireEvent.click(await screen.findByRole('button', { name: `${zh.more} Revenue discussion` }))
  fireEvent.click(screen.getByRole('menuitem', { name: zh.manageConversation }))
  expect(manageConversation).toHaveBeenLastCalledWith(expect.objectContaining({ conversationId: h.result.owner.conversationId }))
  fireEvent.click(screen.getByRole('button', { name: `${zh.more} Revenue discussion` }))
  fireEvent.click(screen.getByRole('menuitem', { name: zh.deleteConversation }))
  expect(manageConversation).toHaveBeenLastCalledWith(expect.objectContaining({ conversationId: h.result.owner.conversationId }), 'delete')
})

it('keeps the selected organization node on the ordinary Session controls without another send pipeline', async () => {
  const h = fixture(), taskId = randomUUID(), planId = randomUUID()
  const selected = conversationResultSchema.parse({ ...h.result,
    goals: [{ id: taskId, classification: 'unassessed' }], execution: { target: { planId, taskId }, title: 'Selected node' } })
  const execute = vi.fn()
  const adapter = new AccountSession({ generation: 1, result: selected }, selected.owner,
    { conversation: h.conversation, connection: h.connection }, h.identity, vi.fn(), execute, vi.fn(),
    async () => ({ groups: [], failures: [], routableProviders: [], default: { provider: 'ordinary', model: 'default' } }),
    async selection => ({ ok: true, value: { selected: selection } }))
  expect(adapter.controls.taskId).toBe(taskId)
  expect(adapter.controls.assigned).toBe(false)
  adapter.controls.openExecution()
  expect(execute).toHaveBeenCalledWith(selected)
  expect(h.conversation).not.toHaveBeenCalled()
  await adapter.dispose()
})

it('retains project navigation and member creation when a private conversation catalog fails', async () => {
  const h = fixture(), store = createConversationStore().create()
  h.connection.mockResolvedValue({ generation: 1, projects: { items: [h.project], total: 1, offset: 0, revision: 1,
    cursor: 'catalog' as import('@deepseek-ai/dsh-organization/types').OrganizationCursor } })
  h.conversation.mockRejectedValue(new Error('organization-conversation-unavailable'))
  render(<OrganizationBrowser {...h.props} section="projects" wide expandSidebar={vi.fn()}
    actions={store.actions} useStore={selector => selector(store.getSnapshot())} />)
  expect(await screen.findByRole('button', { name: h.project.name })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: zh.createProject }))
  expect(screen.queryByLabelText(zh.projectBackground)).toBeNull()
  expect(screen.queryByLabelText(zh.projectSummary)).toBeNull()
  expect(screen.queryByLabelText(zh.projectGoal)).toBeNull()
  expect(screen.getByRole('dialog', { name: zh.createProject })).toBeTruthy()
})
it('opens projectless Recent conversations even when project enumeration fails', async () => {
  const h = fixture(), store = createConversationStore().create(), selectConversation = vi.fn<NonNullable<OrganizationProps['selectConversation']>>(async () => {})
  h.connection.mockRejectedValue(new Error('forbidden'))
  h.conversation.mockResolvedValue({ generation: 1, result: { ...h.result, catalog: { bots: [],
    conversations: [{ conversationId: h.result.owner.conversationId, title: 'Ungrouped discussion', createdAt: 1 }] } } })
  render(<OrganizationBrowser {...h.props} section="recent" wide expandSidebar={vi.fn()} selectConversation={selectConversation}
    actions={store.actions} useStore={selector => selector(store.getSnapshot())} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Ungrouped discussion' }))
  await waitFor(() => { expect(selectConversation).toHaveBeenCalledOnce() })
  expect(selectConversation.mock.calls[0]?.[0]).not.toHaveProperty('projectId')
})

it('offers only project information and deletion in the project menu', async () => {
  const h = fixture(), store = createConversationStore().create(), openProject = vi.fn()
  h.connection.mockResolvedValue({ generation: 1, projects: { items: [h.project], total: 1, offset: 0, revision: 1, cursor: brandString('catalog') } })
  render(<OrganizationBrowser {...h.props} section="projects" wide expandSidebar={vi.fn()} openProject={openProject} removeProject={vi.fn()}
    actions={store.actions} useStore={selector => selector(store.getSnapshot())} />)
  fireEvent.click(await screen.findByRole('button', { name: `${zh.more} ${h.project.name}` }))
  expect(screen.getAllByRole('menuitem').map(item => item.textContent)).toEqual([zh.viewProject, zh.deleteProject])
  fireEvent.click(screen.getByRole('menuitem', { name: zh.viewProject }))
  expect(openProject).toHaveBeenCalledWith(h.project)
})
it.each(['projects', 'bots', 'recent'] as const)('selects the first %s conversation after a navigation request', async (section) => {
  const h = fixture(), store = createConversationStore().create(), selectConversation = vi.fn(async () => {})
  const botId = brandString<import('@deepseek-ai/dsh-organization-conversation/protocol').ConversationRequest['botId']>(randomUUID())
  h.result.catalog = { bots: [{ id: botId, name: 'First Bot', instructions: '', createdAt: 1, revision: 1 }],
    conversations: [{ conversationId: h.result.owner.conversationId, title: 'First conversation', botId, createdAt: 2 }] }
  h.connection.mockResolvedValue({ generation: 1, projects: { items: [h.project], total: 1, offset: 0, revision: 1, cursor: brandString('catalog') } })
  h.conversation.mockResolvedValue({ generation: 1, result: h.result })
  render(<OrganizationBrowser {...h.props} section={section} wide expandSidebar={vi.fn()} navigationRevision={1}
    selectConversation={selectConversation} actions={store.actions} useStore={selector => selector(store.getSnapshot())} />)
  await waitFor(() => {
    expect(selectConversation).toHaveBeenCalledWith(expect.objectContaining({ conversationId: h.result.owner.conversationId }))
  })
  expect(h.conversation.mock.calls.some(([request]) => request.kind === 'send')).toBe(false)
})
it('shows a working new conversation entry for an empty first project instead of falling through to another project', async () => {
  const h = fixture(), store = createConversationStore().create(), showConversationStart = vi.fn(), selectConversation = vi.fn()
  const second = { ...h.project, id: brandString<typeof h.project.id>(randomUUID()), name: 'Second project' }
  h.connection.mockResolvedValue({ generation: 1, projects: { items: [h.project, second], total: 2, offset: 0, revision: 1, cursor: brandString('catalog') } })
  h.conversation.mockImplementation(async (request) => {
    const conversations = request.projectId === second.id
      ? [{ conversationId: h.result.owner.conversationId, title: 'Second project chat', createdAt: 1 }] : []
    return { generation: 1, result: { ...h.result, catalog: { bots: [], conversations } } }
  })
  render(<OrganizationBrowser {...h.props} section="projects" wide expandSidebar={vi.fn()} navigationRevision={1}
    showConversationStart={showConversationStart} selectConversation={selectConversation}
    actions={store.actions} useStore={selector => selector(store.getSnapshot())} />)
  await waitFor(() => { expect(showConversationStart).toHaveBeenCalledWith(h.project, undefined) })
  expect(selectConversation).not.toHaveBeenCalled()
})

it('reuses loaded catalogs when switching Projects, Bots and Recent', async () => {
  const h = fixture(), store = createConversationStore().create(), selectConversation = vi.fn(async () => {})
  const botId = brandString<NonNullable<typeof h.result.catalog>['bots'][number]['id']>(randomUUID())
  h.result.catalog = { bots: [{ id: botId, name: 'First Bot', instructions: '', createdAt: 1, revision: 1 }],
    conversations: [{ conversationId: h.result.owner.conversationId, title: 'First conversation', botId, createdAt: 2 }] }
  h.connection.mockResolvedValue({ generation: 1, projects: { items: [h.project], total: 1, offset: 0, revision: 1, cursor: brandString('catalog') } })
  h.conversation.mockResolvedValue({ generation: 1, result: h.result })
  const props = { ...h.props, wide: true, expandSidebar: vi.fn(), selectConversation, beginConversationNavigation: vi.fn(),
    actions: store.actions, useStore: <T,>(selector: (state: ReturnType<typeof store.getSnapshot>) => T) => selector(store.getSnapshot()) }
  const view = render(<OrganizationBrowser {...props} section="projects" navigationRevision={1} />)
  await waitFor(() => { expect(selectConversation).toHaveBeenCalledOnce() })
  const reads = h.conversation.mock.calls.length
  view.rerender(<OrganizationBrowser {...props} section="bots" navigationRevision={2} />)
  await waitFor(() => { expect(selectConversation).toHaveBeenCalledTimes(2) })
  view.rerender(<OrganizationBrowser {...props} section="recent" navigationRevision={3} />)
  await waitFor(() => { expect(selectConversation).toHaveBeenCalledTimes(3) })
  expect(h.connection).toHaveBeenCalledOnce()
  expect(h.conversation).toHaveBeenCalledTimes(reads)
  expect(props.beginConversationNavigation).toHaveBeenCalledTimes(3)
})

it('starts all project catalog reads without waiting for the first project', async () => {
  const h = fixture(), store = createConversationStore().create()
  const second = { ...h.project, id: brandString<typeof h.project.id>(randomUUID()), name: 'Second project' }
  h.connection.mockResolvedValue({ generation: 1, projects: { items: [h.project, second], total: 2, offset: 0, revision: 1, cursor: brandString('catalog') } })
  h.conversation.mockImplementation(request => request.projectId === h.project.id
    ? new Promise(() => {}) : Promise.resolve({ generation: 1, result: h.result }))
  render(<OrganizationBrowser {...h.props} section="projects" wide expandSidebar={vi.fn()}
    actions={store.actions} useStore={selector => selector(store.getSnapshot())} />)
  await waitFor(() => { expect(h.conversation).toHaveBeenCalledWith(expect.objectContaining({ projectId: second.id, kind: 'catalog' })) })
  expect(h.conversation).toHaveBeenCalledWith(expect.objectContaining({ projectId: h.project.id, kind: 'catalog' }))
})

it('continues the latest navigation when an earlier conversation open is superseded', async () => {
  const h = fixture(), store = createConversationStore().create()
  const botId = brandString<NonNullable<typeof h.result.catalog>['bots'][number]['id']>(randomUUID())
  const botConversationId = brandString<typeof h.result.owner.conversationId>(randomUUID())
  h.result.catalog = { bots: [{ id: botId, name: 'First Bot', instructions: '', createdAt: 1, revision: 1 }], conversations: [
    { conversationId: h.result.owner.conversationId, title: 'Project conversation', createdAt: 1 },
    { conversationId: botConversationId, title: 'Bot conversation', botId, createdAt: 2 },
  ] }
  h.connection.mockResolvedValue({ generation: 1, projects: { items: [h.project], total: 1, offset: 0, revision: 1, cursor: brandString('catalog') } })
  h.conversation.mockResolvedValue({ generation: 1, result: h.result })
  const opening = Promise.withResolvers<undefined>()
  const selectConversation = vi.fn(async () => {}).mockImplementationOnce(() => opening.promise)
  const props = { ...h.props, wide: true, expandSidebar: vi.fn(), selectConversation, beginConversationNavigation: vi.fn(),
    actions: store.actions, useStore: <T,>(selector: (state: ReturnType<typeof store.getSnapshot>) => T) => selector(store.getSnapshot()) }
  const view = render(<OrganizationBrowser {...props} section="projects" navigationRevision={1} />)
  await waitFor(() => { expect(selectConversation).toHaveBeenCalledOnce() })
  view.rerender(<OrganizationBrowser {...props} section="bots" navigationRevision={2} />)
  await act(async () => { opening.reject(new Error('organization-conversation: superseded')) })
  await waitFor(() => { expect(selectConversation).toHaveBeenCalledWith(expect.objectContaining({ conversationId: botConversationId })) })
  expect(screen.queryByRole('alert')).toBeNull()
})
