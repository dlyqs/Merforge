/** Real Loader/SQLite delivery transactions and independent persisted-byte checks. */
import { createHash } from 'node:crypto'
import { writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { setupExecution } from './execution-harness.ts'
import { operationId, openHarness, password } from './harness.ts'
import { openOrganizationDatabase } from '../src/database.ts'
import { readArtifact } from '../src/delivery.ts'
import { backupOrganization } from '../src/maintenance.ts'

const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })
async function fixture() {
  const h = await setupExecution(cleanup)
  const base = { ...h.selector, runId: h.run.runId, planRevision: 1 }
  const bytes = Buffer.from('name,total\nalpha,42\n')
  const upload = { ...base, kind: 'publish-artifact', operationId: operationId(), artifactKind: 'test-report',
    path: 'reports/result.csv', description: 'Checked totals', mediaType: 'text/csv', size: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.toString('base64') }
  const publish = (overrides: object = {}) => h.service.deliveryCommand(h.other.token, { ...upload, ...overrides })
  const submit = (artifactId: string, overrides: object = {}) => h.service.deliveryCommand(h.other.token, {
    ...base, kind: 'submit-delivery', operationId: operationId(), artifactIds: [artifactId], summary: 'Verified CSV', target: 'Import reviewed CSV', confirmed: true, ...overrides })
  return { ...h, base, bytes, upload, publish, submit }
}
it('publishes atomically, requires a separate human submission and survives a cold service with no Session', async () => {
  const h = await fixture()
  const receipt = await h.publish(), artifactId = receipt.delivery!.artifactId!
  expect(await h.publish()).toEqual(receipt)
  expect(h.db.prepare('SELECT count(*) AS n FROM organization_artifacts').get()?.n).toBe(1)
  expect(h.db.prepare('SELECT count(*) AS n FROM organization_submissions').get()?.n).toBe(0)
  await expect(h.submit(artifactId)).rejects.toMatchObject({ code: 'version-conflict' })
  await h.transition('running'); await h.transition('succeeded')
  // Expired execution authority cannot start actions, but it does not erase submission eligibility.
  h.db.prepare("UPDATE execution_delegations SET data=json_set(data,'$.expiresAt',1)").run()
  const operation = operationId(), submitted = await h.submit(artifactId, { operationId: operation })
  expect(await h.submit(artifactId, { operationId: operation })).toEqual(submitted)
  await h.service.readInbox(h.owner.token, { organizationId: h.query.organizationId }, (page) => {
    expect(page.items.some(item => item.request.kind === 'accept-delivery' && item.request.id === submitted.delivery!.submissionId)).toBe(true)
  })
  const output = join(h.root, 'download.csv')
  await h.service.downloadArtifact(h.owner.token, { ...h.selector, artifactId }, (value) => {
    expect(Buffer.from(value.bytes, 'base64')).toEqual(h.bytes)
  })
  await writeFile(output, readArtifact(h.db, artifactId).bytes)
  expect(createHash('sha256').update(await readFile(output)).digest('hex')).toBe(h.upload.sha256)
  await h.close()
  const cold = await openHarness(h.root); cleanup.push(cold.close)
  const login = await cold.service.login({ username: 'owner', password })
  await cold.service.downloadArtifact(login.token, { ...h.selector, artifactId }, (value) => { expect(value.bytes).toBe(h.upload.bytes) })
}, 15000)
it('rejects traversal, altered lengths, hashes, malformed base64 and mismatched retry contents without publishing', async () => {
  const h = await fixture()
  for (const path of ['../secret', '/root/private', 'C:/secret', 'a\\b', 'a/../b', 'a//b', './a', 'a\0b']) {
    await expect(h.publish({ path })).rejects.toMatchObject({ code: 'invalid-input' })
  }
  for (const change of [{ size: 1 }, { sha256: 'a'.repeat(64) }, { bytes: h.upload.bytes + '\n' }, { size: 262145 }]) {
    await expect(h.publish(change)).rejects.toMatchObject({ code: 'invalid-input' })
  }
  expect(h.db.prepare('SELECT count(*) AS n FROM organization_artifacts').get()?.n).toBe(0)
  await h.publish()
  await expect(h.publish({ description: 'Different bytes intent' })).rejects.toMatchObject({ code: 'operation-conflict' })
}, 15000)
it('blocks unresolved actions, wrong Run artifacts, stale revisions and revoked task reads', async () => {
  const h = await fixture(), artifactId = (await h.publish()).delivery!.artifactId!
  await h.transition('running')
  await h.execute(h.action()); await h.transition('cancelled')
  await expect(h.submit(artifactId)).rejects.toMatchObject({ code: 'version-conflict' })
  await expect(h.submit(artifactId, { confirmed: false })).rejects.toMatchObject({ code: 'invalid-input' })
  await expect(h.service.deliveryCommand(h.owner.token, h.upload)).rejects.toMatchObject({ code: 'forbidden' })
  await h.service.grantTask(h.owner.token, { ...h.query, taskId: h.save.definition.taskId, membershipId: h.other.membershipId,
    scope: 'node', actions: [], expectedVersion: h.taskGrant.revision, operationId: operationId() })
  await expect(h.service.downloadArtifact(h.other.token, { ...h.selector, artifactId }, () => {})).rejects.toMatchObject({ code: 'forbidden' })
  await expect(h.publish()).rejects.toMatchObject({ code: 'forbidden' })
  await expect(h.service.readDelivery(h.other.token, h.selector, () => {})).rejects.toMatchObject({ code: 'forbidden' })
}, 15000)
it('refuses corrupted bytes on download, reference, cold startup and backup', async () => {
  const h = await fixture(), artifactId = (await h.publish()).delivery!.artifactId!
  await h.transition('cancelled')
  h.db.prepare('UPDATE organization_artifacts SET bytes=? WHERE id=?').run(Buffer.from('corrupt'), artifactId)
  await expect(h.service.downloadArtifact(h.owner.token, { ...h.selector, artifactId }, () => {})).rejects.toMatchObject({ code: 'incompatible-store' })
  await expect(h.submit(artifactId)).rejects.toMatchObject({ code: 'incompatible-store' })
  await h.close()
  expect(() => openOrganizationDatabase(h.path, 100)).toThrow()
  expect(() => backupOrganization(h.root, `${h.root}-backup`, 100)).toThrow()
}, 15000)
it('enforces deployment file and byte quotas atomically and preserves referenced evidence', async () => {
  const h = await fixture()
  await h.close()
  const cold = await openHarness(h.root, { artifactMaxFiles: 1,
    artifactMaxFileBytes: h.bytes.length, artifactMaxTotalBytes: h.bytes.length })
  cleanup.push(cold.close)
  const login = await cold.service.login({ username: 'alice', password })
  await cold.service.deliveryCommand(login.token, h.upload)
  await expect(cold.service.deliveryCommand(login.token, { ...h.upload, operationId: operationId() })).rejects.toMatchObject({ code: 'invalid-input' })
  expect(h.db.prepare('SELECT count(*) AS n FROM organization_artifacts').get()?.n).toBe(1)
}, 15000)
it('validates Git baselines and byte hashes, and migrates the delivery tables from v8', async () => {
  const h = await fixture()
  const pack = { format: 1, baseCommit: 'a'.repeat(40), baseTree: 'b'.repeat(40), patch: 'diff --git a/result.csv b/result.csv\n',
    files: [{ path: 'result.csv', operation: 'add', oldSha256: null, newSha256: h.upload.sha256, bytes: h.upload.bytes }] }
  const bytes = Buffer.from(JSON.stringify(pack))
  await h.publish({ artifactKind: 'git-change', bytes: bytes.toString('base64'), size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') })
  pack.files[0]!.path = '../escape'
  const invalid = Buffer.from(JSON.stringify(pack))
  await expect(h.publish({ operationId: operationId(), artifactKind: 'git-change', bytes: invalid.toString('base64'), size: invalid.length,
    sha256: createHash('sha256').update(invalid).digest('hex') })).rejects.toMatchObject({ code: 'invalid-input' })
  const empty = await setupExecution(cleanup); await empty.close()
  empty.db.exec('DROP TABLE planning_events; DROP TABLE planning_permits; DROP TABLE planning_grants; DROP TABLE integration_confirmations; DROP TABLE integration_events; DROP TABLE organization_integrations; DROP TABLE organization_acceptances; DROP TABLE delivery_events; DROP TABLE organization_submissions; DROP TABLE organization_artifacts; PRAGMA user_version=8')
  empty.db.exec('CREATE TABLE organization_submissions (sentinel TEXT)')
  expect(() => openOrganizationDatabase(empty.path, 100)).toThrow()
  expect(empty.db.prepare('PRAGMA user_version').get()?.user_version).toBe(8)
  expect(empty.db.prepare("SELECT name FROM sqlite_master WHERE name='organization_artifacts'").get()).toBeUndefined()
  empty.db.exec('DROP TABLE organization_submissions')
  const upgraded = openOrganizationDatabase(empty.path, 100)
  expect(upgraded.prepare('PRAGMA user_version').get()?.user_version).toBe(13)
  upgraded.close()
}, 15000)

it('refuses cross-Run evidence and old-version submissions while preserving historical downloads', async () => {
  const h = await fixture(), artifactId = (await h.publish()).delivery!.artifactId!
  await h.transition('cancelled')
  const next = await h.execute({ ...h.create, operationId: operationId() })
  const runId = next.execution!.runId!
  await h.execute({ ...h.run, runId, kind: 'transition-run', state: 'cancelled', operationId: operationId() })
  await expect(h.submit(artifactId, { runId })).rejects.toMatchObject({ code: 'forbidden' })
  await h.service.savePlan(h.owner.token, { ...h.save, operationId: operationId(), expectedRevision: 1 })
  await expect(h.submit(artifactId)).rejects.toMatchObject({ code: 'version-conflict' })
  await h.service.downloadArtifact(h.owner.token, { ...h.selector, artifactId }, (value) => { expect(value.artifact.planRevision).toBe(1) })
}, 15000)

it('rejects missing referenced evidence at startup and rolls back a submission when its audit insert fails', async () => {
  const h = await fixture(), artifactId = (await h.publish()).delivery!.artifactId!
  await h.transition('cancelled')
  h.db.exec("CREATE TRIGGER fail_delivery BEFORE INSERT ON delivery_events WHEN json_extract(NEW.result,'$.submissionId') IS NOT NULL BEGIN SELECT RAISE(ABORT,'fault'); END")
  await expect(h.submit(artifactId)).rejects.toThrow('fault')
  expect(h.db.prepare('SELECT count(*) AS n FROM organization_submissions').get()?.n).toBe(0)
  h.db.exec('DROP TRIGGER fail_delivery')
  await h.submit(artifactId)
  h.db.prepare('DELETE FROM organization_artifacts WHERE id=?').run(artifactId)
  await h.close()
  expect(() => openOrganizationDatabase(h.path, 100)).toThrow()
}, 15000)
