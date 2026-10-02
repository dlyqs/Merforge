/** Real Loader/SQLite/JSONL and managed child process; only the native peer is scripted. */
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile, readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, it, vi } from 'vitest'
import { setupExecution } from '../../organization/tests/execution-harness.ts'
import { executionAuthoritySchema, executionInputsDigest, executionRequestSchema } from '../src/index.ts'
import type { ExecutionBridge } from '../src/action-guard.ts'
import { boot, fixture, signal } from './harness.ts'
const cleanups: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close() })
const limits = { maxActions: 5, maxSteps: 5, maxDurationMs: 10000, maxBytes: 1000000, recheckMs: 20 }
const nativeLimits = { startupTimeoutMs: 2000, rpcTimeoutMs: 2000, turnTimeoutMs: 10000, humanTimeoutMs: 2000,
  interruptTimeoutMs: 500, disposeGraceMs: 100, maxFrameBytes: 1000000, maxEarlyEvents: 100, maxTurnBytes: 1000000,
  modelCacheMs: 1000, modelPageSize: 100, maxModelPages: 10 }
async function setup(maxTurns = 2) {
  const local = await boot(undefined, limits, undefined, nativeLimits), directory = join(local.root, 'work')
  await mkdir(directory); await writeFile(join(directory, 'private.txt'), 'UNSELECTED_PRIVATE_MATERIAL')
  const backend = { kind: 'codex', dispatch: 'device-native', runtimeVersion: '0.153.4', model: 'scripted-csv', effort: 'medium', maxTurns,
    maxDurationMs: 10000 } as const
  const inputs = executionRequestSchema.shape.inputs.parse({ model: backend.model, backend, capabilities: ['codex-turn'],
    execution: { directory, maxActions: maxTurns, maxSteps: maxTurns, maxDurationMs: 10000 },
    materials: ['SELECTED_MATERIAL'], messages: ['EMPLOYEE_INPUT'] })
  const remote = await setupExecution(cleanups, maxTurns, executionInputsDigest(inputs), ['codex-turn'], undefined,
    { backend, policy: [{ runtimeVersion: '0.153.4', model: backend.model, efforts: ['medium'], maxTurns, maxDurationMs: 10000 }] })
  const request = executionRequestSchema.parse({ ...remote.selector, runId: remote.run.runId,
    operationId: randomUUID(), inputs, start: true })
  const original = fixture().authority
  const snapshot = { ...remote.save.definition.tasks[0], planId: request.planId, revision: 1,
    phaseTitle: remote.save.definition.phases[0]!.title, assignable: true, hasUndisclosedPrerequisite: false }
  const owner = { ...original.context.owner, organizationId: request.organizationId, planId: request.planId, taskId: snapshot.id }
  const bridge: ExecutionBridge = async (command) => {
    if (command) await remote.execute(command)
    return executionAuthoritySchema.parse({ ...original, organizationId: request.organizationId, task: snapshot,
      context: { ...original.context, owner, snapshot }, execution: await remote.read() })
  }
  const spawn = local.ctx.subprocess.spawn.bind(local.ctx.subprocess), children: ReturnType<typeof spawn>[] = []
  const spawnMock = vi.spyOn(local.ctx.subprocess, 'spawn').mockImplementation((spec) => {
    expect(spec.argv.slice(-2)).toEqual(['app-server', '--stdio'])
    const child = spawn({ ...spec, argv: [process.execPath, fileURLToPath(new URL('./fixtures/codex-app-server.mjs', import.meta.url))],
      env: { MERFORGE_CODEX_FIXTURE: local.root } })
    children.push(child); return child
  })
  const selector = { ...remote.selector, runId: request.runId }
  const report = () => local.service.report(selector, async () => {
    const a = await bridge(); return { serverId: a.serverId, accountId: a.accountId, generation: a.generation, execution: a.execution }
  }, signal())
  const script = (steps: unknown[]) => writeFile(join(local.root, 'script.json'), JSON.stringify(steps))
  return { ...local, directory, remote, request, bridge, report, children, script, spawnMock }
}
it('finishes its final permitted native turn without an API credential, file scan, personal Agent or automatic submission', async () => {
  const h = await setup(1); await h.script([{ name: 'write_file', args: { path: 'result.csv', content: 'name,count\na,2\n' } }])
  const fetch = vi.spyOn(globalThis, 'fetch')
  await h.service.executeConfigured(h.request, h.bridge, signal())
  expect(fetch).not.toHaveBeenCalled()
  expect(await readFile(join(h.directory, 'result.csv'), 'utf8')).toBe('name,count\na,2\n')
  expect((await h.remote.read()).run.state).toBe('succeeded')
  expect((await h.remote.read()).actions).toMatchObject([{ capability: 'codex-turn', state: 'succeeded' }])
  expect(h.ctx.agents.list()).toEqual([]); expect(await h.ctx.sessionPersistence.list()).toEqual([])
  const report = await h.report()
  expect(report.native?.status).toBe('completed')
  expect(report.entries).toContainEqual({ role: 'tool', text: 'result.csv' })
  expect(JSON.stringify(report)).not.toMatch(/UNSELECTED_PRIVATE_MATERIAL|NATIVE_PRIVATE_EMAIL|NATIVE_PRIVATE_TOKEN|threadId/)
  expect(h.remote.db.prepare('SELECT count(*) AS n FROM organization_submissions').get()?.n ?? 0).toBe(0)
  await h.service.verifyBindings()
  for (const child of h.children) expect(await child.waitForExit(1)).toBe(true)
})
it.each(['hang', 'lose-acceptance', 'lose-terminal'])('stops or reconciles %s without replaying its original send', async (mode) => {
  const h = await setup(); await h.script([mode])
  const cancel = new AbortController()
  const execution = h.service.executeConfigured(h.request, h.bridge, cancel.signal)
  const failed = expect(execution).rejects.toThrow()
  if (mode === 'hang') {
    await expect.poll(async () => (await h.report()).native?.status, { timeout: 5000 }).toBe('running')
    cancel.abort()
  }
  await failed
  for (const child of h.children) expect(await child.waitForExit(1)).toBe(true)
  const report = await h.report()
  const resume = { ...h.request, operationId: randomUUID(), start: false, reconcile: true,
    resume: { baselineDigest: report.recovery!.baselineDigest! } }
  if (mode === 'lose-acceptance') {
    await expect(h.service.reconcile(resume, h.bridge, signal())).rejects.toThrow('native-result-unknown')
    expect((await h.report()).native?.status).toBe('unknown')
  } else {
    await h.service.reconcile(resume, h.bridge, signal())
    expect((await h.remote.read()).actions[0]?.state).not.toBe('unknown')
  }
  expect((await h.remote.read()).delegation.used).toBe(1)
  const history = JSON.parse(await readFile(join(h.root, 'native-history.json'), 'utf8')) as Record<string, { turns: unknown[] }>
  expect(Object.values(history).flatMap(thread => thread.turns)).toHaveLength(1)
  await h.service.verifyBindings()
})
it('persists native approvals in Inbox, retires the callback and requires an explicit continuation', async () => {
  const h = await setup(); await h.script(['approval'])
  await h.service.executeConfigured(h.request, h.bridge, signal())
  const view = await h.remote.read()
  expect(view.run.state).toBe('waiting-human')
  expect(view.humanRequests[0]).toMatchObject({ kind: 'tool-approval', state: 'pending', handlerId: view.assigneeId })
  const report = await h.report()
  expect(report.entries.some(entry => entry.text.includes(view.humanRequests[0]!.requestDigest!))).toBe(true)
  expect(report.entries.some(entry => entry.text.includes('fixture command'))).toBe(true)
  expect(h.children).toHaveLength(1); expect(await h.children[0]!.waitForExit(1)).toBe(true)
  expect(view.delegation.used).toBe(1)
  const request = view.humanRequests[0]!
  await h.remote.service.participantCommand(h.remote.other.token, { ...h.remote.selector, kind: 'approve-execution-tool',
    operationId: randomUUID(), runId: h.request.runId, planRevision: 1, requestId: request.id, approved: true })
  expect(h.children).toHaveLength(1)
  await h.service.executeConfigured({ ...h.request, operationId: randomUUID(),
    resume: { baselineDigest: report.recovery!.baselineDigest! } }, h.bridge, signal())
  expect(await readFile(join(h.directory, 'approved.txt'), 'utf8')).toBe('approved native command')
  expect((await h.remote.read()).run.state).toBe('succeeded')
  expect((await h.remote.read()).delegation.used).toBe(2)
  await h.service.verifyBindings()
})
it('stops its managed native process when current device authority is withdrawn', async () => {
  const h = await setup(); await h.script(['hang'])
  const execution = h.service.executeConfigured(h.request, h.bridge, signal())
  const failed = expect(execution).rejects.toThrow()
  await expect.poll(async () => (await h.remote.read()).actions.length).toBe(1)
  await h.remote.transition('paused')
  await failed
  expect(await h.children[0]!.waitForExit(1)).toBe(true)
  await h.service.verifyBindings()
  expect(await readdir(h.directory)).toEqual(['private.txt'])
})

