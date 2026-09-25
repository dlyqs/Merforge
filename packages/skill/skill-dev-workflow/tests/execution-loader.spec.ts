/** Real AgentLoop, tools and durable file effects under selected-task authorization. */
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import Agents from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import Tools, { defineTool } from '@deepseek-ai/dsh-tools'
import Skills from '@deepseek-ai/dsh-skill'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Llm, { createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { createWorkflowHarness } from '../../../workspace/personal-workflow/tests/harness.ts'
import { ids, operation, phase, proposal } from '../../../workspace/personal-workflow/tests/fixture.ts'
import * as plugin from '../src/index.ts'

it('executes parallel task tools concurrently, logs selected context, verifies files, and fences cancelled owners', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workflow-tools-'))
  const cwd = join(root, 'work'); await mkdir(join(cwd, 'out'), { recursive: true })
  let active = 0; let overlap = 0
  const both = Promise.withResolvers<undefined>()
  const fixture = {
    name: 'workflow-files-fixture', inject: ['tools'],
    apply(ctx: Context) {
      ctx.tools.register(defineTool({
        name: 'write_check', description: 'Write and verify a test artifact', parameters: { index: { type: 'integer', required: true } },
        output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
        async execute({ index }) {
          if (index === 2 || index === 3) {
            active++; overlap = Math.max(overlap, active)
            if (active === 2) both.resolve(undefined)
            await both.promise
          }
          const path = join(cwd, 'out', ids[index]!)
          await writeFile(path, `actual output ${index}`)
          expect(await readFile(path, 'utf8')).toBe(`actual output ${index}`)
          if (index === 2 || index === 3) active--
          return `Verified ${path}`
        },
      }))
    },
  }
  const { ctx, service } = await createWorkflowHarness(root, [
    ['systemPrompt', SystemPrompt], ['agents', Agents], ['tools', Tools], ['skills', Skills], ['llm', Llm],
    ['method', plugin], ['files', fixture],
  ])
  try {
    for (const index of [1, 2, 3]) {
      const adapter = new MockAdapter([
        toolCallResponse(`write-${index}`, 'write_check', { index }),
        toolCallResponse(`complete-${index}`, 'workflow_complete', { summary: `Checked ${index}`, acceptance: ['Verified actual output'], callIds: [`write-${index}`] }),
      ])
      ctx.llm.registerAdapter([`mock${index}`], adapter)
    }
    await ctx.plugin(AgentLoop, { agents: [] })
    await service.setTestingPreferences({ forceDecomposition: true, expectedRevision: 0 })
    await service.save(proposal()); await service.approve({ taskId: ids[0]!, expectedRevision: 1, operationId: operation(2) })
    const create = async (index: number) => {
      const agent = await ctx.agentLoop.create(SessionId(`worker-${index}`), { provider: `mock${index}`, model: 'mock' }, { cwd })
      await service.execution.claim(agent.session, {
        sessionId: agent.id, planId: ids[0]!, taskId: ids[index]!, expectedRevision: 1, operationId: operation(10 + index),
        authorization: { mode: 'manual', stopPhaseId: phase, maxActions: 10, maxTurns: 5, maxDurationMs: 100000 } })
      return agent
    }
    const start = (agent: Awaited<ReturnType<typeof create>>) => {
      agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Execute selected task and verify it' }] }))
      return agent.whenIdle()
    }
    const first = await create(1); await start(first)
    expect(service.execution.forSession(first.id)?.status, JSON.stringify(first.session.snapshotEvents())).toBe('completed')
    const b = await create(2); const c = await create(3)
    await Promise.all([start(b), start(c)])
    expect(overlap).toBe(2)
    expect(service.list()[0]?.ready).toEqual([ids[4]])
    const bRun = service.execution.forSession(b.id)!
    expect(bRun.evidence[0]?.files.some(file => file.sha256 !== null)).toBe(true)
    await ctx.sessions.flush(b.session)
    await using reader = await ctx.sessionPersistence.open(b.id, 'read')
    expect(JSON.stringify((await reader.read()).events)).toContain('personal-workflow-execution')
    const denied = await ctx.tools.execute({ name: 'write_check', arguments: { index: 2 }, agent: b,
      callId: ToolCallId('late'), signal: new AbortController().signal })
    expect(denied.isError).toBe(true)
    expect(bRun.actions).toHaveLength(1)
  } finally { both.resolve(undefined); await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) }
}, 30000)

it('continues only the selected automatic task and stops at the persisted turn limit without creating another conversation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workflow-auto-'))
  const { ctx, service } = await createWorkflowHarness(root, [
    ['systemPrompt', SystemPrompt], ['agents', Agents], ['tools', Tools], ['skills', Skills], ['llm', Llm], ['method', plugin],
  ])
  try {
    const model = new MockAdapter([textResponse('Need another verification step'), textResponse('Still not verified')])
    ctx.llm.registerAdapter(['mock'], model); await ctx.plugin(AgentLoop, { agents: [] })
    await service.save(proposal()); await service.approve({ taskId: ids[0]!, expectedRevision: 1, operationId: operation(2) })
    const agent = await ctx.agentLoop.create(SessionId('automatic'), { provider: 'mock', model: 'mock' }, { cwd: root })
    await service.execution.claim(agent.session, {
      sessionId: agent.id, planId: ids[0]!, taskId: ids[1]!, expectedRevision: 1, operationId: operation(3),
      authorization: { mode: 'auto_until', stopPhaseId: phase, maxActions: 5, maxTurns: 2, maxDurationMs: 100000 } })
    agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Work within my authorization' }] }))
    await agent.whenIdle()
    expect(model.requests).toHaveLength(2)
    expect(service.execution.forSession(agent.id)).toMatchObject({ status: 'paused', turnsUsed: 2, reason: 'authorization-boundary', evidence: [] })
    expect(service.list()[0]?.runs).toHaveLength(1)
    expect(service.list()[0]?.ready).toEqual([])
  } finally { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) }
}, 30000)

it('marks model failure as needing reconciliation without claiming task completion or replaying work', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workflow-model-failure-'))
  const { ctx, service } = await createWorkflowHarness(root, [
    ['systemPrompt', SystemPrompt], ['agents', Agents], ['tools', Tools], ['skills', Skills], ['llm', Llm], ['method', plugin],
  ])
  try {
    const model = new MockAdapter([])
    ctx.llm.registerAdapter(['mock'], model); await ctx.plugin(AgentLoop, { agents: [] })
    await service.save(proposal()); await service.approve({ taskId: ids[0]!, expectedRevision: 1, operationId: operation(2) })
    const agent = await ctx.agentLoop.create(SessionId('failed'), { provider: 'mock', model: 'mock' }, { cwd: root })
    await service.execution.claim(agent.session, {
      sessionId: agent.id, planId: ids[0]!, taskId: ids[1]!, expectedRevision: 1, operationId: operation(3),
      authorization: { mode: 'manual', stopPhaseId: phase, maxActions: 5, maxTurns: 2, maxDurationMs: 100000 },
    })
    agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Execute the selected task' }] }))
    await agent.whenIdle()
    await expect.poll(() => service.execution.forSession(agent.id)?.status).toBe('needs_reconciliation')
    expect(service.execution.forSession(agent.id)?.evidence).toEqual([])
    expect(model.requests).toHaveLength(1)
  } finally { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) }
}, 30000)
