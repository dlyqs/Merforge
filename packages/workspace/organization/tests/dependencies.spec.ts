/** Real Loader/SQLite prerequisite admission and approval as the end of task work. */
import { afterEach, expect, it } from 'vitest'
import { dependencyFixture } from './dependencies-harness.ts'
import { operationId, openHarness, password } from './harness.ts'
import { openOrganizationDatabase } from '../src/database.ts'
const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })
it.each(['left', 'right'] as const)('requires both independent children with %s accepted first and separately gates dependency execution', async (first) => {
  const h = await dependencyFixture(cleanup, true, first, first === 'right')
  expect((await h.readTasks()).find(task => task.id === h.query.taskId)?.status).toBe('running')
  const dependent = await h.prepareTask(h.consumer)
  await expect(h.execute(dependent.create)).rejects.toMatchObject({ code: 'version-conflict' })
  const right = await h.prepareTask(h.remaining)
  const created = await h.execute(right.create)
  const { kind: _kind, configDigest: _digest, ...owner } = right.create
  await h.execute({ ...owner, runId: created.execution!.runId, kind: 'transition-run', state: 'cancelled', operationId: operationId() })
  await h.publish({ ...right.selector, runId: created.execution!.runId, planRevision: 2 }, first === 'left' ? 'right.csv' : 'left.csv')
  for (const id of [h.left, h.right]) expect((await h.readTasks()).find(task => task.id === id)?.status).toBe('completed')
  const run = await h.execute({ ...dependent.create, operationId: operationId() })
  expect(run.execution?.runId).toBeTruthy()
  const { kind: _dependentKind, configDigest: _dependentDigest, ...dependentOwner } = dependent.create
  await h.execute({ ...dependentOwner, runId: run.execution!.runId, kind: 'transition-run', state: 'running', operationId: operationId() })
  const { taskId: _taskId, planRevision: _revision, ...selector } = h.query
  for (const grant of h.db.prepare('SELECT * FROM task_grants WHERE planId=? AND taskId=? AND membershipId=?').all(h.query.planId, h.left, h.other.membershipId!)) {
    await h.service.grantTask(h.owner.token, { ...selector, taskId: h.left, membershipId: h.other.membershipId,
      scope: grant.scope, actions: [], expectedVersion: grant.version, operationId: operationId() })
  }
  await expect(h.execute({ ...dependentOwner, runId: run.execution!.runId, kind: 'reserve-action', operationId: operationId(),
    actionId: operationId(), capability: 'model', requestDigest: 'b'.repeat(64) })).rejects.toMatchObject({ code: 'version-conflict' })
  await h.close()
  const cold = openOrganizationDatabase(h.path, 100); cold.close()
}, 20000)
it('completes a root task at approval and preserves completion after reopening without a target directory', async () => {
  const h = await dependencyFixture(cleanup)
  expect((await h.readTasks())[0]?.status).toBe('completed')
  expect(h.db.prepare('SELECT count(*) AS n FROM organization_integrations').get()?.n).toBe(0)
  await h.close()
  const cold = await openHarness(h.root); cleanup.push(cold.close)
  const login = await cold.service.login({ username: 'owner', password })
  await cold.service.readTasks(login.token, { organizationId: h.query.organizationId, projectId: h.query.projectId, planId: h.query.planId }, (value) => { expect(value.items[0]?.status).toBe('completed') })
}, 15000)
it('migrates v10 without manufacturing target evidence and rolls back a failed migration', async () => {
  const h = await dependencyFixture(cleanup); await h.close()
  h.db.exec('DROP TABLE organization_hierarchy; DROP TABLE planning_goals; DROP TABLE planning_reapprovals; DROP TABLE planning_events; DROP TABLE planning_permits; DROP TABLE planning_grants; DROP TABLE integration_confirmations; DROP TABLE integration_events; DROP TABLE organization_integrations; DROP TABLE tree_requests; DROP TABLE plan_contexts; PRAGMA user_version=10; CREATE TABLE organization_integrations (sentinel TEXT)')
  expect(() => openOrganizationDatabase(h.path, 100)).toThrow()
  expect(h.db.prepare('PRAGMA user_version').get()?.user_version).toBe(10)
  h.db.exec('DROP TABLE organization_integrations')
  const db = openOrganizationDatabase(h.path, 100)
  expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(22)
  expect(db.prepare('SELECT count(*) AS n FROM organization_integrations').get()?.n).toBe(0)
  db.close()
}, 15000)

it('retains retired target history on reopen without exposing old receipts or changing task completion', async () => {
  const h = await dependencyFixture(cleanup)
  const acceptance = JSON.parse(String(h.db.prepare('SELECT data FROM organization_acceptances').get()?.data))
  const id = operationId(), requestId = operationId()
  const insertEvent = (kind: string) => Number(h.db.prepare('INSERT INTO organization_events (kind,actorId,organizationId,at) VALUES (?,?,?,?)')
    .run(kind, h.owner.accountId, h.query.organizationId, Date.now()).lastInsertRowid)
  const revision = insertEvent('verify-integration')
  const observation = { targetRef: operationId(), baseCommit: '1'.repeat(40), baseTree: '2'.repeat(40),
    files: [h.file], verifiedAt: Date.now(), result: 'verified' }
  const record = { ...h.query, id, inputs: [{ assignmentId: acceptance.assignmentId, taskId: h.query.taskId,
    submissionId: acceptance.submissionId, artifacts: acceptance.artifacts }], observation,
  operatorId: h.owner.membershipId, issuerId: h.owner.membershipId, createdRevision: revision }
  h.db.prepare('INSERT INTO organization_integrations VALUES (?,?,?)').run(id, h.query.planId, JSON.stringify(record))
  h.db.prepare('INSERT INTO integration_events VALUES (?,?,?)').run(revision, id, JSON.stringify({ integrationId: id, delivered: false }))
  h.db.prepare('INSERT INTO workgraph_events VALUES (?,?)').run(revision, h.query.planId)
  const confirmedRevision = insertEvent('confirm-integration')
  const integration = { integrationId: id, delivered: true }
  h.db.prepare('INSERT INTO integration_confirmations VALUES (?,?,?)').run(id, confirmedRevision, JSON.stringify(observation))
  h.db.prepare('INSERT INTO integration_events VALUES (?,?,?)').run(confirmedRevision, id, JSON.stringify(integration))
  h.db.prepare('INSERT INTO workgraph_events VALUES (?,?)').run(confirmedRevision, h.query.planId)
  h.db.prepare('INSERT INTO operation_receipts VALUES (?,?,?,?)').run(`account:${h.owner.accountId}`, requestId, 'a'.repeat(64),
    JSON.stringify({ operationId: requestId, revision: confirmedRevision, organizationId: h.query.organizationId,
      projectId: h.query.projectId, planId: h.query.planId, planRevision: h.query.planRevision, integration }))
  await h.close()
  const cold = await openHarness(h.root); cleanup.push(cold.close)
  const login = await cold.service.login({ username: 'owner', password })
  await cold.service.readTasks(login.token, { organizationId: h.query.organizationId, projectId: h.query.projectId,
    planId: h.query.planId }, (value) => { expect(value.items[0]?.status).toBe('completed') })
  await expect(cold.service.receipt(login.token, requestId)).rejects.toMatchObject({ code: 'forbidden' })
  expect(h.db.prepare('SELECT count(*) AS n FROM integration_confirmations').get()?.n).toBe(1)
})
