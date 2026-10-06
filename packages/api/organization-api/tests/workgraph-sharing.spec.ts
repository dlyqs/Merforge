/** Real private service, HTTPS and SQLite coverage for task sharing and creator approvals. */
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { afterEach, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { openOrganizationDatabase } from '../../../workspace/organization/src/database.ts'
import { addMember } from '../../../workspace/organization/tests/harness.ts'
import { workgraphSharingViewSchema, workgraphGrantViewSchema } from '@deepseek-ai/dsh-organization/workgraph'
import { receiptSchema } from '@deepseek-ai/dsh-organization/protocol'
import { workgraphHarness } from './workgraph-harness.ts'

const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })
async function setup() {
  const h = await workgraphHarness(); cleanup.push(h.close)
  const assignment = receiptSchema.parse((await h.call('/assignment/command', { ...h.query,
    kind: 'approve-assignment', operationId: randomUUID(), taskId: h.save.definition.tasks[1]!.id,
    planRevision: 1, assigneeId: h.member.membershipId })).body)
  const sharing = async (token = h.member.token) => workgraphSharingViewSchema.parse((await h.call('/workgraph/sharing', h.query, token)).body)
  const send = (fields: Record<string, unknown>, token = h.member.token) => h.call('/workgraph/share', {
    ...h.query, operationId: randomUUID(), ...fields }, token)
  return { ...h, assignment, sharing, send }
}

it('shares creator context with a single-node assignee and edits it without changing approval or plan revisions', async () => {
  const h = await setup(), before = await h.sharing()
  expect(before).toMatchObject({ sharedContext: 'scope', canEdit: false, canRequest: true, fullTreeVisible: false })
  expect((await h.send({ kind: 'edit-context', expectedVersion: before.version, sharedContext: 'Employee overwrite' })).status).toBe(403)
  const command = { kind: 'edit-context', operationId: randomUUID(), expectedVersion: before.version,
    sharedContext: 'Build the monthly report. Preserve existing CSV columns. The customer needs regional totals.' }
  const edited = await h.send(command, h.owner.token)
  expect(edited.status).toBe(200)
  expect(await h.send(command, h.owner.token)).toEqual(edited)
  const page = await h.page()
  expect(page.total).toBe(1)
  expect(page.items[0]).toMatchObject({ assignedToMe: true, revision: 1 })
  expect((await h.sharing()).sharedContext).toBe(command.sharedContext)
  const plan = await h.call('/planning/plan', { ...h.query, conversationId: randomUUID(), kind: 'read-planning-plan', taskId: page.items[0]!.id }, h.member.token)
  expect(plan.status).toBe(200)
  expect(plan.body).toMatchObject({ sharedContext: command.sharedContext, version: { revision: 1 } })
  const preparation = await h.call('/assignment/preparation', { ...h.query, assignmentId: h.assignment.assignmentId }, h.member.token)
  expect(preparation.body).toMatchObject({ assignment: { state: 'pending', planRevision: 1 } })
  expect((await h.send({ ...command, operationId: randomUUID(), sharedContext: 'Stale edit' }, h.owner.token)).body).toMatchObject({ error: 'version-conflict' })
}, 15000)

it('keeps long shared background readable without multiplying it by every visible task', async () => {
  const h = await setup(), before = await h.sharing(h.owner.token)
  const sharedContext = 'Task background. '.repeat(25000)
  expect((await h.send({ kind: 'edit-context', expectedVersion: before.version, sharedContext }, h.owner.token)).status).toBe(200)
  expect((await h.sharing()).sharedContext).toBe(sharedContext)
  const page = await h.page(h.owner.token)
  expect(page.total).toBe(3)
  expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThan(10000)
  const plan = await h.call('/planning/plan', { ...h.query, conversationId: randomUUID(), kind: 'read-planning-plan',
    taskId: h.save.definition.tasks[1]!.id }, h.member.token)
  expect(plan.status).toBe(200)
  expect(plan.body).toMatchObject({ sharedContext })
}, 15000)

