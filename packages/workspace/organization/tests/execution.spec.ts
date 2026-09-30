/** Real authority tests for execution budgets, stale owners and durable recovery. */
import { randomUUID } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import { assignmentHarness } from './assignment-harness.ts'
import { openHarness, operationId } from './harness.ts'
import { setupExecution } from './execution-harness.ts'
import { openOrganizationDatabase } from '../src/database.ts'
import type { OrganizationExecutionView } from '../src/index.ts'
const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => { vi.restoreAllMocks(); for (const close of cleanup.splice(0).reverse()) await close() })
const setup = (budget = 2) => setupExecution(cleanup, budget)
it('charges once per action, rejects changed keys and atomically exhausts concurrent budgets', async () => {
  const h = await setup(1)
  expect(await h.service.executionCommand(h.other.token, h.create)).toEqual(h.created)
  await h.transition('running')
  const action = h.action()
  const results = await Promise.allSettled([h.execute(action), h.execute(h.action())])
  expect(results.filter(x => x.status === 'fulfilled')).toHaveLength(1)
  await h.execute({ ...action, operationId: operationId() })
  await expect(h.execute({ ...action, operationId: operationId(), requestDigest: 'c'.repeat(64) })).rejects.toMatchObject({ code: 'operation-conflict' })
  expect((await h.read()).delegation.used).toBe(1)
  await expect(h.execute({ ...action, requestDigest: 'c'.repeat(64) })).rejects.toMatchObject({ code: 'operation-conflict' })
  const reopened = openOrganizationDatabase(h.path, 100); reopened.close()
})
it('cancels unconfirmed actions to unknown, permits historical evidence and refuses new work', async () => {
  const h = await setup(); await h.transition('running')
  const action = h.action(); await h.execute(action)
  await h.transition('cancelled')
  expect((await h.read()).actions[0]?.state).toBe('unknown')
  await expect(h.execute(h.action())).rejects.toMatchObject({ code: 'version-conflict' })
  await h.execute({ ...h.run, kind: 'settle-action', operationId: operationId(), actionId: action.actionId, outcome: 'succeeded', evidenceDigest: 'c'.repeat(64) })
  expect((await h.read()).actions[0]?.state).toBe('succeeded')
  await expect(h.transition('succeeded')).rejects.toMatchObject({ code: 'version-conflict' })
  expect((await h.read()).delegation.used).toBe(1)
  const reopened = openOrganizationDatabase(h.path, 100); reopened.close()
})
it('pauses on service restart and retains old-device evidence without reviving permits', async () => {
  const h = await setup(); await h.transition('running'); const action = h.action(); await h.execute(action)
  await h.close()
  const next = await openHarness(h.root); cleanup.push(next.close)
  let view: OrganizationExecutionView | undefined
  await next.service.readExecution(h.other.token, { ...h.selector, runId: h.run.runId }, (v) => { view = v })
  expect(view?.eligible).toBe(false); expect(view?.run.state).toBe('paused'); expect(view?.actions[0]?.state).toBe('unknown')
  const command = { ...h.run, kind: 'settle-action', operationId: operationId(), actionId: action.actionId, outcome: 'failed', evidenceDigest: 'c'.repeat(64) }
  await next.service.executionCommand(h.other.token, command, h.proof(await next.service.executionChallenge(h.other.token, command)))
  const reserve = h.action()
  await expect(next.service.executionCommand(h.other.token, reserve, h.proof(await next.service.executionChallenge(h.other.token, reserve)))).rejects.toMatchObject({ code: 'version-conflict' })
  const reopened = openOrganizationDatabase(h.path, 100); reopened.close()
})
it('rolls back budget and action together on receipt failure and denies current revoked reads', async () => {
  const h = await setup(); await h.transition('running')
  h.db.exec("CREATE TRIGGER reject_execution BEFORE INSERT ON operation_receipts BEGIN SELECT RAISE(ABORT,'execution fault'); END")
  await expect(h.execute(h.action())).rejects.toThrow('execution fault')
  expect((await h.read()).delegation.used).toBe(0)
  h.db.exec('DROP TRIGGER reject_execution')
  await h.projectGrant(h.other.membershipId!, [], h.otherGrant.revision)
  await expect(h.read()).rejects.toMatchObject({ code: 'forbidden' })
  await expect(h.service.receipt(h.other.token, h.create.operationId)).rejects.toMatchObject({ code: 'forbidden' })
  const reopened = openOrganizationDatabase(h.path, 100); reopened.close()
})
it('expires single-action windows without refund and validates independent persisted usage', async () => {
  const h = await setup(); await h.transition('running'); await h.execute(h.action())
  const view = await h.read()
  vi.spyOn(Date, 'now').mockReturnValue(view.actions[0]!.expiresAt + 1)
  expect((await h.read()).actions[0]?.state).toBe('unknown')
  expect((await h.read()).delegation.used).toBe(1)
  await h.close()
  h.db.exec("UPDATE execution_delegations SET data=json_set(data,'$.used',0)")
  expect(() => openOrganizationDatabase(h.path, 100)).toThrow('incompatible-store')
})
it('migrates v6 preparation without execution grants and rolls failed migration back', async () => {
  const h = await assignmentHarness(cleanup)
  await h.close()
  h.db.exec('DROP TABLE integration_confirmations; DROP TABLE integration_events; DROP TABLE organization_integrations; DROP TABLE organization_acceptances; DROP TABLE delivery_events; DROP TABLE organization_submissions; DROP TABLE organization_artifacts; DROP TABLE execution_human_requests; DROP TABLE execution_events; DROP TABLE execution_actions; DROP TABLE execution_runs; DROP TABLE execution_delegations; PRAGMA user_version=6')
  h.db.exec('CREATE TABLE execution_runs (sentinel TEXT)')
  expect(() => openOrganizationDatabase(h.path, 100)).toThrow()
  expect(h.db.prepare('PRAGMA user_version').get()?.user_version).toBe(6)
  expect(h.db.prepare("SELECT name FROM sqlite_master WHERE name='execution_delegations'").get()).toBeUndefined()
  h.db.exec('DROP TABLE execution_runs')
  const upgraded = openOrganizationDatabase(h.path, 100)
  expect(upgraded.prepare('PRAGMA user_version').get()?.user_version).toBe(11)
  expect(upgraded.prepare('SELECT count(*) AS n FROM execution_delegations').get()?.n).toBe(0)
  upgraded.close()
})
it('refuses preparation-only IDs, wrong device owners and capabilities outside the explicit grant', async () => {
  const h = await setup()
  const view = await h.read()
  await expect(h.execute({ ...h.create, operationId: operationId(), executionDelegationId: view.delegation.delegationId }))
    .rejects.toMatchObject({ code: 'forbidden' })
  await expect(h.execute({ ...h.create, operationId: operationId(), deviceId: randomUUID() })).rejects.toMatchObject({ code: 'forbidden' })
  await h.transition('running')
  await expect(h.execute({ ...h.action(), capability: 'shell' })).rejects.toMatchObject({ code: 'version-conflict' })
  expect((await h.read()).delegation.used).toBe(0)
})
