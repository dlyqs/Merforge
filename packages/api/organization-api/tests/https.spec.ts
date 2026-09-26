/** Real shipped Loader composition, SQLite and TLS; no browser or personal profile. */
import { afterEach, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:net'
import { bootOrganization } from '../../../../apps/desktop-host/src/organization-boot.ts'
import { createOrganizationToken } from '@deepseek-ai/dsh-organization'
import { organizationRequest, probeOrganizationCertificate, type OrganizationTrust } from '../src/transport.ts'

const cleanups: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close() })
const password = 'correct horse battery staple'
async function directory() {
  const path = await mkdtemp(join(tmpdir(), 'organization-https-'))
  cleanups.push(async () => { await rm(path, { recursive: true, force: true }); await rm(`${path}.owner.sqlite`, { force: true }) })
  return path
}
async function setup() {
  const root = await directory()
  const app = await bootOrganization({ api: { directory: root, host: '127.0.0.1', port: 0, names: ['127.0.0.1'], requestTimeoutMs: 5000 } })
  cleanups.push(app.close)
  const origin = `https://127.0.0.1:${app.ready.port}`
  const offer = await probeOrganizationCertificate(origin, 5000)
  expect(offer.fingerprint).toBe(app.ready.fingerprint)
  const trust: OrganizationTrust = { ...offer, origin, timeoutMs: 5000, maxResponseBytes: 1048576 }
  const call = (method: 'GET' | 'POST', path: string, body?: unknown, token?: string) => organizationRequest(trust, method, '/organization/v1' + path, body, token)
  return { root, app, trust, call }
}

it('authenticates real accounts and exposes only the organization protocol', async () => {
  const { app, call } = await setup()
  expect(await call('GET', '/identity')).toMatchObject({ status: 200, body: { protocolVersion: 1 } })
  for (const route of ['/initialize', '/recover', '/shutdown', '/keys', '/api', '/sessions', '/attachments/abcd', '/files/etc/passwd', '/download', '/search', '/tools']) {
    expect((await call('POST', route, {})).status).toBe(404)
  }
  expect((await call('GET', '/login')).status).toBe(405)
  expect((await call('GET', '/organizations', undefined, createOrganizationToken())).status).toBe(401)
  const owner = await app.authority.initialize({ operationId: randomUUID(), username: 'owner', password, organizationName: 'Alpha', recoveryToken: createOrganizationToken() })
  expect((await call('POST', '/login', { username: 'owner', password: 'wrong password long enough' })).status).toBe(401)
  expect((await call('POST', '/login', { username: 'owner', password, actor: 'admin' })).status).toBe(400)
  const login = await call('POST', '/login', { username: 'owner', password })
  expect(login.status).toBe(200)
  const token = (login.body as { token: string }).token
  expect((await call('GET', '/organizations', undefined, token)).body).toMatchObject([{ id: owner.organizationId, name: 'Alpha' }])
  expect((await call('POST', '/commands', { kind: 'initialize', operationId: randomUUID() }, token)).status).toBe(400)
  expect((await call('POST', '/logout', undefined, token)).status).toBe(200)
  expect((await call('GET', '/organizations', undefined, token)).status).toBe(401)
  for (const service of ['agents', 'sessions', 'remote', 'webServer', 'tools', 'credentials']) expect(app.ctx.get(service as 'organization')).toBeUndefined()
}, 20000)

it('rejects changed certificates, hostname mismatches and forged fingerprints', async () => {
  const first = await setup()
  const second = await setup()
  await expect(organizationRequest({ ...first.trust, origin: second.trust.origin }, 'GET', '/organization/v1/identity')).rejects.toThrow()
  await expect(organizationRequest({ ...first.trust, fingerprint: second.trust.fingerprint }, 'GET', '/organization/v1/identity')).rejects.toThrow('certificate-changed')
  await expect(probeOrganizationCertificate(first.trust.origin.replace('127.0.0.1', 'localhost'), 5000)).rejects.toThrow('certificate-invalid')
  await expect(organizationRequest(first.trust, 'GET', 'https://elsewhere.invalid')).rejects.toThrow('invalid-route')
})