it('sends a durable request to the original creator and grants the full tree read-only with the assigned node marked', async () => {
  const h = await setup(), command = { kind: 'request-tree', operationId: randomUUID() }
  const requested = await h.send(command)
  expect(requested.status).toBe(200)
  expect(await h.send(command)).toEqual(requested)
  expect((await h.page()).total).toBe(1)
  const owner = await h.sharing(h.owner.token), request = owner.requests[0]!
  expect(request).toMatchObject({ username: 'reader', state: 'pending' })
  expect((await h.page(h.owner.token)).items.find(t => t.id === h.save.definition.taskId)?.hasTreeRequests).toBe(true)
  expect((await h.send({ kind: 'decide-tree', requestId: request.id, expectedVersion: request.version, answer: 'approved' })).status).toBe(403)
  const decision = { kind: 'decide-tree', operationId: randomUUID(), requestId: request.id, expectedVersion: request.version, answer: 'approved' }
  const approved = await h.send(decision, h.owner.token)
  expect(approved.status).toBe(200)
  expect(await h.send(decision, h.owner.token)).toEqual(approved)
  expect(await h.sharing()).toMatchObject({ fullTreeVisible: true, canRequest: false, requests: [{ state: 'approved' }] })
  const tasks = await h.page()
  expect(tasks.total).toBe(3)
  expect(tasks.items.filter(t => t.assignedToMe).map(t => t.id)).toEqual([h.save.definition.tasks[1]!.id])
  expect(tasks.items.find(t => t.id === h.save.definition.tasks[1]!.id)?.parentTaskId).toBe(h.save.definition.taskId)
  expect((await h.call('/workgraph/read', h.query, h.member.token)).status).toBe(200)
  expect((await h.call('/workgraph/save', { ...h.save, operationId: randomUUID(), expectedRevision: 1 }, h.member.token)).status).toBe(403)
  const grants = await h.call('/workgraph/grants', h.query)
  expect(grants.body).toEqual(expect.arrayContaining([expect.objectContaining({ taskId: h.save.definition.taskId,
    membershipId: h.member.membershipId, actions: ['read'] })]))
  expect((await h.send({ kind: 'edit-context', expectedVersion: 1, sharedContext: 'Forbidden' })).status).toBe(403)
}, 15000)

it('keeps rejected requests read-restricted and allows a fresh request without accepting stale decisions', async () => {
  const h = await setup()
  expect((await h.send({ kind: 'request-tree' })).status).toBe(200)
  const first = (await h.sharing(h.owner.token)).requests[0]!
  const reject = { kind: 'decide-tree', requestId: first.id, expectedVersion: first.version, answer: 'rejected' }
  expect((await h.send(reject, h.owner.token)).status).toBe(200)
  expect((await h.page()).total).toBe(1)
  expect(await h.sharing()).toMatchObject({ fullTreeVisible: false, requests: [{ state: 'rejected' }] })
  expect((await h.send({ kind: 'request-tree' })).status).toBe(200)
  expect((await h.send({ kind: 'request-tree' })).body).toMatchObject({ error: 'version-conflict' })
  expect((await h.send({ ...reject, answer: 'approved' }, h.owner.token)).body).toMatchObject({ error: 'version-conflict' })
  expect((await h.page()).total).toBe(1)
}, 15000)

it('refuses full-tree approval after assignment revocation and rejects injected identities and oversized background', async () => {
  const h = await setup()
  expect((await h.send({ kind: 'request-tree' })).status).toBe(200)
  const request = (await h.sharing(h.owner.token)).requests[0]!
  expect((await h.call('/assignment/command', { ...h.query, kind: 'revoke-assignment', operationId: randomUUID(),
    assignmentId: h.assignment.assignmentId, expectedVersion: h.assignment.revision })).status).toBe(200)
  expect((await h.send({ kind: 'decide-tree', requestId: request.id, expectedVersion: request.version, answer: 'approved' }, h.owner.token)).status).toBe(403)
  expect((await h.send({ kind: 'request-tree' })).status).toBe(403)
  expect((await h.send({ kind: 'request-tree', membershipId: h.owner.membershipId })).status).toBe(400)
  const before = await h.sharing(h.owner.token)
  expect((await h.send({ kind: 'edit-context', expectedVersion: before.version, sharedContext: '背'.repeat(400000) }, h.owner.token)).status).toBe(400)
  expect(await h.sharing(h.owner.token)).toEqual(before)
}, 15000)

