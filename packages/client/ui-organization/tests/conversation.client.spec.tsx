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
  const project = { id: result.owner.projectId, organizationId: result.owner.organizationId, name: 'Reports', version: 1 }
  const planning = planningViewSchema.parse({ project, grant: null, eligible: false, canWrite: true, plans: [], serverTime: 0,
    policy: { models: [{ model: 'test-model', endpoint: 'https://example.test/v1' }], ttlMs: 1000, permitTtlMs: 1000, maxRequests: 10,
      maxInputBytes: 100000, maxOutputBytes: 100000, maxTotalBytes: 1000000, maxDurationMs: 10000 } })
  let state: OrganizationDesktopSnapshot = { connection: { phase: 'ready', mode: 'organization', revision: 1, generation: 1,
    principal: { serverId: brandString<ServerId>(result.owner.serverId), accountId: brandString<AccountId>(result.owner.accountId) },
    organizationId: project.organizationId, organizations: [], members: [] }, server: { phase: 'disabled',
    settings: { host: 'localhost', port: 19487, names: [], restoreOnLaunch: false } } }
  const conversation = vi.fn<NonNullable<OrganizationProps['conversation']>>(async () => ({ generation: 1, result }))
  const connection = vi.fn<OrganizationProps['connection']>(async () => ({ generation: 1, planning }))
  const props: OrganizationProps = { available: true, conversation, connection, server: vi.fn(), secret: vi.fn(), context: vi.fn(),
    execution: vi.fn(), executionReport: vi.fn(), t: makeTranslate(zh), useModelCatalogRevision: f => f(0), useOrganization: f => f(state) }
  return { result, props, project, conversation, connection, identity: createSnapshotStore(state), change: (generation: number) => {
    state = { ...state, connection: { ...state.connection, generation, phase: 'offline' } }
  } }
}
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
  adapter.dispose()
  expect(h.conversation).toHaveBeenCalledWith(expect.objectContaining({ kind: 'detach' }))
  await expect(adapter.controls.catalog.load()).rejects.toThrow('superseded')
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

it('keeps the selected organization node on the ordinary Session controls without another send pipeline', () => {
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
  adapter.dispose()
})
