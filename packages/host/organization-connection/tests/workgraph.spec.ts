/** WorkGraph native actions exercised against real HTTPS and SQLite, without a page. */
import { afterEach, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { bootOrganization } from '../../../../apps/desktop-host/src/organization-boot.ts'
import { OrganizationConnection } from '../src/index.ts'
import { workgraphHarness, password } from '../../../api/organization-api/tests/workgraph-harness.ts'
import * as transport from '@deepseek-ai/dsh-organization-api/transport'

const cleanup: (() => unknown)[] = []
afterEach(async () => { vi.restoreAllMocks(); for (const close of cleanup.splice(0).reverse()) await close() })
async function setup() {
  const h = await workgraphHarness(); cleanup.push(h.close)
  const connect = async (username: string) => {
    const connection = new OrganizationConnection({ trustPath: join(h.root, `${username}.json`), reconnectMs: 100 })
    cleanup.push(() => connection.close())
    await connection.perform({ kind: 'probe', origin: h.trust.origin })
    await connection.perform({ kind: 'trust', fingerprint: h.trust.fingerprint })
    await connection.perform({ kind: 'login', username, password })
    await connection.perform({ kind: 'select', organizationId: h.owner.organizationId })
    return connection
  }
  const owner = await connect('owner'), member = await connect('reader')
  await expect.poll(() => [owner.snapshot().phase, member.snapshot().phase]).toEqual(['ready', 'ready'])
  return { ...h, ownerClient: owner, memberClient: member }
}

it('partitions real task results by account/server/organization/generation and clears on task invalidation', async () => {
  const h = await setup()
  const owner = await h.ownerClient.perform({ kind: 'workgraph-tasks', request: h.query })
  const member = await h.memberClient.perform({ kind: 'workgraph-tasks', request: h.query })
  expect(owner.workgraph?.result).toMatchObject({ kind: 'tasks', value: { total: 3 } })
  expect(member.workgraph?.result).toMatchObject({ kind: 'tasks', value: { total: 1, items: [{ goal: 'Visible task' }] } })
  expect(member.workgraph?.principal.accountId).toBe(h.member.accountId)
  expect(member.workgraph?.principal.serverId).toBe(h.owner.principal.serverId)
  expect(member.workgraph?.organizationId).toBe(h.owner.organizationId)
  expect(member.workgraph?.generation).toBe(h.memberClient.snapshot().generation)
  expect(member.workgraph?.requestId).not.toBe(owner.workgraph?.requestId)
  expect(JSON.stringify(member)).not.toContain('HIDDEN')
  expect(JSON.stringify(h.ownerClient.snapshot())).not.toContain('HIDDEN')
  expect(JSON.stringify(h.memberClient.snapshot())).not.toContain(h.member.token)
  const generation = h.memberClient.snapshot().generation
  const definition = structuredClone(h.save.definition); definition.tasks[1]!.goal = 'Refetch required'
  await h.ownerClient.perform({ kind: 'workgraph-save', request: { ...h.save, definition, expectedRevision: 1, operationId: randomUUID() } })
  await expect.poll(() => h.memberClient.snapshot().generation).toBeGreaterThan(generation)
  await expect.poll(() => h.memberClient.snapshot().phase).toBe('ready')
  const refreshed = await h.memberClient.perform({ kind: 'workgraph-tasks', request: h.query })
  expect(refreshed.workgraph?.result).toMatchObject({ value: { items: [{ goal: 'Refetch required' }] } })
  await h.ownerClient.perform({ kind: 'workgraph-grant', request: { ...h.grant, actions: [], expectedVersion: h.receipt.revision, operationId: randomUUID() } })
  await expect.poll(() => h.memberClient.snapshot().generation).toBeGreaterThan(refreshed.workgraph!.generation)
  await expect.poll(() => h.memberClient.snapshot().phase).toBe('ready')
  await expect(h.memberClient.perform({ kind: 'workgraph-tasks', request: h.query })).rejects.toThrow('forbidden')
}, 20000)

it('discards late task content after personal mode, account switch or organization switch', async () => {
  const h = await setup()
  const beta = await h.app.authority.execute(h.owner.token, { kind: 'create-organization', name: 'Beta', operationId: randomUUID() })
  const original = transport.organizationRequest
  for (const transition of ['personal', 'login', 'select'] as const) {
    await h.memberClient.perform({ kind: 'select', organizationId: h.owner.organizationId })
    let arrived!: () => void, release!: () => void
    const ready = new Promise<void>((resolve) => { arrived = resolve })
    const barrier = new Promise<void>((resolve) => { release = resolve })
    const delayed = vi.spyOn(transport, 'organizationRequest').mockImplementation(async (...args) => {
      const response = await original(...args)
      if (args[2] === '/organization/v1/workgraph/tasks') { arrived(); await barrier }
      return response
    })
    const request = h.memberClient.perform({ kind: 'workgraph-tasks', request: h.query })
    const rejection = expect(request).rejects.toThrow('superseded')
    await ready
    if (transition === 'personal') await h.memberClient.perform({ kind: 'personal' })
    else if (transition === 'login') await h.memberClient.perform({ kind: 'login', username: 'owner', password })
    else await h.memberClient.perform({ kind: 'select', organizationId: beta.organizationId! })
    release(); await rejection; delayed.mockRestore()
    expect(JSON.stringify(h.memberClient.snapshot())).not.toContain('Visible task')
  }
}, 20000)

it('retains a lost write receipt through native restart and never automatically replays a save', async () => {
  const h = await setup()
  const original = transport.organizationRequest
  let saves = 0
  const interrupted = vi.spyOn(transport, 'organizationRequest').mockImplementation(async (...args) => {
    const response = await original(...args)
    if (args[2] === '/organization/v1/workgraph/save') { saves++; throw new Error('lost after commit') }
    return response
  })
  const operationId = randomUUID()
  await expect(h.ownerClient.perform({ kind: 'workgraph-save', request: { ...h.save, expectedRevision: 1, operationId } })).rejects.toThrow('unavailable')
  expect(h.ownerClient.snapshot().pendingOperation).toBe(operationId)
  await h.ownerClient.close()
  interrupted.mockRestore()
  const journal = await readFile(join(h.root, 'owner.json.pending'), 'utf8')
  expect(journal).toContain(operationId)
  expect(journal).not.toContain('HIDDEN')
  expect(journal).not.toContain(h.owner.token)
  const reopened = new OrganizationConnection({ trustPath: join(h.root, 'owner.json') }); cleanup.push(() => reopened.close())
  await reopened.perform({ kind: 'login', username: 'owner', password })
  expect((await reopened.perform({ kind: 'reconcile' })).receipt).toMatchObject({ operationId, planRevision: 2 })
  expect(saves).toBe(1)
  await reopened.perform({ kind: 'select', organizationId: h.owner.organizationId })
  expect((await reopened.perform({ kind: 'workgraph-read', request: h.query })).workgraph?.result).toMatchObject({ kind: 'plan', value: { revision: 2 } })
}, 20000)

it('refuses malformed native actions, impersonation and offline writes; reconnect requires fresh state', async () => {
  const h = await setup()
  for (const request of [{ ...h.query, accountId: h.owner.accountId }, { ...h.query, organizationId: randomUUID() }, { ...h.query, sessionId: 'private' }]) {
    await expect(h.memberClient.perform({ kind: 'workgraph-tasks', request })).rejects.toThrow()
  }
  await expect(h.memberClient.perform({ kind: 'command', command: { kind: 'approve', ...h.query } })).rejects.toThrow()
  await h.ownerClient.perform({ kind: 'reconnect' })
  const before = h.ownerClient.snapshot().generation
  await h.app.close()
  await expect.poll(() => h.ownerClient.snapshot().phase).toBe('offline')
  expect(h.ownerClient.snapshot().generation).toBeGreaterThan(before)
  expect(h.ownerClient.snapshot().projects).toBeUndefined()
  await expect(h.ownerClient.perform({ kind: 'workgraph-save', request: { ...h.save, expectedRevision: 1, operationId: randomUUID() } })).rejects.toThrow('unavailable')
  await expect(h.ownerClient.perform({ kind: 'workgraph-read', request: h.query })).rejects.toThrow('unavailable')
  const restarted = await bootOrganization({ ...h.config, api: { ...h.config.api, port: h.app.ready.port } })
  cleanup.push(restarted.close)
  await expect.poll(() => h.ownerClient.snapshot().phase).toBe('ready')
  expect((await h.ownerClient.perform({ kind: 'workgraph-tasks', request: h.query })).workgraph?.result).toMatchObject({ value: { total: 3 } })
}, 20000)
