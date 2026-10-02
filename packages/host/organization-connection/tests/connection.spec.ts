/** Real shipped organization YAML, SQLite, TLS and independent native clients; no renderer. */
import { afterEach, expect, it, vi } from 'vitest'
import { z } from 'zod'
import * as fs from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { createCipheriv, createDecipheriv, createHash, generateKeyPairSync, sign } from 'node:crypto'
import { deviceChallengeText } from '@deepseek-ai/dsh-organization'
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID, randomBytes } from 'node:crypto'
import { bootOrganization } from '../../../../apps/desktop-host/src/organization-boot.ts'
import { OrganizationConnection } from '../src/index.ts'
import { backupOrganization, restoreOrganization } from '@deepseek-ai/dsh-organization/maintenance'
import * as transport from '@deepseek-ai/dsh-organization-api/transport'
import { organizationRequest } from '@deepseek-ai/dsh-organization-api/transport'
import type { LoginResult } from '@deepseek-ai/dsh-organization/types'

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return { ...actual, renameSync: vi.fn(actual.renameSync) }
})

const cleanup: (() => unknown)[] = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })
const password = 'eight123'
const token = () => randomBytes(32).toString('base64url')
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'org-connection-'))
  cleanup.push(() => rm(root, { recursive: true, force: true }))
  const directory = join(root, 'service')
  const config = { api: { directory, host: '127.0.0.1', port: 0, names: ['127.0.0.1'], eventPollMs: 20 } }
  const app = await bootOrganization(config)
  cleanup.push(app.close)
  const initialized = await app.authority.initialize({ operationId: randomUUID(),
    username: 'owner', password,
    organizationName: 'Alpha',
    recoveryToken: token() })
  let clientNumber = 0
  const connect = async () => {
    const connection = new OrganizationConnection({ reconnectMs: 100, trustPath: join(root, `client-${clientNumber++}.json`) })
    cleanup.push(() => connection.close())
    await connection.perform({ kind: 'probe', origin: `  127.0.0.1:${app.ready.port}  ` })
    expect(connection.snapshot().origin).toBe(`https://127.0.0.1:${app.ready.port}`)
    expect(connection.snapshot().phase).toBe('untrusted')
    await connection.perform({ kind: 'trust', fingerprint: app.ready.fingerprint })
    return connection
  }
  const owner = await connect()
  await owner.perform({ kind: 'login', username: 'owner', password })
  await owner.perform({ kind: 'select', organizationId: initialized.organizationId! })
  return { root, directory, config, app, owner, initialized, connect }
}

it('isolates two real identities, filters search/counts, clears revoked views and preserves personal files', async () => {
  const h = await setup()
  for (const machine of ['B', 'C']) {
    await mkdir(join(h.root, machine))
    await writeFile(join(h.root, machine, 'personal.json'), `private-${machine}-sentinel`)
  }
  const invitation = await h.owner.perform({ kind: 'invite', role: 'member' })
  const member = await h.connect()
  await expect(member.perform({ kind: 'register',
    username: 'alice', password,
    invitationToken: token() })).rejects.toThrow('invalid-invitation')
  await member.perform({ kind: 'register', username: 'alice', password, invitationToken: invitation.invitationToken! })
  expect(member.snapshot()).toMatchObject({ phase: 'ready', username: 'alice' })
  expect(member.snapshot().organizations).toHaveLength(1)
  await expect(member.perform({ kind: 'login', username: 'alice', password: 'wrong password' })).rejects.toThrow('invalid-credentials')
  await member.perform({ kind: 'login', username: 'alice', password })
  await member.perform({ kind: 'select', organizationId: h.initialized.organizationId! })
  await expect.poll(() => h.owner.snapshot().phase).toBe('ready')
  const project = (await h.owner.perform({ kind: 'command',
    command: { kind: 'create-project',
      operationId: randomUUID(),
      organizationId: h.initialized.organizationId,
      name: 'Granted project' } })).receipt!
  expect(h.owner.snapshot().projects?.total).toBe(1)
  const members = await h.app.authority.members((await h.app.authority.login({ username: 'owner', password })).token, h.initialized.organizationId!)
  const alice = members.find(item => item.username === 'alice')!
  const grant = (await h.owner.perform({ kind: 'command',
    command: { kind: 'set-grant',
      operationId: randomUUID(),
      organizationId: h.initialized.organizationId,
      projectId: project.projectId,
      membershipId: alice.id,
      expectedVersion: 0,
      actions: ['read'] } })).receipt!
  await expect.poll(() => member.snapshot().projects?.total).toBe(1)
  expect(JSON.stringify(member.snapshot())).not.toContain('token')
  await member.perform({ kind: 'search', query: 'private-B-sentinel', offset: 0 })
  expect(member.snapshot().projects?.total).toBe(0)
  await member.perform({ kind: 'reconnect' })
  await h.owner.perform({ kind: 'command',
    command: { kind: 'set-grant',
      operationId: randomUUID(),
      organizationId: h.initialized.organizationId,
      projectId: project.projectId,
      membershipId: alice.id,
      expectedVersion: grant.revision,
      actions: [] } })
  await expect.poll(() => member.snapshot().projects?.total).toBe(0)
  const selecting = member.perform({ kind: 'select', organizationId: h.initialized.organizationId! }).catch(() => {})
  await member.perform({ kind: 'personal' }); await selecting
  expect(member.snapshot().mode).toBe('personal')
  expect(member.snapshot().projects).toBeUndefined()
  await expect(member.perform({ kind: 'select',
    organizationId: randomUUID() as typeof h.initialized.organizationId & string })).rejects.toThrow('forbidden')
  for (const machine of ['B', 'C']) expect(await readFile(join(h.root, machine, 'personal.json'), 'utf8')).toBe(`private-${machine}-sentinel`)
}, 30000)

