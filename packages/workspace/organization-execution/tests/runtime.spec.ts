import { mkdir, readFile, writeFile, symlink, link, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, expect, it } from 'vitest'
import { setupExecution } from '../../organization/tests/execution-harness.ts'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { executionAuthoritySchema, executionReadAuthoritySchema, executionInputsDigest, executionRequestSchema } from '../src/index.ts'
import type { ExecutionBridge } from '../src/action-guard.ts'
import { acquireDirectory } from '../src/resources.ts'
import { boot, fixture, signal } from './harness.ts'

const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })
const limits = { maxActions: 20, maxSteps: 10, maxDurationMs: 10000, maxBytes: 100000, recheckMs: 100 }
async function setup(budget = 20, capabilities: ('model' | 'fs-read' | 'fs-write' | 'shell')[] = ['model', 'fs-read', 'fs-write'],
  deployment = limits, requireWriteApproval = false) {
  const local = await boot(undefined, deployment), directory = join(local.root, 'work')
  await mkdir(directory)
  const inputs = { ...fixture().request.inputs, capabilities, requireWriteApproval,
    execution: { directory, maxActions: 20, maxSteps: 10, maxDurationMs: 10000 } }
  const parsedInputs = executionRequestSchema.shape.inputs.parse(inputs)
  const remote = await setupExecution(cleanup, budget, executionInputsDigest(parsedInputs), [...inputs.capabilities])
  const request = executionRequestSchema.parse({ ...remote.selector, runId: remote.run.runId,
    operationId: randomUUID(), inputs: parsedInputs })
  const original = fixture().authority
  const snapshot = { ...remote.save.definition.tasks[0], planId: request.planId, revision: 1,
    phaseTitle: remote.save.definition.phases[0]!.title, assignable: true, status: 'pending', hasUndisclosedPrerequisite: false }
  const owner = { ...original.context.owner, organizationId: request.organizationId,
    planId: request.planId, taskId: remote.save.definition.taskId }
  const bridge: ExecutionBridge = async (command) => {
    if (command) await remote.execute(command)
    return executionAuthoritySchema.parse({ ...original, organizationId: request.organizationId, task: snapshot,
      context: { ...original.context, owner, snapshot }, execution: await remote.read() })
  }
  return { ...local, directory, remote, request, bridge }
}
it('runs the actual loop and filesystem against signed SQLite permissions and reopens its private log', async () => {
  const h = await setup()
  const adapter = new MockAdapter([toolCallResponse('write', 'write_file', { path: 'result.csv', content: 'name,count\na,2\n' }),
    toolCallResponse('read', 'read_file', { path: 'result.csv' }), textResponse('Finished')])
  await h.service.execute(h.request, h.bridge, { adapter, directory: h.directory }, signal())
  expect(await readFile(join(h.directory, 'result.csv'), 'utf8')).toBe('name,count\na,2\n')
  const view = await h.remote.read()
  expect(view.run.state).toBe('succeeded')
  expect(view.actions.map(action => action.capability)).toEqual(['model', 'fs-write', 'model', 'fs-read', 'model'])
  expect(view.delegation.used).toBe(5)
  expect(view.actions.every(action => action.state === 'succeeded')).toBe(true)
  expect(h.ctx.sessions.list()).toEqual([])
  expect(await h.ctx.sessionPersistence.list()).toEqual([])
  expect(JSON.stringify(adapter.requests[0]?.messages)).toContain('Approved work')
  const selector = { ...h.remote.selector, runId: h.request.runId }
  const readAuthority = async () => {
    const a = await h.bridge()
    return { serverId: a.serverId, accountId: a.accountId, generation: a.generation, execution: a.execution }
  }
  expect((await h.service.report(selector, readAuthority, signal())).entries).toContainEqual({ role: 'assistant', text: 'Finished' })
  await expect(h.service.report(selector, async () => executionReadAuthoritySchema.parse({
    ...await readAuthority(), accountId: randomUUID(),
  }), signal())).rejects.toThrow()
  let reads = 0
  await expect(h.service.report(selector, async () => ({ ...await readAuthority(), generation: ++reads }), signal())).rejects.toThrow()
  await h.service.verifyBindings()
  const logPath = (await readdir(join(h.root, 'execution'), { recursive: true })).find(path => path.endsWith('.jsonl'))!
  const log = await readFile(join(h.root, 'execution', logPath), 'utf8')
  expect(log).toContain('organization/execution-action')
  expect(log).toContain('result.csv')
  await h.ctx.fiber.dispose()
  const cold = await boot(h.root)
  await cold.service.verifyBindings()
  await expect(cold.service.execute(h.request, h.bridge, { adapter, directory: h.directory }, signal())).rejects.toThrow()
})
it.each(['../outside', 'alias/value', 'hardlink'])('refuses actual filesystem escape %s and stops further model effects', async (path) => {
  const h = await setup()
  const outside = join(h.root, 'outside'); await writeFile(outside, 'unchanged')
  await symlink(h.root, join(h.directory, 'alias'))
  await link(outside, join(h.directory, 'hardlink'))
  const adapter = new MockAdapter([toolCallResponse('write', 'write_file', { path, content: 'changed' }), textResponse('Should never run')])
  await expect(h.service.execute(h.request, h.bridge, { adapter, directory: h.directory }, signal())).rejects.toThrow()
  expect(await readFile(outside, 'utf8')).toBe('unchanged')
  expect(adapter.requests).toHaveLength(1)
  expect((await h.remote.read()).run.state).toBe('paused')
})
it('denies a revocation between reservation and dispatch, leaving zero file writes', async () => {
  const h = await setup()
  let revokeNext = false
  const bridge: ExecutionBridge = async (command) => {
    if (revokeNext && !command) {
      revokeNext = false
      await h.remote.transition('paused')
    }
    const result = await h.bridge(command)
    if (command?.kind === 'reserve-action' && command.capability === 'fs-write') revokeNext = true
    return result
  }
  const adapter = new MockAdapter([toolCallResponse('write', 'write_file', { path: 'denied', content: 'no' })])
  await expect(h.service.execute(h.request, bridge, { adapter, directory: h.directory }, signal())).rejects.toThrow()
  expect(await readdir(h.directory)).toEqual([])
  expect((await h.remote.read()).actions.at(-1)?.state).toBe('not-issued')
})
it('does not replay a successful write when its settlement response is lost', async () => {
  const h = await setup()
  const bridge: ExecutionBridge = async (command) => {
    const result = await h.bridge(command)
    if (command?.kind === 'settle-action' && result.execution.actions.find(a => a.actionId === command.actionId)?.capability === 'fs-write') throw new Error('lost-response')
    return result
  }
  const adapter = new MockAdapter([toolCallResponse('write', 'write_file', { path: 'once', content: 'observed' }), textResponse('Never')])
  await expect(h.service.execute(h.request, bridge, { adapter, directory: h.directory }, signal())).rejects.toThrow()
  expect(await readFile(join(h.directory, 'once'), 'utf8')).toBe('observed')
  expect(adapter.requests).toHaveLength(1)
  expect((await h.remote.read()).actions.at(-1)?.state).toBe('succeeded')
  await h.service.verifyBindings()
})
it('holds overlapping canonical directory locks and releases them after cancellation drains the adapter', async () => {
  const h = await setup()
  const locked = await acquireDirectory(h.directory)
  await expect(acquireDirectory(join(h.directory, '..', 'work'))).rejects.toThrow('directory-busy')
  locked.release()
  const cancel = new AbortController(), adapter = new MockAdapter(['hang-slow'])
  const running = h.service.execute(h.request, h.bridge, { adapter, directory: h.directory }, cancel.signal)
  const rejected = expect(running).rejects.toThrow()
  await expect.poll(() => adapter.requests.length).toBe(1)
  cancel.abort()
  await rejected
  const reacquired = await acquireDirectory(h.directory)
  reacquired.release()
  expect((await h.remote.read()).run.state).toBe('paused')
})
it('exhausts the authority budget before the next real model request', async () => {
  const h = await setup(1), adapter = new MockAdapter([toolCallResponse('write', 'write_file', { path: 'denied', content: 'no' })])
  await expect(h.service.execute(h.request, h.bridge, { adapter, directory: h.directory }, signal())).rejects.toThrow()
  expect(await readdir(h.directory)).toEqual([])
  expect(adapter.requests).toHaveLength(1)
  expect((await h.remote.read()).delegation.used).toBe(1)
})
it('charges a fresh permission for a provider retry and records the first failure separately', async () => {
  const h = await setup()
  const adapter = new MockAdapter([[{ type: 'finish', reason: { kind: 'error', failure: { code: 'RATE_LIMIT', message: 'try again' } } }], textResponse('Done')])
  adapter.providerRetryPolicy = () => ({ mode: 'normal', maxRetries: 1, retryableCodes: ['RATE_LIMIT'],
    initialDelayMs: 1, maxDelayMs: 1, jitterRatio: 0 })
  await h.service.execute(h.request, h.bridge, { adapter, directory: h.directory }, signal())
  expect(adapter.requests).toHaveLength(2)
  const view = await h.remote.read()
  expect(view.delegation.used).toBe(2)
  expect(view.actions.map(action => action.state)).toEqual(['failed', 'succeeded'])
  expect(new Set(view.actions.map(action => action.actionId)).size).toBe(2)
})
it('keeps a replacement directory lock when an earlier owner releases twice', async () => {
  const h = await setup()
  const first = await acquireDirectory(h.directory); first.release()
  const second = await acquireDirectory(h.directory); first.release()
  await expect(acquireDirectory(h.directory)).rejects.toThrow('directory-busy')
  second.release()
})
it('rejects ungranted local execution selection before creating an Agent or changing the Run', async () => {
  const h = await setup(), adapter = new MockAdapter([textResponse('Never')])
  await expect(h.service.execute(h.request, h.bridge, { adapter, directory: h.root }, signal())).rejects.toThrow('explicit-local-authorization-required')
  expect(adapter.requests).toEqual([])
  expect((await h.remote.read()).run.state).toBe('prepared')
  expect(await readdir(h.directory)).toEqual([])
})
it('aborts and drains an in-flight adapter when the local service is disposed', async () => {
  const h = await setup(), adapter = new MockAdapter(['hang-slow'])
  const running = h.service.execute(h.request, h.bridge, { adapter, directory: h.directory }, signal())
  const rejected = expect(running).rejects.toThrow()
  await expect.poll(() => adapter.requests.length).toBe(1)
  await h.ctx.fiber.dispose()
  await rejected
  const acquired = await acquireDirectory(h.directory); acquired.release()
  expect((await h.remote.read()).run.state).toBe('paused')
})
it('rechecks links after online authorization before the actual filesystem call', async () => {
  const h = await setup()
  const outside = join(h.root, 'private'); await writeFile(outside, 'private')
  const bridge: ExecutionBridge = async (command) => {
    const result = await h.bridge(command)
    if (command?.kind === 'reserve-action' && command.capability === 'fs-write') {
      await symlink(outside, join(h.directory, 'target'))
    }
    return result
  }
  const adapter = new MockAdapter([toolCallResponse('write', 'write_file', { path: 'target', content: 'changed' })])
  await expect(h.service.execute(h.request, bridge, { adapter, directory: h.directory }, signal())).rejects.toThrow()
  expect(await readFile(outside, 'utf8')).toBe('private')
})
it('denies unmapped execution tools without registering a subprocess or background provider', async () => {
  const h = await setup(), adapter = new MockAdapter([toolCallResponse('shell', 'bash', { command: 'touch escaped' }), textResponse('Stopped')])
  await h.service.execute(h.request, h.bridge, { adapter, directory: h.directory }, signal())
  expect(await readdir(h.directory)).toEqual([])
  expect((await h.remote.read()).actions.every(action => action.capability === 'model')).toBe(true)
  expect(JSON.stringify(adapter.requests[1]?.messages)).toContain('bash')
})
it('refuses even explicitly granted shell capability when strict read and network confinement is unavailable', async () => {
  const h = await setup(20, ['model', 'shell']), adapter = new MockAdapter([textResponse('Never')])
  await expect(h.service.execute(h.request, h.bridge, { adapter, directory: h.directory }, signal())).rejects.toThrow('shell-confinement-unavailable')
  expect(adapter.requests).toEqual([])
  expect((await h.remote.read()).actions).toEqual([])
})
it('rejects a durable action whose Run identity diverges from its owning binding', async () => {
  const h = await setup(), adapter = new MockAdapter([textResponse('Done')])
  await h.service.execute(h.request, h.bridge, { adapter, directory: h.directory }, signal())
  const logPath = (await readdir(join(h.root, 'execution'), { recursive: true })).find(path => path.endsWith('.jsonl'))!
  const path = join(h.root, 'execution', logPath)
  const log = await readFile(path, 'utf8')
  await writeFile(path, log.replaceAll(`"runId":"${h.request.runId}"`, `"runId":"${randomUUID()}"`))
  await expect(h.service.verifyBindings()).rejects.toThrow('action/log mismatch')
})
it.each([0, -1])('applies the complete serialized model byte ceiling with multibyte content (offset %s)', async (offset) => {
  const response = textResponse('你'), maxBytes = Buffer.byteLength(JSON.stringify(response)) + offset
  const h = await setup(20, ['model'], { ...limits, maxBytes }), adapter = new MockAdapter([response])
  const execution = h.service.execute(h.request, h.bridge, { adapter, directory: h.directory }, signal())
  if (offset === 0) await execution
  else await expect(execution).rejects.toThrow()
  const view = await h.remote.read()
  expect(view.actions.at(-1)?.state).toBe(offset === 0 ? 'succeeded' : 'unknown')
  expect(adapter.requests).toHaveLength(1)
})
it('refuses a byte ceiling smaller than an empty model response before issuing the request', async () => {
  const h = await setup(20, ['model'], { ...limits, maxBytes: 1 }), adapter = new MockAdapter([textResponse('Never')])
  await expect(h.service.execute(h.request, h.bridge, { adapter, directory: h.directory }, signal())).rejects.toThrow()
  expect(adapter.requests).toEqual([])
  expect((await h.remote.read()).actions.at(-1)?.state).toBe('not-issued')
})