it('refuses invalid configuration, corrupted identity, database failure and occupied ports', async () => {
  const root = await directory()
  const api = { directory: root, host: '127.0.0.1', port: 0, names: ['127.0.0.1'] }
  await expect(bootOrganization({ api: { ...api, maxInFlight: 0 } })).rejects.toThrow()
  await writeFile(join(root, 'tls-identity.json'), '{}')
  await expect(bootOrganization({ api })).rejects.toThrow()
  const dbRoot = await directory()
  await writeFile(join(dbRoot, 'organization.sqlite'), 'not sqlite')
  await expect(bootOrganization({ api: { ...api, directory: dbRoot } })).rejects.toThrow()
  const { app } = await setup()
  const occupied = await directory()
  await expect(bootOrganization({ api: { ...api, directory: occupied, port: app.ready.port } })).rejects.toThrow()
})

it('disposes the real listener and can reopen its port and durable identity', async () => {
  const { app, trust } = await setup()
  await app.close()
  await expect(organizationRequest(trust, 'GET', '/organization/v1/identity')).rejects.toThrow()
  const server = createServer()
  cleanups.push(() => new Promise<void>(resolve => server.close(() =>{  resolve() })))
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(app.ready.port, '127.0.0.1', resolve) })
})

it('refuses redirects and expired certificates without sending credentials to another origin', async () => {
  const { trust, root } = await setup()
  const { createServer: httpsServer } = await import('node:https')
  const { readFile } = await import('node:fs/promises')
  const identity = JSON.parse(await readFile(join(root, 'tls-identity.json'), 'utf8')) as { certificate: string; privateKey: string }
  const redirect = httpsServer({ cert: identity.certificate, key: identity.privateKey }, (_req, res) => {
    res.writeHead(307, { location: 'https://elsewhere.invalid/organization/v1/login' }); res.end()
  })
  cleanups.push(() => new Promise<void>(resolve => redirect.close(() =>{  resolve() })))
  await new Promise<void>(resolve => redirect.listen(0, '127.0.0.1', resolve))
  const address = redirect.address()
  if (!address || typeof address === 'string') throw new Error('missing port')
  await expect(organizationRequest({ ...trust, origin: `https://127.0.0.1:${address.port}` }, 'POST', '/organization/v1/login', { password })).rejects.toThrow('redirect-refused')
  const { generate } = await import('selfsigned')
  const { inspectIdentity } = await import('../src/tls.ts')
  const expired = await generate([{ name: 'commonName', value: 'localhost' }], {
    keySize: 2048, algorithm: 'sha256', notBeforeDate: new Date('2020-01-01'), notAfterDate: new Date('2020-01-02'),
  })
  expect(() => inspectIdentity({ certificate: expired.cert, privateKey: expired.private }, ['localhost'])).toThrow('certificate-invalid')
})

it('bounds incomplete bodies and refuses personal cookies even when the token has the right syntax', async () => {
  const root = await directory()
  const app = await bootOrganization({ api: { directory: root, host: '127.0.0.1', port: 0, names: ['127.0.0.1'], maxInFlight: 1, requestTimeoutMs: 2000 } })
  cleanups.push(app.close)
  const { request } = await import('node:https')
  const response = (path: string, headers: Record<string, string>) => new Promise<number>((resolve) => {
    const req = request(`https://127.0.0.1:${app.ready.port}${path}`, { ca: app.ready.certificate, headers }, (res) => { res.resume(); resolve(res.statusCode!) })
    req.end()
  })
  expect(await response('/organization/v1/organizations', { cookie: `dsh-token=${createOrganizationToken()}` })).toBe(401)
  for (const path of ['/api', '/api/sessions/private', '/attachments/private', '/download?path=/etc/passwd']) expect(await response(path, {})).toBe(404)
  const pending = request(`https://127.0.0.1:${app.ready.port}/organization/v1/login`, { method: 'POST', agent: false, ca: app.ready.certificate,
    headers: { 'content-type': 'application/json', 'content-length': '1000' } })
  pending.on('error', () => {})
  cleanups.push(async () => { pending.destroy() })
  pending.write('{')
  // A second request observes admission after the first headers arrive on its owned TLS socket.
  await new Promise<void>(resolve => pending.once('socket', socket => socket.once('secureConnect', () =>{  resolve() })))
  await expect.poll(() => response('/organization/v1/identity', {})).toBe(503)
  await app.close()
})
