// @vitest-environment jsdom
/** Personal navigation through the shipped Web plugin roster. */
import { expect } from 'vitest'
import { ok } from '@deepseek-ai/dsh-remote-mock'
import { createClientTest, webApp } from '@deepseek-ai/dsh-client-test-runtime/src/assembly/index.ts'
import { SESSION_FORMAT_VERSION, type SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionFollowFrame } from '@deepseek-ai/dsh-api-session-controller/types'
import type { PersonalInjected } from '../src/client/contract.ts'
import { PersonalSidebar } from '../src/client/PersonalSidebar.tsx'

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
  const entry = c.ctx.slots.entries('sidebar.personal')[0]
  expect(entry?.component).toBe(PersonalSidebar)
  expect(entry?.locale).toBe('personal')
  expect(entry?.inject).toBeDefined()
  const face = entry!.inject!() as Partial<PersonalInjected>
  expect(face.hooks?.records.getSnapshot().phase).toBe('loading')
  mock.remote.session.personalList.mockResolvedValue(ok({ projects: [], bots: [] }))
  await face.refresh?.()
  expect(face.hooks?.records.getSnapshot()).toEqual({ phase: 'ready', projects: [], bots: [] })
}, 60_000)
