/** Authorization matrix and replay races through the shipped HTTPS/SQLite composition. */
import { afterEach, expect, it, vi } from 'vitest'
import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'
import { OrganizationStreams } from '../src/events.ts'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { bootOrganization } from '../../../../apps/desktop-host/src/organization-boot.ts'
import { createOrganizationToken, type LoginResult, type Receipt, type OrganizationProjectPage, type OrganizationId, type LoginToken } from '@deepseek-ai/dsh-organization'
import { followOrganizationEvents, organizationRequest, type OrganizationTrust } from '../src/transport.ts'

const cleanups: (() => unknown)[] = []
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close() })
const password = 'correct horse battery staple'
const op = () => randomUUID()
async function setup(authority: Record<string, number> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'organization-resources-'))
  cleanups.push(async () => { await rm(root, { recursive: true, force: true }); await rm(`${root}.owner.sqlite`, { force: true }) })
  const config = { api: { directory: root, host: '127.0.0.1', port: 0, names: ['127.0.0.1'], eventPollMs: 20 }, authority }
  const app = await bootOrganization(config)
  cleanups.push(app.close)
  const trust: OrganizationTrust = { ...app.ready, origin: `https://127.0.0.1:${app.ready.port}`, timeoutMs: 5000, maxResponseBytes: 1048576 }
  const call = (method: 'GET' | 'POST', path: string, body?: unknown, token?: string) => organizationRequest(trust, method, '/organization/v1' + path, body, token)
  const owner = await app.authority.initialize({ operationId: op(), username: 'owner', password, organizationName: 'Alpha', recoveryToken: createOrganizationToken() })
  const ownerLogin = (await call('POST', '/login', { username: 'owner', password })).body as LoginResult
  const invitationToken = createOrganizationToken()
  expect((await call('POST', '/commands', { operationId: op(), kind: 'invite', organizationId: owner.organizationId, role: 'member', invitationToken }, ownerLogin.token)).status).toBe(200)
  const alice = (await call('POST', '/register', { operationId: op(), invitationToken, username: 'alice', password })).body as Receipt
  const aliceLogin = (await call('POST', '/login', { username: 'alice', password })).body as LoginResult
  const organizationId = owner.organizationId!
  const create = async (name = 'Visible', target = organizationId) => {
    const input = { operationId: op(), kind: 'create-project', organizationId: target, name }
    const result = await call('POST', '/projects', input, ownerLogin.token)
    expect(result.status).toBe(200)
    return result.body as Receipt
  }
  const grant = async (project: Receipt, actions: string[], expectedVersion = 0, membershipId = alice.membershipId) => {
    const result = await call('POST', '/grants', { operationId: op(), kind: 'set-grant', organizationId: project.organizationId,
      projectId: project.projectId, membershipId, actions, expectedVersion }, ownerLogin.token)
    expect(result.status).toBe(200)
    return result.body as Receipt
  }
  const page = async (token: LoginToken = aliceLogin.token, target: OrganizationId = organizationId) => {
    const result = await call('GET', `/organizations/${target}/projects`, undefined, token)
    expect(result.status).toBe(200)
    return result.body as OrganizationProjectPage
  }
  const rename = (project: Receipt, name: string, expectedVersion = project.revision, operationId = op(), token = aliceLogin.token) => {
    const input = { operationId, kind: 'rename-project', organizationId: project.organizationId, projectId: project.projectId, expectedVersion, name }
    return call('POST', '/projects', input, token)
  }
  return { root, app, config, trust, call, owner, alice, ownerLogin, aliceLogin, organizationId, create, grant, page, rename }
}

