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
  ['system-prompt'], ['tools'], ['agent'], ['skill'], ['skill-dev-workflow'],
].map(([name, config]) => ({ name: `@deepseek-ai/dsh-${name}`, ...(config ? { config } : {}) }))
await writeFile(configPath, JSON.stringify(rows))
const taskId = '00000000-0000-4000-8000-000000000001'
const phaseId = '10000000-0000-4000-8000-000000000001'
const request = {
  operationId: '20000000-0000-4000-8000-000000000001', expectedRevision: 0,
  definition: {
    taskId, projectId: null, botId: null, phases: [{ id: phaseId, title: 'Review' }],
    tasks: [{ id: taskId, parentTaskId: null, phaseId, goal: 'Ship', scope: 'Local', acceptance: ['Verify output'],
      artifacts: ['output.txt'], cwd: null, dependsOn: [], required: true }],
  },
}
const contexts = []
async function boot() {
  const ctx = new Context()
  contexts.push(ctx)
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const builtEntries = new Map([
    ['@deepseek-ai/dsh-system-prompt', new URL('../../../core/system-prompt/lib/index.js', import.meta.url).href],
    ['@deepseek-ai/dsh-tools', new URL('../../../core/tools/lib/index.js', import.meta.url).href],
    ['@deepseek-ai/dsh-skill', new URL('../../../skill/skill/lib/index.js', import.meta.url).href],
    ['@deepseek-ai/dsh-skill-dev-workflow', new URL('../../../skill/skill-dev-workflow/lib/index.js', import.meta.url).href],
  ])
  ctx.loader.internal = { version: 'v2', import: specifier => import(builtEntries.get(specifier) ?? specifier) }
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  assert.deepEqual([...ctx.loader.entries()].filter(entry => !entry.fiber && !entry.disabled).map(entry => entry.options.name), [])
  return ctx
}
try {
  const save = TYPERT.invocations.find(row => row.namespace === 'session' && row.method === 'workflowSave')
  assert.ok(save)
  const parsed = save.parameters[0].codec.create().parse(request)
  const first = await boot()
  const result = await first.personalWorkflow.save(parsed)
  assert.deepEqual(save.result.create().parse(result), result)
  const session = first.sessions.create(SessionId('built-workflow'), { meta: { cwd: root } })
  const writer = await first.sessionPersistence.create(session.header)
  await first.personalWorkflow.snapshot(session, { taskId }, '20000000-0000-4000-8000-000000000002')
  const modeRemote = TYPERT.invocations.find(row => row.namespace === 'session' && row.method === 'workflowSetMode')
  assert.ok(modeRemote)
  const modeRequest = modeRemote.parameters[0].codec.create().parse({
    sessionId: session.id, enabled: true, expectedRevision: 0, operationId: '20000000-0000-4000-8000-000000000003',
  })
  assert.deepEqual(await first.personalWorkflow.setMode(session, modeRequest), { enabled: true, revision: 1 })
  const method = await first.skills.get('dev-workflow')
  assert.match(method.content, /managed method v1/)
  assert.ok(!method.content.includes('/Users/'))
  assert.equal(method.invocation.modelInvocable, false)
  assert.ok(first.tools.get('workflow_propose'))
  const approved = await first.personalWorkflow.approve({ taskId, expectedRevision: 1, operationId: '20000000-0000-4000-8000-000000000004' })
  const claimRemote = TYPERT.invocations.find(row => row.namespace === 'session' && row.method === 'workflowClaim')
  assert.ok(claimRemote)
  const claim = claimRemote.parameters[0].codec.create().parse({
    sessionId: session.id, planId: taskId, taskId, expectedRevision: 1, operationId: '20000000-0000-4000-8000-000000000005',
    authorization: { mode: 'manual', stopPhaseId: phaseId, maxActions: 5, maxTurns: 3, maxDurationMs: 100000 },
  })
  const run = await first.personalWorkflow.execution.claim(session, claim)
  assert.deepEqual(claimRemote.result.create().parse(run), run)
  await first.personalWorkflow.execution.beginAction(session, 'built-action', 'write')
  await writeFile(join(root, 'output.txt'), 'effect completed before Host exit')
  assert.ok(first.tools.get('workflow_complete'))
  await writer.close()
  await first.fiber.dispose()
  const second = await boot()
  assert.deepEqual(await second.personalWorkflow.mode(session), { enabled: true, revision: 1 })
  assert.deepEqual(second.personalWorkflow.read({ taskId }), approved)
  const interrupted = second.personalWorkflow.execution.forSession(session.id)
  assert.equal(interrupted.status, 'needs_reconciliation')
  assert.equal(interrupted.actions[0].status, 'unknown')
  assert.equal(interrupted.authorization.maxActions, 5)
  const reader = await second.sessionPersistence.open(session.id, 'read')
  const saved = await reader.read()
  assert.deepEqual(saved.events[0].data.snapshot, result)
  const restored = second.sessions.create(session.id, { seed: saved.events, meta: { cwd: root } })
  await second.personalWorkflow.execution.resume(restored, {
    sessionId: session.id, runId: run.id, ownerEpoch: 1, operationId: '20000000-0000-4000-8000-000000000006',
    reconciliation: 'Inspected the completed file effect; verify it afresh after handoff.',
  })
  const handoff = await second.personalWorkflow.execution.prepareHandoff(restored, {
    sessionId: session.id, runId: run.id, ownerEpoch: 1, operationId: '20000000-0000-4000-8000-000000000007',
    context: 'Keep the output file; verify acceptance.',
  })
  assert.equal(handoff.taskId, taskId)
  assert.equal(handoff.runId, run.id)
  const target = second.sessions.create(handoff.targetSessionId, { meta: { cwd: root } })
  const targetWriter = await second.sessionPersistence.create(target.header)
  const transferred = await second.personalWorkflow.execution.finishHandoff(target, run.id, handoff.id)
  const handoffRemote = TYPERT.invocations.find(row => row.namespace === 'session' && row.method === 'workflowHandoff')
  assert.ok(handoffRemote)
  assert.deepEqual(handoffRemote.result.create().parse(transferred), transferred)
  assert.equal(transferred.status, 'paused')
  assert.equal(second.personalWorkflow.execution.denial(restored), 'execution-owner-revoked')
  await targetWriter.close()
  await reader.close()
  assert.match(second.personalWorkflow.export({ taskId }), /Revision: 1/)
  console.log('personal-workflow built Host smoke: passed (Loader, generated Remote codecs, JSON and JSONL reopen, mode/execution codecs, interrupted-action recovery, transfer codecs and packaged Skill)')
} finally {
  for (const ctx of contexts.reverse()) await ctx.fiber.dispose()
  await rm(root, { recursive: true, force: true })
}
