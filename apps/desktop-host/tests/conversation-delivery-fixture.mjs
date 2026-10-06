/** Live planning and execution share the Desktop consumers; only the OS vault is a test seam. */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import Organization from '@deepseek-ai/dsh-organization'
import { localPlanning } from './conversation-planning-fixture.mjs'
import { executionScenario, until } from './organization-execution-fixture.mjs'

/** Run two isolated identities from a model-generated plan through explicit human decisions and delivery.
 * @param kit Source composition with real planning and execution routes.
 * @returns Completion after file, authority, isolation and cold-reopen assertions.
 */
export async function liveDeliveryScenario(kit) {
  const hosts = []
  const selection = { model: kit.planningRoute.model, endpoint: kit.planningRoute.endpoint }
  const planningPolicy = { ...Organization.Config.parse({ path: 'isolated-live-delivery.sqlite' }).planning, models: [selection] }
  let issuer, worker, request, goal, issuerSession
  const invoke = async (client, host, value) => {
    await until(() => client.snapshot().phase === 'ready')
    return kit.organizationConversation(client, host, value, () => {}, new AbortController().signal)
  }
  const hooks = {
    async close() { for (const host of hosts.splice(0).reverse()) await host.close() },
    async createPlan({ root, owner, member, query }) {
      issuer = await localPlanning(kit, join(root, 'issuer-planning')); hosts.push(issuer)
      worker = await localPlanning(kit, join(root, 'worker-planning')); hosts.push(worker)
      request = { kind: 'open', organizationId: query.organizationId, projectId: query.projectId,
        conversationId: randomUUID(), operationId: randomUUID() }
      const opened = await invoke(owner, issuer, request)
      issuerSession = opened.result.sessionId
      assert.equal(opened.result.settings.enabled, true)
      const response = await invoke(owner, issuer, { ...request, kind: 'send', operationId: randomUUID(),
        route: 'new_goal', selection, text: 'PRIVATE_ISSUER_CHAT: Our QA team needs two independently reviewable deliverables: result.csv in UTF-8 with columns name,note and rows Alice with note hello,world and Bob with note say "hi", using standard CSV quoting; and contract.json describing those columns and UTF-8 encoding. Create a plan with one parent and exactly two required leaf tasks, one per file, with no ordering dependency. Both require issuer approval to complete the parent task. Do not execute; people will review and assign the tasks.' })
      goal = response.result.goals.at(-1)
      assert.equal(goal.classification, 'complex')
      assert.equal(goal.proposal.status, 'shared')
      const { definition, revision, planId } = goal.proposal
      const leaves = definition.tasks.filter(task => !definition.tasks.some(child => child.parentTaskId === task.id))
      assert.equal(leaves.length, 2)
      assert.ok(leaves.every(task => task.required && task.parentTaskId === definition.taskId && task.dependsOn.length === 0))
      const csv = leaves.find(task => JSON.stringify(task).includes('result.csv'))
      const contract = leaves.find(task => JSON.stringify(task).includes('contract.json'))
      assert.ok(csv && contract && csv.id !== contract.id, 'model must separate the two named deliverables')
      query.planId = planId
      await assert.rejects(invoke(member, worker, { ...request, kind: 'read', operationId: randomUUID() }))
      return { revision, parent: definition.taskId, left: csv.id, right: contract.id }
    },
    async approve({ owner, member, query, taskId, planRevision, employee }) {
      await until(() => owner.snapshot().phase === 'ready')
      const approved = await owner.perform({ kind: 'assignment-command', request: { ...query,
        kind: 'approve-assignment', operationId: randomUUID(), taskId, planRevision, assigneeId: employee.membershipId } })
      const taskRequest = { ...request, kind: 'open', operationId: randomUUID(), conversationId: approved.receipt.assignmentId,
        assignment: { planId: query.planId, assignmentId: approved.receipt.assignmentId } }
      const bound = await invoke(member, worker, taskRequest)
      assert.notEqual(bound.result.sessionId, issuerSession)
      assert.equal(bound.result.assignment.state, 'pending')
      assert.deepEqual(bound.result.entries, [])
      const continued = await invoke(member, worker, { ...taskRequest, kind: 'send', operationId: randomUUID(),
        route: 'query', goalId: approved.receipt.assignmentId, selection, text: 'Explain the assigned task and its current acceptance requirements. Do not change the plan or start work.' })
      assert.equal(continued.result.goals.length, 1)
      assert.equal(continued.result.assignment.state, 'pending')
      assert.equal(JSON.stringify(continued).includes('PRIVATE_ISSUER_CHAT'), false)
      await assert.rejects(invoke(owner, issuer, { ...taskRequest, kind: 'read', operationId: randomUUID() }))
      return approved
    },
  }
  try { await executionScenario({ ...kit, planningPolicy, liveDelivery: true, planningHooks: hooks }) }
  finally { await hooks.close() }
}
