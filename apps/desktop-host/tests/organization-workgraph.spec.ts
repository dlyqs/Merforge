/** No-page WorkGraph delivery: real Loader, HTTPS/native identities and isolated durable Sessions. */
import { expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import Storage from '@deepseek-ai/dsh-storage'
import * as Json from '@deepseek-ai/dsh-storage-json'
import * as Domain from '@deepseek-ai/dsh-storage-domain'
import Sessions from '@deepseek-ai/dsh-session'
import Jsonl from '@deepseek-ai/dsh-session-persistence-jsonl'
import OrganizationContext, { contextRequestSchema } from '@deepseek-ai/dsh-organization-context'
import { workgraphSaveSchema } from '@deepseek-ai/dsh-organization/workgraph'
import { backupOrganization, restoreOrganization } from '@deepseek-ai/dsh-organization/maintenance'
import { OrganizationConnection } from '@deepseek-ai/dsh-organization-connection'
import { openOrganizationContext, type ContextHost } from '../../desktop/src/organization-context.ts'
import { bootOrganization } from '../src/organization-boot.ts'
import { workgraphHarness, password } from '../../../packages/api/organization-api/tests/workgraph-harness.ts'

it('persists revisions, filtered CSV context and grants across revoke, reconnect, reopen and stopped restore', async () => {
  const h = await workgraphHarness()
  const clients: OrganizationConnection[] = [], contexts: Context[] = []
  let restarted: Awaited<ReturnType<typeof bootOrganization>> | undefined
  const log = vi.spyOn(console, 'info')
  async function connect(username: string) {
    const client = new OrganizationConnection({ reconnectMs: 100 }); clients.push(client)
    await client.perform({ kind: 'probe', origin: h.trust.origin })
    await client.perform({ kind: 'trust', fingerprint: h.trust.fingerprint })
    await client.perform({ kind: 'login', username, password })
    await client.perform({ kind: 'select', organizationId: h.owner.organizationId })
    return client
  }
  async function local() {
    const ctx = new Context(); contexts.push(ctx)
    ctx.baseUrl = pathToFileURL(h.root).href + '/'
    const modules = new Map<string, unknown>([['storage', Storage], ['json', Json], ['domain', Domain],
      ['sessions', Sessions], ['jsonl', Jsonl], ['context', OrganizationContext]])
    const config = join(h.root, 'context.yml')
    await writeFile(config, JSON.stringify([{ name: 'storage' }, { name: 'json', config: { root: join(h.root, 'local-data') } },
      { name: 'domain', config: { backend: 'json' } }, { name: 'sessions' },
      { name: 'jsonl', config: { root: join(h.root, 'personal'), compression: 'none' } },
      { name: 'context', config: { root: join(h.root, 'contexts') } }]))
    await ctx.plugin(Loader); ctx.loader.builtins.include = Include
    ctx.loader.internal = { version: 'v2', async import(name: string) { return modules.get(name) } } as never
    await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(config).href } }); await ctx.loader.await()
    return ctx
  }
  try {
    const owner = await connect('owner'), member = await connect('reader')
    async function openCurrent(client: OrganizationConnection, host: ContextHost, request: Parameters<typeof openOrganizationContext>[2]) {
      let value: Awaited<ReturnType<typeof openOrganizationContext>> | undefined
      await expect.poll(async () => {
        if (client.snapshot().phase !== 'ready') return false
        try { value = await openOrganizationContext(client, host, request, () => {}); return true }
        catch (error) {
          if (error instanceof Error && /superseded|unavailable|cancelled/.test(error.message)) return false
          throw error
        }
      }, { timeout: 5000 }).toBe(true)
      return value!
    }

    const ctx = await local()
    const ownerAction = async (action: Parameters<typeof owner.perform>[0]) => {
      await expect.poll(() => owner.snapshot().phase).toBe('ready')
      return owner.perform(action)
    }
    const taskId = randomUUID(), phaseId = randomUUID()
    const save = workgraphSaveSchema.parse({ ...h.query, planId: randomUUID(), operationId: randomUUID(), expectedRevision: 0,
      definition: { taskId, phases: [{ id: phaseId, title: 'CSV contract' }], tasks: [{ id: taskId, phaseId, parentTaskId: null,
        goal: 'CSV delivery', scope: 'Document columns', acceptance: ['Review UTF-8 and quoting'], artifacts: ['CSV specification'],
        required: true, dependsOn: [], suggestedMembershipId: h.member.membershipId }] } })
    expect((await ownerAction({ kind: 'workgraph-save', request: save })).receipt?.planRevision).toBe(1)
    const query = { organizationId: save.organizationId, projectId: save.projectId, planId: save.planId }
    await expect(member.perform({ kind: 'workgraph-tasks', request: query })).rejects.toThrow('forbidden')
    const edited = { ...save, expectedRevision: 1, operationId: randomUUID(), definition: structuredClone(save.definition) }
    edited.definition.tasks[0]!.scope = 'Document columns and quoting'
    expect((await ownerAction({ kind: 'workgraph-save', request: edited })).receipt?.planRevision).toBe(2)
    await expect(ownerAction({ kind: 'workgraph-save', request: { ...edited, operationId: randomUUID() } })).rejects.toThrow('version-conflict')
    const grant = { ...query, taskId, membershipId: h.member.membershipId, scope: 'subtree', actions: ['read'], expectedVersion: 0 }
    const receipt = (await ownerAction({ kind: 'workgraph-grant', request: { ...grant, operationId: randomUUID() } })).receipt!
    await member.perform({ kind: 'reconnect' })
    const request = contextRequestSchema.parse({ ...query, taskId, operationId: randomUUID() })
    const host: ContextHost = {
      openOrganizationContext: (input, authorize, _timeout, signal) => ctx.organizationContext.open(input, authorize, signal),
    }
    const first = await openCurrent(member, host, request)
    const ownerContext = await openCurrent(owner, host, { ...request,
      operationId: contextRequestSchema.shape.operationId.parse(randomUUID()) })
    expect(ownerContext.result.sessionId).not.toBe(first.result.sessionId)
    expect(first.result.snapshot.scope).toBe('Document columns and quoting')
    await ctx.fiber.dispose()
    const reopened = await local()
    const restoredHost: ContextHost = {
      openOrganizationContext: (input, authorize, _timeout, signal) => reopened.organizationContext.open(input, authorize, signal),
    }
    expect((await openCurrent(member, restoredHost, request)).result).toEqual(first.result)
    expect(await reopened.sessionPersistence.list()).toEqual([])
    await expect(reopened.sessionPersistence.open(first.result.sessionId, 'read')).rejects.toThrow('forbidden')
    await ownerAction({ kind: 'workgraph-grant', request: { ...grant, actions: [], expectedVersion: receipt.revision, operationId: randomUUID() } })
    await member.perform({ kind: 'reconnect' })
    await expect(openOrganizationContext(member, restoredHost, request, () => {})).rejects.toThrow()

    // Three phases fork into visible preparation and hidden inputs before a final merge.
    const csv = structuredClone(h.save)
    csv.expectedRevision = 1; csv.operationId = workgraphSaveSchema.shape.operationId.parse(randomUUID())
    csv.definition.phases = ['Specification', 'Inputs', 'Integration'].map(title => ({
      id: workgraphSaveSchema.shape.definition.shape.phases.element.shape.id.parse(randomUUID()), title,
    }))
    csv.definition.tasks.forEach((task, index) => { task.phaseId = csv.definition.phases[2 - index]!.id })
    csv.definition.tasks[1]!.dependsOn = [csv.definition.tasks[2]!.id]
    await ownerAction({ kind: 'workgraph-save', request: csv })
    const invalid = structuredClone(csv); invalid.expectedRevision = 2
    invalid.operationId = workgraphSaveSchema.shape.operationId.parse(randomUUID())
    invalid.definition.tasks.forEach((task) => { task.phaseId = invalid.definition.phases[2]!.id })
    invalid.definition.tasks[2]!.dependsOn = [invalid.definition.tasks[0]!.id]
    await expect(ownerAction({ kind: 'workgraph-save', request: invalid })).rejects.toThrow('cycle')
    const cycle = structuredClone(csv); cycle.expectedRevision = 2
    cycle.operationId = workgraphSaveSchema.shape.operationId.parse(randomUUID())
    cycle.definition.tasks.forEach((task) => { task.phaseId = cycle.definition.phases[2]!.id })
    cycle.definition.tasks[2]!.dependsOn = [cycle.definition.tasks[1]!.id]
    await expect(ownerAction({ kind: 'workgraph-save', request: cycle })).rejects.toThrow('cycle')
    await ownerAction({ kind: 'workgraph-grant', request: { ...h.grant, expectedVersion: h.receipt.revision, operationId: randomUUID() } })
    await member.perform({ kind: 'reconnect' })
    const visible = await member.perform({ kind: 'workgraph-tasks', request: h.query })
    expect(visible.workgraph?.result).toMatchObject({
      value: { total: 1, items: [{ parentTaskId: null, dependsOn: [], hasUndisclosedPrerequisite: true }] },
    })
    const search = await member.perform({ kind: 'workgraph-tasks', request: { ...h.query, search: 'HIDDEN' } })
    expect(search.workgraph?.result).toMatchObject({ value: { total: 0 } })
    const csvContext = await openCurrent(member, restoredHost, contextRequestSchema.parse({
      ...h.query, taskId: h.grant.taskId, operationId: randomUUID(),
    }))
    expect(JSON.stringify([visible, search, csvContext, member.snapshot(), log.mock.calls])).not.toContain('HIDDEN')
    const files = (await readdir(join(h.root, 'contexts'), { recursive: true })).filter(path => path.endsWith('.jsonl'))
    const logs = await Promise.all(files.map(path => readFile(join(h.root, 'contexts', path), 'utf8')))
    expect(logs.join('')).not.toMatch(/HIDDEN|tool\/call|turn\/start/)
    expect(logs.join('')).toContain('organization/task-snapshot')
    await reopened.organizationContext.verifyBindings()
    await h.app.close()
    const databasePath = join(h.config.api.directory, 'organization.sqlite')
    const database = new DatabaseSync(databasePath, { readOnly: true })
    try {
      expect(database.prepare('SELECT count(*) AS n FROM plan_revisions WHERE planId=?').get(save.planId)?.n).toBe(2)
      expect(database.prepare('SELECT canRead FROM task_grants WHERE planId=? AND membershipId=?').get(save.planId, h.member.membershipId)?.canRead).toBe(0)
    } finally { database.close() }
    const backup = backupOrganization(h.config.api.directory, join(h.root, 'backup'), 5000)
    const manifest = join(backup, 'manifest.json'), original = await readFile(manifest, 'utf8')
    const before = await readFile(databasePath)
    await writeFile(manifest, JSON.stringify({ ...JSON.parse(original), schema: 999 }))
    expect(() => restoreOrganization(backup, h.config.api.directory, 5000)).toThrow()
    expect(await readFile(databasePath)).toEqual(before)
    await writeFile(manifest, original)
    restoreOrganization(backup, h.config.api.directory, 5000)
    restarted = await bootOrganization({ ...h.config, api: { ...h.config.api, port: h.app.ready.port } })
    expect((await h.call('/organizations', undefined, h.member.token)).status).toBe(401)
    await member.perform({ kind: 'login', username: 'reader', password })
    await member.perform({ kind: 'select', organizationId: h.owner.organizationId })
    await expect(member.perform({ kind: 'workgraph-tasks', request: query })).rejects.toThrow('forbidden')
    expect((await member.perform({ kind: 'workgraph-tasks', request: h.query })).workgraph?.result).toMatchObject({ value: { total: 1 } })
  } finally {
    log.mockRestore()
    for (const client of clients) await client.close()
    for (const ctx of contexts.reverse()) await ctx.fiber.dispose()
    await restarted?.close(); await h.close()
  }
}, 30000)
