/** Accepted assignments support manual delivery without any device or isolated Run. */
import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto'
import { afterEach, expect, it } from 'vitest'
import { assignmentHarness } from './assignment-harness.ts'
import { setupExecution } from './execution-harness.ts'
import { operationId } from './harness.ts'
import { openOrganizationDatabase, ORGANIZATION_SCHEMA_VERSION } from '../src/database.ts'

const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })

it('requires employee acceptance, then publishes, submits and approves manual work with no Run or device', async () => {
  const h = await assignmentHarness(cleanup)
  const approved = await h.service.assignmentCommand(h.owner.token, h.approve)
  const selector = { ...h.query, assignmentId: approved.assignmentId }
  const bytes = Buffer.from('Completed manually'), sha256 = createHash('sha256').update(bytes).digest('hex')
  const upload = { ...selector, planRevision: 1, kind: 'publish-artifact', operationId: operationId(),
    artifactKind: 'file', path: 'report.txt', description: 'Employee report', mediaType: 'text/plain',
    size: bytes.length, sha256, bytes: bytes.toString('base64') }
  await expect(h.service.deliveryCommand(h.other.token, upload)).rejects.toMatchObject({ code: 'version-conflict' })
  await h.service.participantCommand(h.other.token, { ...selector, kind: 'answer-assignment', operationId: operationId(),
    requestId: h.db.prepare('SELECT id FROM assignment_requests').get()?.id, expectedVersion: approved.revision, answer: 'accepted' })
  await expect(h.service.deliveryCommand(h.owner.token, upload)).rejects.toMatchObject({ code: 'forbidden' })
  const artifactId = (await h.service.deliveryCommand(h.other.token, upload)).delivery!.artifactId!
  const submit = { ...selector, planRevision: 1, kind: 'submit-delivery', operationId: operationId(),
    artifactIds: [artifactId], summary: 'Task completed and checked', target: 'Report for review', confirmed: true }
  const submitted = await h.service.deliveryCommand(h.other.token, submit)
  expect(await h.service.deliveryCommand(h.other.token, submit)).toEqual(submitted)
  const decision = { ...selector, planRevision: 1, kind: 'accept-delivery', operationId: operationId(),
    submissionId: submitted.delivery!.submissionId, artifacts: [{ artifactId, sha256 }], confirmed: true }
  await expect(h.service.deliveryCommand(h.other.token, decision)).rejects.toMatchObject({ code: 'forbidden' })
  const accepted = await h.service.deliveryCommand(h.owner.token, decision)
  await h.service.readDelivery(h.other.token, selector, (page) => {
    expect(page.artifacts[0]?.runId).toBeNull()
    expect(page.submissions[0]).toMatchObject({ runId: null, reviewState: 'accepted', acceptance: { id: accepted.delivery!.acceptanceId } })
  })
  for (const table of ['organization_devices', 'assignment_delegations', 'assignment_leases', 'execution_runs']) {
    expect(h.db.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n).toBe(0)
  }
  for (const kind of ['delegate', 'revoke-delegation']) {
    await expect(h.service.participantCommand(h.other.token, { ...selector, kind, operationId: operationId() })).rejects.toMatchObject({ code: 'invalid-input' })
  }
  await h.close()
  const reopened = openOrganizationDatabase(h.path, 100)
  expect(reopened.prepare('PRAGMA foreign_key_check').all()).toEqual([])
  expect(JSON.parse(String(reopened.prepare('SELECT data FROM organization_submissions').get()?.data))).toMatchObject({ runId: null })
  reopened.close()
})