it('locks live directories, validates backups before replacing data and revokes restored login tokens', async () => {
  const h = await setup()
  const login = await h.app.authority.login({ username: 'owner', password })
  await expect(bootOrganization(h.config)).rejects.toThrow('organization-directory-in-use')
  expect(() => backupOrganization(h.directory, join(h.root, 'backup'), 5000)).toThrow('organization-directory-in-use')
  await h.app.close()
  await expect.poll(() => h.owner.snapshot().phase).toBe('offline')
  expect(h.owner.snapshot().projects).toBeUndefined()
  await expect(h.owner.perform({ kind: 'invite', role: 'member' })).rejects.toThrow('unavailable')
  await h.owner.close()
  const backup = backupOrganization(h.directory, join(h.root, 'backup'), 5000)
  expect((await readdir(backup)).sort()).toEqual(['manifest.json', 'organization.sqlite', 'tls-identity.json'])
  const original = await readFile(join(h.directory, 'organization.sqlite'))
  const manifest = await readFile(join(backup, 'manifest.json'), 'utf8')
  await writeFile(join(backup, 'manifest.json'), manifest.replace('"format":1', '"format":999'))
  expect(() => restoreOrganization(backup, h.directory, 5000)).toThrow()
  expect(await readFile(join(h.directory, 'organization.sqlite'))).toEqual(original)
  await writeFile(join(backup, 'manifest.json'), manifest)
  const restored = restoreOrganization(backup, h.directory, 5000)
  expect(await readFile(join(restored.previous, 'organization.sqlite'))).toEqual(original)
  const app = await bootOrganization(h.config)
  cleanup.push(app.close)
  await expect(app.authority.authenticate(login.token)).rejects.toThrow('unauthenticated')
  await expect(app.authority.login({ username: 'owner', password })).resolves.toBeDefined()
  await app.authority.recover({ operationId: randomUUID(),
    recoveryToken: restored.recoveryToken,
    newRecoveryToken: token(),
    newPassword: password })
  const trust = { ...app.ready, origin: `https://127.0.0.1:${app.ready.port}`, timeoutMs: 5000, maxResponseBytes: 1048576 }
  const nativeLogin = (await organizationRequest(trust, 'POST', '/organization/v1/login', { username: 'owner', password })).body as LoginResult
  expect((await organizationRequest(trust, 'GET', `/organization/v1/receipts/${randomUUID()}`, undefined, nativeLogin.token)).body).toBeNull()
}, 30000)


