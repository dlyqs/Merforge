import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { definition, ids, operation, proposal } from './fixture.ts'
import type { PersonalWorkflow } from '../src/index.ts'
import { createWorkflowHarness } from './harness.ts'

const contexts: Context[] = []
const directories: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const ctx of contexts.reverse()) await ctx.fiber.dispose()
  contexts.length = 0
  for (const directory of directories) await rm(directory, { recursive: true, force: true })
  directories.length = 0
})

async function boot(root?: string) {
  if (!root) { root = await mkdtemp(join(tmpdir(), 'personal-workflow-')); directories.push(root) }
  const harness = await createWorkflowHarness(root)
  contexts.push(harness.ctx)
  return harness
}

async function enablePlanning(service: PersonalWorkflow, session: Session): Promise<void> {
  await service.setMode(session, { sessionId: session.id, enabled: true, expectedRevision: 0, operationId: operation(20) })
  session.append('user/message', createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'A complex test goal' }] }), { surfaceOp: 'append' })
  await service.assess(session, { modeRevision: 1, decision: 'complex', explanation: 'Validated test plan' })
}

describe('durable personal workflow through Loader', () => {
  it('reopens real JSON plans and JSONL Session snapshots with stable retry receipts', async () => {
    const first = await boot()
    const session = first.ctx.sessions.create(SessionId('planning'))
    const writer = await first.ctx.sessionPersistence.create(session.header)
    await enablePlanning(first.service, session)
    const proposed = await first.service.propose(session, 1, proposal())
    const approved = await first.service.approve({ taskId: ids[0]!, operationId: operation(2), expectedRevision: 1 })
    expect(approved.approval).not.toBeNull()
    await first.service.save(proposal(3, 1))
    expect(first.service.read({ taskId: ids[0]! }).approval).toBeNull()
    expect(await first.service.propose(session, 1, proposal())).toEqual(proposed)
    await writer.close()
    await first.ctx.fiber.dispose()
    const second = await boot(first.root)
    expect(second.service.read({ taskId: ids[0]!, revision: 1 })).toEqual(approved)
    expect(second.service.list()[0]?.snapshot.revision).toBe(2)
    await using reader = await second.ctx.sessionPersistence.open(session.id, 'read')
    const events = (await reader.read()).events
    const replay = Session.create(session.id, events)
    expect(replay.snapshotEvents().filter(event => event.type === 'personal-workflow/snapshot')).toHaveLength(1)
    expect(replay.snapshotEvents().find(event => event.type === 'personal-workflow/snapshot')?.data).toEqual(proposed)
    expect(await second.service.approve({ taskId: ids[0]!, operationId: operation(2), expectedRevision: 1 })).toEqual(approved)
    await expect(second.service.approve({ taskId: ids[0]!, operationId: operation(4), expectedRevision: 1 })).rejects.toThrow('revision-conflict')
  })

  it('allows one concurrent revision update and makes duplicate requests idempotent', async () => {
    const { service } = await boot()
    const request = proposal()
    const results = await Promise.all([service.save(request), service.save(request)])
    expect(results[0]).toEqual(results[1])
    const edits = await Promise.allSettled([service.save(proposal(2, 1)), service.save(proposal(3, 1))])
    expect(edits.map(result => result.status).sort()).toEqual(['fulfilled', 'rejected'])
    expect(service.list()[0]?.snapshot.revision).toBe(2)
    await expect(service.save({ ...request, definition: { ...definition(), tasks: definition().tasks.map(task => ({ ...task, goal: 'Different' })) } })).rejects.toThrow('operation-id-conflict')
    await expect(service.approve({ taskId: ids[0]!, operationId: operation(1), expectedRevision: 2 })).rejects.toThrow('operation-id-conflict')
  })

  it('leaves persisted and visible versions unchanged when backend commit fails', async () => {
    const { ctx, service } = await boot()
    await service.save(proposal())
    const domain = ctx.storageDomain.get('personal_workflow')!
    const unit = Reflect.get(domain, 'unit') as import('@deepseek-ai/dsh-storage').KvUnit
    const failure = vi.spyOn(unit, 'putRecord').mockRejectedValueOnce(new Error('disk failure'))
    await expect(service.save(proposal(2, 1))).rejects.toThrow('disk failure')
    expect(service.read({ taskId: ids[0]! }).revision).toBe(1)
    failure.mockRestore()
    vi.spyOn(unit, 'putRecord').mockRejectedValueOnce(new Error('approval disk failure'))
    await expect(service.approve({ taskId: ids[0]!, operationId: operation(3), expectedRevision: 1 }))
      .rejects.toThrow('approval disk failure')
    expect(service.read({ taskId: ids[0]! }).approval).toBeNull()
    expect((await service.save(proposal(2, 1))).revision).toBe(2)
  })

  it('retries a failed Session flush without duplicating the plan or event', async () => {
    const { ctx, service } = await boot()
    const session = ctx.sessions.create(SessionId('retry'))
    await using _writer = await ctx.sessionPersistence.create(session.header)
    await enablePlanning(service, session)
    const failure = vi.spyOn(ctx.sessions, 'flush').mockRejectedValueOnce(new Error('flush failed'))
    await expect(service.propose(session, 1, proposal())).rejects.toThrow('flush failed')
    expect(service.read({ taskId: ids[0]! }).revision).toBe(1)
    failure.mockRestore()
    await service.propose(session, 1, proposal())
    expect(session.snapshotEvents().filter(event => event.type === 'personal-workflow/snapshot')).toHaveLength(1)
    const reader = await ctx.sessionPersistence.open(session.id, 'read')
    expect((await reader.read()).events).toEqual(session.snapshotEvents())
    await reader.close()
  })

  it('recovers a committed proposal when Session append failed before writing any event', async () => {
    const { ctx, service } = await boot()
    const session = ctx.sessions.create(SessionId('append-retry'))
    await using _writer = await ctx.sessionPersistence.create(session.header)
    await enablePlanning(service, session)
    const append = vi.spyOn(session, 'append').mockImplementationOnce(() => { throw new Error('append failed') })
    await expect(service.propose(session, 1, proposal())).rejects.toThrow('append failed')
    expect(service.read({ taskId: ids[0]! }).revision).toBe(1)
    expect(session.snapshotEvents().filter(event => event.type === 'personal-workflow/snapshot')).toHaveLength(0)
    append.mockRestore()
    await service.propose(session, 1, proposal())
    expect(session.snapshotEvents().filter(event => event.type === 'personal-workflow/snapshot')).toHaveLength(1)
    expect(service.list()).toHaveLength(1)
  })

  it('rejects false durability and retains the original observed version on retry', async () => {
    const { ctx, service } = await boot()
    await service.save(proposal())
    const session = ctx.sessions.create(SessionId('reader'))
    await expect(service.snapshot(session, { taskId: ids[0]! }, operation(8))).rejects.toThrow()
    await using writer = await ctx.sessionPersistence.create(session.header)
    await writer.append(session.snapshotEvents())
    const original = await service.snapshot(session, { taskId: ids[0]! }, operation(8))
    await service.approve({ taskId: ids[0]!, operationId: operation(2), expectedRevision: 1 })
    await service.save(proposal(3, 1))
    expect(await service.snapshot(session, { taskId: ids[0]! }, operation(8))).toEqual(original)
    expect(original.snapshot.approval).toBeNull()
    await expect(service.snapshot(session, { taskId: ids[0]!, revision: 2 }, operation(8))).rejects.toThrow('operation-id-conflict')
  })

  it('keeps task ownership across plans and refuses retired identities or affiliation edits', async () => {
    const { service } = await boot()
    await service.save(proposal())
    const other = { ...definition(), taskId: ids[7]!, tasks: definition().tasks.map(task => ({
      ...task, id: task.id === ids[0] ? ids[7]! : task.id, parentTaskId: task.parentTaskId === null ? null : ids[7]!,
    })) }
    await expect(service.save({ ...proposal(2), definition: other })).rejects.toThrow('another plan')
    const reduced = { ...definition(), tasks: definition().tasks.filter(task => task.id !== ids[4]) }
    await service.save({ ...proposal(3, 1), definition: reduced })
    await expect(service.save(proposal(4, 2))).rejects.toThrow('retired task')
  })
})
