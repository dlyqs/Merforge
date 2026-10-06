/** Real persistence and authorization regressions through the Loader-created authority. */
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import { createOrganizationToken, type LoginToken, type OrganizationId } from '../src/index.ts'
import { openOrganizationDatabase, transaction, ORGANIZATION_SCHEMA_VERSION } from '../src/database.ts'
import { addMember, initialize, invite, openHarness, operationId, password } from './harness.ts'

const roots: string[] = []
const harnesses: Awaited<ReturnType<typeof openHarness>>[] = []
async function harness(config: Parameters<typeof openHarness>[1] = {}) {
  const root = await mkdtemp(join(tmpdir(), 'merforge-organization-'))
  roots.push(root)
  const result = await openHarness(root, config)
  harnesses.push(result)
  return { ...result, root }
}
async function reopen(root: string, config: Parameters<typeof openHarness>[1] = {}) {
  const result = await openHarness(root, config)
  harnesses.push(result)
  return result
}
function inspect<T>(path: string, read: (db: DatabaseSync) => T): T {
  const db = new DatabaseSync(path)
  try { return read(db) } finally { db.close() }
}
async function denial(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toMatchObject({ code })
}

afterEach(async () => {
  vi.restoreAllMocks()
  for (const h of harnesses.splice(0)) await h.close()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

describe('organization identity authority', () => {
  it('loads without personal services, initializes once across competing writers and reopens durable receipts', async () => {
    const h = await harness()
    const other = await reopen(h.root)
    const request = { operationId: operationId(), username: 'owner', password, organizationName: 'Alpha', recoveryToken: createOrganizationToken() }
    const [one, two] = await Promise.all([h.service.initialize(request), other.service.initialize(request)])
    expect(one).toEqual(two)
    await denial(h.service.initialize({ ...request, operationId: operationId() }), 'already-initialized')
    await denial(h.service.initialize({ ...request, password: 'different password' }), 'operation-conflict')
    expect(h.ctx.get('sessions')).toBeUndefined()
    expect(h.ctx.get('storage')).toBeUndefined()
    expect(h.ctx.get('connection')).toBeUndefined()
    const login = await h.service.login({ username: 'OWNER', password })
    expect(login.principal.accountId).toBe(one.accountId)
    expect(inspect(h.path, db => db.prepare('SELECT count(*) AS n FROM accounts').get()?.n)).toBe(1)
    await other.close()
    await h.close()
    const opened = await reopen(h.root)
    expect(await opened.service.initialize(request)).toEqual(one)
    expect(await opened.service.authenticate(login.token)).toEqual(login.principal)
    expect(await opened.service.organizations(login.token)).toMatchObject([{ name: 'Alpha', role: 'admin' }])
    if (process.platform !== 'win32') expect((await stat(h.path)).mode & 0o777).toBe(0o600)
  })

  it('allows exactly one concurrent invitation consumer and rejects expiry, reuse and duplicate usernames', async () => {
    const h = await harness({ invitationTtlMs: 10000 })
    const owner = await initialize(h.service)
    const invitation = await invite(h.service, owner.token, owner.organizationId)
    expect(await h.service.execute(owner.token, invitation.input)).toEqual(invitation.receipt)
    const other = await reopen(h.root)
    const input = { operationId: operationId(), username: 'alice', password, invitationToken: invitation.invitationToken }
    const attempts = await Promise.allSettled([h.service.register(input), other.service.register({ ...input, operationId: operationId(), username: 'bob' })])
    expect(attempts.filter(item => item.status === 'fulfilled')).toHaveLength(1)
    expect(attempts.find(item => item.status === 'rejected')).toMatchObject({ reason: { code: 'invalid-invitation' } })
    const rows = inspect(h.path, db => db.prepare('SELECT username FROM accounts ORDER BY username').all())
    expect(rows).toHaveLength(2)
    const name = rows.find(row => row.username !== 'owner')?.username
    const second = await invite(h.service, owner.token, owner.organizationId)
    await denial(h.service.register({ ...input, operationId: operationId(), invitationToken: second.invitationToken, username: name }), 'username-taken')
    expect(inspect(h.path, db => db.prepare('SELECT consumed FROM invitations WHERE id=?').get(second.receipt.invitationId!)?.consumed)).toBe(0)
    const now = Date.now()
    vi.spyOn(Date, 'now').mockReturnValue(now + 11000)
    await denial(h.service.register({ ...input, operationId: operationId(), invitationToken: second.invitationToken, username: 'carol' }), 'invalid-invitation')
  })

  it('rolls back account, invitation, event and receipt together when a real SQLite write fails', async () => {
    const h = await harness()
    const owner = await initialize(h.service)
    const invitation = await invite(h.service, owner.token, owner.organizationId)
    const input = { operationId: operationId(), invitationToken: invitation.invitationToken, username: 'alice', password }
    const before = inspect(h.path, db => db.prepare('SELECT count(*) AS n FROM organization_events').get()?.n)
    inspect(h.path, (db) =>{  db.exec("CREATE TRIGGER reject_receipt BEFORE INSERT ON operation_receipts BEGIN SELECT RAISE(ABORT, 'simulated write failure'); END") })
    await expect(h.service.register(input)).rejects.toThrow('simulated write failure')
    inspect(h.path, (db) => {
      expect(db.prepare("SELECT * FROM accounts WHERE username='alice'").get()).toBeUndefined()
      expect(db.prepare('SELECT consumed FROM invitations WHERE id=?').get(invitation.receipt.invitationId!)?.consumed).toBe(0)
      expect(db.prepare('SELECT count(*) AS n FROM organization_events').get()?.n).toBe(before)
      expect(db.prepare('SELECT * FROM operation_receipts WHERE operationId=?').get(input.operationId)).toBeUndefined()
      db.exec('DROP TRIGGER reject_receipt')
    })
    const committed = await h.service.register(input)
    await h.close()
    const opened = await reopen(h.root)
    expect(await opened.service.register(input)).toEqual(committed)
    inspect(h.path, (db) => {
      expect(db.prepare('SELECT * FROM organization_events WHERE revision=?').get(committed.revision)?.kind).toBe('register')
      expect(db.prepare('SELECT count(*) AS n FROM memberships WHERE accountId=?').get(committed.accountId!)?.n).toBe(1)
    })
  })

  it('does not publish permission changes when receipt persistence fails', async () => {
    const h = await harness()
    const owner = await initialize(h.service)
    const alice = await addMember(h.service, owner.token, owner.organizationId)
    const input = { kind: 'set-membership', operationId: operationId(), organizationId: owner.organizationId,
      membershipId: alice.membershipId, expectedVersion: alice.revision, enabled: false, role: 'member' }
    const before = inspect(h.path, db => db.prepare('SELECT count(*) AS n FROM organization_events').get()?.n)
    inspect(h.path, (db) =>{  db.exec("CREATE TRIGGER reject_receipt BEFORE INSERT ON operation_receipts BEGIN SELECT RAISE(ABORT, 'permission write failure'); END") })
    await expect(h.service.execute(owner.token, input)).rejects.toThrow('permission write failure')
    expect((await h.service.authenticate(alice.token, owner.organizationId)).accountId).toBe(alice.accountId)
    expect(inspect(h.path, db => db.prepare('SELECT count(*) AS n FROM organization_events').get()?.n)).toBe(before)
    inspect(h.path, (db) =>{  db.exec('DROP TRIGGER reject_receipt') })
    const receipt = await h.service.execute(owner.token, input)
    await h.close()
    const opened = await reopen(h.root)
    expect(await opened.service.execute(owner.token, input)).toEqual(receipt)
    await denial(opened.service.authenticate(alice.token, owner.organizationId), 'forbidden')
  })

  it('verifies real salted passwords, persists rate windows and expires or revokes login tokens', async () => {
    const h = await harness({ loginMaxAttempts: 2, loginGlobalMaxAttempts: 5, loginWindowMs: 10000, loginTtlMs: 10000 })
    const owner = await initialize(h.service)
    await denial(h.service.login({ username: 'owner', password: 'incorrect password' }), 'invalid-credentials')
    await h.close()
    const reopened = await reopen(h.root, { loginMaxAttempts: 2, loginGlobalMaxAttempts: 5, loginWindowMs: 10000, loginTtlMs: 10000 })
    await denial(reopened.service.login({ username: 'owner', password }), 'rate-limited')
    const now = Date.now()
    vi.spyOn(Date, 'now').mockReturnValue(now + 11000)
    await denial(reopened.service.authenticate(owner.token), 'unauthenticated')
    const login = await reopened.service.login({ username: 'owner', password })
    await reopened.service.logout(login.token)
    await reopened.service.logout(login.token)
    await denial(reopened.service.authenticate(login.token), 'unauthenticated')
    await denial(reopened.service.authenticate(brandString<LoginToken>(createOrganizationToken())), 'unauthenticated')
    const raw = await readFile(h.path)
    expect(raw.includes(Buffer.from(password))).toBe(false)
    inspect(h.path, (db) => {
      const hash = db.prepare('SELECT passwordHash FROM accounts').get()?.passwordHash
      expect(hash).toMatch(/^scrypt-v1\$/)
      expect(JSON.stringify(db.prepare('SELECT * FROM operation_receipts').all())).not.toContain(password)
    })
  })

  it('bounds attempts across random usernames as well as one username', async () => {
    const h = await harness({ loginGlobalMaxAttempts: 3 })
    await initialize(h.service)
    await denial(h.service.login({ username: 'nobody', password }), 'invalid-credentials')
    await denial(h.service.login({ username: 'another', password }), 'invalid-credentials')
    await denial(h.service.login({ username: 'third', password }), 'rate-limited')
  })

  it('separates memberships from account disabling and denies cross-organization or member administration', async () => {
    const h = await harness()
    const owner = await initialize(h.service)
    const alice = await addMember(h.service, owner.token, owner.organizationId)
    const second = await h.service.execute(owner.token, { kind: 'create-organization', operationId: operationId(), name: 'Beta' })
    const beta = second.organizationId!
    await denial(h.service.authenticate(alice.token, beta), 'forbidden')
    await denial(h.service.members(alice.token, owner.organizationId), 'forbidden')
    await denial(h.service.execute(alice.token, { kind: 'invite', operationId: operationId(), organizationId: owner.organizationId, role: 'admin', invitationToken: createOrganizationToken() }), 'forbidden')
    await denial(h.service.execute(alice.token, { kind: 'set-account', operationId: operationId(), accountId: owner.accountId, expectedVersion: owner.revision, enabled: false }), 'forbidden')
    const invitation = await invite(h.service, owner.token, beta)
    await h.service.execute(alice.token, { kind: 'accept-invitation', operationId: operationId(), invitationToken: invitation.invitationToken })
    expect(await h.service.organizations(alice.token)).toHaveLength(2)
    const member = (await h.service.members(owner.token, owner.organizationId)).find(item => item.accountId === alice.accountId)!
    const disable = { kind: 'set-membership', operationId: operationId(), organizationId: owner.organizationId, membershipId: member.id, expectedVersion: member.version, enabled: false, role: 'member' }
    await denial(h.service.execute(owner.token, { ...disable, organizationId: beta }), 'forbidden')
    await denial(h.service.execute(owner.token, { ...disable, expectedVersion: 0 }), 'version-conflict')
    const receipt = await h.service.execute(owner.token, disable)
    expect(await h.service.execute(owner.token, disable)).toEqual(receipt)
    await denial(h.service.authenticate(alice.token, owner.organizationId), 'forbidden')
    expect((await h.service.authenticate(alice.token, beta)).role).toBe('member')
    expect(await h.service.organizations(alice.token)).toMatchObject([{ name: 'Beta' }])
    await h.service.execute(owner.token, { kind: 'set-account', operationId: operationId(), accountId: alice.accountId, expectedVersion: member.accountVersion, enabled: false })
    await denial(h.service.authenticate(alice.token, beta), 'unauthenticated')
    await denial(h.service.login({ username: 'alice', password }), 'invalid-credentials')
    const changed = (await h.service.members(owner.token, owner.organizationId)).find(item => item.accountId === alice.accountId)!
    await h.service.execute(owner.token, { kind: 'set-account', operationId: operationId(), accountId: alice.accountId, expectedVersion: changed.accountVersion, enabled: true })
    await denial(h.service.authenticate(alice.token), 'unauthenticated')
    const login = await h.service.login({ username: 'alice', password })
    await denial(h.service.authenticate(login.token, owner.organizationId), 'forbidden')
    expect(await h.service.authenticate(login.token, beta)).toMatchObject({ accountId: alice.accountId })
  })

  it('preserves the last enabled administrator and rolls failed permission writes back', async () => {
    const h = await harness()
    const owner = await initialize(h.service)
    const eventCount = inspect(h.path, db => db.prepare('SELECT count(*) AS n FROM organization_events').get()?.n)
    await denial(h.service.execute(owner.token, { kind: 'set-membership', operationId: operationId(), organizationId: owner.organizationId, membershipId: owner.membershipId, expectedVersion: owner.revision, enabled: false, role: 'member' }), 'last-admin')
    await denial(h.service.execute(owner.token, { kind: 'set-account', operationId: operationId(), accountId: owner.accountId, expectedVersion: owner.revision, enabled: false }), 'last-admin')
    expect(inspect(h.path, db => db.prepare('SELECT count(*) AS n FROM organization_events').get()?.n)).toBe(eventCount)
    const bob = await addMember(h.service, owner.token, owner.organizationId, 'bob', 'admin')
    const beta = await h.service.execute(owner.token, { kind: 'create-organization', operationId: operationId(), name: 'Beta' })
    await denial(h.service.execute(owner.token, { kind: 'set-account', operationId: operationId(), accountId: owner.accountId, expectedVersion: owner.revision, enabled: false }), 'last-admin')
    await denial(h.service.authenticate(bob.token, beta.organizationId), 'forbidden')
    const invitation = await invite(h.service, bob.token, owner.organizationId)
    await h.service.execute(owner.token, { kind: 'set-membership', operationId: operationId(), organizationId: owner.organizationId, membershipId: bob.membershipId, expectedVersion: bob.revision, enabled: false, role: 'admin' })
    await denial(h.service.register({ operationId: operationId(), username: 'carol', password, invitationToken: invitation.invitationToken }), 'invalid-invitation')
    await denial(h.service.execute(bob.token, invitation.input), 'forbidden')
  })

  it('revokes every account login on password change without changing another account', async () => {
    const h = await harness()
    const owner = await initialize(h.service)
    const alice = await addMember(h.service, owner.token, owner.organizationId)
    const second = await h.service.login({ username: 'alice', password })
    const input = { kind: 'change-password', operationId: operationId(), currentPassword: password, newPassword: 'a genuinely different password' }
    await denial(h.service.execute(alice.token, { ...input, currentPassword: 'wrong password text' }), 'invalid-credentials')
    const receipt = await h.service.execute(alice.token, input)
    await denial(h.service.authenticate(alice.token), 'unauthenticated')
    await denial(h.service.authenticate(second.token), 'unauthenticated')
    await denial(h.service.login({ username: 'alice', password }), 'invalid-credentials')
    const updated = await h.service.login({ username: 'alice', password: input.newPassword })
    expect(await h.service.execute(updated.token, input)).toEqual(receipt)
    expect(await h.service.authenticate(owner.token)).toEqual(owner.principal)
    inspect(h.path, (db) => {
      const hashes = db.prepare('SELECT passwordHash FROM accounts').all().map(row => row.passwordHash)
      expect(new Set(hashes).size).toBe(2)
    })
  }, 30_000)

  it('requires a separate recovery secret, restores the bootstrap administrator and consumes that secret', async () => {
    const h = await harness()
    const owner = await initialize(h.service)
    const bob = await addMember(h.service, owner.token, owner.organizationId, 'bob', 'admin')
    await h.service.execute(bob.token, { kind: 'set-membership', operationId: operationId(), organizationId: owner.organizationId, membershipId: owner.membershipId, expectedVersion: owner.revision, enabled: false, role: 'member' })
    const request = { operationId: operationId(), recoveryToken: owner.recoveryToken,
      newRecoveryToken: createOrganizationToken(), newPassword: 'recovered account password' }
    await denial(h.service.recover({ ...request, recoveryToken: createOrganizationToken() }), 'invalid-recovery')
    const receipt = await h.service.recover(request)
    expect(await h.service.recover(request)).toEqual(receipt)
    await denial(h.service.recover({ ...request, operationId: operationId() }), 'invalid-recovery')
    await denial(h.service.authenticate(bob.token), 'unauthenticated')
    await denial(h.service.authenticate(owner.token), 'unauthenticated')
    const login = await h.service.login({ username: 'owner', password: request.newPassword })
    expect((await h.service.authenticate(login.token, owner.organizationId, 'manage')).role).toBe('admin')
  }, 30_000)

  it('rejects unknown JSON fields and keeps private files and credentials outside the organization store', async () => {
    const h = await harness()
    const privatePath = join(h.root, 'personal-profile.json')
    const marker = 'PRIVATE_CHAT_AND_MODEL_KEY_NEVER_IMPORT'
    await writeFile(privatePath, JSON.stringify({ cwd: h.root, token: marker }))
    const owner = await initialize(h.service)
    await denial(h.service.execute(owner.token, { kind: 'create-organization', operationId: operationId(), name: 'Beta', actorId: owner.accountId }), 'invalid-input')
    await denial(h.service.execute(owner.token, { kind: 'recover', operationId: operationId(), recoveryToken: owner.recoveryToken }), 'invalid-input')
    await denial(h.service.authenticate(owner.token, brandString<OrganizationId>(operationId())), 'forbidden')
    expect(await readFile(privatePath, 'utf8')).toContain(marker)
    await h.close()
    const raw = await readFile(h.path)
    for (const secret of [marker, privatePath, h.root, owner.token, owner.recoveryToken, password]) {
      expect(raw.includes(Buffer.from(secret))).toBe(false)
    }
  })

  it('waits for admitted password work on disposal and rejects calls after disposal', async () => {
    const h = await harness()
    const owner = await initialize(h.service)
    const pending = h.service.login({ username: 'owner', password })
    await h.close()
    const login = await pending
    await denial(h.service.authenticate(owner.token), 'closed')
    const opened = await reopen(h.root)
    expect((await opened.service.authenticate(login.token)).accountId).toBe(owner.accountId)
  })
})

describe('organization schema and transactions', () => {
  it('keeps committed mutations successful and notifies other listeners after a listener throws', async () => {
    const h = await harness()
    const owner = await initialize(h.service)
    const revisions: number[] = []
    h.ctx.on('organization/committed', () => { throw new Error('subscriber fault') })
    h.ctx.on('organization/committed', (revision) => { revisions.push(revision) })
    const project = await h.service.projectCommand(owner.token, { operationId: operationId(), kind: 'create-project', organizationId: owner.organizationId, name: 'Committed' })
    expect(revisions).toEqual([project.revision])
    inspect(h.path, (db) =>{  expect(db.prepare('SELECT name FROM organization_projects WHERE id=?').get(project.projectId!)?.name).toBe('Committed') })
  })

  it('upgrades the known v1 identity database atomically without changing accounts or memberships', async () => {
    const h = await harness()
    const owner = await initialize(h.service)
    await h.close()
    inspect(h.path, (db) =>{  db.exec('DROP TABLE account_profiles; DROP TABLE tree_requests; DROP TABLE plan_contexts; DROP TABLE organization_hierarchy; DROP TABLE planning_goals; DROP TABLE planning_reapprovals; DROP TABLE planning_events; DROP TABLE planning_permits; DROP TABLE planning_grants; DROP TABLE integration_confirmations; DROP TABLE integration_events; DROP TABLE organization_integrations; DROP TABLE organization_acceptances; DROP TABLE delivery_events; DROP TABLE organization_submissions; DROP TABLE organization_artifacts; DROP TABLE execution_human_requests; DROP TABLE execution_events; DROP TABLE execution_actions; DROP TABLE execution_runs; DROP TABLE execution_delegations; DROP TABLE device_actions; DROP TABLE assignment_leases; DROP TABLE organization_devices; DROP TABLE assignment_actions; DROP TABLE assignment_delegations; DROP TABLE assignment_notifications; DROP TABLE assignment_requests; DROP TABLE task_assignments; DROP TABLE task_grants; DROP TABLE plan_tasks; DROP TABLE workgraph_events; DROP TABLE plan_revisions; DROP TABLE organization_plans; DROP TABLE resource_events; DROP TABLE resource_grants; DROP TABLE organization_projects; PRAGMA user_version=1') })
    const current = await reopen(h.root)
    expect((await current.service.organizations(owner.token))[0]?.id).toBe(owner.organizationId)
    const project = await current.service.projectCommand(owner.token, { operationId: operationId(), kind: 'create-project', organizationId: owner.organizationId, name: 'Upgraded' })
    expect(project.projectId).toBeDefined()
    inspect(h.path, (db) =>{  expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(ORGANIZATION_SCHEMA_VERSION) })
  })

  it('refuses unknown versions, other database identities, unstamped nonempty databases and invalid durable rows', async () => {
    const h = await harness()
    await initialize(h.service)
    await h.close()
    inspect(h.path, (db) =>{  db.exec(`PRAGMA user_version=${ORGANIZATION_SCHEMA_VERSION + 1}`) })
    expect(() => openOrganizationDatabase(h.path, 1000)).toThrow('incompatible-store')
    inspect(h.path, (db) =>{  db.exec(`PRAGMA user_version=${ORGANIZATION_SCHEMA_VERSION}; PRAGMA application_id=0`) })
    expect(() => openOrganizationDatabase(h.path, 1000)).toThrow('incompatible-store')
    inspect(h.path, (db) =>{  db.exec('PRAGMA user_version=0') })
    expect(() => openOrganizationDatabase(h.path, 1000)).toThrow('incompatible-store')
    inspect(h.path, (db) =>{  db.exec(`PRAGMA user_version=${ORGANIZATION_SCHEMA_VERSION}; PRAGMA application_id=1296453458; UPDATE accounts SET passwordHash='plaintext'`) })
    expect(() => openOrganizationDatabase(h.path, 1000)).toThrow('incompatible-store')
  })

  it('reopens after abrupt writer exit with committed state and without the unfinished transaction', async () => {
    const h = await harness()
    const owner = await initialize(h.service)
    await h.close()
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import { DatabaseSync } from 'node:sqlite';
      const db = new DatabaseSync(process.argv[1]);
      db.exec('PRAGMA foreign_keys=ON; BEGIN IMMEDIATE');
      db.exec('UPDATE accounts SET enabled=0');
      db.exec("INSERT INTO organization_events(kind,at) VALUES ('set-account',1)");
      process.exit(23);
    `, h.path], { encoding: 'utf8', env: {}, timeout: 10000 })
    expect(result.error).toBeUndefined()
    expect(result.status).toBe(23)
    const reopened = await reopen(h.root)
    expect(await reopened.service.authenticate(owner.token)).toEqual(owner.principal)
    expect(inspect(h.path, db => db.prepare("SELECT * FROM organization_events WHERE kind='set-account'").all())).toEqual([])
  })

  it('rejects extra durable fields instead of silently dropping a newer record format', async () => {
    const h = await harness()
    await initialize(h.service)
    await h.close()
    inspect(h.path, (db) =>{  db.exec('ALTER TABLE accounts ADD COLUMN extra TEXT') })
    expect(() => openOrganizationDatabase(h.path, 1000)).toThrow('incompatible-store')
  })

  it('rolls back a commit-time foreign key failure rather than returning an unpersisted result', async () => {
    const h = await harness()
    await h.close()
    const db = openOrganizationDatabase(h.path, 1000)
    try {
      expect(() => transaction(db, () => {
        db.prepare('INSERT INTO organization_events(kind,actorId,at) VALUES (?,?,?)').run('login', operationId(), Date.now())
        return 'must not return'
      })).toThrow()
      expect(db.prepare('SELECT * FROM organization_events').all()).toEqual([])
    } finally { db.close() }
  })
})