it('resolves a response lost after commit from the durable receipt after restarting the native client', async () => {
  const h = await setup()
  const original = transport.organizationRequest
  const lost = vi.spyOn(transport, 'organizationRequest').mockImplementationOnce(async (...args) => {
    const result = await original(...args)
    expect(result.status).toBe(200)
    throw new Error('response-lost')
  })
  const operationId = randomUUID()
  try {
    await expect(h.owner.perform({ kind: 'command', command: { kind: 'create-project', operationId,
      organizationId: h.initialized.organizationId, name: 'Committed exactly once' } })).rejects.toThrow('unavailable')
  } finally { lost.mockRestore() }
  expect(h.owner.snapshot().pendingOperation).toBe(operationId)
  await h.owner.close()
  const journal = await readFile(join(h.root, 'client-0.json.pending'), 'utf8')
  expect(journal).toContain(operationId)
  expect(journal).not.toContain(password)
  expect(journal).not.toContain('Committed exactly once')
  const reopened = new OrganizationConnection({ trustPath: join(h.root, 'client-0.json') })
  cleanup.push(() => reopened.close())
  expect(reopened.snapshot().phase).toBe('signed-out')
  await reopened.perform({ kind: 'login', username: 'owner', password })
  expect(reopened.snapshot().pendingOperation).toBe(operationId)
  const receipt = (await reopened.perform({ kind: 'reconcile' })).receipt
  expect(receipt?.operationId).toBe(operationId)
  expect(reopened.snapshot().pendingOperation).toBeUndefined()
  const login = await h.app.authority.login({ username: 'owner', password })
  expect(await h.app.authority.receipt(login.token, operationId)).toEqual(receipt)
}, 30000)

it('drops a delayed snapshot after a personal-mode switch even if the network ignores cancellation', async () => {
  const h = await setup()
  const original = transport.organizationRequest
  let release!: () => void
  let arrived!: () => void
  const waiting = new Promise<void>((resolve) => { arrived = resolve })
  const barrier = new Promise<void>((resolve) => { release = resolve })
  const delayed = vi.spyOn(transport, 'organizationRequest').mockImplementationOnce(async (...args) => {
    const result = await original(...args)
    arrived(); await barrier
    return result
  })
  try {
    const pending = h.owner.perform({ kind: 'reconnect' }).catch((error: unknown) => error)
    await waiting
    await h.owner.perform({ kind: 'personal' })
    release(); await pending
    expect(h.owner.snapshot().mode).toBe('personal')
    expect(h.owner.snapshot().projects).toBeUndefined()
    expect(h.owner.snapshot().organizationId).toBeUndefined()
  } finally { release(); delayed.mockRestore() }
}, 30000)


it('preserves the current directory when validation or the final restore rename fails', async () => {
  const h = await setup()
  await h.owner.close(); await h.app.close()
  const backup = backupOrganization(h.directory, join(h.root, 'backup-failures'), 5000)
  const original = await readFile(join(h.directory, 'organization.sqlite'))
  const originalRename = (await vi.importActual<typeof import('node:fs')>('node:fs')).renameSync
  const renameFailure = vi.spyOn(fs, 'renameSync').mockImplementation((source, target) => {
    if (String(source).includes('.restore-') && target === h.directory) throw new Error('injected-rename-failure')
    originalRename(source, target)
  })
  try { expect(() => restoreOrganization(backup, h.directory, 5000)).toThrow('injected-rename-failure') }
  finally { renameFailure.mockRestore() }
  expect(await readFile(join(h.directory, 'organization.sqlite'))).toEqual(original)
  const manifestPath = join(backup, 'manifest.json')
  const manifest = await readFile(manifestPath, 'utf8')
  const invalid = Buffer.from('not a sqlite database')
  await writeFile(join(backup, 'organization.sqlite'), invalid)
  const changed = manifest.replace(/"organization.sqlite":"[^"]+"/, `"organization.sqlite":"${createHash('sha256').update(invalid).digest('hex')}"`)
  await writeFile(manifestPath, changed)
  expect(() => restoreOrganization(backup, h.directory, 5000)).toThrow()
  expect(await readFile(join(h.directory, 'organization.sqlite'))).toEqual(original)
}, 30000)