it('retains an observed native completion when independent process cleanup fails', async () => {
  const h = await setup(1); await h.script(['Observed completion'])
  const spawn = h.spawnMock.getMockImplementation()!
  vi.spyOn(h.ctx.subprocess, 'spawn').mockImplementation((spec) => {
    const child = spawn(spec), wait = child.waitForExit.bind(child)
    child.waitForExit = async (timeout) => { await wait(timeout); throw new Error('fixture cleanup observation failed') }
    return child
  })
  await h.service.executeConfigured(h.request, h.bridge, signal())
  expect((await h.remote.read()).run.state).toBe('succeeded')
  expect((await h.report()).native).toMatchObject({ status: 'completed', cleanupFailed: true })
  await h.service.verifyBindings()
})

it('refuses native receipt associations that diverge from the durable Run thread', async () => {
  const h = await setup(1); await h.script(['Finished'])
  await h.service.executeConfigured(h.request, h.bridge, signal())
  const path = (await readdir(join(h.root, 'execution'), { recursive: true })).find(path => path.endsWith('.jsonl'))!
  const file = join(h.root, 'execution', path)
  const original = await readFile(file, 'utf8')
  const records = original.trimEnd().split('\n').map((line): unknown => { const parsed: unknown = JSON.parse(line); return parsed }) as Array<{ type: string; data?: { kind?: string; threadId?: string } }>
  const receipt = records.find(record => record.type === 'organization/execution-native' && record.data?.kind === 'receipt')!
  receipt.data!.threadId = 'another-native-thread'
  await writeFile(file, records.map(record => JSON.stringify(record)).join('\n') + '\n')
  await expect(h.service.verifyBindings()).rejects.toThrow('native-log-mismatch')
  await writeFile(file, original)
  await h.service.verifyBindings()
})
