/** Real HTTPS WorkGraph requests, replay and denial paths; no browser or personal Host. */
import { afterEach, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:https'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { followWorkgraphEvents, organizationRequest } from '../src/transport.ts'
import { workgraphHarness } from './workgraph-harness.ts'

const cleanup: (() => unknown)[] = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })
async function setup() { const h = await workgraphHarness(); cleanup.push(h.close); return h }

it('delivers distinct authorized views and denies execution, identity injection and personal routes', async () => {
  const h = await setup()
  expect((await h.page(h.owner.token)).total).toBe(3)
  const member = await h.page()
  expect(member.total).toBe(1)
  for (const hidden of ['HIDDEN', h.save.definition.taskId, h.save.definition.tasks[2]!.id]) expect(JSON.stringify(member)).not.toContain(hidden)
  expect((await h.call('/workgraph/read', h.query, h.member.token)).status).toBe(403)
  expect((await h.call('/workgraph/grants', h.query, h.member.token)).status).toBe(403)
  expect((await h.call('/workgraph/grants', h.query)).body).not.toHaveProperty('definition')
  for (const kind of ['approve', 'dispatch', 'claim', 'submit', 'context', 'prompt']) {
    expect((await h.call(`/workgraph/${kind}`, {})).status).toBe(404)
  }
  for (const field of ['accountId', 'actor', 'role', 'completed', 'run', 'sessionId']) {
    expect((await h.call('/workgraph/tasks', { ...h.query, [field]: randomUUID() })).status).toBe(400)
    expect((await h.call('/workgraph/save', { ...h.save, [field]: true })).status).toBe(400)
  }
  expect((await h.call('/workgraph/tasks?actor=owner', h.query)).status).toBe(400)
  expect((await h.call('/workgraph/tasks')).status).toBe(405)
  expect((await h.call('/workgraph/events?organizationId=x&cursor=x&stream=false')).status).toBe(400)
  for (const path of ['/api/session', '/api/attachments/private', '/files/private', '/organization/v1/initialize', '/organization/v1/recover']) {
    expect((await organizationRequest(h.trust, 'GET', path.startsWith('/organization') ? path : '/organization/v1' + path, undefined, h.member.token)).status).toBe(404)
  }
  const mismatch = { ...h.query, organizationId: randomUUID() }
  expect((await h.call('/workgraph/tasks', mismatch, h.member.token)).status).toBe(403)
}, 15000)

it('replays visible edits, hides private edits and resets a subscribed member on revocation', async () => {
  const h = await setup()
  const page = await h.page()
  const abort = new AbortController(); cleanup.push(() =>{  abort.abort() })
  const stream = followWorkgraphEvents(h.trust, h.owner.organizationId, h.member.token, page, abort.signal)
  const hiddenDefinition = structuredClone(h.save.definition)
  hiddenDefinition.tasks[2]!.goal = 'HIDDEN_CHANGED'
  expect((await h.call('/workgraph/save', { ...h.save, definition: hiddenDefinition, expectedRevision: 1, operationId: randomUUID() })).status).toBe(200)
  expect((await stream.next()).value?.events).toEqual([])
  const waiting = stream.next()
  hiddenDefinition.tasks[1]!.goal = 'Visible changed'
  const changed = await h.call('/workgraph/save', { ...h.save, definition: hiddenDefinition, expectedRevision: 2, operationId: randomUUID() })
  expect(changed.status).toBe(200)
  expect((await waiting).value?.events).toMatchObject([{ planId: h.query.planId }])
  const reset = expect(stream.next()).rejects.toMatchObject({ code: 'snapshot-required' })
  expect((await h.call('/workgraph/grant', { ...h.grant, actions: [], expectedVersion: h.receipt.revision, operationId: randomUUID() })).status).toBe(200)
  await reset
  expect((await h.call(`/workgraph/events?organizationId=${h.owner.organizationId}&cursor=${page.cursor}`, undefined, h.member.token)).status).toBe(409)
  expect((await h.call('/workgraph/tasks', { ...h.query, revision: 1 }, h.member.token)).status).toBe(403)
}, 15000)

it.each(['gap', 'order'])('suppresses duplicate task batches and rejects %s before delivery', async (failure) => {
  const h = await setup()
  const snapshot = await h.page()
  const identity = JSON.parse(await readFile(join(h.root, 'service/tls-identity.json'), 'utf8')) as { certificate: string; privateKey: string }
  const first = { from: snapshot.cursor, cursor: 'one', revision: snapshot.revision + 1,
    events: [{ revision: snapshot.revision + 1, planId: h.query.planId }] }
  const invalid = failure === 'gap' ? { ...first, from: 'missing', cursor: 'two', revision: first.revision + 1 }
    : { ...first, from: first.cursor, cursor: 'two', revision: first.revision - 1 }
  const server = createServer({ cert: identity.certificate, key: identity.privateKey }, (_req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.end([first, first, invalid].map(batch => `data: ${JSON.stringify(batch)}\n\n`).join(''))
  })
  cleanup.push(() => new Promise<void>(resolve => server.close(() =>{  resolve() })))
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('missing port')
  const abort = new AbortController(); cleanup.push(() =>{  abort.abort() })
  const stream = followWorkgraphEvents({ ...h.trust, origin: `https://127.0.0.1:${address.port}` }, h.owner.organizationId, h.member.token, snapshot, abort.signal)
  expect((await stream.next()).value).toEqual(first)
  await expect(stream.next()).rejects.toMatchObject({ code: 'snapshot-required' })
}, 15000)
