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
