/** Client-memory conversation entry; only a submitted prompt or command materializes persistence. */
import { brandString } from '@deepseek-ai/dsh-brand'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ExternalSessionTarget, SessionFace, SessionReference, SessionControls, SessionSnapshot } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ModelCatalog, ModelSelection, SessionRequestId } from '@deepseek-ai/dsh-api-session-controller/types'

type Materialized = { reference: SessionReference; controls?: SessionControls; dispose(): void; commit(): void }
/** Draft dependencies capture one account and navigation lifetime. */
export interface ConversationDraftOptions {
  eventSource: ExternalSessionTarget['eventSource']
  title: string
  /** @returns Current read-only model directory. */
  loadModels(): Promise<ModelCatalog>
  /** @returns Retained Session owned by the first submitted input. */
  materialize(): Promise<Materialized>
  listTasks: SessionControls['listTasks']
  /** Show task execution controls without persisting this draft. */
  openExecution(): void
}
/**
 * Assemble the standard composer over a local, uncatalogued draft.
 * @param options - Account-scoped model reader and deferred Session attachment.
 * @returns Local presentation and its owned attachment cleanup.
 */
export function createConversationDraft(options: ConversationDraftOptions): ExternalSessionTarget & { dispose(): void } {
  const sessionId = brandString<SessionFace['sessionId']>(`conversation-draft:${randomUUID()}`)
  const snapshot = createSnapshotStore<SessionSnapshot>({ sessionId, pendingSubmissions: [], running: false, subagent: null,
    removed: false, openState: 'open', openError: null, hasMore: false, loadingOlder: false, promptError: null,
    blank: true, lastAgentError: null, promptAttempted: false, awaitingFirstTurn: false })
  const projected = new Map<string, ReturnType<typeof createSnapshotStore<unknown>>>()
  const projection = (key: string) => {
    let store = projected.get(key)
    if (!store) { store = createSnapshotStore<unknown>(undefined); projected.set(key, store) }
    return store
  }
  projection('modelSelection').set({ lastUsed: null, next: null })
  const catalog = createSnapshotStore<ReturnType<SessionControls['catalog']['store']['getSnapshot']>>({ value: null, status: 'idle', error: null })
  let taskId: SessionControls['taskId'], taskTitle: string | undefined
  let model: ModelSelection | undefined, enabled = true, modeRevision = 0, modeChanged = false
  let active = true, materialized: Materialized | undefined, opening: Promise<Materialized> | undefined
  const submissions = new Map<SessionRequestId, Parameters<SessionFace['beginSubmission']>[0]>()
  const assertActive = () => { if (!active) throw new Error('conversation-draft: superseded') }
  const load = async () => {
    assertActive(); catalog.set({ ...catalog.getSnapshot(), status: 'loading', error: null })
    try {
      const value = await options.loadModels(); assertActive()
      catalog.set({ value, status: 'ready', error: null }); return value
    } catch (error: unknown) {
      if (active) catalog.set({ value: null, status: 'error', error: error instanceof Error ? error.message : String(error) })
      throw error
    }
  }
  const open = (): Promise<Materialized> => {
    assertActive()
    if (materialized) return Promise.resolve(materialized)
    opening ??= options.materialize().then(async (initial) => {
      let value = initial
      materialized = value
      if (!active) { materialized = undefined; value.dispose(); throw new Error('conversation-draft: superseded') }
      await value.reference.ready
      let controls = (value.controls ?? value.reference.binding.controls)
      if (!controls) throw new Error('conversation-draft: controls-required')
      if (model) {
        const result = await controls.selectModel(model)
        if (!result.ok) throw new Error(result.error.message)
        if (result.value.sessionId) {
          const replacement = await options.materialize()
          value.dispose(); value = replacement; materialized = replacement
          await value.reference.ready
          controls = (value.controls ?? value.reference.binding.controls)
          if (!controls) throw new Error('conversation-draft: controls-required')
        }
      }
      if (taskId) { await controls.listTasks(); await controls.selectTask(taskId) }
      if (modeChanged) {
        const current = await controls.readMode()
        await controls.setMode(enabled, current.revision, brandString<Parameters<SessionControls['setMode']>[2]>(randomUUID()))
      }
      assertActive(); return value
    }).catch((error: unknown) => { materialized?.dispose(); materialized = undefined; opening = undefined; throw error })
    return opening
  }
  const existing = () => {
    assertActive()
    if (!materialized) throw new Error('conversation-draft: not-submitted')
    return materialized.reference.binding.session
  }
  const session: SessionFace = {
    sessionId, getSnapshot: () => snapshot.getSnapshot(), subscribe: listener => snapshot.subscribe(listener),
    projections: { faceOf: projection },
    beginSubmission: (input) => {
      const requestId = brandString<SessionRequestId>(randomUUID())
      let retired = false
      const captured = { ...input, onRetire: (retirement: Parameters<NonNullable<typeof input.onRetire>>[0]) => {
        if (retired) return
        retired = true; input.onRetire?.(retirement)
      } }
      submissions.set(requestId, captured)
      return { requestId, abandon: () => { submissions.delete(requestId); captured.onRetire({ reason: 'failed' }) } }
    },
    prompt: async (content, mode, signal, requestId) => {
      if (!content.some(part => part.type !== 'text' || part.text.trim())) return { ok: true, value: { accepted: true } }
      signal?.throwIfAborted()
      snapshot.set({ ...snapshot.getSnapshot(), promptAttempted: true, promptError: null })
      const input = requestId ? submissions.get(requestId) : undefined
      try {
        const value = await open(); assertActive(); signal?.throwIfAborted()
        const target = value.reference.binding.session
        const submission = input ? target.beginSubmission(input) : undefined
        const result = await target.prompt(content, mode, signal, submission?.requestId)
        if (requestId) submissions.delete(requestId)
        if (result.ok) { materialized = undefined; value.commit() }
        else snapshot.set({ ...snapshot.getSnapshot(), promptError: { op: 'send', error: result.error } })
        return result
      } catch (error: unknown) {
        if (requestId) submissions.delete(requestId)
        input?.onRetire?.({ reason: 'failed' })
        throw error
      }
    },
    command: async (line) => {
      if (!line.trim()) return { ok: true, value: { matched: false } }
      const value = await open(), result = await value.reference.binding.session.command(line)
      if (result.ok) { materialized = undefined; value.commit() }
      return result
    },
    readAttachment: id => existing().readAttachment(id), updateQueue: (id, action) => existing().updateQueue(id, action),
    cancel: () => existing().cancel(), rename: title => existing().rename(title),
    loadOlder: () => Promise.resolve(), loadThrough: () => Promise.resolve(),
  }
  const controls: SessionControls = {
    catalog: { store: catalog, load, refresh: () => { void load().catch((_error: unknown) => { /* The catalog publishes failure. */ }) } },
    selectModel: (selection) => {
      assertActive(); model = selection; projection('modelSelection').set({ lastUsed: null, next: selection })
      return Promise.resolve({ ok: true, value: { selected: selection } })
    },
    readMode: () => Promise.resolve({ enabled, revision: modeRevision }),
    setMode: (next, expected) => {
      assertActive()
      if (expected !== modeRevision) throw new Error('version-conflict')
      enabled = next; modeChanged = true; return Promise.resolve({ enabled, revision: ++modeRevision })
    },
    listTasks: () => options.listTasks(),
    selectTask: async (id) => {
      assertActive()
      const task = (await options.listTasks()).find(item => item.id === id)
      assertActive()
      if (!task) throw new Error('conversation-draft: task-required')
      taskId = id; taskTitle = task.title
    },
    get taskTitle() { return taskTitle }, get taskId() { return taskId }, assigned: false,
    openExecution: () => { options.openExecution() },
    manage: () => { /* A draft has no durable title or management record. */ },
  }
  return { kind: 'external', session, controls, eventSource: options.eventSource, title: createSnapshotStore(options.title),
    dispose: () => { active = false; materialized?.dispose(); materialized = undefined } }
}
