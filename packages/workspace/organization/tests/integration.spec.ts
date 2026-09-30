/** Real Loader/SQLite dependency admission, target receipts, permission cuts and crash recovery. */
import { afterEach, expect, it } from 'vitest'
import { integrationFixture } from './integration-harness.ts'
import { operationId, openHarness, password } from './harness.ts'
import { openOrganizationDatabase } from '../src/database.ts'
const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })
it.each(['left', 'right'] as const)('requires both independent children with %s accepted first and separately gates dependency execution', async (first) => {
  const h = await integrationFixture(cleanup, true, first, undefined, first === 'right')
  expect(await h.readIntegration()).toMatchObject({ inputsReady: false, delivered: false, inputs: [] })
  const dependent = await h.prepareTask(h.consumer)
  await expect(h.execute(dependent.create)).rejects.toMatchObject({ code: 'version-conflict' })
  const right = await h.prepareTask(h.remaining)
  const created = await h.execute(right.create)
  const { kind: _kind, configDigest: _digest, ...owner } = right.create
  await h.execute({ ...owner, runId: created.execution!.runId, kind: 'transition-run', state: 'cancelled', operationId: operationId() })
  const file = await h.publish({ ...right.selector, runId: created.execution!.runId, planRevision: 2 }, first === 'left' ? 'right.csv' : 'left.csv')
  expect((await h.readIntegration()).inputs).toHaveLength(2)
  expect((await h.readIntegration(h.consumer as typeof h.query.taskId, h.other.token)).dependenciesReady).toBe(true)
  const run = await h.execute({ ...dependent.create, operationId: operationId() })
  expect(run.execution?.runId).toBeTruthy()
  const { command, receipt } = await h.verify([file, h.file])
  expect(await h.service.integrationCommand(h.owner.token, command)).toEqual(receipt)
  const confirm = { ...h.query, kind: 'confirm-integration', operationId: operationId(), integrationId: receipt.integration!.integrationId,
    observation: command.observation, confirmed: true }
  await h.service.integrationCommand(h.owner.token, confirm)
  expect((await h.readIntegration()).delivered).toBe(true)
  const { kind: _dependentKind, configDigest: _dependentDigest, ...dependentOwner } = dependent.create
  await h.execute({ ...dependentOwner, runId: run.execution!.runId, kind: 'transition-run', state: 'running', operationId: operationId() })
  const grant = h.db.prepare('SELECT version FROM task_grants WHERE membershipId=? AND taskId=?').get(h.other.membershipId!, h.left)
  const { taskId: _taskId, planRevision: _revision, ...selector } = h.query
  await h.service.grantTask(h.owner.token, { ...selector, taskId: h.left, membershipId: h.other.membershipId,
    scope: 'node', actions: [], expectedVersion: grant?.version, operationId: operationId() })
  await expect(h.execute({ ...dependentOwner, runId: run.execution!.runId, kind: 'reserve-action', operationId: operationId(),
    actionId: operationId(), capability: 'model', requestDigest: 'b'.repeat(64) })).rejects.toMatchObject({ code: 'version-conflict' })
  await h.close()
  const cold = openOrganizationDatabase(h.path, 100); cold.close()
}, 20000)
it('leaf root needs actual matching target evidence and explicit original issuer confirmation', async () => {
  const h = await integrationFixture(cleanup)
  expect(await h.readIntegration()).toMatchObject({ inputsReady: true, latest: null, delivered: false })
  const { command, receipt } = await h.verify()
  const confirm = { ...h.query, kind: 'confirm-integration', operationId: operationId(), integrationId: receipt.integration!.integrationId,
    observation: command.observation, confirmed: true }
  for (const observation of [{ ...command.observation, baseCommit: '3'.repeat(40) },
    { ...command.observation, files: [{ ...h.file, sha256: '4'.repeat(64) }] }]) {
    await expect(h.service.integrationCommand(h.owner.token, { ...confirm, observation })).rejects.toMatchObject({ code: 'version-conflict' })
  }
  await expect(h.service.integrationCommand(h.other.token, confirm)).rejects.toMatchObject({ code: 'forbidden' })
  expect((await h.readIntegration()).delivered).toBe(false)
  await h.service.integrationCommand(h.owner.token, confirm)
  await h.close()
  const cold = await openHarness(h.root); cleanup.push(cold.close)
  const login = await cold.service.login({ username: 'owner', password })
  await cold.service.readIntegration(login.token, h.query, (v) => { expect(v.delivered).toBe(true) })
}, 15000)
it('blocks inaccessible sibling evidence and invalidates receipts on whole-plan revision changes', async () => {
  const h = await integrationFixture(cleanup, true)
  const { taskId: _taskId, planRevision: _revision, ...selector } = h.query
  const planGrant = await h.service.grantTask(h.owner.token, { ...selector, taskId: h.query.taskId, membershipId: h.other.membershipId,
    scope: 'node', actions: ['read'], expectedVersion: h.taskGrant.revision, operationId: operationId() })
  expect(planGrant.revision).toBeGreaterThan(0)
  const grant = h.db.prepare('SELECT version FROM task_grants WHERE membershipId=? AND taskId=?').get(h.other.membershipId!, h.left)
  await h.service.grantTask(h.owner.token, { ...selector, taskId: h.left, membershipId: h.other.membershipId,
    scope: 'node', actions: [], expectedVersion: grant?.version, operationId: operationId() })
  expect(await h.readIntegration(h.query.taskId, h.other.token)).toMatchObject({ inputsReady: false, inputs: [], latest: null })
  const leaf = await integrationFixture(cleanup), { command } = await leaf.verify()
  await leaf.service.savePlan(leaf.owner.token, { ...leaf.save, expectedRevision: 1, operationId: operationId() })
  await expect(leaf.service.integrationCommand(leaf.owner.token, command)).rejects.toMatchObject({ code: 'version-conflict' })
  await expect(leaf.service.receipt(leaf.owner.token, command.operationId)).rejects.toMatchObject({ code: 'version-conflict' })
}, 15000)
it('rolls back integration on receipt failure and refuses corrupted durable target evidence', async () => {
  const h = await integrationFixture(cleanup)
  h.db.exec("CREATE TRIGGER fail_integration BEFORE INSERT ON integration_events BEGIN SELECT RAISE(ABORT,'fault'); END")
  await expect(h.verify()).rejects.toThrow('fault')
  expect(h.db.prepare('SELECT count(*) AS n FROM organization_integrations').get()?.n).toBe(0)
  h.db.exec('DROP TRIGGER fail_integration')
  await h.verify(); await h.close()
  h.db.exec("UPDATE organization_integrations SET data=json_set(data,'$.observation.files[0].sha256','"+'0'.repeat(64)+"')")
  expect(() => openOrganizationDatabase(h.path, 100)).toThrow()
}, 15000)
it('migrates v10 without manufacturing target evidence and rolls back a failed migration', async () => {
  const h = await integrationFixture(cleanup); await h.close()
  h.db.exec('DROP TABLE integration_confirmations; DROP TABLE integration_events; DROP TABLE organization_integrations; PRAGMA user_version=10; CREATE TABLE organization_integrations (sentinel TEXT)')
  expect(() => openOrganizationDatabase(h.path, 100)).toThrow()
  expect(h.db.prepare('PRAGMA user_version').get()?.user_version).toBe(10)
  h.db.exec('DROP TABLE organization_integrations')
  const db = openOrganizationDatabase(h.path, 100)
  expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(11)
  expect(db.prepare('SELECT count(*) AS n FROM organization_integrations').get()?.n).toBe(0)
  db.close()
}, 15000)
it('rejects incomplete inputs and forged file evidence, emits authorized invalidations and rechecks issuer authority on retries', async () => {
  const h = await integrationFixture(cleanup)
  let cursor = ''
  const { taskId: _taskId, planRevision: _revision, ...selector } = h.query
  await h.service.readTasks(h.owner.token, selector, (v) => { cursor = v.cursor })
  const { command, receipt } = await h.verify()
  await h.service.readWorkgraphEvents(h.owner.token, { organizationId: h.query.organizationId, cursor }, (v) => {
    expect(v.events).toContainEqual({ planId: h.query.planId, revision: receipt.revision })
  })
  for (const inputs of [[], [...command.inputs, ...command.inputs], command.inputs.map(i => ({ ...i, artifacts: [] }))]) {
    await expect(h.service.integrationCommand(h.owner.token, { ...command, operationId: operationId(), inputs })).rejects.toThrow()
  }
  await expect(h.service.integrationCommand(h.owner.token, { ...command, operationId: operationId(),
    observation: { ...command.observation, files: [{ ...h.file, sha256: '0'.repeat(64) }] } })).rejects.toMatchObject({ code: 'invalid-input' })
  const confirm = { ...h.query, kind: 'confirm-integration', operationId: operationId(),
    integrationId: receipt.integration!.integrationId, observation: command.observation, confirmed: true }
  await h.service.integrationCommand(h.owner.token, confirm)
  await h.projectGrant(h.owner.membershipId, ['read'], h.ownerGrant.revision)
  await expect(h.service.integrationCommand(h.owner.token, confirm)).rejects.toMatchObject({ code: 'forbidden' })
  await expect(h.service.receipt(h.owner.token, confirm.operationId)).rejects.toMatchObject({ code: 'forbidden' })
}, 15000)
