/** Unsaved conversation controls and rejected first submissions never create records implicitly. */
import { expect, it, vi } from 'vitest'
import type { SessionFace, SessionReference, SessionControls } from '@deepseek-ai/dsh-api-session-controller/client'
import { MutableSessionEventSource } from '@deepseek-ai/dsh-api-session-controller/client'
import { createConversationDraft } from '../src/client/sessions/conversation-draft.ts'
function fixture() {
  const materialize = vi.fn(async () => { throw new Error('offline') })
  const loadModels = vi.fn(async () => ({ default: { provider: 'test', model: 'test' }, groups: [], failures: [], routableProviders: ['test'] }))
  const draft = createConversationDraft({ eventSource: new MutableSessionEventSource(), title: 'Draft', loadModels,
    materialize, listTasks: async () => [], openExecution: vi.fn() })
  return { draft, materialize, loadModels }
}
it('keeps model and planning choices local and ignores whitespace or aborted submissions', async () => {
  const h = fixture()
  await h.draft.controls.catalog.load()
  await h.draft.controls.selectModel({ provider: 'chosen', model: 'chosen' })
  await h.draft.controls.setMode(false, 0, 'gesture' as Parameters<typeof h.draft.controls.setMode>[2])
  expect(await h.draft.controls.readMode()).toEqual({ enabled: false, revision: 1 })
  expect(h.draft.session.projections.faceOf('modelSelection').getSnapshot()).toEqual({ lastUsed: null, next: { provider: 'chosen', model: 'chosen' } })
  await h.draft.session.prompt([{ type: 'text', text: '   ' }], 'queue')
  await h.draft.session.command('   ')
  const cancel = new AbortController(); cancel.abort()
  await expect(h.draft.session.prompt([{ type: 'text', text: 'Unsent' }], 'queue', cancel.signal)).rejects.toThrow()
  expect(h.materialize).not.toHaveBeenCalled()
  h.draft.dispose()
})
it('preserves the draft after a failed first send and retries only on another submit', async () => {
  const h = fixture(), onRetire = vi.fn()
  const echo = h.draft.session.beginSubmission({ text: 'First message', attachments: [], mode: 'queue', onRetire })
  await expect(h.draft.session.prompt([{ type: 'text', text: 'First message' }], 'queue', undefined, echo.requestId)).rejects.toThrow('offline')
  echo.abandon()
  expect(onRetire).toHaveBeenCalledExactlyOnceWith({ reason: 'failed' })
  expect(h.materialize).toHaveBeenCalledOnce()
  expect(h.draft.session.getSnapshot().blank).toBe(true)
  await expect(h.draft.session.prompt([{ type: 'text', text: 'Retry' }], 'queue')).rejects.toThrow('offline')
  expect(h.materialize).toHaveBeenCalledTimes(2)
  h.draft.dispose()
})

it('applies the selected model and planning mode before admitting the first input', async () => {
  const prompt = vi.fn<SessionFace['prompt']>(async () => ({ ok: true, value: { accepted: true } }))
  const selectModel = vi.fn<SessionControls['selectModel']>(async selection => ({ ok: true, value: { selected: selection } }))
  const setMode = vi.fn<SessionControls['setMode']>(async enabled => ({ enabled, revision: 8 }))
  const commit = vi.fn(), dispose = vi.fn()
  const materialize = vi.fn(async () => {
    const sessionId = 'persisted' as SessionFace['sessionId']
    const binding = { sessionId, session: { prompt } } as SessionReference['binding']
    const reference: SessionReference = { sessionId, binding, ready: Promise.resolve(binding), release: dispose, [Symbol.dispose]: dispose }
    return { reference, commit, dispose, controls: { ...draft.controls, selectModel, setMode,
      readMode: () => Promise.resolve({ enabled: true, revision: 7 }) } }
  })
  const draft = createConversationDraft({ eventSource: new MutableSessionEventSource(), title: 'Draft',
    loadModels: () => Promise.resolve({ default: { provider: 'test', model: 'test' }, groups: [], failures: [], routableProviders: ['test'] }),
    materialize, listTasks: () => Promise.resolve([]), openExecution: vi.fn() })
  const model = { provider: 'selected', model: 'selected' }
  await draft.controls.selectModel(model)
  await draft.controls.setMode(false, 0, 'gesture' as Parameters<SessionControls['setMode']>[2])
  expect(materialize).not.toHaveBeenCalled()
  await draft.session.prompt([{ type: 'text', text: 'Submitted' }], 'queue')
  expect(selectModel).toHaveBeenCalledExactlyOnceWith(model)
  expect(setMode).toHaveBeenCalledWith(false, 7, expect.any(String))
  expect(setMode.mock.invocationCallOrder[0]).toBeLessThan(prompt.mock.invocationCallOrder[0]!)
  expect(commit).toHaveBeenCalledOnce()
  expect(dispose).not.toHaveBeenCalled()
  draft.dispose()
})