it.each(['pending', 'held'])('preserves WorkGraph history and permanently retires %s assignments through backup restore', async (state) => {
  const h = await setup()
  const login = await h.app.authority.login({ username: 'owner', password })
  const organizationId = h.initialized.organizationId!
  const project = await h.app.authority.projectCommand(login.token, { kind: 'create-project', operationId: randomUUID(), organizationId, name: 'Backup plan' })
  await h.app.authority.grant(login.token, { kind: 'set-grant', operationId: randomUUID(), organizationId, projectId: project.projectId,
    membershipId: h.initialized.membershipId, expectedVersion: project.revision, actions: ['read', 'write'] })
  const planId = randomUUID(), taskId = randomUUID(), phaseId = randomUUID()
  const request = { organizationId, projectId: project.projectId, planId, operationId: randomUUID(), expectedRevision: 0,
    definition: { taskId, phases: [{ id: phaseId, title: 'Plan' }], tasks: [{ id: taskId, phaseId, parentTaskId: null,
      goal: 'Persistent work', scope: 'Text', acceptance: ['Readable after restore'], artifacts: [], required: true, dependsOn: [], suggestedMembershipId: null }] } }
  await h.app.authority.savePlan(login.token, request)
  await h.app.authority.savePlan(login.token, { ...request, operationId: randomUUID(), expectedRevision: 1 })
  const approvalOperation = randomUUID()
  const assignment = await h.app.authority.assignmentCommand(login.token, { kind: 'approve-assignment',
    organizationId, projectId: project.projectId, planId, taskId, planRevision: 2,
    assigneeId: h.initialized.membershipId, operationId: approvalOperation })
  if (state === 'held') {
    const selector = { organizationId, projectId: project.projectId, planId, assignmentId: assignment.assignmentId }
    let requestId = ''
    await h.app.authority.readInbox(login.token, { organizationId }, (page) => { requestId = page.items[0]!.request.id })
    const accepted = await h.app.authority.participantCommand(login.token, { ...selector, kind: 'answer-assignment',
      operationId: randomUUID(), requestId, answer: 'accepted', expectedVersion: assignment.revision })
    const pair = generateKeyPairSync('ed25519')
    const registration = { kind: 'register-device', organizationId, operationId: randomUUID(), name: 'Backup device', keyGeneration: 1,
      publicKey: pair.publicKey.export({ format: 'der', type: 'spki' }).toString('base64') }
    const write = async (command: unknown) => {
      const challenge = await h.app.authority.deviceChallenge(login.token, command)
      return h.app.authority.deviceCommand(login.token, command, { challengeId: challenge.challengeId,
        signature: sign(null, Buffer.from(deviceChallengeText(challenge)), pair.privateKey).toString('base64url') })
    }
    const device = await write(registration)
    const delegation = await h.app.authority.participantCommand(login.token, { ...selector, kind: 'delegate', operationId: randomUUID(),
      expectedVersion: accepted.revision, deviceId: device.deviceId, executorId: 'desktop-builtin', capabilities: ['draft'], budget: 1,
      expiresAt: Date.now() + 60000 })
    await write({ ...selector, kind: 'claim', operationId: randomUUID(), deviceId: device.deviceId, delegationId: delegation.delegationId })
  }
  await h.owner.close()
  await h.app.close()
  const backup = backupOrganization(h.directory, join(h.root, 'workgraph-backup'), 5000)
  expect(JSON.parse(await readFile(join(backup, 'manifest.json'), 'utf8'))).toMatchObject({ schema: 14 })
  restoreOrganization(backup, h.directory, 5000)
  const restored = await bootOrganization(h.config)
  cleanup.push(restored.close)
  const current = await restored.authority.login({ username: 'owner', password })
  const query = { organizationId, projectId: project.projectId, planId }
  for (const revision of [1, 2]) {
    await restored.authority.readPlan(current.token, { ...query, revision }, (value) => {
      expect(value.revision).toBe(revision)
      expect(value.definition).toEqual(request.definition)
    })
  }
  await restored.authority.readAssignment(current.token, { ...query, assignmentId: assignment.assignmentId }, (value) => {
    expect(value).toMatchObject({ state: 'invalidated', reason: 'restored', planRevision: 2 })
  })
  expect(await restored.authority.receipt(current.token, approvalOperation)).toBeNull()
  const restoredDb = new DatabaseSync(join(h.directory, 'organization.sqlite'), { readOnly: true })
  try {
    expect(restoredDb.prepare('SELECT state FROM assignment_requests').get()?.state).toBe(state === 'held' ? 'accepted' : 'cancelled')
    expect(restoredDb.prepare('SELECT count(*) AS n FROM assignment_notifications').get()?.n).toBe(1)
    if (state === 'held') {
      expect(restoredDb.prepare('SELECT state FROM organization_devices').get()?.state).toBe('revoked')
      expect(restoredDb.prepare('SELECT state FROM assignment_delegations').get()?.state).toBe('invalidated')
      expect(restoredDb.prepare('SELECT state FROM assignment_leases').get()?.state).toBe('invalidated')
    }
  } finally { restoredDb.close() }
  await expect(restored.authority.readPlan(login.token, query, () => { throw new Error('old login') })).rejects.toMatchObject({ code: 'unauthenticated' })
})


