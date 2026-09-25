/** Local test override routes simple goals through durable, unapproved decomposition. */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import Agents from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import Tools, { defineTool } from '@deepseek-ai/dsh-tools'
import Skills from '@deepseek-ai/dsh-skill'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Llm, { createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { createWorkflowHarness } from '../../../workspace/personal-workflow/tests/harness.ts'
import { operation, proposal } from '../../../workspace/personal-workflow/tests/fixture.ts'
import * as Method from '../src/index.ts'

it('forces decomposition with conversation mode off, refuses simple/single-task bypasses, and restores ordinary routing when disabled', async () => {
  const root = await mkdtemp(join(tmpdir(), 'forced-workflow-'))
  const { ctx, service } = await createWorkflowHarness(root, [
    ['systemPrompt', SystemPrompt], ['agents', Agents], ['tools', Tools], ['skills', Skills], ['llm', Llm], ['method', Method],
  ])
  try {
    expect(service.testingPreferences()).toEqual({ forceDecomposition: false, revision: 0 })
    await service.setTestingPreferences({ forceDecomposition: true, expectedRevision: 0 })
    await expect(service.setTestingPreferences({ forceDecomposition: false, expectedRevision: 0 })).rejects.toThrow('revision-conflict')
    const request = proposal()
    const model = new MockAdapter([
      toolCallResponse('simple', 'workflow_assess', { modeRevision: 0, decision: 'simple', explanation: 'A short answer' }),
      () => {
        expect(service.list()).toEqual([])
        return toolCallResponse('complex', 'workflow_assess', { modeRevision: 0, decision: 'complex', explanation: 'Explicit testing override' })
      },
      toolCallResponse('single', 'workflow_propose', { ...request, modeRevision: 0, definition: { ...request.definition, tasks: request.definition.tasks.slice(0, 1) } }),
      () => {
        expect(service.list()).toEqual([])
        return toolCallResponse('split', 'workflow_propose', { ...request, modeRevision: 0 })
      },
      textResponse('Review the task plan'),
      textResponse('Ordinary answer'),
      toolCallResponse('normal-simple', 'workflow_assess', { modeRevision: 1, decision: 'simple', explanation: 'Testing override has been disabled' }),
      textResponse('Simple answer with enhancement enabled'),
    ])
    ctx.llm.registerAdapter(['mock'], model)
    await ctx.plugin(AgentLoop, { agents: [] })
    const agent = await ctx.agentLoop.create(SessionId('forced-goal'), { provider: 'mock', model: 'mock' }, { cwd: root })
    let wrote = false
    ctx.effect(() => ctx.tools.register(defineTool({
      name: 'test_write', description: 'Test effect', parameters: {},
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      execute() { wrote = true; return 'written' },
    })))
    const denied = await ctx.tools.execute({ name: 'test_write', arguments: {}, agent, callId: ToolCallId('direct'), signal: new AbortController().signal })
    expect(denied.isError).toBe(true)
    expect(wrote).toBe(false)
    const send = async () => {
      agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Explain a CSV header' }] }))
      await agent.whenIdle()
    }
    await send()
    expect(model.requests).toHaveLength(5)
    expect(JSON.stringify(model.requests[0]?.messages)).toContain('Temporary testing override is ON')
    expect(service.list()).toHaveLength(1)
    expect(service.list()[0]?.snapshot.approval).toBeNull()
    expect(service.list()[0]?.runs ?? []).toEqual([])
    expect(await service.mode(agent.session)).toEqual({ enabled: false, revision: 0 })
    await ctx.sessions.flush(agent.session)
    await using reader = await ctx.sessionPersistence.open(agent.id, 'read')
    const saved = JSON.stringify((await reader.read()).events)
    expect(saved).toContain('testing requires decomposition')
    expect(saved).toContain('at least two required subtasks')
    expect(saved).toContain('Temporary testing override is ON')
    await service.setTestingPreferences({ forceDecomposition: false, expectedRevision: 1 })
    await send()
    expect(model.requests).toHaveLength(6)
    expect(model.requests[5]?.tools?.some(tool => tool.name === 'workflow_propose') ?? false).toBe(false)
    expect(JSON.stringify(model.requests[5]?.messages.at(-1))).toContain('Task enhancement is now disabled')
    expect(service.list()).toHaveLength(1)
    await service.setMode(agent.session, { sessionId: agent.id, enabled: true, expectedRevision: 0, operationId: operation(99) })
    await send()
    expect(model.requests).toHaveLength(8)
    expect(JSON.stringify(model.requests[6]?.messages.at(-1))).toContain('Temporary testing override is OFF')
    expect(service.list()).toHaveLength(1)
    expect(await service.mode(agent.session)).toEqual({ enabled: true, revision: 1 })
    await service.setTestingPreferences({ forceDecomposition: true, expectedRevision: 2 })
    await ctx.fiber.dispose()
    const reopened = await createWorkflowHarness(root)
    try { expect(reopened.service.testingPreferences()).toEqual({ forceDecomposition: true, revision: 3 }) }
    finally { await reopened.ctx.fiber.dispose() }
  } finally { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) }
}, 30000)
