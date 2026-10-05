import { randomUUID } from 'node:crypto'
import { afterEach, expect, it } from 'vitest'
import { setupExecution } from './execution-harness.ts'
import { executionHumanSchema } from '../src/execution-human-schema.ts'
import { operationId } from './harness.ts'
import { openOrganizationDatabase } from '../src/database.ts'

const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })
async function waiting(recipient: 'employee' | 'issuer' = 'employee', kind = 'work-question') {
  const h = await setupExecution(cleanup, 10, 'a'.repeat(64), ['model', 'fs-write'])
  await h.transition('running')
  const view = await h.read()
  const request = { ...h.run, kind: 'request-execution-human', operationId: operationId(), requestId: randomUUID(),
    handlerId: recipient === 'employee' ? view.assigneeId : view.approvedBy,
    requestKind: kind, prompt: 'Check the totals manually.', actionId: null,
    requestDigest: kind === 'tool-approval' ? 'b'.repeat(64) : null, expiresAt: Date.now() + 10000 }
  await h.execute(request)
  const answer = { ...h.selector, operationId: operationId(), runId: h.run.runId, planRevision: 1,
    requestId: request.requestId, kind: 'answer-execution-question', answer: 'The total is 42.' }
  return { ...h, request, answer }
}
it('persists issuer questions in the designated inbox and requires separate employee continuation', async () => {
  const h = await waiting('issuer')
  await expect(h.execute(h.action())).rejects.toMatchObject({ code: 'version-conflict' })
  const items: string[] = []
  await h.service.readInbox(h.owner.token, { organizationId: h.query.organizationId }, (page) => {
    items.push(...page.items.map(i => i.request.id))
  })
  expect(items).toContain(h.request.requestId)
  await expect(h.service.participantCommand(h.other.token, h.answer)).rejects.toMatchObject({ code: 'forbidden' })
  const receipt = await h.service.participantCommand(h.owner.token, h.answer)
  expect(await h.service.participantCommand(h.owner.token, h.answer)).toEqual(receipt)
  expect((await h.read()).run.state).toBe('waiting-human')
  expect((await h.read()).humanRequests[0]?.answer).toBe('The total is 42.')
  await h.execute({ ...h.run, kind: 'resume-run', operationId: operationId() })
  expect((await h.read()).run.state).toBe('running')
  await h.close()
  const cold = openOrganizationDatabase(h.path, 100)
  expect(executionHumanSchema.parse(JSON.parse(String(cold.prepare('SELECT data FROM execution_human_requests').get()?.data))).answer).toBe('The total is 42.')
  cold.close()
}, 15000)
it('serializes competing answers and refuses wrong-kind, expired and old-version replies', async () => {
  const h = await waiting()
  await expect(h.service.participantCommand(h.other.token, { ...h.answer, planRevision: 2 })).rejects.toMatchObject({ code: 'forbidden' })
  const { answer: _answer, ...fields } = h.answer
  await expect(h.service.participantCommand(h.other.token, { ...fields, kind: 'approve-execution-tool', approved: true })).rejects.toMatchObject({ code: 'forbidden' })
  const results = await Promise.allSettled([h.service.participantCommand(h.other.token, h.answer),
    h.service.participantCommand(h.other.token, { ...h.answer, operationId: operationId(), answer: 'Another answer' })])
  expect(results.map(r => r.status).sort()).toEqual(['fulfilled', 'rejected'])
  const other = await waiting()
  const row = other.db.prepare('SELECT data FROM execution_human_requests').get()!
  const request = executionHumanSchema.parse(JSON.parse(String(row.data))); request.expiresAt = Date.now() - 1
  other.db.prepare('UPDATE execution_human_requests SET data=?').run(JSON.stringify(request))
  await expect(other.service.participantCommand(other.other.token, other.answer)).rejects.toMatchObject({ code: 'version-conflict' })
  expect((await other.read()).humanRequests[0]?.state).toBe('expired')
}, 15000)
it('answers never renew a lost lease and unknown actions prevent continuation', async () => {
  const h = await waiting()
  await h.service.participantCommand(h.other.token, h.answer)
  h.db.prepare("UPDATE assignment_leases SET state='released'").run()
  await expect(h.execute({ ...h.run, kind: 'resume-run', operationId: operationId() })).rejects.toMatchObject({ code: 'version-conflict' })
  expect((await h.read()).eligible).toBe(false)
  const other = await setupExecution(cleanup, 10)
  await other.transition('running')
  await other.execute(other.action())
  await other.transition('paused')
  await expect(other.execute({ ...other.run, kind: 'resume-run', operationId: operationId() })).rejects.toMatchObject({ code: 'version-conflict' })
}, 15000)
it('consumes a tool approval only for its exact digest and never grants another capability', async () => {
  const h = await waiting('employee', 'tool-approval')
  const { answer: _answer, ...fields } = h.answer
  await h.service.participantCommand(h.other.token, { ...fields, kind: 'approve-execution-tool', approved: true })
  await h.execute({ ...h.run, kind: 'resume-run', operationId: operationId() })
  await expect(h.execute({ ...h.action(), approvalId: h.request.requestId, requestDigest: 'c'.repeat(64) })).rejects.toMatchObject({ code: 'version-conflict' })
  await expect(h.execute({ ...h.action(), approvalId: h.request.requestId, capability: 'shell' })).rejects.toMatchObject({ code: 'version-conflict' })
  await h.execute({ ...h.action(), capability: 'fs-write', approvalId: h.request.requestId })
  await expect(h.execute({ ...h.action(), approvalId: h.request.requestId })).rejects.toMatchObject({ code: 'version-conflict' })
}, 15000)
it('upgrades v7 atomically and validates the new request table on reopen', async () => {
  const h = await setupExecution(cleanup)
  await h.close()
  h.db.exec('DROP TABLE organization_hierarchy; DROP TABLE planning_goals; DROP TABLE planning_reapprovals; DROP TABLE planning_events; DROP TABLE planning_permits; DROP TABLE planning_grants; DROP TABLE integration_confirmations; DROP TABLE integration_events; DROP TABLE organization_integrations; DROP TABLE organization_acceptances; DROP TABLE delivery_events; DROP TABLE organization_submissions; DROP TABLE organization_artifacts; DROP TABLE execution_human_requests; DROP TABLE tree_requests; DROP TABLE plan_contexts; PRAGMA user_version=7')
  const upgraded = openOrganizationDatabase(h.path, 100)
  expect(upgraded.prepare('PRAGMA user_version').get()?.user_version).toBe(20)
  expect(upgraded.prepare('SELECT count(*) AS n FROM execution_human_requests').get()?.n).toBe(0)
  upgraded.close()
}, 15000)
it('cancels unanswered execution requests when the exact approval is revoked', async () => {
  const h = await waiting()
  await h.service.assignmentCommand(h.owner.token, { ...h.selector, kind: 'revoke-assignment', operationId: operationId(),
    expectedVersion: h.db.prepare('SELECT version FROM task_assignments WHERE id=?').get(h.selector.assignmentId!)?.version })
  expect((await h.read()).humanRequests[0]?.state).toBe('cancelled')
  await expect(h.service.participantCommand(h.other.token, h.answer)).rejects.toMatchObject({ code: 'version-conflict' })
}, 15000)
