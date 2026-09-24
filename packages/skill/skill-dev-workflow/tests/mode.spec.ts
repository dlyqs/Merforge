/** Real JSON/JSONL mode and proposal authority through the Loader. */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import { createWorkflowHarness } from '../../../workspace/personal-workflow/tests/harness.ts'
import { operation, proposal } from '../../../workspace/personal-workflow/tests/fixture.ts'

const contexts: Context[] = []
const roots: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
async function boot() {
  const root = await mkdtemp(join(tmpdir(), 'workflow-mode-')); roots.push(root)
  const result = await createWorkflowHarness(root); contexts.push(result.ctx)
  const session = result.ctx.sessions.create(SessionId('enhanced'))
  const writer = await result.ctx.sessionPersistence.create(session.header)
  result.ctx.effect(() => () => writer.close())
  return { ...result, session }
}
it('defaults off, persists explicit selection, and accepts only assessed complex proposals', async () => {
  const { service, session } = await boot()
  expect(await service.mode(session)).toEqual({ enabled: false, revision: 0 })
  await expect(service.propose(session, 0, proposal())).rejects.toThrow('mode is off')
  await service.setMode(session, { sessionId: session.id, enabled: true, expectedRevision: 0, operationId: operation(20) })
  for (const decision of ['simple', 'clarify', 'infeasible'] as const) {
    await service.assess(session, { decision, explanation: decision, modeRevision: 1 })
    await expect(service.propose(session, 1, proposal())).rejects.toThrow('complex goal')
    expect(service.list()).toEqual([])
  }
  await service.assess(session, { decision: 'complex', explanation: 'Clarified feasible fork and join', modeRevision: 1 })
  const result = await service.propose(session, 1, proposal())
  expect(result.snapshot.approval).toBeNull()
  expect(result.snapshot.definition.tasks[2]?.dependsOn).toEqual(result.snapshot.definition.tasks[3]?.dependsOn)
  await expect(service.propose(session, 1, proposal())).resolves.toEqual(result)
  await service.setMode(session, { sessionId: session.id, enabled: false, expectedRevision: 1, operationId: operation(21) })
  await expect(service.propose(session, 1, proposal(2, 1))).rejects.toThrow('mode is off')
})
it('rejects invalid graphs, stale mode choices and tightened Skill permission', async () => {
  const { ctx, service, session } = await boot()
  const request = { sessionId: session.id, enabled: true, expectedRevision: 0, operationId: operation(20) }
  await service.setMode(session, request)
  await expect(service.setMode(session, request)).resolves.toMatchObject({ enabled: true, revision: 1 })
  await expect(service.setMode(session, { ...request, operationId: operation(21) })).rejects.toThrow('mode-revision-conflict')
  await service.assess(session, { decision: 'complex', explanation: 'Feasible', modeRevision: 1 })
  const invalid = proposal()
  await expect(service.propose(session, 1, { ...invalid, definition: { ...invalid.definition, tasks: invalid.definition.tasks.map(task => ({ ...task, dependsOn: [task.id] })) } })).rejects.toThrow('cycle')
  const bot = await ctx.personalProjects.createBot({ name: 'Restricted', identity: 'Review', direction: '', allowedSkills: [] })
  ctx.personalProjects.move(session, { botId: bot.id })
  await ctx.sessions.flush(session)
  await expect(service.propose(session, 1, proposal())).rejects.toThrow('disabled by the current Bot')
  expect(service.list()).toEqual([])
})
it('never enables from a failed flush, and retries the original gesture', async () => {
  const { ctx, service, session } = await boot()
  const request = { sessionId: session.id, enabled: true, expectedRevision: 0, operationId: operation(20) }
  const flush = vi.spyOn(ctx.sessions, 'flush').mockRejectedValueOnce(new Error('disk failure'))
  await expect(service.setMode(session, request)).rejects.toThrow('disk failure')
  expect(await service.mode(session)).toEqual({ enabled: false, revision: 0 })
  await expect(service.setMode(session, { ...request, operationId: operation(21) })).rejects.toThrow('pending mode operation')
  flush.mockRestore()
  await expect(service.setMode(session, request)).resolves.toMatchObject({ enabled: true, revision: 1 })
  expect(session.snapshotEvents().filter(event => event.type === 'personal-workflow/mode')).toHaveLength(1)
})
