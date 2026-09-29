/** Real authority tests for execution budgets, stale owners and durable recovery. */
import { generateKeyPairSync, sign, randomUUID } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import { assignmentHarness } from './assignment-harness.ts'
import { openHarness, operationId } from './harness.ts'
import { deviceChallengeText } from '../src/device-schema.ts'
import { openOrganizationDatabase } from '../src/database.ts'
import type { OrganizationDeviceChallenge, OrganizationExecutionView } from '../src/index.ts'
const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => { vi.restoreAllMocks(); for (const close of cleanup.splice(0).reverse()) await close() })
async function setup(budget = 2) {
  const h = await assignmentHarness(cleanup)
  const approved = await h.service.assignmentCommand(h.owner.token, h.approve)
  const selector = { ...h.query, assignmentId: approved.assignmentId }
  const accepted = await h.service.participantCommand(h.other.token, { ...selector, kind: 'answer-assignment', operationId: operationId(),
    requestId: h.db.prepare('SELECT id FROM assignment_requests').get()?.id, expectedVersion: approved.revision, answer: 'accepted' })
  const pair = generateKeyPairSync('ed25519')
  const proof = (c: OrganizationDeviceChallenge) => ({ challengeId: c.challengeId, signature: sign(null, Buffer.from(deviceChallengeText(c)), pair.privateKey).toString('base64url') })
  const registration = { kind: 'register-device', operationId: operationId(), organizationId: h.query.organizationId,
    publicKey: pair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64'), keyGeneration: 1, name: 'Employee' }
  const device = await h.service.deviceCommand(h.other.token, registration,
    proof(await h.service.deviceChallenge(h.other.token, registration)))
  const prep = await h.service.participantCommand(h.other.token, { ...selector, kind: 'delegate', operationId: operationId(),
    expectedVersion: accepted.revision, deviceId: device.deviceId, executorId: 'desktop-builtin', capabilities: ['draft'], budget, expiresAt: Date.now() + 60000 })
  const claim = { ...selector, kind: 'claim', operationId: operationId(), deviceId: device.deviceId, delegationId: prep.delegationId }
  const lease = (await h.service.deviceCommand(h.other.token, claim, proof(await h.service.deviceChallenge(h.other.token, claim)))).lease!
  const base = { ...selector, planRevision: 1, deviceId: device.deviceId }
  const execute = async (command: object) => h.service.executionCommand(h.other.token, command,
    proof(await h.service.executionChallenge(h.other.token, command)))
  const grant = await execute({ ...base, kind: 'grant-execution', operationId: operationId(), delegationId: prep.delegationId,
    capabilities: ['model'], budget, expiresAt: Date.now() + 30000, configDigest: 'a'.repeat(64) })
  const owner = { ...base, executionDelegationId: grant.execution!.executionDelegationId, serverEpoch: lease.serverEpoch,
    fencingEpoch: lease.fencingEpoch }
  const create = { ...owner, kind: 'create-run', operationId: operationId(), configDigest: 'a'.repeat(64) }
  const created = await execute(create)
  const run = { ...owner, runId: created.execution!.runId }
  const read = async () => {
    let view: OrganizationExecutionView | undefined
    await h.service.readExecution(h.other.token, { ...selector, runId: run.runId }, (v) => { view = v })
    return view!
  }
  const transition = (state: string) => execute({ ...run, kind: 'transition-run', state, operationId: operationId() })
  const action = () => ({ ...run, kind: 'reserve-action', operationId: operationId(), actionId: randomUUID(), capability: 'model', requestDigest: 'b'.repeat(64) })
  return { ...h, selector, execute, read, transition, action, run, create, created, proof }
}
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
  h.db.exec('DROP TABLE execution_events; DROP TABLE execution_actions; DROP TABLE execution_runs; DROP TABLE execution_delegations; PRAGMA user_version=6')
  h.db.exec('CREATE TABLE execution_runs (sentinel TEXT)')
  expect(() => openOrganizationDatabase(h.path, 100)).toThrow()
  expect(h.db.prepare('PRAGMA user_version').get()?.user_version).toBe(6)
  expect(h.db.prepare("SELECT name FROM sqlite_master WHERE name='execution_delegations'").get()).toBeUndefined()
  h.db.exec('DROP TABLE execution_runs')
  const upgraded = openOrganizationDatabase(h.path, 100)
  expect(upgraded.prepare('PRAGMA user_version').get()?.user_version).toBe(7)
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
