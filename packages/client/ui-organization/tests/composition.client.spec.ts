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
import { OrganizationConversation } from '../src/client/Conversation.tsx'
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
  let publish: ((snapshot: OrganizationDesktopSnapshot) => void) | undefined
  const bridge: OrganizationDesktopBridge = { snapshot: async () => snapshot,
    subscribe: (listener) => { publish = listener; return () => { publish = undefined } },
    conversation: async () => { throw new Error('not-used') }, context: async () => { throw new Error('not-used') },
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
    expect(app.ctx.slots.entries('main').filter(e => e.options.key === 'conversation')[0]?.component).toBe(OrganizationConversation)
    publish?.({ ...snapshot, connection: { ...snapshot.connection, mode: 'personal', generation: 2 } })
    await vi.waitFor(() => { expect(app.ctx.slots.entries('sidebar.tasks').some(e => e.component === OrganizationTaskList)).toBe(false) })
    app.ctx.uiWorkspace.showConversation()
    expect(selectPanel).toHaveBeenLastCalledWith(null)
    await app.ctx.fiber.dispose()
    expect(publish).toBeUndefined()
  } finally {
    if (previous === undefined) delete globalObject.dshDesktop
    else globalObject.dshDesktop = previous
  }
}, 60000)