it('initializes draft permissions and defers changes until the first prompt', async () => {
  const command = vi.fn<SessionFace['command']>(async () => ({ ok: true, value: { matched: true } }))
  const prompt = vi.fn<SessionFace['prompt']>(async () => ({ ok: true, value: { accepted: true } }))
  const materialize = vi.fn(async () => {
    const binding = { sessionId: draft.session.sessionId, session: { command, prompt } } as SessionReference['binding']
    const dispose = vi.fn()
    const reference: SessionReference = { sessionId: binding.sessionId, binding, ready: Promise.resolve(binding),
      release: dispose, [Symbol.dispose]: dispose }
    return { reference, controls: draft.controls, dispose, commit: vi.fn() }
  })
  const draft = createConversationDraft({ eventSource: new MutableSessionEventSource(), title: 'Draft',
    loadModels: async () => ({ default: { provider: 'test', model: 'test' }, groups: [], failures: [], routableProviders: ['test'] }),
    loadPermissions: async () => ({ defaultPreset: 'read-only', options: [{ value: 'read-only' }, { value: 'workspace-write' }] }),
    materialize, listTasks: async () => [], openExecution: vi.fn() })
  try {
    await vi.waitFor(() => { expect(draft.session.projections.faceOf('permissions').getSnapshot()).toEqual({ currentValue: 'read-only' }) })
    await draft.session.command('/permission workspace-write')
    expect(draft.session.projections.faceOf('permissions').getSnapshot()).toEqual({ currentValue: 'workspace-write' })
    await expect(draft.session.command('/permission missing')).rejects.toThrow('unknown-permission-preset')
    expect(materialize).not.toHaveBeenCalled()
    expect(command).not.toHaveBeenCalled()
    await draft.session.prompt([{ type: 'text', text: 'Start' }], 'queue')
    expect(command).toHaveBeenCalledExactlyOnceWith('/permission workspace-write')
    expect(command.mock.invocationCallOrder[0]).toBeLessThan(prompt.mock.invocationCallOrder[0]!)
  } finally { draft.dispose() }
})

it('leaves the first prompt unsubmitted when its permission change is refused', async () => {
  const command = vi.fn<SessionFace['command']>(async () => ({ ok: true, value: { matched: false } }))
  const prompt = vi.fn<SessionFace['prompt']>()
  const dispose = vi.fn()
  const draft = createConversationDraft({ eventSource: new MutableSessionEventSource(), title: 'Draft',
    loadModels: async () => ({ default: { provider: 'test', model: 'test' }, groups: [], failures: [], routableProviders: ['test'] }),
    loadPermissions: async () => ({ defaultPreset: 'read-only', options: [{ value: 'workspace-write' }] }),
    materialize: async () => {
      const binding = { sessionId: draft.session.sessionId, session: { command, prompt } } as SessionReference['binding']
      const reference: SessionReference = { sessionId: binding.sessionId, binding, ready: Promise.resolve(binding),
        release: dispose, [Symbol.dispose]: dispose }
      return { reference, controls: draft.controls, dispose, commit: vi.fn() }
    }, listTasks: async () => [], openExecution: vi.fn() })
  try {
    await draft.session.command('/permission workspace-write')
    await expect(draft.session.prompt([{ type: 'text', text: 'Start' }], 'queue')).rejects.toThrow('permission-command-required')
    expect(prompt).not.toHaveBeenCalled()
    expect(dispose).toHaveBeenCalledOnce()
  } finally { draft.dispose() }
})

