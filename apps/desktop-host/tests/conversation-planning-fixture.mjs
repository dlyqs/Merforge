/** Shared source/published planning-to-delivery composition. Only model responses and OS vault are scripted. */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { executionScenario, until } from './organization-execution-fixture.mjs'

export const selection = { model: 'deepseek-flash', endpoint: 'https://api.deepseek.com/anthropic/v1' }

/** Convert a scripted tool or text response into the provider's streaming protocol. */
export function planningReply(entry) {
  const events = [{ type: 'message_start', message: { id: randomUUID(), model: selection.model, usage: { input_tokens: 10, output_tokens: 0 } } }]
  if (typeof entry === 'string') events.push(
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: entry } })
  else events.push(
    { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: randomUUID(), name: entry.name, input: {} } },
    { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(entry.args) } })
  events.push({ type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: typeof entry === 'string' ? 'end_turn' : 'tool_use' }, usage: { output_tokens: 10 } }, { type: 'message_stop' })
  return new Response(events.map(e => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } })
}

/** Model HTTP seam; all commands still pass through the Agent tools and online authority. */
export function scriptedPlanningFetch(root) {
  return async (_url, init) => {
    const body = JSON.parse(init.body)
    assert.ok(JSON.stringify(body).includes('organization-planning/v2'))
    assert.ok(body.tools.every(t => ['workflow_assess', 'workflow_propose', 'planning_authorization', 'planning_members'].includes(t.name)))
    const path = join(root, 'planning-script.json'), script = JSON.parse(await readFile(path, 'utf8'))
    assert.ok(script.length, 'planning script exhausted')
    const response = planningReply(script.shift())
    await writeFile(path, JSON.stringify(script))
    return response
  }
}

/** Boot the real planning service with isolated local stores; the live lane keeps the real provider. */
export async function localPlanning(kit, root) {
  await mkdir(root, { recursive: true })
  const ctx = new kit.Context(), route = kit.planningRoute ?? { ...selection, credential: 'PLANNING_TEST_KEY', maxTokens: 4096, contextWindow: 1000000, idleTimeoutMs: 5000 }
  ctx.baseUrl = pathToFileURL(root).href + '/'
  const credentials = join(root, 'credentials.yml'), profile = join(root, 'planning.yml')
  await writeFile(credentials, kit.planningRoute ? '{}\n' : 'PLANNING_TEST_KEY: local-test-key\n', { mode: 0o600 })
  const modules = new Map([...kit.modules, ['credentials', kit.Credentials], ['conversation', kit.Conversation]])
  await writeFile(profile, JSON.stringify([{ name: 'storage' }, { name: 'json', config: { root: join(root, 'data') } },
    { name: 'domain', config: { backend: 'json' } }, { name: 'credentials', config: { path: credentials, watch: false } },
    { name: 'conversation', config: { root: join(root, 'conversations'), models: [route], maxSteps: 16,
      recheckMs: 100, maxDurationMs: 120000, maxReportBytes: 1000000, defaultSettings: { enabled: true, granularity: 'balanced' } } }]))
  try {
    await ctx.plugin(kit.Loader); ctx.loader.builtins.include = kit.Include
    ctx.loader.internal = { version: 'v2', async import(name) { assert.ok(modules.has(name)); return modules.get(name) } }
    await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(profile).href } }); await ctx.loader.await()
    assert.ok(ctx.get('organizationConversation'))
  } catch (error) { await ctx.fiber.dispose(); throw error }
  return { ctx,
    async organizationConversation(request, authorize, _timeout, signal) {
      const original = globalThis.fetch
      if (!kit.planningRoute) globalThis.fetch = scriptedPlanningFetch(root)
      try { return await ctx.organizationConversation.perform(request, authorize, signal) }
      finally { globalThis.fetch = original }
    },
    async close() { try { await ctx.organizationConversation.verifyBindings() } finally { await ctx.fiber.dispose() } },
  }
}

