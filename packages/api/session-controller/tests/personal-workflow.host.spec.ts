import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import Gateway from '@deepseek-ai/dsh-api-gateway'
import Typert from '@deepseek-ai/dsh-typert-registry'
import { createWorkflowHarness } from '../../../workspace/personal-workflow/tests/harness.ts'
import { ids, operation, proposal } from '../../../workspace/personal-workflow/tests/fixture.ts'
import { createSessionTestController } from './test-remote.ts'

it('dispatches plan save, review, read and export through the real Remote gateway', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workflow-remote-'))
  const { ctx } = await createWorkflowHarness(root)
  try {
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(Typert)
    const controller = createSessionTestController(ctx, {
      defaultModelSelection: () => ({ provider: 'fixture', model: 'fixture' }), cwd: root,
    })
    await ctx.plugin(Gateway, {})
    const invoke = (method: string, request?: unknown) => ctx.typertGateway.invoke({ namespace: 'session', method, args: request === undefined ? {} : { request } })
    expect(await invoke('workflowList')).toEqual([])
    const saved = await invoke('workflowSave', proposal())
    expect(saved).toMatchObject({ revision: 1, approval: null })
    expect(await invoke('workflowSave', proposal())).toEqual(saved)
    expect(await invoke('workflowRead', { taskId: ids[0] })).toEqual(saved)
    const approval = { taskId: ids[0], operationId: operation(2), expectedRevision: 1 }
    expect(await invoke('workflowApprove', approval)).toMatchObject({ revision: 1, approval: { operationId: operation(2) } })
    expect(await invoke('workflowExport', { taskId: ids[0] })).toContain('Review: approved')
    await invoke('workflowSave', proposal(3, 1))
    await expect(invoke('workflowApprove', { ...approval, operationId: operation(4) })).rejects.toThrow('revision-conflict')
    expect(controller.workflowList()[0]?.snapshot.approval).toBeNull()
    await expect(invoke('workflowSave', { ...proposal(5, 2), approval: true })).rejects.toThrow()
    expect(controller.workflowRead({ taskId: ids[0]! }).revision).toBe(2)
  } finally {
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  }
})

it('recovers a receiver created before failed ownership commit without creating another Session or waking it', async () => {
  const { default: AgentLoop } = await import('@deepseek-ai/dsh-agent-loop')
  const { default: Tools } = await import('@deepseek-ai/dsh-tools')
  const { default: Skills } = await import('@deepseek-ai/dsh-skill')
  const { default: SystemPrompt } = await import('@deepseek-ai/dsh-system-prompt')
  const { default: Llm } = await import('@deepseek-ai/dsh-llm')
  const { MockAdapter } = await import('../../../core/agent-loop/tests/mock-adapter.ts')
  const { SessionId } = await import('@deepseek-ai/dsh-session')
  const { phase } = await import('../../../workspace/personal-workflow/tests/fixture.ts')
  const { vi } = await import('vitest')
  const root = await mkdtemp(join(tmpdir(), 'workflow-relay-remote-'))
  const { ctx, service } = await createWorkflowHarness(root, [
    ['systemPrompt', SystemPrompt], ['agents', AgentRegistry], ['tools', Tools], ['skills', Skills], ['llm', Llm],
  ])
  try {
    const model = new MockAdapter([])
    ctx.llm.registerAdapter(['mock'], model)
    await ctx.plugin(AgentLoop, { agents: [] })
    await ctx.plugin(Typert)
    const controller = createSessionTestController(ctx, { defaultModelSelection: () => ({ provider: 'mock', model: 'mock' }), cwd: root })
    await ctx.plugin(Gateway, {})
    await controller.create({ sessionId: SessionId('source'), cwd: root })
    await controller.workflowSave(proposal())
    await controller.workflowApprove({ taskId: ids[0]!, expectedRevision: 1, operationId: operation(2) })
    const run = await controller.workflowClaim({ sessionId: SessionId('source'), planId: ids[0]!, taskId: ids[1]!, expectedRevision: 1, operationId: operation(3),
      authorization: { mode: 'manual', stopPhaseId: phase, maxActions: 10, maxTurns: 3, maxDurationMs: 100000 } })
    const request = { sessionId: run.sessionId, runId: run.id, ownerEpoch: run.ownerEpoch, operationId: operation(4), context: 'Keep API decision; finish verification.' }
    const fault = vi.spyOn(service.execution, 'finishHandoff').mockRejectedValueOnce(new Error('crash after receiver creation'))
    await expect(controller.workflowHandoff(request)).rejects.toThrow('crash after receiver creation')
    const prepared = service.execution.forSession(run.sessionId)!.handoffs[0]!
    const receiver = ctx.agents.get(prepared.targetSessionId)!
    expect(receiver).toBeDefined()
    expect(service.execution.denial(receiver.session)).toBe('execution-owner-revoked')
    fault.mockRestore()
    const invoke = () => ctx.typertGateway.invoke({ namespace: 'session', method: 'workflowHandoff', args: { request } })
    const transferred = await invoke()
    expect(transferred).toMatchObject({ sessionId: receiver.id, ownerEpoch: 2, status: 'paused' })
    expect(await invoke()).toEqual(transferred)
    expect(ctx.agents.get(receiver.id)).toBe(receiver)
    expect(service.execution.forSession(run.sessionId)?.sessions).toEqual([run.sessionId, receiver.id])
    expect(receiver.status).toBe('idle')
    expect(model.requests).toEqual([])
  } finally { vi.restoreAllMocks(); await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) }
}, 30000)