it('uses explicit grants for detail, list totals, pagination and literal search, including administrators', async () => {
  const h = await setup({ pageSize: 1 })
  const first = await h.create('Visible one')
  const second = await h.create('Visible two')
  const hidden = await h.create('Private needle')
  expect((await h.page(h.ownerLogin.token)).total).toBe(3)
  expect((await h.call('GET', `/projects/${first.projectId}?organizationId=${h.organizationId}`, undefined, h.ownerLogin.token)).status).toBe(200)
  await h.grant(first, ['read'])
  await h.grant(second, ['read'])
  const page = await h.page()
  expect(page.total).toBe(2)
  expect(page.items).toHaveLength(1)
  const next = await h.call('GET', `/organizations/${h.organizationId}/projects?offset=1&cursor=${page.cursor}`, undefined, h.aliceLogin.token)
  expect(next.status).toBe(200)
  expect((next.body as OrganizationProjectPage).items).toHaveLength(1)
  expect((next.body as OrganizationProjectPage).items[0]?.id).not.toBe(page.items[0]?.id)
  for (const q of ['Private', '%', '_', "' OR 1=1"]) {
    const result = await h.call('GET', `/organizations/${h.organizationId}/search?q=${encodeURIComponent(q)}`, undefined, h.aliceLogin.token)
    expect(result.body).toMatchObject({ items: [], total: 0 })
  }
  expect((await h.call('GET', `/organizations/${h.organizationId}/search?q=Visible`, undefined, h.aliceLogin.token)).body).toMatchObject({ total: 2 })
  for (const projectId of [hidden.projectId, op()]) expect((await h.call('GET', `/projects/${projectId}?organizationId=${h.organizationId}`, undefined, h.aliceLogin.token)).status).toBe(403)
  expect((await h.rename(first, 'forbidden write')).status).toBe(403)
  expect((await h.call('POST', '/projects', { operationId: op(), kind: 'create-project', organizationId: h.organizationId, name: 'rogue' }, h.aliceLogin.token)).status).toBe(403)
  expect((await h.call('POST', '/projects', { operationId: op(), kind: 'create-project', organizationId: h.organizationId, name: 'rogue', cwd: '/private' }, h.ownerLogin.token)).status).toBe(400)
  const injected = await h.call('GET', `/organizations/${h.organizationId}/projects?actor=owner`, undefined, h.aliceLogin.token)
  expect(injected.status).toBe(400)
}, 15000)

it('rejects cross-organization reads, grants and cursor substitution', async () => {
  const h = await setup()
  const beta = (await h.call('POST', '/commands', { operationId: op(), kind: 'create-organization', name: 'Beta' }, h.ownerLogin.token)).body as Receipt
  const project = await h.create('Alpha name')
  await h.grant(project, ['read'])
  const snapshot = await h.page()
  const betaProject = await h.create('Beta secret', beta.organizationId)
  const mismatches = [
    [project.projectId, beta.organizationId], [betaProject.projectId, h.organizationId], [betaProject.projectId, beta.organizationId],
  ]
  for (const [id, org] of mismatches) {
    expect((await h.call('GET', `/projects/${id}?organizationId=${org}`, undefined, h.aliceLogin.token)).status).toBe(403)
  }
  expect((await h.call('GET', `/organizations/${beta.organizationId}/projects`, undefined, h.aliceLogin.token)).status).toBe(403)
  expect((await h.call('POST', '/grants', { operationId: op(), kind: 'set-grant', organizationId: beta.organizationId,
    projectId: betaProject.projectId, membershipId: h.alice.membershipId, expectedVersion: 0, actions: ['read'] }, h.ownerLogin.token)).status).toBe(403)
  expect((await h.call('GET', `/organizations/${h.organizationId}/events?cursor=${snapshot.cursor}`, undefined, h.ownerLogin.token)).status).toBe(409)
  const own = await h.page(h.ownerLogin.token)
  expect((await h.call('GET', `/organizations/${beta.organizationId}/events?cursor=${own.cursor}`, undefined, h.ownerLogin.token)).status).toBe(409)
}, 15000)

it('checks write/grant versions and refuses receipt replay after write revocation', async () => {
  const h = await setup()
  const project = await h.create()
  const grant = await h.grant(project, ['read', 'write'])
  const operationId = op()
  const changed = await h.rename(project, 'Changed', project.revision, operationId)
  expect(changed.status).toBe(200)
  expect(await h.rename(project, 'Changed', project.revision, operationId)).toEqual(changed)
  expect((await h.rename(project, 'Stale', project.revision)).body).toMatchObject({ error: 'version-conflict' })
  const current = (changed.body as Receipt).revision
  const race = await Promise.all([h.rename(project, 'Winner one', current), h.rename(project, 'Winner two', current)])
  expect(race.map(result => result.status).sort()).toEqual([200, 400])
  expect((await h.call('POST', '/grants', { operationId: op(), kind: 'set-grant', organizationId: h.organizationId, projectId: project.projectId,
    membershipId: h.alice.membershipId, expectedVersion: 0, actions: [] }, h.ownerLogin.token)).body).toMatchObject({ error: 'version-conflict' })
  await h.grant(project, [], grant.revision)
  expect((await h.rename(project, 'Changed', project.revision, operationId)).status).toBe(403)
  expect((await h.page()).total).toBe(0)
}, 15000)