it('retains account planning detail locally and applies it before the first submitted input', async () => {
  const prompt = vi.fn<SessionFace['prompt']>(async () => ({ ok: true, value: { accepted: true } }))
  const setPlanningPreferences = vi.fn<SessionControls['setPlanningPreferences']>(async request => ({ enabled: request.enabled,
    granularity: request.granularity, revision: 5 }))
  const dispose = vi.fn(), commit = vi.fn()
  const draft = createConversationDraft({ eventSource: new MutableSessionEventSource(), title: 'Draft',
    loadModels: () => Promise.resolve({ default: { provider: 'test', model: 'test' }, groups: [], failures: [], routableProviders: ['test'] }),
    listTasks: () => Promise.resolve([]), openExecution: vi.fn(), materialize: async () => {
      const sessionId = 'persisted' as SessionFace['sessionId']
      const binding = { sessionId, session: { prompt } } as SessionReference['binding']
      const reference: SessionReference = { sessionId, binding, ready: Promise.resolve(binding), release: dispose,
        [Symbol.dispose]: dispose }
      return { reference, dispose, commit, controls: { ...draft.controls, setPlanningPreferences,
        readPlanningPreferences: async () => ({ enabled: true, granularity: 'balanced', revision: 4 }) } }
    } })
  await draft.controls.setPlanningPreferences({ enabled: true, granularity: 'fine', expectedRevision: 0 })
  expect(await draft.controls.readPlanningPreferences()).toEqual({ enabled: true, granularity: 'fine', revision: 1 })
  expect(setPlanningPreferences).not.toHaveBeenCalled()
  await draft.session.prompt([{ type: 'text', text: 'Submitted' }], 'queue')
  expect(setPlanningPreferences).toHaveBeenCalledExactlyOnceWith({ enabled: true, granularity: 'fine', expectedRevision: 4 })
  expect(setPlanningPreferences.mock.invocationCallOrder[0]).toBeLessThan(prompt.mock.invocationCallOrder[0]!)
  draft.dispose()
})

it('saves personal profile planning preferences without materializing the draft or changing its mode', async () => {
  const materialize = vi.fn(async () => { throw new Error('should remain unsaved') })
  const readPlanningPreferences = vi.fn<SessionControls['readPlanningPreferences']>(async () => ({ enabled: false,
    granularity: 'fine', revision: 8 }))
  const setPlanningPreferences = vi.fn<SessionControls['setPlanningPreferences']>(async () => ({ enabled: false, granularity: 'balanced', revision: 9 }))
  const draft = createConversationDraft({ eventSource: new MutableSessionEventSource(), title: 'Draft', planningScope: 'personal',
    planningPreferences: { readPlanningPreferences, setPlanningPreferences }, materialize,
    loadModels: () => Promise.resolve({ default: { provider: 'test', model: 'test' }, groups: [], failures: [], routableProviders: ['test'] }),
    listTasks: () => Promise.resolve([]), openExecution: vi.fn() })
  expect(await draft.controls.readPlanningPreferences()).toEqual({ enabled: false, granularity: 'fine', revision: 8 })
  await draft.controls.setPlanningPreferences({ enabled: false, granularity: 'balanced', expectedRevision: 8 })
  expect(setPlanningPreferences).toHaveBeenCalledExactlyOnceWith({ enabled: false, granularity: 'balanced', expectedRevision: 8 })
  expect(await draft.controls.readMode()).toEqual({ enabled: true, revision: 0 })
  expect(materialize).not.toHaveBeenCalled()
  draft.dispose()
})
