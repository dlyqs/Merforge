/** Actual Loader registrations, model context and guarded tools without a browser. */
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import Agents, { agentEvents, type Agent } from '@deepseek-ai/dsh-agent'
import Tools from '@deepseek-ai/dsh-tools'
import Skills from '@deepseek-ai/dsh-skill'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { SessionId } from '@deepseek-ai/dsh-session'
import { createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import { unsupportedInbox } from '@deepseek-ai/dsh-agent-loop-testkit'
import { createWorkflowHarness } from '../../../workspace/personal-workflow/tests/harness.ts'
import { operation, proposal } from '../../../workspace/personal-workflow/tests/fixture.ts'
import * as plugin from '../src/index.ts'

it('loads a portable authorized method, preserves off input, records enabled context and disposes registrations', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workflow-skill-'))
  const { ctx, service } = await createWorkflowHarness(root, [['systemPrompt', SystemPrompt], ['agents', Agents], ['tools', Tools], ['skills', Skills], ['method', plugin]])
  try {
    expect('default' in plugin).toBe(false)
    const session = ctx.sessions.create(SessionId('method'))
    const writer = await ctx.sessionPersistence.create(session.header)
    ctx.effect(() => () => writer.close())
    const agent: Agent = {
      id: session.id, ctx, options: {}, session, status: 'idle', inbox: unsupportedInbox(),
      send() {}, followup() {}, steer() {}, inject() {}, cancel() {}, whenIdle: async () => {},
      runMaintenance: task => task(new AbortController().signal),
    }
    await service.setPreferences({ enabled: false, granularity: 'balanced', expectedRevision: 0 })
    const signal = new AbortController().signal
    const messages = [createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Prepare CSV export with independent test data' }] })]
    const step = () => agentEvents(ctx, agent).waterfall('agent/pre-step', { messages, turn: 1, step: 1, signal }, async () => ({ kind: 'enter' as const, messages }))
    expect(await step()).toEqual({ kind: 'enter', messages })
    const disabled = await ctx.tools.execute({ name: 'workflow_assess', arguments: { modeRevision: 0, decision: 'complex', explanation: 'Ready' }, agent, signal, callId: ToolCallId('off') })
    expect(JSON.stringify(disabled)).toContain('mode is off')
    await service.setMode(session, { sessionId: session.id, enabled: true, expectedRevision: 0, operationId: operation(20) })
    const enabled = await step()
    expect(enabled.kind).toBe('enter')
    if (enabled.kind !== 'enter') throw new Error('Expected admitted model input')
    expect(JSON.stringify(enabled.messages)).toContain('parent-child tree')
    expect(JSON.stringify(enabled.messages)).toContain("use that name as the root task's goal")
    expect(JSON.stringify(enabled.messages)).toContain('Normally every node has at most 5 direct children.')
    expect(JSON.stringify(enabled.messages)).toContain('place 10 subtasks under 2–3 groups')
    for (const message of enabled.messages) session.append('user/message', message, { surfaceOp: 'append' })
    await ctx.sessions.flush(session)
    await using reader = await ctx.sessionPersistence.open(session.id, 'read')
    expect(JSON.stringify((await reader.read()).events)).toContain('personal-workflow-method')
    const call = (name: string, args: object) => ctx.tools.execute({ name, arguments: args, agent, signal, callId: ToolCallId(name) })
    await call('workflow_assess', { modeRevision: 1, decision: 'complex', explanation: 'Clarified and feasible' })
    const saved = await call('workflow_propose', { ...proposal(), modeRevision: 1 })
    expect(JSON.stringify(saved)).toContain('snapshot')
    expect(service.list()).toHaveLength(1)
    expect(service.list()[0]?.snapshot.approval).toBeNull()
    await service.setMode(session, { sessionId: session.id, enabled: false, expectedRevision: 1, operationId: operation(21) })
    expect(JSON.stringify(await step())).toContain('Task enhancement is now disabled')
    const skill = await ctx.skills.get('dev-workflow')
    expect(skill?.invocation).toEqual({ modelInvocable: false, userInvocable: false })
    expect(skill?.content).not.toContain('/Users/')
    const entry = [...ctx.loader.entries()].find(item => item.options.name === 'method')
    expect(entry?.fiber).toBeDefined()
    await entry!.fiber!.dispose()
    expect(await ctx.skills.get('dev-workflow')).toBeUndefined()
    expect(ctx.tools.get('workflow_assess')).toBeUndefined()
    expect(ctx.tools.get('workflow_complete')).toBeUndefined()
  } finally {
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  }
}, 30_000)

it('pins the unchanged upstream source and documents its project-specific authorization', async () => {
  const source = JSON.parse(await readFile(new URL('../assets/source.json', import.meta.url), 'utf8')) as { sourceSha256: string; commit: string }
  expect(source.commit).toBe('4f51803b4578139dd9de2dc690c1d2638c54decd')
  expect(createHash('sha256').update(await readFile(new URL('../assets/upstream/SKILL.md', import.meta.url))).digest('hex')).toBe(source.sourceSha256)
  expect(await readFile(new URL('../assets/NOTICE.md', import.meta.url), 'utf8')).toContain('我就是 dlyqs')
})

it('runs ordinary and complex goals through the real AgentLoop and durable model history', async () => {
  const { default: Llm } = await import('@deepseek-ai/dsh-llm')
  const { default: AgentLoop } = await import('@deepseek-ai/dsh-agent-loop')
  const { MockAdapter, textResponse, toolCallResponse } = await import('../../../core/agent-loop/tests/mock-adapter.ts')
  const root = await mkdtemp(join(tmpdir(), 'workflow-loop-'))
  const { ctx, service } = await createWorkflowHarness(root, [
    ['systemPrompt', SystemPrompt], ['agents', Agents], ['tools', Tools], ['skills', Skills], ['llm', Llm], ['method', plugin],
  ])
  try {
    const model = new MockAdapter([
      textResponse('ordinary answer'),
      toolCallResponse('simple', 'workflow_assess', { modeRevision: 1, decision: 'simple', explanation: 'One clear bounded action' }),
      textResponse('ordinary simple answer'),
      toolCallResponse('clarify', 'workflow_assess', { modeRevision: 1, decision: 'clarify', explanation: 'Acceptance is unknown' }),
      textResponse('Which acceptance conditions are required?'),
      toolCallResponse('infeasible', 'workflow_assess', { modeRevision: 1, decision: 'infeasible', explanation: 'Required external service is unavailable' }),
      textResponse('Provide the external service or choose a local alternative'),
      toolCallResponse('assess', 'workflow_assess', { modeRevision: 1, decision: 'complex', explanation: 'Feasible fork and join' }),
      toolCallResponse('invalid', 'workflow_propose', {
        ...proposal(), modeRevision: 1,
        definition: { ...proposal().definition, tasks: proposal().definition.tasks.map(task => ({ ...task, dependsOn: [task.id] })) },
      }),
      () => {
        expect(service.list()).toEqual([])
        return toolCallResponse('propose', 'workflow_propose', { ...proposal(), modeRevision: 1 })
      },
      textResponse('Plan awaits review'),
    ])
    ctx.llm.registerAdapter(['mock'], model)
    await ctx.plugin(AgentLoop, { agents: [] })
    const agent = await ctx.agentLoop.create(SessionId('real-method'), { provider: 'mock', model: 'mock' })
    const send = async (text: string) => {
      agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] }))
      await agent.whenIdle()
    }
    await service.setPreferences({ enabled: false, granularity: 'balanced', expectedRevision: 0 })
    await send('Explain CSV')
    expect(service.list()).toEqual([])
    expect(model.requests).toHaveLength(1)
    expect(model.requests[0]?.tools?.some(tool => tool.name.startsWith('workflow_')) ?? false).toBe(false)
    expect(JSON.stringify(model.requests[0]?.messages)).not.toContain('Managed task enhancement')
    await service.setMode(agent.session, { sessionId: agent.id, enabled: true, expectedRevision: 0, operationId: operation(20) })
    for (const text of ['Explain a CSV header', 'Build an unspecified data system', 'Integrate the unavailable external service']) {
      await send(text)
      expect(service.list()).toEqual([])
    }
    const complexRequest = model.requests.length
    await send('Build CSV export with independent test data and integration')
    expect(service.list()).toHaveLength(1)
    expect(service.list()[0]?.snapshot.approval).toBeNull()
    expect(model.requests[complexRequest]?.tools?.some(tool => tool.name === 'workflow_propose')).toBe(true)
    expect(JSON.stringify(model.requests[complexRequest]?.messages)).toContain('managed method v3')
    expect(JSON.stringify(model.requests[complexRequest]?.messages)).toContain('Do not copy the user\'s full request')
    expect(JSON.stringify(model.requests[complexRequest]?.tools?.find(tool => tool.name === 'workflow_propose'))).toContain('at most 5 direct children per node')
    await ctx.sessions.flush(agent.session)
    await using reader = await ctx.sessionPersistence.open(agent.id, 'read')
    const saved = (await reader.read()).events
    expect(saved.filter(event => event.type === 'personal-workflow/assessment').map(event => event.data.decision)).toEqual(['simple', 'clarify', 'infeasible', 'complex'])
    expect(JSON.stringify(saved)).toContain('cycle')
    expect(saved.some(event => event.type === 'personal-workflow/snapshot')).toBe(true)
    expect(saved.some(event => event.type === 'user/message' && event.data.source.kind === 'personal-workflow-method')).toBe(true)
  } finally {
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  }
}, 30_000)