/** Start with normal conversation sends, adjust the saved goal, batch-confirm, then reuse real CSV execution and delivery. */
export async function planningScenario(kit, createExecutionHost, createPlanningHost = root => localPlanning(kit, root)) {
  const hosts = []
  let conversation, employeeConversation, invoke, request, goal, planningRoot, originalSession, originalPlanRevision, employeeRoot
  const hooks = {
    async close() { for (const host of hosts.splice(0).reverse()) await host.close() },
    async createPlan({ root, owner, member, query, definition, employee }) {
      planningRoot = join(root, 'issuer-planning')
      await mkdir(planningRoot)
      conversation = await createPlanningHost(planningRoot); hosts.push(conversation)
      request = { kind: 'open', organizationId: query.organizationId, projectId: query.projectId, conversationId: randomUUID(), operationId: randomUUID() }
      invoke = async (client, host, value) => {
        await until(() => client.snapshot().phase === 'ready')
        return kit.organizationConversation(client, host, value, () => {}, new AbortController().signal)
      }
      const opened = await invoke(owner, conversation, request)
      assert.equal(opened.result.settings.enabled, true)
      const send = { ...request, kind: 'send', operationId: randomUUID(), route: 'new_goal', selection,
        text: 'Prepare a UTF-8 CSV with name,note columns and correctly escaped Alice/Bob rows, plus a separate JSON column contract. Both files must be independently checked and delivered together. PRIVATE_ISSUER_CHAT' }
      await writeFile(join(planningRoot, 'planning-script.json'), JSON.stringify([
        { name: 'workflow_assess', args: { classification: 'complex', rationale: 'Two necessary independently reviewed artifacts' } },
        { name: 'workflow_propose', args: { operationId: randomUUID(), expectedRevision: 0, definition } }, 'Review the unapproved CSV plan.' ]))
      const planned = await invoke(owner, conversation, send)
      goal = planned.result.goals[0]
      assert.equal(goal.classification, 'complex'); assert.equal(goal.proposal.status, 'shared')
      query.planId = goal.proposal.planId
      assert.deepEqual(goal.proposal.definition, definition)
      assert.deepEqual((await invoke(owner, conversation, send)).result, planned.result)
      await assert.rejects(invoke(owner, conversation, { ...send, text: 'Changed content with the same operation' }))
      const adjusted = await invoke(owner, conversation, { ...request, kind: 'suggest', operationId: randomUUID(),
        goalId: goal.id, taskId: definition.tasks[1].id, membershipId: employee.membershipId, expectedRevision: 1 })
      originalPlanRevision = adjusted.result.goals[0].proposal.revision
      assert.equal(originalPlanRevision, 2)
      await assert.rejects(invoke(owner, conversation, { ...request, kind: 'suggest', operationId: randomUUID(),
        goalId: goal.id, taskId: definition.tasks[1].id, membershipId: employee.membershipId, expectedRevision: 1 }))
      const remaining = await readFile(join(planningRoot, 'planning-script.json'), 'utf8')
      originalSession = adjusted.result.sessionId
      await conversation.close(); hosts.splice(hosts.indexOf(conversation), 1)
      conversation = await createPlanningHost(planningRoot); hosts.push(conversation)
      const restored = await invoke(owner, conversation, { ...request, kind: 'read', operationId: randomUUID() })
      assert.equal(restored.result.sessionId, originalSession)
      assert.equal(restored.result.goals[0].proposal.revision, originalPlanRevision)
      assert.equal((await readFile(join(planningRoot, 'planning-script.json'), 'utf8')), remaining)
      employeeRoot = join(root, 'employee-planning'); await mkdir(employeeRoot)
      employeeConversation = await createPlanningHost(employeeRoot); hosts.push(employeeConversation)
      const employeeOpen = await invoke(member, employeeConversation, { ...request, conversationId: randomUUID(), operationId: randomUUID() })
      assert.equal(employeeOpen.result.settings.revision, 0)
      assert.deepEqual(employeeOpen.result.entries, [])
      return originalPlanRevision
    },
    async approve({ owner, member, query, taskId, planRevision, employee }) {
      const command = { ...query, taskId, planRevision, kind: 'approve-assignment', assigneeId: employee.membershipId, operationId: randomUUID() }
      await until(() => owner.snapshot().phase === 'ready')
      const result = await owner.perform({ kind: 'assignment-batch', request: { ...query, planRevision, confirmed: true, commands: [command] } })
      const item = result.assignmentBatch.items.find(item => item.command.taskId === taskId)
      assert.equal(item.state, 'confirmed')
      const receipt = item.receipt
      const taskRequest = { ...request, kind: 'open', operationId: randomUUID(), conversationId: receipt.assignmentId,
        assignment: { planId: query.planId, assignmentId: receipt.assignmentId } }
      const task = await invoke(member, employeeConversation, taskRequest)
      assert.notEqual(task.result.sessionId, originalSession)
      assert.equal(task.result.assignment.state, 'pending')
      assert.deepEqual(task.result.entries, [])
      assert.equal(task.result.goals[0].proposal.definition.taskId, taskId)
      assert.equal((await invoke(member, employeeConversation, taskRequest)).result.sessionId, task.result.sessionId)
      await writeFile(join(employeeRoot, 'planning-script.json'), JSON.stringify(['The assigned work awaits your explicit acceptance.']))
      const continued = await invoke(member, employeeConversation, { ...taskRequest, kind: 'send', operationId: randomUUID(),
        route: 'query', goalId: receipt.assignmentId, selection, text: 'Explain my current assignment without changing it.' })
      assert.equal(continued.result.goals.length, 1)
      assert.equal(continued.result.goals[0].proposal.planId, query.planId)
      assert.equal(continued.result.assignment.state, 'pending')
      await assert.rejects(invoke(owner, conversation, taskRequest))
      return { receipt }
    },
  }
  try { await executionScenario({ ...kit, planningHooks: hooks }, createExecutionHost) }
  finally { for (const host of hosts.reverse()) await host.close() }
}