it('atomically rolls back projects, grants, event rows and receipts when storage rejects the commit', async () => {
  const h = await setup()
  const db = new DatabaseSync(join(h.root, 'organization.sqlite'))
  cleanups.push(() =>{  db.close() })
  const project = await h.create()
  let publications = 0
  h.app.ctx.on('organization/committed', () => { publications++ })
  const before = db.prepare('SELECT count(*) AS count FROM organization_events').get()
  db.exec("CREATE TRIGGER reject_resource BEFORE INSERT ON resource_events BEGIN SELECT RAISE(ABORT,'test storage fault'); END")
  const operationId = op()
  const result = await h.call('POST', '/projects', { operationId, kind: 'create-project', organizationId: h.organizationId, name: 'Must roll back' }, h.ownerLogin.token)
  expect(result).toMatchObject({ status: 503, body: { error: 'unavailable' } })
  const grant = await h.call('POST', '/grants', { operationId: op(), kind: 'set-grant', organizationId: h.organizationId, projectId: project.projectId,
    membershipId: h.alice.membershipId, expectedVersion: 0, actions: ['read'] }, h.ownerLogin.token)
  expect(grant.status).toBe(503)
  expect(publications).toBe(0)
  expect(db.prepare('SELECT count(*) AS count FROM organization_events').get()).toEqual(before)
  expect(db.prepare('SELECT * FROM operation_receipts WHERE operationId=?').get(operationId)).toBeUndefined()
  expect(db.prepare('SELECT * FROM organization_projects WHERE name=?').get('Must roll back')).toBeUndefined()
  expect((await h.page()).total).toBe(0)
  db.exec('DROP TRIGGER reject_resource')
  const retry = await h.call('POST', '/projects', { operationId, kind: 'create-project', organizationId: h.organizationId, name: 'Must roll back' }, h.ownerLogin.token)
  expect(retry.status).toBe(200)
}, 15000)

it('bridges snapshot/replay/live delivery without a gap and resets an already open stream on revocation', async () => {
  const h = await setup()
  const project = await h.create()
  const grant = await h.grant(project, ['read', 'write'])
  const snapshot = await h.page()
  const first = await h.rename(project, 'Before subscription')
  expect(first.status).toBe(200)
  const abort = new AbortController()
  cleanups.push(() =>{  abort.abort() })
  const stream = followOrganizationEvents(h.trust, h.organizationId, h.aliceLogin.token, snapshot, abort.signal)
  const replay = await stream.next()
  expect(replay.value?.events).toEqual([{ revision: (first.body as Receipt).revision, projectId: project.projectId }])
  const pending = stream.next()
  const second = await h.rename(project, 'After subscription', (first.body as Receipt).revision)
  expect((await pending).value?.events).toEqual([{ revision: (second.body as Receipt).revision, projectId: project.projectId }])
  const reset = expect(stream.next()).rejects.toMatchObject({ code: 'snapshot-required' })
  await h.grant(project, [], grant.revision)
  await reset
  expect((await h.call('GET', `/organizations/${h.organizationId}/events?cursor=${snapshot.cursor}`, undefined, h.aliceLogin.token)).status).toBe(409)
  const refreshed = await h.page()
  expect(refreshed.items).toEqual([])
  expect((await h.call('GET', `/organizations/${h.organizationId}/events?cursor=${refreshed.cursor}`, undefined, h.aliceLogin.token)).body).toMatchObject({ events: [] })
}, 15000)

