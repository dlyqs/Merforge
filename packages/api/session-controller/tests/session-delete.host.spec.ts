/** User deletion through the Remote, Agent lifecycle, and persistent Session store. */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import Tools from '@deepseek-ai/dsh-tools'
import Skills from '@deepseek-ai/dsh-skill'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Llm, { createUserMessage } from '@deepseek-ai/dsh-llm'
import Gateway from '@deepseek-ai/dsh-api-gateway'
import Typert from '@deepseek-ai/dsh-typert-registry'
import { SESSION_FORMAT_VERSION, SessionId } from '@deepseek-ai/dsh-session'
import { createWorkflowHarness } from '../../../workspace/personal-workflow/tests/harness.ts'
import { MockAdapter } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { createSessionTestController } from './test-remote.ts'

it('stops a running conversation, removes it through the Remote, and keeps it absent after restart', async () => {
  const root = await mkdtemp(join(tmpdir(), 'conversation-delete-'))
  const { ctx } = await createWorkflowHarness(root, [
    ['systemPrompt', SystemPrompt], ['agents', AgentRegistry], ['tools', Tools], ['skills', Skills], ['llm', Llm],
  ])
  try {
    const model = new MockAdapter(['hang'])
    ctx.llm.registerAdapter(['mock'], model)
    await ctx.plugin(AgentLoop, { agents: [] })
    await ctx.plugin(Typert)
    const controller = createSessionTestController(ctx, { defaultModelSelection: () => ({ provider: 'mock', model: 'mock' }), cwd: root })
    await ctx.plugin(Gateway, {})
    const id = SessionId('deleted-conversation')
    const keep = SessionId('kept-conversation')
    await controller.create({ sessionId: id, cwd: root })
    await controller.create({ sessionId: keep, cwd: root })
    const agent = ctx.agents.get(id)!
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Wait until stopped' }], source: { kind: 'user' } }))
    await vi.waitFor(() => { expect(model.requests).toHaveLength(1) })
    const removed = vi.fn()
    ctx.on('api-session/removed', removed)
    await ctx.typertGateway.invoke({ namespace: 'session', method: 'delete', args: { sessionId: id } })
    expect(agent.status).toBe('idle')
    expect(ctx.agents.get(id)).toBeUndefined()
    expect(ctx.sessions.get(id)).toBeUndefined()
    expect(await ctx.sessionPersistence.stat(id)).toBeUndefined()
    expect(ctx.agents.get(keep)).toBeDefined()
    expect(removed).toHaveBeenCalledWith(id)
    await expect(controller.inspect(id)).rejects.toThrow()
    await controller.deleteSession(id)
    await ctx.fiber.dispose()
    const reopened = await createWorkflowHarness(root)
    try {
      expect((await reopened.ctx.sessionPersistence.list()).some(item => item.header.id === id)).toBe(false)
      await expect(reopened.ctx.sessionPersistence.open(id, 'write')).rejects.toThrow()
    } finally { await reopened.ctx.fiber.dispose() }
  } finally {
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  }
})

it('preserves an externally held log and permits retry after the writer closes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'conversation-delete-held-'))
  const { ctx } = await createWorkflowHarness(root)
  try {
    await ctx.plugin(AgentRegistry)
    const controller = createSessionTestController(ctx, { defaultModelSelection: () => ({ provider: 'mock', model: 'mock' }), cwd: root })
    const id = SessionId('held-conversation')
    const writer = await ctx.sessionPersistence.create({ id, version: SESSION_FORMAT_VERSION, createdAt: 1, cwd: root, isSeeded: false })
    await writer.flush()
    const removed = vi.fn()
    ctx.on('api-session/removed', removed)
    await expect(controller.deleteSession(id)).rejects.toThrow()
    expect(removed).not.toHaveBeenCalled()
    expect(await ctx.sessionPersistence.stat(id)).toBeDefined()
    await writer.close()
    await controller.deleteSession(id)
    expect(await ctx.sessionPersistence.stat(id)).toBeUndefined()
  } finally {
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  }
})
