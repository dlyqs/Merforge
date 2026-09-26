// @vitest-environment jsdom
/** Personal navigation through the shipped Web plugin roster. */
import { expect } from 'vitest'
import { ok } from '@deepseek-ai/dsh-remote-mock'
import { createClientTest, webApp } from '@deepseek-ai/dsh-client-test-runtime/src/assembly/index.ts'
import { SESSION_FORMAT_VERSION, type SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionFollowFrame } from '@deepseek-ai/dsh-api-session-controller/types'
import { PersonalSidebarEntry, PersonalSettings } from '../src/client/PersonalSettings.tsx'

const it = createClientTest({ roster: webApp })

it('loads personal records through the registered sidebar seat', async ({ mock, start }) => {
  const sessionId = 'initial-personal-session' as SessionId
  mock.remote.session.create.mockResolvedValue(ok({ sessionId }))
  mock.stream('session/follow', (_request, stream) => {
    stream.push({
      type: 'snapshot',
      header: { version: SESSION_FORMAT_VERSION, id: sessionId, createdAt: 1, isSeeded: false },
      cursor: -1, records: [], hasMore: false,
      projections: { asOfSeq: -1, values: {} }, assistantStream: { revision: 0 },
    } satisfies SessionFollowFrame)
  })
  const c = await start()
  const entry = c.ctx.slots.entries('sidebar.personal').find(item => item.component === PersonalSidebarEntry)
  expect(entry?.component).toBe(PersonalSidebarEntry)
  expect(c.ctx.slots.entries('settings.section').find(item => item.options.id === 'personal')?.component).toBe(PersonalSettings)
  expect(JSON.stringify(c.ctx.slots.snapshot('factory:personal.manager'))).toContain('personal.manager.workflow')
  expect(c.ctx.slots.entries('settings.personal.testing')).toHaveLength(1)
}, 60_000)