it.each([2, 3])('restores a schema v%s backup by upgrading staging and retaining project grants', async (schema) => {
  const h = await setup()
  const login = await h.app.authority.login({ username: 'owner', password })
  const organizationId = h.initialized.organizationId!
  const project = await h.app.authority.projectCommand(login.token, { kind: 'create-project', operationId: randomUUID(), organizationId, name: 'Legacy project' })
  await h.app.authority.grant(login.token, { kind: 'set-grant', operationId: randomUUID(), organizationId, projectId: project.projectId,
    membershipId: h.initialized.membershipId, expectedVersion: project.revision, actions: ['read'] })
  await h.owner.close(); await h.app.close()
  const backup = backupOrganization(h.directory, join(h.root, 'legacy-backup'), 5000)
  const db = new DatabaseSync(join(backup, 'organization.sqlite'))
  try {
    db.exec('DROP TABLE planning_goals; DROP TABLE planning_reapprovals; DROP TABLE planning_events; DROP TABLE planning_permits; DROP TABLE planning_grants; DROP TABLE integration_confirmations; DROP TABLE integration_events; DROP TABLE organization_integrations; DROP TABLE organization_acceptances; DROP TABLE delivery_events; DROP TABLE organization_submissions; DROP TABLE organization_artifacts; DROP TABLE execution_human_requests; DROP TABLE execution_events; DROP TABLE execution_actions; DROP TABLE execution_runs; DROP TABLE execution_delegations; DROP TABLE device_actions; DROP TABLE assignment_leases; DROP TABLE organization_devices; DROP TABLE assignment_actions; DROP TABLE assignment_delegations; DROP TABLE assignment_notifications; DROP TABLE assignment_requests; DROP TABLE task_assignments')
    if (schema === 2) db.exec('DROP TABLE task_grants; DROP TABLE plan_tasks; DROP TABLE workgraph_events; DROP TABLE plan_revisions; DROP TABLE organization_plans')
    db.exec(`PRAGMA user_version=${schema}`)
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
  } finally { db.close() }
  const hashes = {
    'organization.sqlite': createHash('sha256').update(await readFile(join(backup, 'organization.sqlite'))).digest('hex'),
    'tls-identity.json': createHash('sha256').update(await readFile(join(backup, 'tls-identity.json'))).digest('hex'),
  }
  await writeFile(join(backup, 'manifest.json'), JSON.stringify({ format: 1, schema: 4, hashes }))
  expect(() => restoreOrganization(backup, h.directory, 5000)).toThrow('invalid-backup-schema')
  await writeFile(join(backup, 'manifest.json'), JSON.stringify({ format: 1, schema, hashes }))
  restoreOrganization(backup, h.directory, 5000)
  const restored = await bootOrganization(h.config)
  cleanup.push(restored.close)
  const current = await restored.authority.login({ username: 'owner', password })
  await restored.authority.readProject(current.token, { organizationId, projectId: project.projectId }, (value) => {
    expect(value.name).toBe('Legacy project')
  })
})

it('reports invalid addresses and clears the previous error when probing again', async () => {
  const h = await setup()
  await expect(h.owner.perform({ kind: 'probe', origin: 'https://' })).rejects.toThrow('invalid-origin')
  expect(h.owner.snapshot().error).toBe('invalid-origin')
  await h.owner.perform({ kind: 'probe', origin: `127.0.0.1:${h.app.ready.port}` })
  expect(h.owner.snapshot().error).toBeUndefined()
  expect(h.owner.snapshot().offer?.fingerprint).toBe(h.app.ready.fingerprint)
})

