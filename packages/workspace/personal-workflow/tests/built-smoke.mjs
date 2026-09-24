/** Plain-Node check of built Loader, plan persistence and generated Remote codecs; no UI. */
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { SessionId } from '@deepseek-ai/dsh-session'
import { TYPERT } from '../../../api/session-controller/lib/typert.host.js'

const root = await mkdtemp(join(tmpdir(), 'workflow-built-'))
const configPath = join(root, 'cordis.yml')
const rows = [
  ['storage'], ['storage-json', { root: join(root, 'data') }], ['storage-domain', { backend: 'json' }],
  ['session'], ['session-persistence-jsonl', { root: join(root, 'sessions'), compression: 'none' }],
  ['session-projection'], ['session-query'], ['workspace'], ['personal-project'], ['personal-workflow'],
].map(([name, config]) => ({ name: `@deepseek-ai/dsh-${name}`, ...(config ? { config } : {}) }))
await writeFile(configPath, JSON.stringify(rows))
const taskId = '00000000-0000-4000-8000-000000000001'
const phaseId = '10000000-0000-4000-8000-000000000001'
const request = {
  operationId: '20000000-0000-4000-8000-000000000001', expectedRevision: 0,
  definition: {
    taskId, projectId: null, botId: null, phases: [{ id: phaseId, title: 'Review' }],
    tasks: [{ id: taskId, parentTaskId: null, phaseId, goal: 'Ship', scope: 'Local', acceptance: ['Verify output'],
      artifacts: [], cwd: null, dependsOn: [], required: true }],
  },
}
const contexts = []
async function boot() {
  const ctx = new Context()
  contexts.push(ctx)
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  ctx.loader.internal = { version: 'v2', import: specifier => import(specifier) }
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  assert.equal([...ctx.loader.entries()].filter(entry => !entry.fiber && !entry.disabled).length, 0)
  return ctx
}
try {
  const save = TYPERT.invocations.find(row => row.namespace === 'session' && row.method === 'workflowSave')
  assert.ok(save)
  const parsed = save.parameters[0].codec.create().parse(request)
  const first = await boot()
  const result = await first.personalWorkflow.save(parsed)
  assert.deepEqual(save.result.create().parse(result), result)
  const session = first.sessions.create(SessionId('built-workflow'))
  const writer = await first.sessionPersistence.create(session.header)
  await first.personalWorkflow.snapshot(session, { taskId }, '20000000-0000-4000-8000-000000000002')
  await writer.close()
  await first.fiber.dispose()
  const second = await boot()
  assert.deepEqual(second.personalWorkflow.read({ taskId }), result)
  const reader = await second.sessionPersistence.open(session.id, 'read')
  assert.deepEqual((await reader.read()).events[0].data.snapshot, result)
  await reader.close()
  assert.match(second.personalWorkflow.export({ taskId }), /Revision: 1/)
  console.log('personal-workflow built Host smoke: passed (Loader, generated Remote codecs, JSON and JSONL reopen)')
} finally {
  for (const ctx of contexts.reverse()) await ctx.fiber.dispose()
  await rm(root, { recursive: true, force: true })
}
