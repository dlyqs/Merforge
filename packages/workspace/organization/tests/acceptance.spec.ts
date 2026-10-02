/** Real Loader/SQLite issuer review, rework transactions and qualification renewal. */
import { createHash, randomUUID } from 'node:crypto'
import { afterEach, expect, it } from 'vitest'
import { setupExecution } from './execution-harness.ts'
import { operationId, openHarness, password, addMember } from './harness.ts'
import { openOrganizationDatabase } from '../src/database.ts'

const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })
async function fixture() {
  const h = await setupExecution(cleanup)
  await h.transition('running'); await h.transition('succeeded')
  const bytes = Buffer.from('name,total\nalpha,42\n'), sha256 = createHash('sha256').update(bytes).digest('hex')
  const base = { ...h.selector, runId: h.run.runId, planRevision: 1 }
  const artifact = await h.service.deliveryCommand(h.other.token, { ...base, kind: 'publish-artifact', operationId: operationId(),
    artifactKind: 'test-report', path: 'result.csv', description: 'CSV report', mediaType: 'text/csv', size: bytes.length, sha256, bytes: bytes.toString('base64') })
  const artifactId = artifact.delivery!.artifactId!
  const submit = { ...base, kind: 'submit-delivery', operationId: operationId(), artifactIds: [artifactId], summary: 'Verified CSV', target: 'Review CSV', confirmed: true }
  const submitted = await h.service.deliveryCommand(h.other.token, submit)
  const decision = { ...base, kind: 'accept-delivery', operationId: operationId(), submissionId: submitted.delivery!.submissionId!, artifacts: [{ artifactId, sha256 }], confirmed: true }
  const reject = { ...decision, kind: 'reject-delivery', reason: 'Missing second row', requirements: 'Include beta totals' }
  const read = async () => {
    const pages: import('zod').z.output<typeof import('../src/delivery-schema.ts').deliveryPageSchema>[] = []
    await h.service.readDelivery(h.owner.token, h.selector, (p) => { pages.push(p) })
    return pages[0]!
  }
  return { ...h, base, bytes, artifactId, decision, reject, submit, readDelivery: read }
}
it('accepts an exact submitted hash set once, preserves the submission and never marks a root delivered', async () => {
  const h = await fixture()
  const receipt = await h.service.deliveryCommand(h.owner.token, h.decision)
  expect(await h.service.deliveryCommand(h.owner.token, h.decision)).toEqual(receipt)
  expect((await h.readDelivery()).submissions[0]).toMatchObject({ state: 'submitted', reviewState: 'accepted', acceptance: { artifacts: h.decision.artifacts } })
  expect(h.db.prepare('SELECT currentRevision FROM organization_plans').get()?.currentRevision).toBe(1)
  expect(h.db.prepare('SELECT count(*) AS n FROM organization_acceptances').get()?.n).toBe(1)
  await h.service.readInbox(h.owner.token, { organizationId: h.query.organizationId, state: 'pending' }, (p) => {
    expect(p.items.some(i => i.request.kind === 'accept-delivery')).toBe(false)
  })
  await h.service.readInbox(h.other.token, { organizationId: h.query.organizationId, state: 'processed' }, (p) => {
    expect(p.items.some(i => i.request.kind === 'accept-delivery' && i.request.reviewState === 'accepted')).toBe(true)
  })
  await expect(h.service.deliveryCommand(h.owner.token, { ...h.decision, operationId: operationId() })).rejects.toMatchObject({ code: 'version-conflict' })
  await expect(h.service.deliveryCommand(h.owner.token, h.reject)).rejects.toMatchObject({ code: 'operation-conflict' })
  const second = await h.service.deliveryCommand(h.other.token, { ...h.submit, operationId: operationId() })
  await expect(h.service.deliveryCommand(h.owner.token, { ...h.decision, operationId: operationId(), submissionId: second.delivery!.submissionId })).rejects.toMatchObject({ code: 'version-conflict' })
  await h.close()
  const cold = await openHarness(h.root); cleanup.push(cold.close)
  const login = await cold.service.login({ username: 'owner', password })
  await cold.service.readDelivery(login.token, h.selector, (p) => {
    expect(p.submissions.find(s => s.id === h.decision.submissionId)?.acceptance?.id).toBe(receipt.delivery!.acceptanceId)
  })
}, 15000)
it('refuses employees, other root editors, disabled issuers and receipt retries after issuer write authority is lost', async () => {
  const h = await fixture()
  await expect(h.service.deliveryCommand(h.other.token, h.decision)).rejects.toMatchObject({ code: 'forbidden' })
  const admin = await addMember(h.service, h.owner.token, h.owner.organizationId, 'reviewer', 'admin')
  await h.projectGrant(admin.membershipId!, ['read', 'write'])
  await h.service.grantTask(h.owner.token, { ...h.query, taskId: h.save.definition.taskId, membershipId: admin.membershipId,
    scope: 'subtree', actions: ['read', 'edit'], expectedVersion: 0, operationId: operationId() })
  await expect(h.service.deliveryCommand(admin.token, h.decision)).rejects.toMatchObject({ code: 'forbidden' })
  await h.service.deliveryCommand(h.owner.token, h.decision)
  await h.projectGrant(h.owner.membershipId, ['read'], h.ownerGrant.revision)
  await expect(h.service.deliveryCommand(h.owner.token, h.decision)).rejects.toMatchObject({ code: 'forbidden' })
  const other = await fixture()
  other.db.prepare('UPDATE memberships SET enabled=0 WHERE id=?').run(other.owner.membershipId)
  await expect(other.service.deliveryCommand(other.owner.token, other.decision)).rejects.toMatchObject({ code: 'forbidden' })
}, 15000)
it('refuses unsubmitted evidence, incorrect hashes, duplicate evidence and missing rejection requirements', async () => {
  const h = await fixture()
  for (const change of [{ submissionId: randomUUID() }, { runId: randomUUID() }]) {
    await expect(h.service.deliveryCommand(h.owner.token, { ...h.decision, ...change })).rejects.toMatchObject({ code: 'forbidden' })
  }
  for (const artifacts of [[], [...h.decision.artifacts, ...h.decision.artifacts], [{ artifactId: h.artifactId, sha256: '0'.repeat(64) }]]) {
    await expect(h.service.deliveryCommand(h.owner.token, { ...h.decision, artifacts })).rejects.toMatchObject({ code: 'invalid-input' })
  }
  for (const change of [{ reason: '' }, { requirements: '' }, { confirmed: false }]) {
    await expect(h.service.deliveryCommand(h.owner.token, { ...h.reject, ...change })).rejects.toMatchObject({ code: 'invalid-input' })
  }
  h.db.prepare('UPDATE organization_artifacts SET bytes=?').run(Buffer.from('corrupt'))
  await expect(h.service.deliveryCommand(h.owner.token, h.decision)).rejects.toMatchObject({ code: 'incompatible-store' })
  expect(h.db.prepare('SELECT count(*) AS n FROM organization_acceptances').get()?.n).toBe(0)
}, 15000)
it('rejection retains historical evidence, creates one new plan revision and requires every new qualification', async () => {
  const h = await fixture()
  const receipt = await h.service.deliveryCommand(h.owner.token, h.reject)
  expect(await h.service.deliveryCommand(h.owner.token, h.reject)).toEqual(receipt)
  expect((await h.readDelivery()).submissions[0]).toMatchObject({ reviewState: 'rejected', acceptance: { reason: h.reject.reason, reworkRevision: 2 } })
  expect(h.db.prepare('SELECT state FROM task_assignments').get()?.state).toBe('invalidated')
  expect(h.db.prepare('SELECT state FROM assignment_delegations').get()?.state).toBe('invalidated')
  expect(h.db.prepare('SELECT state FROM assignment_leases').get()?.state).toBe('invalidated')
  expect((await h.read()).run.state).toBe('succeeded')
  await h.service.readPlan(h.owner.token, { ...h.query, revision: 1 }, (v) => { expect(v.definition).toEqual(h.save.definition) })
  await h.service.readPlan(h.owner.token, h.query, (v) => { expect(v.definition.tasks[0]!.acceptance).toEqual(['A reviewed report', h.reject.requirements]) })
  await expect(h.execute({ ...h.create, operationId: operationId() })).rejects.toThrow()
  await expect(h.service.deliveryCommand(h.other.token, { ...h.submit, operationId: operationId() })).rejects.toMatchObject({ code: 'version-conflict' })
  const approval = await h.service.assignmentCommand(h.owner.token, { ...h.approve, operationId: operationId(), planRevision: 2 })
  const selector = { ...h.query, assignmentId: approval.assignmentId }
  const acceptance = await h.service.participantCommand(h.other.token, { ...selector, kind: 'answer-assignment', operationId: operationId(),
    requestId: h.db.prepare('SELECT id FROM assignment_requests WHERE assignmentId=?').get(approval.assignmentId!)?.id, expectedVersion: approval.revision, answer: 'accepted' })
  const prep = await h.service.participantCommand(h.other.token, { ...selector, kind: 'delegate', operationId: operationId(), expectedVersion: acceptance.revision,
    deviceId: h.run.deviceId, executorId: 'desktop-builtin', capabilities: ['draft'], budget: 2, expiresAt: Date.now() + 60000 })
  const claim = { ...selector, kind: 'claim', operationId: operationId(), deviceId: h.run.deviceId, delegationId: prep.delegationId }
  const lease = (await h.service.deviceCommand(h.other.token, claim, h.proof(await h.service.deviceChallenge(h.other.token, claim)))).lease!
  const base = { ...selector, planRevision: 2, deviceId: h.run.deviceId }
  const granted = await h.execute({ ...base, kind: 'grant-execution', operationId: operationId(), delegationId: prep.delegationId,
    capabilities: ['model'], budget: 2, expiresAt: Date.now() + 30000, configDigest: 'a'.repeat(64) })
  const owner = { ...base, executionDelegationId: granted.execution!.executionDelegationId,
    serverEpoch: lease.serverEpoch, fencingEpoch: lease.fencingEpoch }
  const run = await h.execute({ ...owner, kind: 'create-run', operationId: operationId(), configDigest: 'a'.repeat(64) })
  expect(run.execution!.runId).not.toBe(h.run.runId)
  await h.execute({ ...owner, runId: run.execution!.runId, kind: 'transition-run', state: 'cancelled', operationId: operationId() })
  await expect(h.service.deliveryCommand(h.other.token, { ...h.submit, ...selector, planRevision: 2, runId: run.execution!.runId, operationId: operationId() })).rejects.toMatchObject({ code: 'forbidden' })
  await h.service.downloadArtifact(h.other.token, { ...h.selector, artifactId: h.artifactId }, (v) => { expect(Buffer.from(v.bytes, 'base64')).toEqual(h.bytes) })
  const newBase = { ...selector, planRevision: 2, runId: run.execution!.runId }
  const newArtifact = await h.service.deliveryCommand(h.other.token, { ...newBase, kind: 'publish-artifact', operationId: operationId(),
    artifactKind: 'test-report', path: 'result.csv', description: 'Explicitly rechecked evidence', mediaType: 'text/csv',
    size: h.bytes.length, sha256: h.decision.artifacts[0]!.sha256, bytes: h.bytes.toString('base64') })
  const newArtifactId = newArtifact.delivery!.artifactId!
  const newSubmission = await h.service.deliveryCommand(h.other.token, { ...h.submit, ...newBase,
    operationId: operationId(), artifactIds: [newArtifactId] })
  await h.service.deliveryCommand(h.owner.token, { ...h.decision, ...newBase, operationId: operationId(),
    submissionId: newSubmission.delivery!.submissionId,
    artifacts: [{ artifactId: newArtifactId, sha256: h.decision.artifacts[0]!.sha256 }] })
  expect(h.db.prepare('SELECT count(*) AS n FROM organization_acceptances').get()?.n).toBe(2)
  await h.close()
  const cold = openOrganizationDatabase(h.path, 100); cold.close()
}, 15000)
it('serializes competing acceptance/rejection and refuses decisions after a concurrent plan edit wins', async () => {
  const h = await fixture()
  const settled = await Promise.allSettled([h.service.deliveryCommand(h.owner.token, h.decision),
    h.service.deliveryCommand(h.owner.token, { ...h.reject, operationId: operationId() })])
  expect(settled.filter(v => v.status === 'fulfilled')).toHaveLength(1)
  const other = await fixture()
  await other.service.savePlan(other.owner.token, { ...other.save, operationId: operationId(), expectedRevision: 1 })
  await expect(other.service.deliveryCommand(other.owner.token, other.decision)).rejects.toMatchObject({ code: 'version-conflict' })
  expect((await other.readDelivery()).submissions[0]?.reviewState).toBe('superseded')
}, 15000)
it('rolls back the new version, invalidation and decision together if the receipt event insert fails', async () => {
  const h = await fixture()
  h.db.exec("CREATE TRIGGER fail_acceptance BEFORE INSERT ON delivery_events WHEN json_extract(NEW.result,'$.acceptanceId') IS NOT NULL BEGIN SELECT RAISE(ABORT,'fault'); END")
  await expect(h.service.deliveryCommand(h.owner.token, h.reject)).rejects.toThrow('fault')
  expect(h.db.prepare('SELECT currentRevision FROM organization_plans').get()?.currentRevision).toBe(1)
  expect(h.db.prepare('SELECT state FROM task_assignments').get()?.state).toBe('accepted')
  expect(h.db.prepare('SELECT count(*) AS n FROM organization_acceptances').get()?.n).toBe(0)
  h.db.exec('DROP TRIGGER fail_acceptance')
  await h.service.deliveryCommand(h.owner.token, h.reject)
  await h.close()
  h.db.prepare("UPDATE organization_acceptances SET data=json_set(data,'$.requirements','forged')").run()
  expect(() => openOrganizationDatabase(h.path, 100)).toThrow()
}, 15000)
it('migrates v9 without manufacturing acceptances and rolls back failed schema upgrades', async () => {
  const h = await fixture(); await h.close()
  h.db.exec('DROP TABLE planning_events; DROP TABLE planning_permits; DROP TABLE planning_grants; DROP TABLE integration_confirmations; DROP TABLE integration_events; DROP TABLE organization_integrations; DROP TABLE organization_acceptances; PRAGMA user_version=9; CREATE TABLE organization_acceptances (sentinel TEXT)')
  expect(() => openOrganizationDatabase(h.path, 100)).toThrow()
  expect(h.db.prepare('PRAGMA user_version').get()?.user_version).toBe(9)
  h.db.exec('DROP TABLE organization_acceptances')
  const upgraded = openOrganizationDatabase(h.path, 100)
  expect(upgraded.prepare('PRAGMA user_version').get()?.user_version).toBe(13)
  expect(upgraded.prepare('SELECT count(*) AS n FROM organization_acceptances').get()?.n).toBe(0)
  expect(upgraded.prepare('SELECT count(*) AS n FROM organization_submissions').get()?.n).toBe(1)
  upgraded.close()
}, 15000)