async function readAuthority(bridge: ExecutionBridge) {
  const { serverId, accountId, generation, execution } = await bridge()
  return { serverId, accountId, generation, execution }
}
async function recovery(h: Awaited<ReturnType<typeof setup>>) {
  const report = await h.service.report({ ...h.remote.selector, runId: h.request.runId }, () => readAuthority(h.bridge), signal())
  expect(report.recovery?.baselineDigest).toBeTruthy()
  return { ...h.request, operationId: randomUUID() as typeof h.request.operationId, start: true,
    resume: { baselineDigest: report.recovery!.baselineDigest! } }
}
it('waits durably for a human, logs the answer before the resumed model call and never auto-wakes', async () => {
  const h = await setup()
  const adapter = new MockAdapter([toolCallResponse('question', 'request_human', { prompt: 'Please verify the expected total.', recipient: 'employee' })])
  await h.service.execute(h.request, h.bridge, { adapter, directory: h.directory }, signal())
  const view = await h.remote.read()
  expect(view.run.state).toBe('waiting-human')
  expect(adapter.requests).toHaveLength(1)
  const request = view.humanRequests[0]!
  const resume = await recovery(h)
  await expect(h.service.execute(resume, h.bridge, { adapter, directory: h.directory }, signal())).rejects.toThrow()
  const answer = { ...h.remote.selector, operationId: randomUUID(), runId: h.request.runId,
    planRevision: 1, requestId: request.id, kind: 'answer-execution-question', answer: 'Human verified total 42.' }
  await h.remote.service.participantCommand(h.remote.other.token, answer)
  await h.remote.service.participantCommand(h.remote.other.token, answer)
  expect((await h.remote.read()).run.state).toBe('waiting-human')
  await h.ctx.fiber.dispose()
  const cold = await boot(h.root, limits)
  const continued = new MockAdapter([textResponse('Done with the verified total.')])
  await cold.service.execute(resume, h.bridge, { adapter: continued, directory: h.directory }, signal())
  expect(JSON.stringify(continued.requests[0]?.messages)).toContain('Human verified total 42.')
  expect((await h.remote.read()).run.state).toBe('succeeded')
  await cold.service.verifyBindings()
})
it('independently confirms an unreported file result before resuming without a second write', async () => {
  const h = await setup()
  const bridge: ExecutionBridge = async (command) => {
    if (command?.kind === 'settle-action' && (await h.remote.read()).actions.find(a => a.actionId === command.actionId)?.capability === 'fs-write') throw new Error('offline-before-report')
    return h.bridge(command)
  }
  const adapter = new MockAdapter([toolCallResponse('write', 'write_file', { path: 'once.csv', content: 'n\n42\n' })])
  await expect(h.service.execute(h.request, bridge, { adapter, directory: h.directory }, signal())).rejects.toThrow()
  expect((await h.remote.read()).actions.at(-1)?.state).toBe('unknown')
  const resume = await recovery(h)
  await h.ctx.fiber.dispose()
  const cold = await boot(h.root, limits)
  const continued = new MockAdapter([textResponse('Already written.')])
  await cold.service.execute(resume, h.bridge, { adapter: continued, directory: h.directory }, signal())
  expect(await readFile(join(h.directory, 'once.csv'), 'utf8')).toBe('n\n42\n')
  expect((await h.remote.read()).actions.filter(a => a.capability === 'fs-write')).toHaveLength(1)
  await cold.service.verifyBindings()
})
it('refuses a changed directory and distinguishes a confirmed cancelled model result', async () => {
  const h = await setup()
  await h.service.execute(h.request, h.bridge, { adapter: new MockAdapter([toolCallResponse('q', 'request_human', { prompt: 'Question', recipient: 'employee' })]), directory: h.directory }, signal())
  const resume = await recovery(h)
  await writeFile(join(h.directory, 'external'), 'changed')
  await expect(h.service.execute(resume, h.bridge, { adapter: new MockAdapter([]), directory: h.directory }, signal())).rejects.toThrow('baseline-changed')
  const other = await setup()
  const cancel = new AbortController(), model = new MockAdapter(['hang-slow'])
  const running = other.service.execute(other.request, other.bridge, { adapter: model, directory: other.directory }, cancel.signal)
  const failed = expect(running).rejects.toThrow()
  await expect.poll(() => model.requests.length).toBe(1); cancel.abort(); await failed
  const report = await other.service.report({ ...other.remote.selector, runId: other.request.runId },
    () => readAuthority(other.bridge), signal())
  expect(report.recovery?.actions.every(a => a.status === 'confirmed')).toBe(true)
})
it('holds a write for exact employee approval and consumes it once after explicit continuation', async () => {
  const h = await setup(20, ['model', 'fs-write'], limits, true)
  const call = toolCallResponse('write', 'write_file', { path: 'approved.txt', content: 'approved bytes' })
  await h.service.execute(h.request, h.bridge, { adapter: new MockAdapter([call]), directory: h.directory }, signal())
  expect(await readdir(h.directory)).toEqual([])
  const request = (await h.remote.read()).humanRequests[0]!
  expect(request.kind).toBe('tool-approval')
  await h.remote.service.participantCommand(h.remote.other.token, { ...h.remote.selector,
    runId: h.request.runId, planRevision: 1, requestId: request.id, operationId: randomUUID(), kind: 'approve-execution-tool', approved: true })
  const adapter = new MockAdapter([call, textResponse('Written')])
  await h.service.execute(await recovery(h), h.bridge, { adapter, directory: h.directory }, signal())
  expect(await readFile(join(h.directory, 'approved.txt'), 'utf8')).toBe('approved bytes')
  expect((await h.remote.read()).actions.filter(a => a.approvalId === request.id)).toHaveLength(1)
})
it('settles durable historical evidence after assignment revocation without reactivating the old Run', async () => {
  const h = await setup()
  const bridge: ExecutionBridge = async (command) => {
    if (command?.kind === 'settle-action' && (await h.remote.read()).actions.find(a => a.actionId === command.actionId)?.capability === 'fs-write') throw new Error('reply-lost')
    return h.bridge(command)
  }
  await expect(h.service.execute(h.request, bridge, { adapter: new MockAdapter([
    toolCallResponse('write', 'write_file', { path: 'historical.txt', content: 'observed' }),
  ]), directory: h.directory }, signal())).rejects.toThrow()
  await h.remote.service.assignmentCommand(h.remote.owner.token, { ...h.remote.selector, kind: 'revoke-assignment',
    operationId: randomUUID(), expectedVersion: h.remote.db.prepare('SELECT version FROM task_assignments WHERE id=?').get(h.remote.selector.assignmentId!)?.version })
  const request = { ...await recovery(h), start: false, reconcile: true }
  await h.service.reconcile(request, h.bridge, signal())
  const view = await h.remote.read()
  expect(view.eligible).toBe(false)
  expect(view.run.state).toBe('paused')
  expect(view.actions.at(-1)?.state).toBe('succeeded')
  await expect(h.service.execute({ ...request, reconcile: false, start: true }, h.bridge,
    { adapter: new MockAdapter([]), directory: h.directory }, signal())).rejects.toThrow('resume-qualification-required')
})
