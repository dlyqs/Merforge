/** Native HTTPS authorization and private Host cleanup, without a Renderer. */
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { OrganizationConnection } from '@deepseek-ai/dsh-organization-connection'
import { workgraphHarness, password } from '../../../api/organization-api/tests/workgraph-harness.ts'
import { organizationConversation, type ConversationHost } from '../../../../apps/desktop/src/organization-conversation.ts'
import { conversationRequestSchema, conversationResultSchema, type ConversationBridge } from '../src/protocol.ts'
import { boot } from './harness.ts'

async function setup() {
  const remote = await workgraphHarness()
  const connection = new OrganizationConnection({ trustPath: join(remote.root, 'native.json'), timeoutMs: 5000 })
  try {
    await connection.perform({ kind: 'probe', origin: remote.trust.origin })
    await connection.perform({ kind: 'trust', fingerprint: remote.trust.fingerprint })
    await connection.perform({ kind: 'login', username: 'reader', password })
    await connection.perform({ kind: 'select', organizationId: remote.owner.organizationId })
    return { remote, connection, close: async () => { await connection.close(); await remote.close() } }
  } catch (error) { await connection.close(); await remote.close(); throw error }
}

it('finishes catalog and conversation reads before releasing their native authorization', async () => {
  const h = await setup(), local = await boot(h.remote.root)
  const host: ConversationHost = { organizationConversation: async (request, authorize, timeoutMs, signal, onClosed) => {
    try { return await local.host.organizationConversation(request, authorize, timeoutMs, signal) }
    finally { onClosed?.() }
  } }
  try {
    const request = conversationRequestSchema.parse({ kind: 'open', organizationId: h.remote.query.organizationId,
      projectId: h.remote.query.projectId,
      conversationId: randomUUID(), operationId: randomUUID() })
    const opened = await organizationConversation(h.connection, host, request, () => {}, new AbortController().signal)
    const catalog = await organizationConversation(h.connection, host, { ...request, kind: 'catalog', operationId: randomUUID() },
      () => {}, new AbortController().signal)
    expect(catalog.result.catalog?.conversations).toContainEqual(expect.objectContaining({ conversationId: request.conversationId }))
    const read = await organizationConversation(h.connection, host, { ...request, kind: 'read' }, () => {}, new AbortController().signal)
    expect(read.result.sessionId).toBe(opened.result.sessionId)
  } finally { await local.close(); await h.close() }
})

it('retains an attached conversation across project refreshes and cancels it on logout', async () => {
  const h = await setup(), lifetime = new AbortController(), closed = vi.fn()
  let authorize: ConversationBridge | undefined, signal: AbortSignal | undefined
  const host: ConversationHost = { organizationConversation: async (request, bridge, _timeoutMs, nativeSignal, onClosed) => {
    authorize = bridge; signal = nativeSignal
    nativeSignal.addEventListener('abort', () => { onClosed?.() }, { once: true })
    const authority = await bridge()
    return conversationResultSchema.parse({ sessionId: `organization-conversation:${randomUUID()}`,
      sharedSessionId: `session-${randomUUID()}`, attachmentId: request.operationId,
      owner: { serverId: authority.serverId, accountId: authority.accountId, organizationId: request.organizationId,
        projectId: request.projectId, conversationId: request.conversationId },
      settings: { enabled: true, granularity: 'balanced', revision: 0 }, entries: [], goals: [], truncated: false, state: 'ready' })
  } }
  try {
    const request = conversationRequestSchema.parse({ kind: 'attach', organizationId: h.remote.query.organizationId,
      projectId: h.remote.query.projectId, conversationId: randomUUID(), operationId: randomUUID() })
    const initial = await organizationConversation(h.connection, host, request, () => {}, lifetime.signal, closed)
    const identityGeneration = h.connection.snapshot().identityGeneration
    const projects = await h.connection.perform({ kind: 'project-page', offset: 0 })
    const project = projects.projects!.items[0]!
    expect((await h.remote.call('/projects', { kind: 'rename-project', organizationId: project.organizationId,
      projectId: project.id, expectedVersion: project.version, name: 'Refreshed project', operationId: randomUUID() })).status).toBe(200)
    await vi.waitFor(() => { expect(h.connection.snapshot().generation).toBeGreaterThan(initial.generation)
      expect(h.connection.snapshot().phase).toBe('ready') })
    expect(signal?.aborted).toBe(false)
    expect(h.connection.snapshot().identityGeneration).toBe(identityGeneration)
    expect((await authorize!()).view.project?.name).toBe('Refreshed project')
    expect(closed).not.toHaveBeenCalled()
    await h.connection.perform({ kind: 'logout' })
    expect(h.connection.snapshot().identityGeneration).toBeGreaterThan(identityGeneration)
    expect(signal?.aborted).toBe(true)
    expect(closed).toHaveBeenCalledTimes(1)
  } finally { lifetime.abort(); await h.close() }
})
