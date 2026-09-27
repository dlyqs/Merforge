// @vitest-environment jsdom
/** Shipped plugin roster registers organization presentation without mounting a page. */
import { expect } from 'vitest'
import { ok } from '@deepseek-ai/dsh-remote-mock'
import { createClientTest, webApp } from '@deepseek-ai/dsh-client-test-runtime/src/assembly/index.ts'
import { SESSION_FORMAT_VERSION, type SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionFollowFrame } from '@deepseek-ai/dsh-api-session-controller/types'
import { OrganizationSidebar, OrganizationSettings, OrganizationModeSwitch } from '../src/client/Organization.tsx'
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
  expect(app.ctx.slots.entries('sidebar.mode')[0]?.component).toBe(OrganizationModeSwitch)
  expect(app.ctx.slots.entries('sidebar.personal')[0]?.component).toBe(OrganizationSidebar)
  expect(app.ctx.slots.entries('settings.section').find(item => item.options.id === 'organization')?.component).toBe(OrganizationSettings)
  expect(JSON.stringify(app.ctx.slots.snapshot('factory:personal.manager'))).toContain('personal.manager.workflow')
  const slots = app.ctx.slots
  await app.ctx.fiber.dispose()
  expect(slots.entries('sidebar.personal')).toHaveLength(0)
}, 60000)
