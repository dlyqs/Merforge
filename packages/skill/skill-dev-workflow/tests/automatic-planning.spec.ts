/** Normal default routing with real Loader, AgentLoop, tools and JSON/JSONL persistence. */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import Agents from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import Tools from '@deepseek-ai/dsh-tools'
import Skills from '@deepseek-ai/dsh-skill'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Llm, { createUserMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { GoalId, WorkflowAssessmentRequest } from '@deepseek-ai/dsh-personal-workflow'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { createWorkflowHarness } from '../../../workspace/personal-workflow/tests/harness.ts'
import { operation, proposal } from '../../../workspace/personal-workflow/tests/fixture.ts'
import * as Method from '../src/index.ts'

const contexts: Context[] = []
const roots: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
async function boot() {
  const root = await mkdtemp(join(tmpdir(), 'automatic-planning-')); roots.push(root)
  const result = await createWorkflowHarness(root)
  contexts.push(result.ctx)
  const session = result.ctx.sessions.create(SessionId('normal-goal'))
  const writer = await result.ctx.sessionPersistence.create(session.header)
  result.ctx.effect(() => () => writer.close())
  const input = (text: string) => session.append('user/message', createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] }), { surfaceOp: 'append' })
  return { ...result, session, input }
}

it('uses default recognition, continues clarification on one goal, and answers queries without another root', async () => {
  const root = await mkdtemp(join(tmpdir(), 'automatic-loop-')); roots.push(root)
  const { ctx, service } = await createWorkflowHarness(root, [
    ['systemPrompt', SystemPrompt], ['agents', Agents], ['tools', Tools], ['skills', Skills], ['llm', Llm], ['method', Method],
  ]); contexts.push(ctx)
  const goalId = () => {
    const event = agent.session.snapshotEvents().find(event => event.type === 'personal-workflow/assessment' && event.data.decision === 'clarify')
    if (event?.type !== 'personal-workflow/assessment' || event.data.context === undefined) throw new Error('Expected durable clarified goal')
    return event.data.context.goalId
  }
  const model = new MockAdapter([
    toolCallResponse('simple', 'workflow_assess', { modeRevision: 0, decision: 'simple', explanation: 'Ordinary CSV question' }),
    textResponse('A CSV header identifies columns'),
    toolCallResponse('clarify', 'workflow_assess', { modeRevision: 0, decision: 'clarify', explanation: 'Confirm the export acceptance' }),
    textResponse('Which columns are required?'),
    () => toolCallResponse('clarified', 'workflow_assess', { modeRevision: 0, decision: 'complex', explanation: 'Build and verify export', route: 'clarification', goalId: goalId() }),
    toolCallResponse('propose', 'workflow_propose', { ...proposal(), modeRevision: 0 }),
    textResponse('Review this plan'),
    () => toolCallResponse('query', 'workflow_assess', { modeRevision: 0, decision: 'simple', explanation: 'Read progress', route: 'query', goalId: goalId() }),
    toolCallResponse('query-cannot-propose', 'workflow_propose', { ...proposal(2, 1), modeRevision: 0 }),
    textResponse('The plan is awaiting review'),
    () => toolCallResponse('modify', 'workflow_assess', { modeRevision: 0, decision: 'complex', explanation: 'Adjust acceptance', route: 'modify', goalId: goalId() }),
    toolCallResponse('edit', 'workflow_propose', { ...proposal(3, 1), modeRevision: 0 }),
    textResponse('Review the revised plan'),
  ])
  ctx.llm.registerAdapter(['mock'], model)
  await ctx.plugin(AgentLoop, { agents: [] })
  const agent = await ctx.agentLoop.create(SessionId('automatic-method'), { provider: 'mock', model: 'mock' })
  const send = async (text: string) => {
    agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] }))
    await agent.whenIdle()
  }
  expect(await service.mode(agent.session)).toEqual({ enabled: true, revision: 0 })
  expect(service.testingPreferences().forceDecomposition).toBe(false)
  await send('Explain a CSV header')
  expect(service.list()).toEqual([])
  expect(model.requests[0]?.tools?.some(tool => tool.name === 'workflow_assess')).toBe(true)
  expect(JSON.stringify(model.requests[0]?.messages)).toContain('managed method v3')
  await send('Build a CSV export with independent test data')
  expect(service.list()).toEqual([])
  await send('Use name and email columns and verify quoting')
  const initial = service.list()[0]?.snapshot
  expect(initial?.goalId).toBe(goalId())
  expect(initial?.approval).toBeNull()
  await send('What is the status of this export?')
  expect(service.list()).toHaveLength(1)
  expect(service.list()[0]?.snapshot.revision).toBe(1)
  await send('Update the export plan acceptance')
  expect(service.list()).toHaveLength(1)
  expect(service.list()[0]?.snapshot.revision).toBe(2)
  expect((await service.goals(agent.session)).filter(goal => goal.taskId !== null)).toEqual([
    { goalId: goalId(), decision: 'complex', taskId: initial?.definition.taskId, revision: 2 },
  ])
  await using reader = await ctx.sessionPersistence.open(agent.id, 'read')
  const events = (await reader.read()).events
  expect(JSON.stringify(events)).toContain('complex goal before proposing')
  expect(events.filter(event => event.type === 'personal-workflow/assessment').map(event => event.data.context?.route)).toEqual([
    'new_goal', 'new_goal', 'clarification', 'query', 'modify',
  ])
  const replay = Session.create(agent.id, events)
  expect(await service.goals(replay)).toEqual(await service.goals(agent.session))
  expect(events.filter(event => event.type === 'user/message' && event.data.source.kind === 'personal-workflow-method')
    .every(event => event.type === 'user/message' && event.data.source.kind === 'personal-workflow-method' && event.data.source.policy?.testingRevision === 0)).toBe(true)
}, 30_000)

