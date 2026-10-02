/** No-page native conversation, reviewed workflow and cold recovery; no API model. */
import { afterEach, expect, it, vi } from 'vitest'
import { fixture, boot, input, readStored, selection } from '../../../packages/core/agent-codex/tests/harness.ts'
import { proposal, ids, phase, operation } from '../../../packages/workspace/personal-workflow/tests/fixture.ts'
import { createSessionTestRemote } from '../../../packages/api/session-controller/tests/test-remote.ts'
import type { SessionRequestId } from '../../../packages/api/session-controller/src/types.ts'

afterEach(() => { vi.unstubAllEnvs() })

it('continues one native Bot thread from two chat turns through planning, human approval, selected execution and cold reopen with zero API requests', async () => {
  const { ctx, root, peer } = await fixture(true, true)
  vi.stubEnv('DEEPSEEK_API_KEY', '')
  const outbound = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('API model outbound forbidden'))
  const apiRequests = vi.spyOn(ctx.llm, 'stream')
  const apiPreparation = vi.spyOn(ctx.llm, 'prepareCall')
  const bot = await ctx.personalProjects.createBot({ name: 'Native CSV', defaultModel: {
    backend: 'codex', provider: 'codex', model: selection.model, reasoningEffort: selection.effort,
  } })
  const remote = createSessionTestRemote(ctx, { cwd: root, defaultModelSelection: () => ({ provider: 'unconfigured-api', model: 'no-key' }) })
  const created = await remote.create({ botId: bot.id })
  if (!created.ok) throw created.error
  const id = created.value.sessionId
  const agent = ctx.agents.get(id)!
  for (const text of ['CSV columns name,note', 'Remember the CSV columns']) {
    expect(await remote.prompt({ sessionId: id, requestId: text as SessionRequestId, mode: 'queue', content: [{ type: 'text', text }] })).toMatchObject({ ok: true })
    await agent.whenIdle()
  }
  await ctx.personalWorkflow.setMode(agent.session, { sessionId: id, enabled: true, expectedRevision: 0, operationId: operation(10) })
  peer.onTurn = async (server, threadId, turnId) => {
    expect(await server.request('item/tool/call', { threadId, turnId, callId: 'assess', tool: 'workflow_assess',
      arguments: { modeRevision: 1, decision: 'complex', explanation: 'CSV export and independent verification' } })).toMatchObject({ success: true })
    expect(await server.request('item/tool/call', { threadId, turnId, callId: 'propose', tool: 'workflow_propose',
      arguments: { ...proposal(), definition: { ...proposal().definition, botId: bot.id }, modeRevision: 1 },
    })).toMatchObject({ success: true })
  }
  agent.followup(input('Prepare an explicit CSV plan'))
  await agent.whenIdle()
  expect(ctx.personalWorkflow.list()[0]?.snapshot.approval).toBeNull()
  expect(ctx.personalWorkflow.execution.forSession(id)).toBeNull()
  await ctx.personalWorkflow.approve({ taskId: ids[0]!, expectedRevision: 1, operationId: operation(11) })
  const claimed = await ctx.personalWorkflow.execution.claim(agent.session, {
    sessionId: id, planId: ids[0]!, taskId: ids[1]!, expectedRevision: 1,
    operationId: operation(12), authorization: { mode: 'manual', stopPhaseId: phase, maxActions: 2, maxTurns: 2, maxDurationMs: 100000 },
  })
  ctx.on('approval/request', async (request) => { expect(request.agent).toBe(agent); return 'allowed-once' })
  peer.onTurn = async (server, threadId, turnId) => {
    expect(await server.request('item/commandExecution/requestApproval', { threadId, turnId, itemId: 'command', command: 'CSV export',
      startedAtMs: Date.now() })).toEqual({ decision: 'accept' })
  }
  agent.followup(input('Execute only the approved CSV agreement'))
  await agent.whenIdle()
  expect(ctx.personalWorkflow.execution.forSession(id)).toMatchObject({ backend: 'codex', status: 'paused', turnsUsed: 1 })
  expect(apiRequests).not.toHaveBeenCalled()
  expect(apiPreparation).not.toHaveBeenCalled()
  await ctx.fiber.dispose()
  peer.onTurn = undefined
  const cold = await boot(root, peer, true, true)
  const coldRequests = vi.spyOn(cold.llm, 'stream')
  const coldPreparation = vi.spyOn(cold.llm, 'prepareCall')
  const resumed = await cold.agents.resume({ resumeSessionId: id })
  expect(peer.calls.filter(call => call.method === 'turn/start')).toHaveLength(4)
  await cold.personalWorkflow.execution.resume(resumed.agent.session, {
    sessionId: id, runId: claimed.id, ownerEpoch: claimed.ownerEpoch, operationId: operation(13), reconciliation: '',
  })
  peer.onTurn = async (server, threadId, turnId) => {
    expect(await server.request('item/tool/call', { threadId, turnId, callId: 'complete', tool: 'workflow_complete',
      arguments: { summary: 'Codex reports the CSV agreement', acceptance: ['Reported actual output verified'], callIds: [] } })).toMatchObject({ success: true })
  }
  resumed.agent.followup(input('Continue the original task after explicit recovery'))
  await resumed.agent.whenIdle()
  expect(cold.personalWorkflow.execution.forSession(id)).toMatchObject({ status: 'completed', evidence: [{ reportedBy: 'codex', files: [] }] })
  const events = (await readStored(cold, id)).events
  expect(events.filter(event => event.type === 'codex/turn-result')).toHaveLength(5)
  expect(events.filter(event => event.type === 'codex/thread-bound')).toHaveLength(1)
  expect(events.some(event => event.type === 'request/header')).toBe(false)
  expect(peer.calls.filter(call => call.method === 'turn/start')).toHaveLength(5)
  expect(peer.calls.filter(call => call.method === 'thread/start')).toHaveLength(1)
  expect(coldRequests).not.toHaveBeenCalled()
  expect(coldPreparation).not.toHaveBeenCalled()
  expect(outbound).not.toHaveBeenCalled()
  expect(peer.children.every(child => child.exited)).toBe(true)
})