it('keeps decisions creator-owned even for a root-editing administrator and refuses revoked task access', async () => {
  const h = await setup()
  const administrator = await addMember(h.app.authority, h.owner.token, h.query.organizationId, 'reviewer', 'admin')
  expect((await h.call('/grants', { kind: 'set-grant', ...h.query, planId: undefined, operationId: randomUUID(),
    membershipId: administrator.membershipId, actions: ['read', 'write'], expectedVersion: 0 })).status).toBe(200)
  expect((await h.call('/workgraph/grant', { ...h.query, taskId: h.save.definition.taskId, scope: 'subtree',
    membershipId: administrator.membershipId, actions: ['read', 'edit'], expectedVersion: 0, operationId: randomUUID() })).status).toBe(200)
  expect((await h.send({ kind: 'request-tree' })).status).toBe(200)
  const request = (await h.sharing(h.owner.token)).requests[0]!
  expect((await h.send({ kind: 'decide-tree', requestId: request.id, expectedVersion: request.version, answer: 'approved' }, administrator.token)).status).toBe(403)
  expect((await h.send({ kind: 'edit-context', expectedVersion: (await h.sharing()).version, sharedContext: 'Another admin' }, administrator.token)).status).toBe(403)
  expect((await h.sharing(administrator.token)).requests).toEqual([])
  const grants = await h.call('/workgraph/grants', h.query)
  const access = z.array(workgraphGrantViewSchema).parse(grants.body)
    .find(g => g.taskId === h.save.definition.tasks[1]!.id && g.membershipId === h.member.membershipId)!
  expect((await h.call('/workgraph/grant', { ...h.grant, actions: [], expectedVersion: access.version, operationId: randomUUID() })).status).toBe(200)
  expect((await h.call('/workgraph/sharing', h.query, h.member.token)).status).toBe(403)
}, 15000)

it('migrates v19 plans with background without altering task revisions', async () => {
  const h = await setup()
  await h.app.close()
  const path = join(h.root, 'service', 'organization.sqlite'), old = new DatabaseSync(path)
  try { old.exec('DROP TABLE tree_requests; DROP TABLE plan_contexts; PRAGMA user_version=19') } finally { old.close() }
  const migrated = openOrganizationDatabase(path, 5000)
  try {
    expect(migrated.prepare('PRAGMA user_version').get()?.user_version).toBe(22)
    expect(migrated.prepare('SELECT sharedContext FROM plan_contexts WHERE planId=?').get(h.query.planId)?.sharedContext).toBe('scope')
    expect(migrated.prepare('SELECT currentRevision FROM organization_plans WHERE id=?').get(h.query.planId)?.currentRevision).toBe(1)
  } finally { migrated.close() }
}, 15000)

it('reopens durable decisions and refuses an approved request whose same-version grant was changed to edit access', async () => {
  const h = await setup()
  expect((await h.send({ kind: 'request-tree' })).status).toBe(200)
  const request = (await h.sharing(h.owner.token)).requests[0]!
  expect((await h.send({ kind: 'decide-tree', requestId: request.id, expectedVersion: request.version, answer: 'approved' }, h.owner.token)).status).toBe(200)
  const saved = await h.sharing()
  await h.app.close()
  const path = join(h.root, 'service', 'organization.sqlite'), reopened = openOrganizationDatabase(path, 5000)
  try {
    expect(reopened.prepare('SELECT state,version FROM tree_requests WHERE id=?').get(request.id))
      .toMatchObject({ state: 'approved', version: saved.requests[0]!.version })
    reopened.prepare("UPDATE task_grants SET canEdit=1 WHERE planId=? AND taskId=? AND membershipId=? AND scope='subtree'")
      .run(h.query.planId, h.save.definition.taskId, h.member.membershipId!)
  } finally { reopened.close() }
  expect(() => openOrganizationDatabase(path, 5000)).toThrow('incompatible-store')
}, 15000)