it('distinguishes historical untouched off from explicit off and preserves profile preferences on reopen', async () => {
  const { ctx, service, session, root } = await boot()
  expect(service.preferences()).toEqual({ enabled: true, granularity: 'balanced', revision: 0 })
  expect(await service.mode(session)).toEqual({ enabled: true, revision: 0 })
  session.append('personal-workflow/mode', { enabled: false, revision: 0, operationId: operation(70) })
  await ctx.sessions.flush(session)
  expect(await service.mode(session)).toEqual({ enabled: false, revision: 0 })
  expect(service.selectedMode(session)).toEqual({ enabled: false, revision: 0 })
  await service.setPreferences({ enabled: false, granularity: 'fine', expectedRevision: 0 })
  await expect(service.setPreferences({ enabled: true, granularity: 'balanced', expectedRevision: 0 })).rejects.toThrow('preferences-revision-conflict')
  await service.setMode(session, { sessionId: session.id, enabled: true, expectedRevision: 0, operationId: operation(71) })
  expect(await service.mode(session)).toEqual({ enabled: true, revision: 1 })
  await ctx.fiber.dispose()
  const reopened = await createWorkflowHarness(root); contexts.push(reopened.ctx)
  expect(reopened.service.preferences()).toEqual({ enabled: false, granularity: 'fine', revision: 1 })
  await using reader = await reopened.ctx.sessionPersistence.open(session.id, 'read')
  const replay = Session.create(session.id, (await reader.read()).events)
  expect(await reopened.service.mode(replay)).toEqual({ enabled: true, revision: 1 })
  const other = reopened.ctx.sessions.create(SessionId('new-default-off'))
  await using _writer = await reopened.ctx.sessionPersistence.create(other.header)
  expect(await reopened.service.mode(other)).toEqual({ enabled: false, revision: 0 })
  await reopened.service.setTestingPreferences({ forceDecomposition: true, expectedRevision: 0 })
  expect((await reopened.service.resolve(other)).enabled).toBe(true)
  await reopened.service.setTestingPreferences({ forceDecomposition: false, expectedRevision: 1 })
  expect((await reopened.service.resolve(other)).enabled).toBe(false)
  const separateRoot = await mkdtemp(join(tmpdir(), 'other-profile-')); roots.push(separateRoot)
  const separate = await createWorkflowHarness(separateRoot); contexts.push(separate.ctx)
  expect(separate.service.preferences()).toEqual({ enabled: true, granularity: 'balanced', revision: 0 })
})

it('recovers a failed assessment flush by message identity and never deduplicates new text-identical goals', async () => {
  const { ctx, service, session, input } = await boot()
  input('Same text')
  const assessment = { modeRevision: 0, decision: 'clarify', explanation: 'Need acceptance' } as const
  const flush = vi.spyOn(ctx.sessions, 'flush').mockRejectedValueOnce(new Error('disk failure'))
  await expect(service.assess(session, assessment)).rejects.toThrow('disk failure')
  const recovered = await service.assess(session, assessment)
  flush.mockRestore()
  expect(session.snapshotEvents().filter(event => event.type === 'personal-workflow/assessment')).toHaveLength(1)
  expect(await service.assess(session, assessment)).toEqual(recovered)
  await expect(service.assess(session, { ...assessment, explanation: 'Different' })).rejects.toThrow('message-assessment-conflict')
  input('Same text')
  const other = await service.assess(session, assessment)
  expect(other.context?.goalId).not.toBe(recovered.context?.goalId)
  input('Status')
  await expect(service.assess(session, { ...assessment, route: 'query', goalId: '20000000-0000-4000-8000-000000000080' as GoalId })).rejects.toThrow('unknown goal')
})

