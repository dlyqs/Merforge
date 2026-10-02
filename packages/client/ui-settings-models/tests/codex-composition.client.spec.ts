// @vitest-environment jsdom
/** The shipped Client Loader binds one setup source and a preference-only first-use step. */
import { expect, onTestFinished, vi } from 'vitest'
import Schema from '@deepseek-ai/schemastery'
import { ok } from '@deepseek-ai/dsh-remote-mock'
import { createClientTest, webApp } from '@deepseek-ai/dsh-client-test-runtime/src/assembly/index.ts'
import { SESSION_FORMAT_VERSION, type SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionFollowFrame } from '@deepseek-ai/dsh-api-session-controller/types'
import type { CodexSetupSnapshot } from '@deepseek-ai/dsh-agent-codex/setup-types'
import type { CodexCardInjected } from '../src/client/CodexCard.tsx'
import type { ModelSetupOnboardingInjected } from '../src/client/ModelSetupOnboarding.tsx'

const it = createClientTest({ roster: webApp })
it('shares the native observation with onboarding, persists only completion and opens one shell-owned target', async ({ mock, start }) => {
  const snapshot: CodexSetupSnapshot = { revision: 1, runtime: { version: '0.153.4', status: 'ready' },
    account: { status: 'known', value: { kind: 'none', requiresOpenaiAuth: true } },
    catalog: { status: 'error', models: [], category: 'login-required' }, login: { status: 'idle' } }
  const off = vi.fn()
  const detect = vi.fn(async () => ({ snapshot }))
  const login = vi.fn()
  vi.stubGlobal('dshDesktop', { protocolVersion: 2, codexSetup: { subscribe: () => off, detect, start: login } })
  onTestFinished(() => { vi.unstubAllGlobals() })
  const sessionId = 'setup-composition' as SessionId
  mock.remote.session.create.mockResolvedValue(ok({ sessionId }))
  mock.stream('session/follow', (_request, stream) => {
    stream.push({ type: 'snapshot', header: { version: SESSION_FORMAT_VERSION, id: sessionId, createdAt: 1, isSeeded: false },
      cursor: -1, records: [], hasMore: false, projections: { asOfSeq: -1, values: {} }, assistantStream: { revision: 0 },
    } satisfies SessionFollowFrame)
  })
  const namespace = (value: Record<string, unknown>, revision: number) => ({
    ns: 'ui-settings-general',
    schema: Schema.object({ modelSetupVersion: Schema.string() }).toJSON(),
    value, base: {}, user: value, autoGenerate: false, applies: 'live' as const, secrets: [], revision,
  })
  mock.remote.settings.describe.mockResolvedValue(ok({ writable: true, hasDocument: true, namespaces: [namespace({}, 0)] }))
  mock.remote.settings.mutate.mockResolvedValue(ok(namespace({ modelSetupVersion: 'v1' }, 1)))
  const c = await start()
  const card = c.ctx.slots.entries('settings.models.native')[0]!
  const cardFace = (card.inject as () => CodexCardInjected)()
  const step = c.ctx.slots.entries('settings.onboarding').find(entry => entry.options.id === 'model-setup')!
  const stepFace = (step.inject as () => ModelSetupOnboardingInjected)()
  expect(c.ctx.slots.entries('settings.onboarding').map(entry => entry.options.id)).toEqual(['model-setup'])
  expect(cardFace.hooks.codex).toBe(stepFace.hooks.codex)
  cardFace.ensure(); stepFace.ensure()
  await vi.waitFor(() => { expect(cardFace.hooks.codex.getSnapshot().view?.snapshot.account.status).toBe('known') })
  expect(detect).toHaveBeenCalledOnce()
  expect(login).not.toHaveBeenCalled()
  expect(await stepFace.acknowledge()).toBe(true)
  expect(mock.remote.settings.mutate).toHaveBeenCalledWith('ui-settings-general', [
    { op: 'set', path: ['modelSetupVersion'], value: 'v1' },
  ], 0)
  c.ctx.settingsNavigation.open('models', 'codex')
  expect(c.ctx.settingsNavigation.view.getSnapshot()).toEqual({ open: true, section: 'models', target: 'codex' })
  await c.unload('@deepseek-ai/dsh-client-ui-settings-models')
  expect(off).toHaveBeenCalledOnce()
  expect(c.ctx.slots.entries('settings.models.native')).toHaveLength(0)
}, 60_000)
