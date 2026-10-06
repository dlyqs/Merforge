import { mkdtemp, rm, writeFile, readdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import Storage from '@deepseek-ai/dsh-storage'
import * as JsonStorage from '@deepseek-ai/dsh-storage-json'
import * as Domain from '@deepseek-ai/dsh-storage-domain'
import Sessions, { SessionId, Session } from '@deepseek-ai/dsh-session'
import Query from '@deepseek-ai/dsh-session-query'
import Projections from '@deepseek-ai/dsh-session-projection'
import Invariants from '@deepseek-ai/dsh-invariants'
import * as ContextInvariant from '../src/invariant.ts'
import Agents from '@deepseek-ai/dsh-agent'
import Jsonl from '@deepseek-ai/dsh-session-persistence-jsonl'
import { afterEach, expect, it, vi } from 'vitest'
import OrganizationContext, { contextAuthoritySchema, contextRequestSchema } from '../src/index.ts'

const roots: string[] = []
const contexts: Context[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
async function boot(root?: string) {
  root ??= await mkdtemp(join(tmpdir(), 'organization-context-'))
  if (!roots.includes(root)) roots.push(root)
  const ctx = new Context(); contexts.push(ctx)
  ctx.baseUrl = pathToFileURL(root).href + '/'
  const modules = new Map<string, unknown>([['storage', Storage], ['json', JsonStorage], ['domain', Domain],
    ['sessions', Sessions], ['projections', Projections], ['query', Query], ['invariants', Invariants], ['context-invariant', ContextInvariant], ['agents', Agents], ['jsonl', Jsonl], ['organization-context', OrganizationContext]])
  const config = [{ name: 'storage' }, { name: 'json', config: { root: join(root, 'data') } },
    { name: 'domain', config: { backend: 'json' } }, { name: 'sessions' }, { name: 'agents' }, { name: 'projections' }, { name: 'query' }, { name: 'invariants' },
    { name: 'jsonl', config: { root: join(root, 'personal'), compression: 'none' } },
    { name: 'organization-context', config: { root: join(root, 'organization') } }, { name: 'context-invariant' }]
  const configPath = join(root, 'cordis.yml'); await writeFile(configPath, JSON.stringify(config))
  await ctx.plugin(Loader); ctx.loader.builtins.include = Include
  ctx.loader.internal = { version: 'v2', async import(specifier: string) { return modules.get(specifier) } } as never
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  expect([...ctx.loader.entries()].filter(entry => !entry.fiber && !entry.disabled)).toEqual([])
  return { ctx, root, service: ctx.organizationContext }
}
function fixture() {
  const request = contextRequestSchema.parse({ organizationId: randomUUID(), projectId: randomUUID(),
    planId: randomUUID(), taskId: randomUUID(), operationId: contextRequestSchema.shape.operationId.parse(randomUUID()) })
  const authority = contextAuthoritySchema.parse({ serverId: randomUUID(), accountId: randomUUID(), organizationId: request.organizationId,
    generation: 1, requestId: randomUUID(), task: { id: request.taskId, planId: request.planId, revision: 1,
      parentTaskId: null, phaseId: randomUUID(), phaseTitle: 'Preparation', goal: 'Authorized sentinel', scope: 'Scope',
      acceptance: ['Review'], artifacts: [], required: true, dependsOn: [], suggestedMembershipId: null,
      assignable: false, status: 'pending', hasUndisclosedPrerequisite: true } })
  return { request, authority }
}
const signal = () => new AbortController().signal
it('persists exactly two required events and reopens the original snapshot under the same identity', async () => {
  const { request, authority } = fixture()
  const first = await boot()
  const authorize = vi.fn(async () => authority)
  const [one, duplicate] = await Promise.all([
    first.service.open(request, authorize, signal()), first.service.open(request, authorize, signal()),
  ])
  expect(duplicate).toEqual(one)
  expect(authorize).toHaveBeenCalledTimes(6)
  expect(first.ctx.sessions.list()).toEqual([])
  expect(await first.ctx.sessionPersistence.list()).toEqual([])
  await first.ctx.fiber.dispose()
  const second = await boot(first.root)
  const reopened = await second.service.open({ ...request, operationId: contextRequestSchema.shape.operationId.parse(randomUUID()) }, async () => ({ ...authority, task: { ...authority.task, goal: 'New version' } }), signal())
  expect(reopened).toEqual(one)
  const files = await readdir(join(first.root, 'organization'), { recursive: true })
  const logs = files.filter(file => file.endsWith('.jsonl'))
  expect(logs).toHaveLength(1)
  const log = await readFile(join(first.root, 'organization', logs[0]!), 'utf8')
  expect(log).toContain('organization/context')
  expect(log).toContain('organization/task-snapshot')
  expect(log).not.toMatch(/turn\/start|tool\/call|New version/)
})
it('isolates accounts and tasks, rejects forged identity input and conflicting operation receipts', async () => {
  const { service } = await boot(); const { request, authority } = fixture()
  const a = await service.open(request, async () => authority, signal())
  const otherAccount = contextAuthoritySchema.shape.accountId.parse(randomUUID())
  const b = await service.open({ ...request, operationId: contextRequestSchema.shape.operationId.parse(randomUUID()) },
    async () => ({ ...authority, accountId: otherAccount }), signal())
  expect(a.sessionId).not.toBe(b.sessionId)
  expect(() => service.open({ ...request, accountId: authority.accountId } as never, async () => authority, signal())).toThrow()
  await expect(service.open(request, async () => ({ ...authority, accountId: contextAuthoritySchema.shape.accountId.parse(randomUUID()) }), signal())).rejects.toThrow('operation-conflict')
  await expect(service.open(request, async () => ({ ...authority, task: { ...authority.task, id: contextRequestSchema.shape.taskId.parse(randomUUID()) } }), signal())).rejects.toThrow('superseded')
})
it('refuses reserved IDs in personal hot, cold, fork and Agent execution entries', async () => {
  const { ctx, service } = await boot(); const { request, authority } = fixture()
  const { sessionId } = await service.open(request, async () => authority, signal())
  expect(() => ctx.sessions.create(sessionId)).toThrow('forbidden')
  expect(() => ctx.sessions.enter(Session.create(sessionId))).toThrow('forbidden')
  expect(() => ctx.sessions.get(sessionId)).toThrow('forbidden')
  const personal = ctx.sessions.create(SessionId('personal'))
  expect(() => ctx.sessions.fork(personal, undefined, sessionId)).toThrow('forbidden')
  await expect(ctx.sessionPersistence.open(sessionId, 'read')).rejects.toThrow('forbidden')
  await expect(ctx.sessionPersistence.stat(sessionId)).rejects.toThrow('forbidden')
  await expect(ctx.sessionPersistence.delete(sessionId)).rejects.toThrow('forbidden')
  expect(() => ctx.sessionQuery.observeSession(sessionId)).toThrow('forbidden')
  await expect(ctx.sessionQuery.readSession(sessionId)).rejects.toThrow('forbidden')
  expect((await ctx.sessionQuery.filterSessions([])).map(value => value.header.id)).toEqual([personal.id])
  await expect(ctx.agents.create({ sessionId })).rejects.toThrow('forbidden')
  await expect(ctx.agents.resume({ resumeSessionId: sessionId })).rejects.toThrow('forbidden')
  expect(ctx.sessions.get(personal.id)).toBe(personal)
})
it('retains a reservation after failed Session materialization and retries the same identifier after restart', async () => {
  const { request, authority } = fixture(); const first = await boot()
  const failure = vi.spyOn(Jsonl.prototype, 'create').mockRejectedValueOnce(new Error('disk failure'))
  await expect(first.service.open(request, async () => authority, signal())).rejects.toThrow('disk failure')
  failure.mockRestore()
  const domain = first.ctx.storageDomain.get('organization_context')!
  const reserved = domain.global.get() as { bindings: { sessionId: string; state: string }[] }
  expect(reserved.bindings[0]?.state).toBe('reserved')
  await first.ctx.fiber.dispose()
  const next = await boot(first.root)
  const reopened = await next.service.open(request, async () => authority, signal())
  expect(reopened.sessionId).toBe(reserved.bindings[0]?.sessionId)
})
it('denies revocation during persistence, generation changes, offline reopening, cancellation and disposed ownership', async () => {
  const { request, authority } = fixture(); const { ctx, service } = await boot()
  let reads = 0
  await expect(service.open(request, async () => {
    if (++reads > 1) throw new Error('revoked')
    return authority
  }, signal())).rejects.toThrow('revoked')
  await expect(service.open(request, async () => { throw new Error('offline') }, signal())).rejects.toThrow('offline')
  reads = 0
  await expect(service.open(request, async () => ({ ...authority, generation: ++reads }), signal())).rejects.toThrow('superseded')
  const cancel = new AbortController()
  await expect(service.open(request, async () => { cancel.abort(); return authority }, cancel.signal)).rejects.toThrow()
  await ctx.fiber.dispose()
  await expect(service.open(request, async () => authority, signal())).rejects.toThrow('unavailable')
})

it('rejects a history snapshot when current grants no longer cover its recorded relationships', async () => {
  const { service } = await boot(); const { request, authority } = fixture()
  const parent = contextRequestSchema.shape.taskId.parse(randomUUID())
  const original = { ...authority, task: { ...authority.task, parentTaskId: parent } }
  await service.open(request, async () => original, signal())
  await expect(service.open(request, async () => authority, signal())).rejects.toThrow('historical access changed')
})

it('routes real HTTPS authority through native coordination and private Host IPC, then denies revoked history', async () => {
  const { workgraphHarness, password } = await import('../../../api/organization-api/tests/workgraph-harness.ts')
  const { OrganizationConnection } = await import('../../../host/organization-connection/src/index.ts')
  const { openOrganizationContext } = await import('../../../../apps/desktop/src/organization-context.ts')
  const { installOrganizationContextControl } = await import('../../../../apps/desktop-host/src/organization-context.ts')
  const { EventEmitter } = await import('node:events')
  const { contextNativeMessageSchema } = await import('../src/protocol.ts')
  const remote = await workgraphHarness()
  const connection = new OrganizationConnection({ reconnectMs: 100 })
  const { ctx } = await boot()
  const bus = new EventEmitter()
  let deliver: (message: object) => void = () => { throw new Error('no request') }
  installOrganizationContextControl(ctx, {
    on: (event, listener) => bus.on(event, listener), off: (event, listener) => bus.off(event, listener),
    send: (message) => { deliver(message) },
  })
  try {
    await connection.perform({ kind: 'probe', origin: remote.trust.origin })
    await connection.perform({ kind: 'trust', fingerprint: remote.trust.fingerprint })
    await connection.perform({ kind: 'login', username: 'reader', password })
    await connection.perform({ kind: 'select', organizationId: remote.owner.organizationId })
    const input = contextRequestSchema.parse({ ...remote.query, taskId: remote.grant.taskId, operationId: randomUUID() })
    const host: import('../../../../apps/desktop/src/organization-context.ts').ContextHost = {
      openOrganizationContext(request, authorize, timeoutMs, signal) {
        return new Promise((resolve, reject) => {
          const requestId = randomUUID(), nonce = randomUUID()
          const cancel = () => bus.emit('message', { type: 'organization-context-cancel', requestId, nonce })
          signal.addEventListener('abort', cancel, { once: true })
          deliver = (raw) => {
            const message = contextNativeMessageSchema.parse(raw)
            expect(message.nonce).toBe(nonce)
            if (message.type === 'organization-context-result') {
              signal.removeEventListener('abort', cancel)
              if (message.result) resolve(message.result); else reject(new Error(message.error))
              return
            }
            void authorize(message.revision).then((authority) => {
              bus.emit('message', { type: 'organization-context-authorized', requestId, nonce, authorizationId: message.authorizationId, authority })
            }, () => bus.emit('message', { type: 'organization-context-authorized', requestId, nonce, authorizationId: message.authorizationId, error: 'denied' }))
          }
          bus.emit('message', { type: 'organization-context-open', requestId, nonce, timeoutMs, request })
        })
      },
    }
    const opened = await openOrganizationContext(connection, host, input, () => {})
    expect(opened.result.snapshot.goal).toBe('Visible task')
    expect(JSON.stringify(opened)).not.toContain('HIDDEN')
    expect(opened.result.owner.accountId).toBe(remote.member.accountId)
    const again = await openOrganizationContext(connection, host, input, () => {})
    expect(again.result.sessionId).toBe(opened.result.sessionId)
    await remote.call('/workgraph/grant', { ...remote.grant, operationId: randomUUID(), actions: [], expectedVersion: remote.receipt.revision })
    await expect.poll(() => connection.snapshot().generation).toBeGreaterThan(opened.generation)
    await expect.poll(() => connection.snapshot().phase).toBe('ready')
    await expect(openOrganizationContext(connection, host, input, () => {})).rejects.toThrow()
    await ctx.fiber.dispose()
    expect(bus.listenerCount('message')).toBe(0)
  } finally { await connection.close(); await remote.close() }
}, 20000)

it('recovers an uncommitted ready marker without duplicating events and detects later cross-store corruption', async () => {
  const { ctx, root, service } = await boot(); const { request, authority } = fixture()
  const domain = ctx.storageDomain.get('organization_context')!
  const unit = Reflect.get(domain, 'unit') as import('@deepseek-ai/dsh-storage').KvUnit
  const put = unit.setGlobal.bind(unit)
  let writes = 0
  const failure = vi.spyOn(unit, 'setGlobal').mockImplementation(async (...args) => {
    if (++writes === 2) throw new Error('ready marker failure')
    return put(...args)
  })
  await expect(service.open(request, async () => authority, signal())).rejects.toThrow('ready marker failure')
  failure.mockRestore()
  const reopened = await service.open(request, async () => authority, signal())
  await service.verifyBindings()
  const files = await readdir(join(root, 'organization'), { recursive: true })
  const logs = files.filter(file => file.endsWith('.jsonl'))
  expect(logs).toHaveLength(1)
  const path = join(root, 'organization', logs[0]!)
  const text = await readFile(path, 'utf8')
  expect(text).toContain(reopened.sessionId)
  await writeFile(path, text.replace('Authorized sentinel', 'Corrupted sentinel'))
  await expect(service.verifyBindings()).rejects.toThrow('binding/log mismatch')
  await expect(service.open(request, async () => authority, signal())).rejects.toThrow('corrupt binding')
})