it.each(['preferences', 'testing', 'affiliation', 'tools', 'skill'] as const)('refuses a proposal after %s changes instead of using stale qualification', async (change) => {
  const { ctx, service, session, input } = await boot()
  input('Build CSV and independent data')
  await service.assess(session, { modeRevision: 0, decision: 'complex', explanation: 'Feasible' })
  if (change === 'preferences') await service.setPreferences({ enabled: true, granularity: 'fine', expectedRevision: 0 })
  if (change === 'testing') await service.setTestingPreferences({ forceDecomposition: true, expectedRevision: 0 })
  if (change === 'affiliation') {
    const project = await ctx.personalProjects.createProject({ name: 'Changed', description: '' })
    ctx.personalProjects.move(session, { projectId: project.id })
  }
  if (change === 'tools' || change === 'skill') {
    const bot = await ctx.personalProjects.createBot({ name: 'Restricted', identity: '', direction: '',
      ...(change === 'tools' ? { allowedTools: [] } : { allowedSkills: [] }) })
    ctx.personalProjects.move(session, { botId: bot.id })
  }
  await expect(service.propose(session, 0, proposal())).rejects.toThrow(/changed|disabled/)
  expect(service.list()).toEqual([])
})

it('keeps clarification on one root and refuses a second root or a legacy assessment', async () => {
  const { ctx, service, session, input } = await boot()
  input('Build an unspecified export')
  const pending = await service.assess(session, { modeRevision: 0, decision: 'clarify', explanation: 'Which fields?' })
  input('Use name and email')
  const request: WorkflowAssessmentRequest = { modeRevision: 0, decision: 'complex', explanation: 'Confirmed', route: 'clarification', goalId: pending.context?.goalId }
  await service.assess(session, request)
  await service.propose(session, 0, proposal())
  const second = proposal(6)
  const otherRoot = operation(90)
  await expect(service.propose(session, 0, { ...second, definition: { ...second.definition, taskId: otherRoot,
    tasks: second.definition.tasks.map(task => ({ ...task, id: task.id === second.definition.taskId ? otherRoot : task.id,
      parentTaskId: task.parentTaskId === second.definition.taskId ? otherRoot : task.parentTaskId })) } })).rejects.toThrow('already has a plan')
  input('Another request')
  session.append('personal-workflow/assessment', { modeRevision: 0, decision: 'complex', explanation: 'Historical record without qualification' })
  await ctx.sessions.flush(session)
  await expect(service.propose(session, 0, proposal(7, 1))).rejects.toThrow('complex goal')
})

it('keeps an ordinary Bot conversation usable when its Skill permissions disable automatic planning', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ordinary-restricted-bot-')); roots.push(root)
  const { ctx, service } = await createWorkflowHarness(root, [
    ['systemPrompt', SystemPrompt], ['agents', Agents], ['tools', Tools], ['skills', Skills], ['llm', Llm], ['method', Method],
  ]); contexts.push(ctx)
  const model = new MockAdapter([textResponse('A plain answer under this Bot')])
  ctx.llm.registerAdapter(['mock'], model)
  await ctx.plugin(AgentLoop, { agents: [] })
  const agent = await ctx.agentLoop.create(SessionId('no-planning-bot'), { provider: 'mock', model: 'mock' })
  const bot = await ctx.personalProjects.createBot({ name: 'Ordinary Bot', identity: '', direction: '', allowedSkills: [] })
  ctx.personalProjects.move(agent.session, { botId: bot.id })
  await ctx.sessions.flush(agent.session)
  agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'A question for this Bot' }] }))
  await agent.whenIdle()
  expect(model.requests).toHaveLength(1)
  expect(model.requests[0]?.tools?.some(tool => tool.name === 'workflow_assess') ?? false).toBe(false)
  expect(JSON.stringify(model.requests[0]?.messages)).not.toContain('managed method v3')
  expect(service.list()).toEqual([])
  expect((await service.resolve(agent.session)).enabled).toBe(false)
  await expect(service.assess(agent.session, { modeRevision: 0, decision: 'complex', explanation: 'Attempted bypass' })).rejects.toThrow('disabled by the current Bot')
}, 30_000)
