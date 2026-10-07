/** Loader-backed task ownership, file evidence, bounded execution and crash recovery. */
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { SessionId, type Session } from '@deepseek-ai/dsh-session'
import { createToolResultMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import { createWorkflowHarness } from './harness.ts'
import { ids, phase, operation, proposal, phaseDefinition } from './fixture.ts'
import type { TaskRun } from '../src/types.ts'

const contexts: Context[] = []
const roots: string[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
async function setup(existing?: string) {
  const root = existing ?? await mkdtemp(join(tmpdir(), 'workflow-execution-'))
  if (!existing) roots.push(root)
  const harness = await createWorkflowHarness(root)
  contexts.push(harness.ctx)
  const cwd = join(root, 'work')
  await mkdir(cwd, { recursive: true })
  const session = async (id: string) => {
    const value = harness.ctx.sessions.create(SessionId(id), { meta: { cwd } })
    const writer = await harness.ctx.sessionPersistence.create(value.header)
    harness.ctx.effect(() => () => writer.close())
    return value
  }
  if (!existing) {
    await harness.service.save(proposal())
    await harness.service.approve({ taskId: ids[0]!, expectedRevision: 1, operationId: operation(2) })
  }
  const claim = (s: Session, index: number, op: number, maxActions = 10, mode: 'manual' | 'auto' | 'auto_until' = 'manual') => harness.service.execution.claim(s, {
    sessionId: s.id, planId: ids[0]!, taskId: ids[index]!, expectedRevision: 1, operationId: operation(op),
    authorization: { mode, stopPhaseId: phase, maxActions, maxTurns: 5, maxDurationMs: 100000 },
  })
  const complete = async (s: Session, index: number) => {
    const callId = ToolCallId(`verify-${index}`)
    const runId = await harness.service.execution.beginAction(s, callId, 'verify-file')
    await mkdir(join(cwd, 'out'), { recursive: true })
    await writeFile(join(cwd, 'out', ids[index]!), `verified-${index}`)
    await harness.service.execution.settleAction(runId!, callId, true)
    s.append('tool/result', { turn: 1, step: 1, message: createToolResultMessage({ callId, content: [{ type: 'text', text: 'checked file output' }], isError: false }) }, { surfaceOp: 'append' })
    await harness.ctx.sessions.flush(s)
    return harness.service.execution.complete(s, { summary: 'Verified actual output', acceptance: ['Verified actual output'], callIds: [callId] })
  }
  return { ...harness, cwd, session, claim, complete }
}
const control = (run: TaskRun, op: number) => ({
  sessionId: run.sessionId, runId: run.id, ownerEpoch: run.ownerEpoch, operationId: operation(op),
})

async function ordered(count = 6, stop = count, relayEveryPhases?: number) {
  const h = await setup()
  const definition = phaseDefinition(count)
  await h.service.save({ operationId: operation(20), expectedRevision: 1, definition })
  await h.service.approve({ taskId: ids[0]!, expectedRevision: 2, operationId: operation(21) })
  const source = await h.session('phase-source')
  const run = await h.service.execution.claim(source, {
    sessionId: source.id, planId: ids[0]!, taskId: ids[1]!, expectedRevision: 2, operationId: operation(22),
    authorization: { mode: 'auto_until', startPhaseId: definition.phases[0]!.id, stopPhaseId: definition.phases[stop - 1]!.id,
      maxActions: 20, maxTurns: 10, maxDurationMs: 100000, ...(relayEveryPhases === undefined ? {} : { relayEveryPhases }) },
  })
  return { ...h, definition, source, run }
}

it('verifies more than five flat phases in order and requires final root acceptance', async () => {
  const h = await ordered()
  expect(h.service.execution.candidates(await h.session('other'))).toEqual([])
  for (let index = 1; index <= 6; index++) {
    expect(h.service.execution.forSession(h.source.id)?.taskId).toBe(ids[index])
    await h.service.execution.enterTurn(h.source)
    await h.complete(h.source, index)
    expect(await h.service.execution.endTurn(h.source)).toBe(true)
    expect(h.service.list()[0]?.tasks.find(task => task.taskId === ids[index])?.status).toBe('completed')
  }
  expect(h.service.execution.forSession(h.source.id)?.taskId).toBe(ids[0])
  await h.service.execution.enterTurn(h.source)
  await h.complete(h.source, 0)
  expect(await h.service.execution.endTurn(h.source)).toBe(false)
  expect(h.service.list()[0]?.tasks.every(task => task.status === 'completed')).toBe(true)
  expect(h.service.execution.forSession(h.source.id)).toMatchObject({ turnsUsed: 7, status: 'completed' })
  expect(h.service.execution.forSession(h.source.id)?.actions).toHaveLength(7)
})

it('stops at the inclusive phase endpoint without reserving or starting later work', async () => {
  const h = await ordered(6, 2)
  await h.service.execution.enterTurn(h.source); await h.complete(h.source, 1)
  expect(await h.service.execution.endTurn(h.source)).toBe(true)
  await h.service.execution.enterTurn(h.source); await h.complete(h.source, 2)
  expect(await h.service.execution.endTurn(h.source)).toBe(false)
  expect(h.service.execution.forSession(h.source.id)).toMatchObject({ taskId: ids[2], status: 'completed', turnsUsed: 2 })
  expect(h.service.execution.candidates(await h.session('next'))[0]?.ready).toEqual([ids[3]])
  await expect(h.service.execution.enterTurn(h.source)).rejects.toThrow('task-completed')
})

it('executes final root acceptance after the phase tasks were completed individually', async () => {
  const h = await setup(), definition = phaseDefinition(2)
  await h.service.save({ operationId: operation(20), expectedRevision: 1, definition })
  await h.service.approve({ taskId: ids[0]!, expectedRevision: 2, operationId: operation(21) })
  for (const index of [1, 2]) {
    const session = await h.session(`individual-${index}`)
    await h.service.execution.claim(session, { sessionId: session.id, planId: ids[0]!, taskId: ids[index]!,
      expectedRevision: 2, operationId: operation(22 + index),
      authorization: { mode: 'manual', stopPhaseId: definition.phases[index - 1]!.id, maxActions: 5, maxTurns: 3, maxDurationMs: 100000 } })
    await h.service.execution.enterTurn(session); await h.complete(session, index)
    expect(await h.service.execution.endTurn(session)).toBe(false)
  }
  const session = await h.session('root-acceptance')
  const run = await h.service.execution.claim(session, { sessionId: session.id, planId: ids[0]!, taskId: ids[0]!,
    expectedRevision: 2, operationId: operation(25),
    authorization: { mode: 'auto', startPhaseId: definition.phases[1]!.id, stopPhaseId: definition.phases[1]!.id,
      maxActions: 5, maxTurns: 3, maxDurationMs: 100000 } })
  expect(run.sequence?.taskIds).toEqual([ids[0]])
  await h.service.execution.enterTurn(session); await h.complete(session, 0)
  expect(await h.service.execution.endTurn(session)).toBe(false)
  expect(h.service.list()[0]?.tasks.every(task => task.status === 'completed')).toBe(true)
})

it('requires fresh verification in each phase and pauses progression at the cumulative action boundary', async () => {
  const h = await ordered(3)
  await h.service.execution.enterTurn(h.source); await h.complete(h.source, 1)
  expect(await h.service.execution.endTurn(h.source)).toBe(true)
  await h.service.execution.enterTurn(h.source)
  await expect(h.service.execution.complete(h.source, { summary: 'Reused old verification', acceptance: ['Verified'], callIds: ['verify-1'] }))
    .rejects.toThrow('verification-action-not-successful')
  for (let index = 0; index < 19; index++) {
    const callId = `read-${index}`
    const id = await h.service.execution.beginAction(h.source, callId, 'read')
    await h.service.execution.settleAction(id!, callId, true)
  }
  expect(await h.service.execution.endTurn(h.source)).toBe(false)
  const stopped = h.service.execution.forSession(h.source.id)!
  expect(stopped).toMatchObject({ taskId: ids[2], status: 'paused', reason: 'authorization-boundary', turnsUsed: 2 })
  await expect(h.service.execution.resume(h.source, { ...control(stopped, 40), reconciliation: '' })).rejects.toThrow('budget-exhausted')
})

it('retains range, evidence, cumulative budgets and single ownership across a phase relay and restart', async () => {
  const h = await ordered(3, 3, 1)
  await h.service.execution.enterTurn(h.source); await h.complete(h.source, 1)
  expect(await h.service.execution.endTurn(h.source)).toBe(false)
  const run = h.service.execution.forSession(h.source.id)!
  expect(run).toMatchObject({ taskId: ids[2], reason: 'phase-relay-ready', status: 'paused', turnsUsed: 1 })
  const handoff = await h.service.execution.prepareHandoff(h.source, { ...control(run, 23), context: 'Keep all instructions and verified Phase 1 evidence' })
  const target = await h.session(handoff.targetSessionId)
  const transferred = await h.service.execution.finishHandoff(target, run.id, handoff.id)
  await expect(h.service.execution.enterTurn(h.source)).rejects.toThrow('owner-revoked')
  await h.service.execution.resume(target, { ...control(transferred, 24), reconciliation: '' })
  await h.service.execution.enterTurn(target)
  expect(h.service.execution.forSession(target.id)).toMatchObject({
    turnsUsed: 2, authorization: run.authorization, sequence: run.sequence,
  })
  await h.ctx.fiber.dispose()
  const reopened = await setup(h.root)
  const recovered = reopened.service.execution.forSession(target.id)!
  expect(recovered).toMatchObject({
    status: 'needs_reconciliation', reason: 'host-restarted', ownerEpoch: 2, sequence: run.sequence, turnsUsed: 2,
  })
  expect(reopened.service.list()[0]?.tasks.find(task => task.taskId === ids[1])?.status).toBe('completed')
})

it('rejects reversed ranges, phase ranges on hierarchical plans and missing per-phase acceptance', async () => {
  const h = await setup(), definition = phaseDefinition(3)
  await h.service.save({ operationId: operation(20), expectedRevision: 1, definition })
  await h.service.approve({ taskId: ids[0]!, expectedRevision: 2, operationId: operation(21) })
  const other = await h.session('invalid-range')
  const authorization = { mode: 'auto_until' as const, startPhaseId: definition.phases[0]!.id,
    stopPhaseId: definition.phases[2]!.id, maxActions: 20, maxTurns: 10, maxDurationMs: 100000 }
  const request = { sessionId: other.id, planId: ids[0]!, taskId: ids[1]!, expectedRevision: 2, operationId: operation(30), authorization }
  await expect(h.service.execution.claim(other, { ...request,
    authorization: { ...authorization, startPhaseId: definition.phases[1]!.id, stopPhaseId: definition.phases[0]!.id },
  })).rejects.toThrow('invalid-inclusive-phase-range')
  await h.service.execution.claim(other, { ...request, operationId: operation(31) })
  await h.service.execution.enterTurn(other)
  await expect(h.service.execution.complete(other, { summary: 'Skipped acceptance', acceptance: [], callIds: ['invented'] })).rejects.toThrow()
  const ordinary = await setup(), s = await ordinary.session('hierarchical')
  await expect(ordinary.service.execution.claim(s, { sessionId: s.id, planId: ids[0]!, taskId: ids[1]!,
    expectedRevision: 1, operationId: operation(30),
    authorization: { ...authorization, startPhaseId: phase, stopPhaseId: phase } })).rejects.toThrow('phase-sequence')
})

it('retains full node statuses while qualifying ready candidates by conversation directory', async () => {
  const h = await setup()
  const request = proposal(20, 1)
  await h.service.save({ ...request, definition: { ...request.definition,
    tasks: request.definition.tasks.map(task => task.id === ids[1] ? { ...task, cwd: join(h.root, 'other') }
      : task.id === ids[2] ? { ...task, dependsOn: [] } : task),
  } })
  await h.service.approve({ taskId: ids[0]!, expectedRevision: 2, operationId: operation(21) })
  const candidates = h.service.execution.candidates(await h.session('directory-filter'))
  expect(candidates[0]?.ready).toEqual([ids[2]])
  expect(candidates[0]?.tasks).toHaveLength(5)
  expect(candidates[0]?.tasks.find(task => task.taskId === ids[1])).toMatchObject({ status: 'ready', candidate: false })
  expect(candidates[0]?.tasks.find(task => task.taskId === ids[2])).toMatchObject({ status: 'ready', candidate: true })
})

it('atomically claims one ready task, releases parallel branches from real evidence, and waits for join and parent verification', async () => {
  const h = await setup()
  const a = await h.session('a'); const b = await h.session('b'); const c = await h.session('c')
  expect(h.service.execution.candidates(a)[0]?.ready).toEqual([ids[1]])
  expect(h.service.execution.candidates(a)[0]?.tasks).toHaveLength(5)
  expect(h.service.execution.candidates(a)[0]?.tasks.find(task => task.taskId === ids[2])).toMatchObject({ status: 'blocked', candidate: false })
  const outcomes = await Promise.allSettled([h.claim(a, 1, 3), h.claim(b, 1, 4)])
  expect(outcomes.map(value => value.status)).toEqual(['fulfilled', 'rejected'])
  expect(await h.claim(a, 1, 3)).toMatchObject({ sessionId: a.id })
  await expect(h.service.save(proposal(5, 1))).rejects.toThrow('stop-execution')
  await expect(h.service.execution.complete(a, { summary: 'done', acceptance: ['done'], callIds: ['invented'] })).rejects.toThrow('not-successful')
  await h.complete(a, 1)
  expect(h.service.execution.candidates(b)[0]?.ready).toEqual([ids[2], ids[3]])
  expect(h.service.execution.candidates(b)[0]?.tasks.find(task => task.taskId === ids[1])).toMatchObject({ status: 'completed', candidate: false })
  const [rb, rc] = await Promise.all([h.claim(b, 2, 6), h.claim(c, 3, 7)])
  expect(rb.status).toBe('running'); expect(rc.status).toBe('running')
  await h.complete(b, 2)
  expect(h.service.list()[0]?.ready).toEqual([])
  await h.complete(c, 3)
  expect(h.service.list()[0]?.ready).toEqual([ids[4]])
  const d = await h.session('d'); await h.claim(d, 4, 8); await h.complete(d, 4)
  expect(h.service.list()[0]?.ready).toEqual([ids[0]])
  const parent = await h.session('parent'); await h.claim(parent, 0, 9); await h.complete(parent, 0)
  expect(h.service.list()[0]?.tasks.every(task => task.status === 'completed')).toBe(true)
})

it('stops new actions on cancellation while retaining late results and sibling execution', async () => {
  const h = await setup(); const a = await h.session('a'); await h.claim(a, 1, 3); await h.complete(a, 1)
  const b = await h.session('b'); const c = await h.session('c')
  const rb = await h.claim(b, 2, 4); await h.claim(c, 3, 5)
  await h.service.execution.beginAction(b, 'in-flight', 'write')
  await h.service.execution.stop(b, control(rb, 6), true)
  await expect(h.service.execution.beginAction(b, 'late', 'write')).rejects.toThrow('cancelled')
  await h.service.execution.settleAction(rb.id, 'in-flight', true)
  expect(h.service.execution.forSession(b.id)?.actions[0]?.status).toBe('succeeded')
  expect(h.service.execution.denial(c)).toBeUndefined()
})

it('enforces action and turn boundaries, manual pauses, and explicit automatic continuation only within the selected task', async () => {
  const h = await setup(); const a = await h.session('a'); const run = await h.claim(a, 1, 3, 1)
  await h.service.execution.enterTurn(a)
  expect(await h.service.execution.endTurn(a)).toBe(false)
  await h.service.execution.resume(a, { ...control(run, 4), reconciliation: '' })
  await h.service.execution.beginAction(a, 'one', 'read')
  await h.service.execution.settleAction(run.id, 'one', true)
  await expect(h.service.execution.beginAction(a, 'two', 'read')).rejects.toThrow('action-limit')
  await expect(h.service.execution.resume(a, { ...control(run, 5), reconciliation: '' })).rejects.toThrow('budget-exhausted')
  expect(h.service.list()[0]?.tasks.find(task => task.taskId === ids[2])?.candidate).toBe(false)
})

it('prepares one receiver before creation, retries transfer, fences the old owner and keeps cumulative authorization', async () => {
  const h = await setup(); const a = await h.session('a'); const run = await h.claim(a, 1, 3)
  await h.service.execution.enterTurn(a)
  await h.service.execution.beginAction(a, 'read', 'read')
  await expect(h.service.execution.prepareHandoff(a, { ...control(run, 4), context: 'Continue verification' })).rejects.toThrow('settle')
  await h.service.execution.settleAction(run.id, 'read', true)
  const request = { ...control(run, 4), context: 'Decision: CSV format fixed. Remaining: verify file.' }
  const handoff = await h.service.execution.prepareHandoff(a, request)
  expect(await h.service.execution.prepareHandoff(a, request)).toEqual(handoff)
  expect(h.service.execution.denial(a)).toBe('task-paused')
  const target = await h.session(handoff.targetSessionId)
  const next = await h.service.execution.finishHandoff(target, run.id, handoff.id)
  expect(await h.service.execution.finishHandoff(target, run.id, handoff.id)).toEqual(next)
  expect(next.ownerEpoch).toBe(2); expect(next.actions).toHaveLength(1); expect(next.turnsUsed).toBe(1)
  expect(next.authorization).toEqual(run.authorization)
  expect(h.service.execution.denial(a)).toBe('execution-owner-revoked')
  await expect(h.service.execution.resume(a, { ...control(run, 5), reconciliation: '' })).rejects.toThrow('owner-revoked')
  await h.service.execution.resume(target, { ...control(next, 6), reconciliation: '' })
  expect(await h.service.execution.enterTurn(target)).toContain(handoff.context)
})

it('reopens running work as unknown without replay and requires explicit reconciliation of file changes', async () => {
  const h = await setup(); const a = await h.session('a'); const run = await h.claim(a, 1, 3)
  await h.service.execution.beginAction(a, 'unsettled-write', 'write')
  await mkdir(join(h.cwd, 'out'), { recursive: true }); await writeFile(join(h.cwd, 'out', ids[1]!), 'effect before crash')
  await h.ctx.fiber.dispose()
  const reopened = await setup(h.root)
  const source = reopened.ctx.sessions.create(SessionId('a'), { meta: { cwd: reopened.cwd } })
  expect(reopened.service.execution.forSession(source.id)).toMatchObject({ status: 'needs_reconciliation', actions: [{ status: 'unknown' }] })
  await expect(reopened.service.execution.resume(source, { ...control(run, 4), reconciliation: '' })).rejects.toThrow('reconciliation-required')
  await reopened.service.execution.resume(source, { ...control(run, 5), reconciliation: 'Inspected the file; the earlier write occurred. Verify it with a new read.' })
  expect(reopened.service.execution.forSession(source.id)?.actions).toHaveLength(1)
  // Reconciled unknown history stays visible and cannot silently become successful evidence.
  await expect(reopened.service.execution.complete(source, { summary: 'done', acceptance: ['done'], callIds: ['unsettled-write'] })).rejects.toThrow('not-successful')
})

it('recovers a prepared handoff across restart and refuses changed associated artifacts until inspected', async () => {
  const h = await setup(); const a = await h.session('a'); const run = await h.claim(a, 1, 3)
  const request = { ...control(run, 4), context: 'Inspect output' }
  const handoff = await h.service.execution.prepareHandoff(a, request)
  await h.ctx.fiber.dispose()
  const reopened = await setup(h.root)
  const source = reopened.ctx.sessions.create(SessionId('a'), { meta: { cwd: reopened.cwd } })
  expect((await reopened.service.execution.prepareHandoff(source, request)).targetSessionId).toBe(handoff.targetSessionId)
  const target = await reopened.session(handoff.targetSessionId)
  await mkdir(join(reopened.cwd, 'out'), { recursive: true }); await writeFile(join(reopened.cwd, 'out', ids[1]!), 'external change')
  await expect(reopened.service.execution.finishHandoff(target, run.id, handoff.id)).rejects.toThrow('reconciliation-required')
  await reopened.service.execution.resume(source, { ...control(run, 5), reconciliation: 'Inspected changed artifact; retain it.' })
  expect((await reopened.service.execution.finishHandoff(target, run.id, handoff.id)).sessionId).toBe(target.id)
})

it('does not publish a failed claim or transfer and retains the prepared receiver on retry', async () => {
  const { vi } = await import('vitest')
  const h = await setup(); const a = await h.session('a')
  const domain = h.ctx.storageDomain.get('personal_workflow')!
  const unit = Reflect.get(domain, 'unit') as import('@deepseek-ai/dsh-storage').KvUnit
  const fault = vi.spyOn(unit, 'putRecord').mockRejectedValueOnce(new Error('claim disk failed'))
  await expect(h.claim(a, 1, 3)).rejects.toThrow('claim disk failed')
  expect(h.service.execution.forSession(a.id)).toBeNull()
  const run = await h.claim(a, 1, 3)
  const request = { ...control(run, 4), context: 'Continue inspected task' }
  const handoff = await h.service.execution.prepareHandoff(a, request)
  const target = await h.session(handoff.targetSessionId)
  fault.mockRejectedValueOnce(new Error('transfer disk failed'))
  await expect(h.service.execution.finishHandoff(target, run.id, handoff.id)).rejects.toThrow('transfer disk failed')
  expect(h.service.execution.forSession(a.id)?.sessionId).toBe(a.id)
  expect(h.service.execution.denial(target)).toBe('execution-owner-revoked')
  expect((await h.service.execution.prepareHandoff(a, request)).targetSessionId).toBe(target.id)
  expect((await h.service.execution.finishHandoff(target, run.id, handoff.id)).ownerEpoch).toBe(2)
  fault.mockRestore()
})

it('requires reconciliation after archive and denies delegated execution', async () => {
  const h = await setup(); const a = await h.session('a'); const run = await h.claim(a, 1, 3)
  await h.ctx.workspaceRegistry.archiveSession(a.id)
  await expect(h.service.execution.checkAccess(a)).rejects.toThrow('session-archived')
  expect(h.service.execution.forSession(a.id)?.status).toBe('needs_reconciliation')
  await h.ctx.workspaceRegistry.unarchiveSession(a.id)
  await h.service.execution.resume(a, { ...control(run, 4), reconciliation: 'Restored the same conversation and checked output.' })
  expect(h.service.execution.denial(a)).toBeUndefined()
  expect(h.service.execution.denial(a, 'subagent')).toBe('tool-outside-task-authorization')
  const child = h.ctx.sessions.create(SessionId('child'), { meta: { cwd: h.cwd, parentSession: a.id } })
  expect(h.service.execution.denial(child)).toBe('task-does-not-authorize-delegated-execution')
})

it('refuses a prepared transfer after Bot permissions tighten and requires explicit reinspection after restoration', async () => {
  const h = await setup()
  const bot = await h.ctx.personalProjects.createBot({ name: 'Executor', allowedSkills: ['dev-workflow'] })
  const other = proposal(20)
  const definition = { ...other.definition, taskId: ids[5]!, botId: bot.id,
    tasks: [{ ...other.definition.tasks[1]!, id: ids[5]!, parentTaskId: null }] }
  await h.service.save({ ...other, definition })
  await h.service.approve({ taskId: ids[5]!, expectedRevision: 1, operationId: operation(21) })
  const source = await h.session('bot-source')
  h.ctx.personalProjects.move(source, { botId: bot.id }, 'create')
  const run = await h.service.execution.claim(source, { sessionId: source.id, planId: ids[5]!, taskId: ids[5]!, expectedRevision: 1,
    operationId: operation(22), authorization: { mode: 'manual', stopPhaseId: phase, maxActions: 10, maxTurns: 3, maxDurationMs: 100000 } })
  const handoff = await h.service.execution.prepareHandoff(source, { ...control(run, 23), context: 'Same task and Bot' })
  const target = await h.session(handoff.targetSessionId)
  h.ctx.personalProjects.move(target, { botId: bot.id }, 'create')
  await h.ctx.personalProjects.updateBot(bot.id, { allowedSkills: [] })
  await expect(h.service.execution.finishHandoff(target, run.id, handoff.id)).rejects.toThrow('workflow-skill-disabled')
  await expect(h.service.execution.resume(source, { ...control(run, 24), reconciliation: 'Cannot override forbidden Skill' })).rejects.toThrow('workflow-skill-disabled')
  await h.ctx.personalProjects.updateBot(bot.id, { allowedSkills: ['dev-workflow'] })
  await expect(h.service.execution.finishHandoff(target, run.id, handoff.id)).rejects.toThrow('reconciliation-required')
  await h.service.execution.resume(source, { ...control(run, 25), reconciliation: 'Inspected restored Bot policy and task files.' })
  expect((await h.service.execution.finishHandoff(target, run.id, handoff.id)).sessionId).toBe(target.id)
})

it('rejects persisted duplicate ownership, invalid epochs and completion without evidence', async () => {
  const { storedPlanSchema } = await import('../src/schema.ts')
  const h = await setup(); const a = await h.session('a'); const run = await h.claim(a, 1, 3)
  const snapshot = h.service.read({ taskId: ids[0]! })
  const record = { taskId: ids[0], revisions: [snapshot], receipts: [{ operationId: operation(1), fingerprint: 'receipt', snapshot }], runs: [run] }
  expect(storedPlanSchema.safeParse(record).success).toBe(true)
  expect(storedPlanSchema.safeParse({ ...record, runs: [run, run] }).success).toBe(false)
  expect(storedPlanSchema.safeParse({ ...record, runs: [{ ...run, ownerEpoch: 2 }] }).success).toBe(false)
  expect(storedPlanSchema.safeParse({ ...record, runs: [{ ...run, status: 'completed' }] }).success).toBe(false)
})

it('keeps sibling ownership during transfer and reopens a transferred receiver without waking or resetting its budget', async () => {
  const h = await setup(); const prerequisite = await h.session('prerequisite')
  await h.claim(prerequisite, 1, 3); await h.complete(prerequisite, 1)
  const source = await h.session('source'); const sibling = await h.session('sibling')
  const run = await h.claim(source, 2, 4); const siblingRun = await h.claim(sibling, 3, 5)
  await h.service.execution.beginAction(sibling, ToolCallId('sibling-action'), 'write')
  const handoff = await h.service.execution.prepareHandoff(source, { ...control(run, 6), context: 'Finish implementation verification' })
  const target = await h.session(handoff.targetSessionId)
  const transferred = await h.service.execution.finishHandoff(target, run.id, handoff.id)
  expect(h.service.execution.denial(source)).toBe('execution-owner-revoked')
  expect(h.service.execution.denial(sibling)).toBeUndefined()
  await h.service.execution.settleAction(siblingRun.id, ToolCallId('sibling-action'), true)
  expect(h.service.execution.forSession(sibling.id)?.status).toBe('running')
  await h.ctx.fiber.dispose()
  const reopened = await setup(h.root)
  const receiver = reopened.ctx.sessions.create(target.id, { meta: { cwd: reopened.cwd } })
  const recovered = reopened.service.execution.forSession(receiver.id)
  expect(recovered).toEqual(transferred)
  expect(recovered?.authorization).toEqual(run.authorization)
  expect(recovered?.startedAt).toBe(run.startedAt)
  await reopened.service.execution.resume(receiver, { ...control(transferred, 7), reconciliation: '' })
  expect(reopened.service.execution.forSession(receiver.id)?.actions).toEqual([])
})

it('refuses handoff at the action budget boundary before reserving any receiver', async () => {
  const h = await setup(); const source = await h.session('source'); const run = await h.claim(source, 1, 3, 1)
  await h.service.execution.beginAction(source, ToolCallId('last-action'), 'read')
  await h.service.execution.settleAction(run.id, ToolCallId('last-action'), true)
  await expect(h.service.execution.prepareHandoff(source, { ...control(run, 4), context: 'Cannot extend authorization by transferring' }))
    .rejects.toThrow('budget-exhausted')
  expect(h.service.execution.forSession(source.id)?.handoffs).toEqual([])
})
