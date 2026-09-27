/** Built pre-execution store under Node and Electron Node mode; no window or model. */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { Context } from '../../../vendor/cordis/lib/index.js'
import Loader from '../../../vendor/loader/lib/index.js'
import Include from '../../../vendor/include/lib/index.js'
import Storage from '../../../packages/storage/storage/lib/index.js'
import * as Json from '../../../packages/storage/storage-json/lib/index.js'
import * as Domain from '../../../packages/storage/storage-domain/lib/index.js'
import Sessions from '../../../packages/core/session/lib/index.js'
import Jsonl from '../../../packages/session/session-persistence-jsonl/lib/index.js'
import OrganizationContext, { contextRequestSchema, contextAuthoritySchema } from '../../../packages/workspace/organization-context/lib/index.js'

const root = await mkdtemp(join(tmpdir(), 'organization-context-built-'))
const contexts = []
try {
  const modules = new Map([['storage', Storage], ['json', Json], ['domain', Domain], ['sessions', Sessions],
    ['jsonl', Jsonl], ['organization-context', OrganizationContext]])
  const path = join(root, 'cordis.yml')
  await writeFile(path, JSON.stringify([{ name: 'storage' }, { name: 'json', config: { root: join(root, 'data') } },
    { name: 'domain', config: { backend: 'json' } }, { name: 'sessions' },
    { name: 'jsonl', config: { root: join(root, 'personal'), compression: 'none' } },
    { name: 'organization-context', config: { root: join(root, 'contexts') } }]))
  async function boot() {
    const ctx = new Context(); contexts.push(ctx)
    ctx.baseUrl = pathToFileURL(root).href + '/'
    await ctx.plugin(Loader); ctx.loader.builtins.include = Include
    ctx.loader.internal = { version: 'v2', async import(name) { return modules.get(name) } }
    await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(path).href } })
    await ctx.loader.await()
    return ctx
  }
  const request = contextRequestSchema.parse({ organizationId: randomUUID(), projectId: randomUUID(), planId: randomUUID(), taskId: randomUUID(), operationId: randomUUID() })
  const authority = contextAuthoritySchema.parse({ serverId: randomUUID(), accountId: randomUUID(), organizationId: request.organizationId,
    generation: 1, requestId: randomUUID(), task: { id: request.taskId, planId: request.planId, revision: 1, parentTaskId: null,
      phaseId: randomUUID(), phaseTitle: 'Prepare', goal: 'Authorized task', scope: 'Text only', acceptance: ['Review'], artifacts: [],
      required: true, dependsOn: [], suggestedMembershipId: null, assignable: false, hasUndisclosedPrerequisite: false } })
  const first = await boot()
  const read = await first.organizationContext.open(request, async () => authority, new AbortController().signal)
  assert.deepEqual(await first.sessionPersistence.list(), [])
  assert.throws(() => first.sessions.create(read.sessionId), /forbidden/)
  await assert.rejects(first.sessionPersistence.open(read.sessionId, 'read'), /forbidden/)
  await first.organizationContext.verifyBindings()
  await first.fiber.dispose()
  const second = await boot()
  assert.deepEqual(await second.organizationContext.open(request, async () => authority, new AbortController().signal), read)
  await assert.rejects(second.organizationContext.open(request, async () => { throw new Error('offline') }, new AbortController().signal), /offline/)
  console.log(`organization context built smoke: ${process.versions.electron ? 'Electron Node' : 'Node'} isolation/persistence/reopen/offline passed`)
} finally {
  for (const ctx of contexts.reverse()) await ctx.fiber.dispose()
  await rm(root, { recursive: true, force: true })
}
if (!process.versions.electron && !process.argv.includes('--child')) {
  const require = createRequire(new URL('../../desktop/package.json', import.meta.url))
  const child = spawn(require('electron'), ['--expose-internals', import.meta.filename, '--child'], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit',
  })
  await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Electron smoke exited ${code}`)))
  })
}