function loginVault() {
  // Only the OS credential vault is substituted; transport and authority remain real.
  const key = randomBytes(32)
  return {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => 'test-os-vault',
    encryptString(text: string) {
      const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv)
      const bytes = Buffer.concat([cipher.update(text), cipher.final()])
      return Buffer.concat([iv, cipher.getAuthTag(), bytes])
    },
    decryptString(bytes: Buffer) {
      const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12))
      decipher.setAuthTag(bytes.subarray(12, 28))
      return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8')
    },
  }
}
async function persistentLogin() {
  const h = await setup(), vault = loginVault(), trustPath = join(h.root, 'saved-trust.json')
  const reopen = () => {
    const client = new OrganizationConnection({ trustPath, reconnectMs: 100 }, { directory: join(h.root, 'devices'), vault })
    cleanup.push(() => client.close())
    return client
  }
  const client = reopen()
  await client.perform({ kind: 'probe', origin: `https://127.0.0.1:${h.app.ready.port}` })
  await client.perform({ kind: 'trust', fingerprint: h.app.ready.fingerprint })
  await client.perform({ kind: 'login', username: 'owner', password })
  return { ...h, client, reopen, vault, path: `${trustPath}.login` }
}
it('restores encrypted login after native restart and removes it on explicit logout', async () => {
  const h = await persistentLogin()
  const encrypted = await readFile(h.path)
  expect(encrypted.toString()).not.toContain(password)
  expect(encrypted.toString()).not.toContain('token')
  await h.client.close()
  const next = h.reopen()
  expect(next.snapshot().phase).toBe('signed-out')
  await next.restoreLogin()
  expect(next.snapshot()).toMatchObject({ phase: 'ready', username: 'owner' })
  expect(next.snapshot().organizations).toHaveLength(1)
  expect(JSON.stringify(next.snapshot())).not.toContain('token')
  await next.perform({ kind: 'logout' })
  expect(fs.existsSync(h.path)).toBe(false)
  const last = h.reopen()
  await last.restoreLogin()
  expect(last.snapshot().phase).toBe('signed-out')
})
it('rejects revoked sessions on restart and clears saved credentials', async () => {
  const h = await persistentLogin()
  const saved = JSON.parse(h.vault.decryptString(await readFile(h.path))) as LoginResult
  await h.client.close()
  await h.app.authority.logout(saved.token)
  const next = h.reopen()
  await next.restoreLogin()
  expect(next.snapshot().phase).toBe('signed-out')
  expect(next.snapshot().principal).toBeUndefined()
  expect(fs.existsSync(h.path)).toBe(false)
})
it('expires a restored login while idle without extending its deadline', async () => {
  const h = await persistentLogin()
  await h.client.close()
  const saved = JSON.parse(h.vault.decryptString(await readFile(h.path))) as LoginResult
  saved.expiresAt = Date.now() + 500
  await writeFile(h.path, h.vault.encryptString(JSON.stringify(saved)))
  const next = h.reopen()
  await next.restoreLogin()
  expect(next.snapshot().phase).toBe('ready')
  await expect.poll(() => next.snapshot().phase).toBe('signed-out')
  expect(fs.existsSync(h.path)).toBe(false)
  expect(next.snapshot().organizations).toEqual([])
})
it('rejects expired or differently scoped saved logins before restoring private facts', async () => {
  const h = await persistentLogin()
  await h.client.close()
  const saved = z.record(z.string(), z.unknown()).parse(JSON.parse(h.vault.decryptString(await readFile(h.path))))
  for (const patch of [{ expiresAt: Date.now() - 1 }, { fingerprint: 'different-certificate' }, { origin: 'https://other.invalid' }]) {
    await writeFile(h.path, h.vault.encryptString(JSON.stringify({ ...saved, ...patch })))
    const next = h.reopen()
    await next.restoreLogin()
    expect(next.snapshot().phase).toBe('signed-out')
    expect(next.snapshot().principal).toBeUndefined()
    expect(fs.existsSync(h.path)).toBe(false)
  }
})

it('retries saved login after temporary network failure and discards a restore superseded by logout', async () => {
  const h = await persistentLogin()
  await h.client.close()
  const next = h.reopen()
  const request = vi.spyOn(transport, 'organizationRequest').mockRejectedValueOnce(new Error('offline'))
  try { await next.restoreLogin() } finally { request.mockRestore() }
  expect(next.snapshot().phase).toBe('offline')
  expect(fs.existsSync(h.path)).toBe(true)
  await expect.poll(() => next.snapshot().phase).toBe('ready')
  await next.close()
  const last = h.reopen()
  const restoring = last.restoreLogin()
  await last.perform({ kind: 'logout' })
  await restoring
  expect(last.snapshot().phase).toBe('signed-out')
  expect(last.snapshot().principal).toBeUndefined()
  expect(fs.existsSync(h.path)).toBe(false)
})
it('uses only in-memory login when secure OS encryption is unavailable', async () => {
  const h = await persistentLogin()
  await h.client.perform({ kind: 'logout' })
  h.vault.isEncryptionAvailable = () => false
  await h.client.perform({ kind: 'login', username: 'owner', password })
  expect(h.client.snapshot().phase).toBe('ready')
  expect(fs.existsSync(h.path)).toBe(false)
  await h.client.close()
  const next = h.reopen()
  await next.restoreLogin()
  expect(next.snapshot().phase).toBe('signed-out')
})