it('replays only currently readable resources and requires a snapshot for malformed/expired cursors', async () => {
  const h = await setup({ eventReplayWindow: 3, eventBatchSize: 1 })
  const project = await h.create('Visible')
  await h.grant(project, ['read', 'write'])
  const hidden = await h.create('Hidden')
  await h.grant(hidden, ['read', 'write'], hidden.revision, h.owner.membershipId)
  const snapshot = await h.page()
  const hiddenChange = await h.rename(hidden, 'Hidden changed', hidden.revision, op(), h.ownerLogin.token)
  const first = await h.call('GET', `/organizations/${h.organizationId}/events?cursor=${snapshot.cursor}`, undefined, h.aliceLogin.token)
  expect(first.body).toMatchObject({ events: [], revision: (hiddenChange.body as Receipt).revision })
  let version = project.revision
  for (let i = 0; i < 4; i++) version = ((await h.rename(project, `Change ${i}`, version)).body as Receipt).revision
  expect((await h.call('GET', `/organizations/${h.organizationId}/events?cursor=${snapshot.cursor}`, undefined, h.aliceLogin.token)).status).toBe(409)
  for (const cursor of ['garbage', snapshot.cursor + 'x']) expect((await h.call('GET', `/organizations/${h.organizationId}/events?cursor=${cursor}`, undefined, h.aliceLogin.token)).status).toBe(409)
}, 15000)

it('closes active streams on membership disable and login revocation without relying on a client acknowledgement', async () => {
  const h = await setup()
  const project = await h.create()
  await h.grant(project, ['read'])
  const snapshot = await h.page()
  const abort = new AbortController()
  cleanups.push(() =>{  abort.abort() })
  const stream = followOrganizationEvents(h.trust, h.organizationId, h.aliceLogin.token, snapshot, abort.signal)
  const pending = expect(stream.next()).rejects.toMatchObject({ code: 'forbidden' })
  expect((await h.call('POST', '/commands', { operationId: op(), kind: 'set-membership', organizationId: h.organizationId,
    membershipId: h.alice.membershipId, expectedVersion: h.alice.revision, enabled: false, role: 'member' }, h.ownerLogin.token)).status).toBe(200)
  await pending
  expect((await h.call('GET', `/organizations/${h.organizationId}/projects`, undefined, h.aliceLogin.token)).status).toBe(403)
  const ownerSnapshot = await h.page(h.ownerLogin.token)
  const ownerStream = followOrganizationEvents(h.trust, h.organizationId, h.ownerLogin.token, ownerSnapshot, abort.signal)
  const logout = expect(ownerStream.next()).rejects.toMatchObject({ code: 'unauthenticated' })
  expect((await h.call('POST', '/logout', undefined, h.ownerLogin.token)).status).toBe(200)
  await logout
}, 15000)

it('rejects old pagination and event cursors after authority restart while preserving the granted project', async () => {
  const h = await setup()
  const project = await h.create()
  await h.grant(project, ['read', 'write'])
  const snapshot = await h.page()
  await h.rename(project, 'New version')
  expect((await h.call('GET', `/organizations/${h.organizationId}/projects?offset=1&cursor=${snapshot.cursor}`, undefined, h.aliceLogin.token)).status).toBe(409)
  await h.app.close()
  const reopened = await bootOrganization(h.config)
  cleanups.push(reopened.close)
  const trust = { ...h.trust, origin: `https://127.0.0.1:${reopened.ready.port}` }
  expect((await organizationRequest(trust, 'GET', `/organization/v1/organizations/${h.organizationId}/events?cursor=${snapshot.cursor}`, undefined, h.aliceLogin.token)).status).toBe(409)
  expect((await organizationRequest(trust, 'GET', `/organization/v1/organizations/${h.organizationId}/projects`, undefined, h.aliceLogin.token)).body).toMatchObject({ total: 1, items: [{ name: 'New version' }] })
}, 15000)