it('upgrades v20 device history and preserves artifacts, submissions, approvals and old execution data', async () => {
  const h = await setupExecution(cleanup)
  await h.transition('cancelled')
  const bytes = Buffer.from('Historical work'), sha256 = createHash('sha256').update(bytes).digest('hex')
  const base = { ...h.selector, runId: h.run.runId, planRevision: 1 }
  const artifactId = (await h.service.deliveryCommand(h.other.token, { ...base, kind: 'publish-artifact', operationId: operationId(),
    artifactKind: 'file', path: 'old.txt', description: 'Historical report', mediaType: 'text/plain', size: bytes.length,
    sha256, bytes: bytes.toString('base64') })).delivery!.artifactId!
  const submissionId = (await h.service.deliveryCommand(h.other.token, { ...base, kind: 'submit-delivery', operationId: operationId(),
    artifactIds: [artifactId], summary: 'Historical summary', target: 'Historical target', confirmed: true })).delivery!.submissionId!
  const acceptance = await h.service.deliveryCommand(h.owner.token, { ...base, kind: 'accept-delivery', operationId: operationId(),
    submissionId, artifacts: [{ artifactId, sha256 }], confirmed: true })
  await h.close()
  const deviceId = randomUUID(), delegationId = randomUUID(), epoch = randomUUID()
  const event = (kind: string) => Number(h.db.prepare('INSERT INTO organization_events(kind,actorId,organizationId,at) VALUES (?,?,?,?)')
    .run(kind, h.other.accountId, h.query.organizationId, Date.now()).lastInsertRowid)
  const registered = event('register-device'), delegated = event('delegate'), claimed = event('claim')
  const key = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'der' }).toString('base64')
  h.db.prepare('INSERT INTO organization_devices VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(deviceId, h.query.organizationId,
    h.other.accountId, h.other.membershipId!, key, 1, 'Old device', Number(h.db.prepare('SELECT at FROM organization_events WHERE revision=?').get(registered)?.at), registered, registered, 'active')
  h.db.prepare('INSERT INTO device_actions VALUES (?,?,NULL)').run(registered, deviceId)
  const expiresAt = Date.now() + 60000
  h.db.prepare('INSERT INTO assignment_delegations VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(delegationId, h.selector.assignmentId!,
    1, h.other.membershipId!, deviceId, 'desktop-builtin', JSON.stringify(['draft']), 2, expiresAt, 'active', delegated, delegated)
  h.db.prepare('INSERT INTO assignment_actions VALUES (?,?,?)').run(delegated, h.selector.assignmentId!, delegationId)
  const lease = { assignmentId: h.selector.assignmentId, delegationId, deviceId, fencingEpoch: 1, serverEpoch: epoch,
    expiresAt, createdRevision: claimed, version: claimed, state: 'held' }
  h.db.prepare('INSERT INTO assignment_leases VALUES (?,?,?,?,?,?,?,?,?)').run(h.selector.assignmentId!, delegationId, deviceId, 1,
    epoch, expiresAt, claimed, claimed, 'held')
  h.db.prepare('INSERT INTO device_actions VALUES (?,?,?)').run(claimed, deviceId, JSON.stringify(lease))
  h.db.prepare("UPDATE execution_runs SET data=json_set(data,'$.deviceId',?,'$.serverEpoch',?,'$.fencingEpoch',1)").run(deviceId, epoch)
  h.db.prepare("UPDATE execution_delegations SET data=json_set(data,'$.deviceId',?,'$.delegationId',?)").run(deviceId, delegationId)
  const history = h.db.prepare('SELECT data FROM execution_runs').get()?.data
  h.db.exec(`PRAGMA foreign_keys=OFF;
    CREATE TABLE organization_artifacts_v20 (id TEXT PRIMARY KEY, assignmentId TEXT NOT NULL REFERENCES task_assignments(id),
      runId TEXT NOT NULL REFERENCES execution_runs(id), data TEXT NOT NULL, bytes BLOB NOT NULL) STRICT;
    INSERT INTO organization_artifacts_v20 SELECT * FROM organization_artifacts;
    DROP TABLE organization_artifacts;
    ALTER TABLE organization_artifacts_v20 RENAME TO organization_artifacts;
    CREATE TABLE organization_submissions_v20 (id TEXT PRIMARY KEY, assignmentId TEXT NOT NULL REFERENCES task_assignments(id),
      runId TEXT NOT NULL REFERENCES execution_runs(id), data TEXT NOT NULL) STRICT;
    INSERT INTO organization_submissions_v20 SELECT * FROM organization_submissions;
    DROP TABLE organization_submissions;
    ALTER TABLE organization_submissions_v20 RENAME TO organization_submissions;
    PRAGMA foreign_keys=ON; PRAGMA user_version=20;
    CREATE TABLE organization_artifacts_v21 (sentinel TEXT)`)
  expect(() => openOrganizationDatabase(h.path, 100)).toThrow()
  expect(h.db.prepare('PRAGMA user_version').get()?.user_version).toBe(20)
  expect(h.db.prepare('SELECT state FROM organization_devices').get()?.state).toBe('active')
  expect(h.db.prepare('SELECT state FROM assignment_leases').get()?.state).toBe('held')
  expect(h.db.prepare('PRAGMA table_info(organization_artifacts)').all().find(row => row.name === 'runId')?.notnull).toBe(1)
  h.db.exec('DROP TABLE organization_artifacts_v21')
  const upgraded = openOrganizationDatabase(h.path, 100)
  try {
    expect(upgraded.prepare('PRAGMA user_version').get()?.user_version).toBe(ORGANIZATION_SCHEMA_VERSION)
    expect(upgraded.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    expect(upgraded.prepare('SELECT data FROM execution_runs').get()?.data).toBe(history)
    expect(upgraded.prepare('SELECT bytes FROM organization_artifacts WHERE id=?').get(artifactId)?.bytes).toEqual(new Uint8Array(bytes))
    expect(upgraded.prepare('SELECT id FROM organization_submissions').get()?.id).toBe(submissionId)
    expect(upgraded.prepare('SELECT id FROM organization_acceptances').get()?.id).toBe(acceptance.delivery!.acceptanceId)
    expect(upgraded.prepare('SELECT state FROM assignment_leases').get()?.state).toBe('invalidated')
    expect(upgraded.prepare('SELECT state FROM assignment_delegations').get()?.state).toBe('invalidated')
    expect(upgraded.prepare('SELECT state FROM organization_devices').get()?.state).toBe('revoked')
    expect(upgraded.prepare('PRAGMA table_info(organization_artifacts)').all().find(row => row.name === 'runId')?.notnull).toBe(0)
  } finally { upgraded.close() }
})
