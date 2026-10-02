/** Native model selection replacement and login refresh without a rendered page. */
import { expect, it, vi } from 'vitest'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ModelSelectionProjection } from '@deepseek-ai/dsh-api-session-controller/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { ModelDirectory } from '../src/client/directory.ts'
import { ModelCatalogDirectory } from '../src/client/catalog.ts'

const id = 'source' as SessionId
const replacement = 'replacement' as SessionId
const selected = { backend: 'codex' as const, provider: 'codex', model: 'native', reasoningEffort: 'medium' }
const value = { default: { provider: 'api', model: 'api' }, groups: [], failures: [], routableProviders: [] }

it('submits the native discriminant and opens the independently created conversation', async () => {
  const catalog = new ModelCatalogDirectory({ remote: { session: { modelCatalog: async () => ({ ok: true, value }) } } } as never)
  const selectModel = vi.fn(async () => ({ ok: true as const, value: { selected, sessionId: replacement } }))
  const open = vi.fn(async () => {})
  const projection = createSnapshotStore<ModelSelectionProjection>({ lastUsed: null, next: null })
  const subject = new ModelDirectory({ selectModel }, id, () => true, catalog, projection, open)
  try {
    await subject.load()
    await expect(subject.select(selected)).resolves.toEqual({ ok: true, value: undefined })
    expect(selectModel).toHaveBeenCalledWith({ sessionId: id, ...selected })
    expect(open).toHaveBeenCalledWith(replacement)
    expect(projection.getSnapshot().next).toBeNull()
  } finally { subject.dispose() }
})

it('refreshes a ready catalog containing native login failure after explicit retry', async () => {
  const modelCatalog = vi.fn().mockResolvedValueOnce({ ok: true, value: { ...value, failures: [{ id: 'codex', name: 'Codex', message: 'login required' }] } })
    .mockResolvedValueOnce({ ok: true, value: { ...value, routableProviders: ['codex'] } })
  const catalog = new ModelCatalogDirectory({ remote: { session: { modelCatalog } } } as never)
  const subject = new ModelDirectory({ selectModel: async () => ({ ok: true, value: { selected } }) }, id, () => true, catalog,
    createSnapshotStore<ModelSelectionProjection>({ lastUsed: null, next: selected }))
  try {
    await subject.load()
    expect(subject.store.getSnapshot().routable).toBe(false)
    await subject.load()
    expect(modelCatalog).toHaveBeenCalledTimes(2)
    expect(subject.store.getSnapshot().routable).toBe(true)
  } finally { subject.dispose() }
})