it('ignores duplicate batches and rejects reordered batches before a client can apply them', async () => {
  const h = await setup()
  const project = await h.create()
  await h.grant(project, ['read'])
  const snapshot = await h.page()
  const { readFile } = await import('node:fs/promises')
  const { createServer } = await import('node:https')
  const identity = JSON.parse(await readFile(join(h.root, 'tls-identity.json'), 'utf8')) as { certificate: string; privateKey: string }
  const first = { from: snapshot.cursor, cursor: 'cursor-one', revision: snapshot.revision + 1,
    events: [{ revision: snapshot.revision + 1, projectId: project.projectId }] }
  const second = { from: first.cursor, cursor: 'cursor-two', revision: snapshot.revision + 2,
    events: [{ revision: snapshot.revision + 2, projectId: project.projectId }] }
  const outOfOrder = { from: snapshot.cursor, cursor: 'cursor-three', revision: snapshot.revision + 3,
    events: [{ revision: snapshot.revision + 3, projectId: project.projectId }] }
  const server = createServer({ cert: identity.certificate, key: identity.privateKey }, (_req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.end([first, first, second, outOfOrder].map(batch => `data: ${JSON.stringify(batch)}\n\n`).join(''))
  })
  cleanups.push(() => new Promise<void>(resolve => server.close(() =>{  resolve() })))
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('no port')
  const abort = new AbortController()
  cleanups.push(() =>{  abort.abort() })
  const iterator = followOrganizationEvents({ ...h.trust, origin: `https://127.0.0.1:${address.port}` }, h.organizationId, h.aliceLogin.token, snapshot, abort.signal)
  expect((await iterator.next()).value).toEqual(first)
  expect((await iterator.next()).value).toEqual(second)
  await expect(iterator.next()).rejects.toMatchObject({ code: 'snapshot-required' })
}, 15000)

it('exposes versioned grant metadata only to managers without leaking project content', async () => {
  const h = await setup()
  const project = await h.create('Hidden from manager')
  const revoked = await h.grant(project, [], project.revision, h.owner.membershipId)
  const granted = await h.grant(project, ['read'])
  const path = `/projects/${project.projectId}/grants?organizationId=${h.organizationId}`
  expect((await h.call('GET', path, undefined, h.ownerLogin.token)).body).toEqual(expect.arrayContaining([{
    projectId: project.projectId, membershipId: h.alice.membershipId, actions: ['read'], version: granted.revision,
  }, { projectId: project.projectId, membershipId: h.owner.membershipId, actions: [], version: revoked.revision }]))
  expect((await h.call('GET', path, undefined, h.aliceLogin.token)).status).toBe(403)
  expect((await h.page(h.ownerLogin.token)).items).toEqual([])
}, 15000)

it('waits for a pending stream write without advancing its cursor and rechecks permission before delivery', async () => {
  const h = await setup()
  const project = await h.create()
  const grant = await h.grant(project, ['read', 'write'])
  const snapshot = await h.page()
  const response = new ServerResponse(new IncomingMessage(new Socket()))
  const frames: string[] = []
  let buffered = 0, sent = false
  const length = vi.spyOn(response, 'writableLength', 'get').mockImplementation(() => buffered)
  const headers = vi.spyOn(response, 'headersSent', 'get').mockImplementation(() => sent)
  const write = vi.spyOn(response, 'write').mockImplementation((chunk) => { frames.push(String(chunk)); sent = true; return true })
  const end = vi.spyOn(response, 'end').mockReturnValue(response)
  const read = vi.spyOn(h.app.authority, 'readProjectEvents')
  const streams = new OrganizationStreams(h.app.ctx, {
    maxSubscriptions: 1, eventPollMs: 20, streamMaxAgeMs: 5000, maxResponseBytes: 1048576,
  })
  try {
    await streams.open(h.aliceLogin.token, h.organizationId, snapshot.cursor, response)
    expect(frames).toHaveLength(1)
    buffered = 13
    const first = await h.rename(project, 'Buffered change')
    const observed = read.mock.calls.length
    await vi.waitFor(() => { expect(read.mock.calls.length).toBeGreaterThan(observed) })
    expect(response.destroyed).toBe(false)
    expect(frames).toHaveLength(1)
    expect(read.mock.calls.at(-1)?.[1].cursor).toBe(snapshot.cursor)
    buffered = 0
    await vi.waitFor(() => { expect(frames.some(frame => frame.includes(`"revision":${(first.body as Receipt).revision}`))).toBe(true) })
    buffered = 13
    await h.grant(project, [], grant.revision)
    await vi.waitFor(() => { expect(response.destroyed).toBe(true) })
    expect(end).not.toHaveBeenCalled()
    expect(frames.filter(frame => frame.startsWith('data: '))).toHaveLength(2)
  } finally {
    await streams.close()
    for (const spy of [length, headers, write, end, read]) spy.mockRestore()
  }
}, 15000)
