/** Permission intersections exercised through the real Loader and SQLite authority. */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, expect, it } from 'vitest'
import type { LoginToken, OrganizationTaskPage, OrganizationWorkgraphBatch } from '../src/index.ts'
import { openHarness, initialize, addMember, operationId } from './harness.ts'

const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })
async function setup(config = {}) {
  const root = await mkdtemp(join(tmpdir(), 'workgraph-access-'))
  cleanup.push(() => rm(root, { recursive: true, force: true }))
  const h = await openHarness(root, config); cleanup.push(h.close)
  const owner = await initialize(h.service)
  const member = await addMember(h.service, owner.token, owner.organizationId, 'reader', 'admin')
  const project = await h.service.projectCommand(owner.token, { kind: 'create-project', operationId: operationId(), organizationId: owner.organizationId, name: 'Project' })
  for (const membershipId of [member.membershipId]) await h.service.grant(owner.token, {
    kind: 'set-grant', operationId: operationId(), organizationId: owner.organizationId, projectId: project.projectId,
    membershipId, actions: ['read', 'write'], expectedVersion: 0,
  })
  const planId = randomUUID(), rootId = randomUUID(), x = randomUUID(), child = randomUUID(), y = randomUUID()
  const phaseId = randomUUID(), secretPhase = randomUUID()
  const task = (id: string, parentTaskId: string | null, goal: string) => ({ id, parentTaskId, goal, phaseId,
    scope: 'scope', acceptance: ['accepted'], artifacts: [], required: false, dependsOn: [] as string[], suggestedMembershipId: null as string | null })
  const definition = { taskId: rootId, phases: [{ id: secretPhase, title: 'HIDDEN_PHASE' }, { id: phaseId, title: 'Public phase' }], tasks: [
    { ...task(rootId, null, 'HIDDEN_ROOT'), required: true, phaseId: secretPhase },
    { ...task(x, rootId, 'Visible X'), dependsOn: [y] }, task(child, x, 'Visible child'),
    { ...task(y, rootId, 'HIDDEN_Y'), phaseId: secretPhase, suggestedMembershipId: member.membershipId! },
  ] }
  const query = { organizationId: owner.organizationId, projectId: project.projectId, planId }
  let revision = 0
  const save = async () => {
    const receipt = await h.service.savePlan(owner.token, { ...query, definition, operationId: operationId(), expectedRevision: revision })
    revision++; return receipt
  }
  await save()
  const grant = (taskId = x, scope = 'subtree', actions = ['read'], expectedVersion = 0) => h.service.grantTask(owner.token, {
    ...query, operationId: operationId(), taskId, scope, actions, expectedVersion, membershipId: member.membershipId,
  })
  const page = async (fields = {}, token: LoginToken = member.token) => {
    let page!: OrganizationTaskPage
    await h.service.readTasks(token, { ...query, ...fields }, (value) => { page = value })
    return page
  }
  const events = async (cursor: string) => {
    let batch!: OrganizationWorkgraphBatch
    await h.service.readWorkgraphEvents(member.token, { organizationId: owner.organizationId, cursor }, (value) => { batch = value })
    return batch
  }
  return { ...h, root, owner, member, query, definition, rootId, x, child, y, save, grant, page, events }
}

it('uses explicit node/subtree grants for details, searches and counts without hidden sentinels', async () => {
  const h = await setup()
  await expect(h.page()).rejects.toMatchObject({ code: 'forbidden' })
  await expect(h.page({ taskId: h.y })).rejects.toMatchObject({ code: 'forbidden' })
  await h.grant(h.x, 'node')
  const node = await h.page()
  expect(node.total).toBe(1)
  expect(node.items[0]).toMatchObject({ id: h.x, parentTaskId: null, dependsOn: [], status: 'blocked', hasUndisclosedPrerequisite: true })
  await h.grant()
  const subtree = await h.page()
  expect(subtree.total).toBe(2)
  for (const hidden of [h.y, h.rootId, 'HIDDEN_ROOT', 'HIDDEN_Y', 'HIDDEN_PHASE']) expect(JSON.stringify(subtree)).not.toContain(hidden)
  expect((await h.page({ search: 'HIDDEN' })).total).toBe(0)
  expect((await h.page({ search: 'child' })).items.map(t => t.id)).toEqual([h.child])
  await expect(h.service.readPlan(h.member.token, h.query, () => { throw new Error('leaked') })).rejects.toMatchObject({ code: 'forbidden' })
  await expect(h.service.savePlan(h.member.token, { ...h.query, definition: h.definition, expectedRevision: 1, operationId: operationId() })).rejects.toMatchObject({ code: 'forbidden' })
  await h.service.readTaskGrants(h.member.token, h.query, (grants) => {
    expect(grants.length).toBe(3)
    expect(JSON.stringify(grants)).not.toContain('HIDDEN')
  })
  await expect(h.grant(h.x, 'subtree', ['read', 'edit'])).rejects.toMatchObject({ code: 'version-conflict' })
})

it('invalidates pagination on grants and restart, while reopened pages retain only authorized rows', async () => {
  const h = await setup({ workgraphPageSize: 1 })
  const grant = await h.grant()
  const first = await h.page()
  expect(first.total).toBe(2); expect(first.items).toHaveLength(1)
  const second = await h.page({ offset: 1, cursor: first.cursor })
  expect(second.items[0]?.id).not.toBe(first.items[0]?.id)
  await expect(h.page({ offset: 1 })).rejects.toMatchObject({ code: 'snapshot-required' })
  await h.grant(h.x, 'subtree', [], grant.revision)
  await expect(h.page({ offset: 1, cursor: first.cursor })).rejects.toMatchObject({ code: 'snapshot-required' })
  await expect(h.events(first.cursor)).rejects.toMatchObject({ code: 'snapshot-required' })
  await h.close(); cleanup.pop()
  const reopened = await openHarness(h.root); cleanup.push(reopened.close)
  await expect(reopened.service.readTasks(h.member.token, { ...h.query, cursor: first.cursor }, () => {})).rejects.toMatchObject({ code: 'snapshot-required' })
  await expect(reopened.service.readTasks(h.member.token, h.query, () => {})).rejects.toMatchObject({ code: 'forbidden' })
})

it('intersects historical coverage after move, regrant and deletion without restoring old parents', async () => {
  const h = await setup()
  const grant = await h.grant()
  const first = await h.page()
  h.definition.tasks.find(t => t.id === h.child)!.parentTaskId = h.y
  await h.save()
  await expect(h.page()).rejects.toMatchObject({ code: 'forbidden' })
  await expect(h.events(first.cursor)).rejects.toMatchObject({ code: 'snapshot-required' })
  await h.grant(h.x, 'subtree', ['read'], grant.revision)
  expect((await h.page({ revision: 1 })).items.map(t => t.id)).toEqual([h.x])
  h.definition.tasks = h.definition.tasks.filter(t => t.id !== h.child)
  await h.save()
  let latest = 0
  await h.service.readTaskGrants(h.owner.token, h.query, (rows) => { latest = rows.find(g => g.taskId === h.x)!.version })
  await h.grant(h.x, 'subtree', ['read'], latest)
  expect((await h.page({ revision: 1 })).items.map(t => t.id)).toEqual([h.x])
})

it('notifies visible edits only after commit, filters hidden changes and rechecks queued deliveries', async () => {
  const h = await setup()
  const grant = await h.grant()
  const first = await h.page()
  h.definition.tasks.find(t => t.id === h.y)!.goal = 'HIDDEN_CHANGED'
  await h.save()
  const hidden = await h.events(first.cursor)
  expect(hidden.events).toEqual([])
  h.definition.tasks.find(t => t.id === h.x)!.goal = 'Visible changed'
  const receipt = await h.save()
  expect((await h.events(hidden.cursor)).events).toEqual([{ revision: receipt.revision, planId: h.query.planId }])
  const revoke = h.grant(h.x, 'subtree', [], grant.revision)
  const denied = expect(h.page({ revision: 1 })).rejects.toMatchObject({ code: 'forbidden' })
  await revoke; await denied
})

it('keeps grant writes atomic, idempotent and subject to current management rights', async () => {
  const h = await setup()
  const input = { ...h.query, operationId: operationId(), taskId: h.x, membershipId: h.member.membershipId,
    scope: 'node', actions: ['read'], expectedVersion: 0 }
  const db = new DatabaseSync(h.path)
  let notifications = 0
  h.ctx.on('organization/committed', () => { notifications++ })
  try {
    db.exec("CREATE TRIGGER reject_grant_receipt BEFORE INSERT ON operation_receipts BEGIN SELECT RAISE(ABORT,'test fault'); END")
    await expect(h.service.grantTask(h.member.token, input)).rejects.toThrow('test fault')
    expect(notifications).toBe(0)
    expect(db.prepare('SELECT * FROM task_grants WHERE membershipId=?').get(h.member.membershipId!)).toBeUndefined()
    db.exec('DROP TRIGGER reject_grant_receipt')
    const receipt = await h.service.grantTask(h.member.token, input)
    expect(await h.service.grantTask(h.member.token, input)).toEqual(receipt)
    expect(notifications).toBe(1)
    await expect(h.service.grantTask(h.member.token, { ...input, actions: [] })).rejects.toMatchObject({ code: 'operation-conflict' })
    const current = (await h.service.members(h.owner.token, h.owner.organizationId)).find(m => m.id === h.member.membershipId)!
    await h.service.execute(h.owner.token, { kind: 'set-membership', operationId: operationId(), organizationId: h.owner.organizationId,
      membershipId: current.id, role: 'member', enabled: true, expectedVersion: current.version })
    await expect(h.service.receipt(h.member.token, input.operationId)).rejects.toMatchObject({ code: 'forbidden' })
    await expect(h.service.grantTask(h.member.token, input)).rejects.toMatchObject({ code: 'forbidden' })
  } finally { db.close() }
})

it('bounds complete UTF-8 pages and grants and derives assignability from current member state', async () => {
  const h = await setup({ workgraphMaxGrants: 2 })
  await h.grant()
  await expect(h.grant(h.y)).rejects.toMatchObject({ code: 'invalid-input' })
  h.definition.tasks.find(t => t.id === h.x)!.suggestedMembershipId = h.member.membershipId!
  await h.save()
  const before = await h.page()
  expect(before.items.find(t => t.id === h.x)!.assignable).toBe(true)
  const current = (await h.service.members(h.owner.token, h.owner.organizationId)).find(m => m.id === h.member.membershipId)!
  await h.service.execute(h.owner.token, { kind: 'set-membership', operationId: operationId(), organizationId: h.owner.organizationId,
    membershipId: current.id, role: 'admin', enabled: false, expectedVersion: current.version })
  expect((await h.page({}, h.owner.token)).items.find(t => t.id === h.x)!.assignable).toBe(false)
  await expect(h.page()).rejects.toMatchObject({ code: 'forbidden' })
  const bounded = await openHarness(h.root, { workgraphMaxBytes: 256 }); cleanup.push(bounded.close)
  await expect(bounded.service.readTasks(h.owner.token, h.query, () => { throw new Error('oversize') })).rejects.toMatchObject({ code: 'invalid-input' })
})

it('rejects foreign organizations and actors, execution fields and cross-account cursors', async () => {
  const h = await setup()
  await h.grant()
  const page = await h.page()
  await expect(h.page({ cursor: page.cursor }, h.owner.token)).rejects.toMatchObject({ code: 'snapshot-required' })
  const other = await h.service.execute(h.owner.token, { kind: 'create-organization', name: 'Beta', operationId: operationId() })
  await expect(h.page({ organizationId: other.organizationId })).rejects.toMatchObject({ code: 'forbidden' })
  for (const key of ['actor', 'accountId', 'approve', 'dispatch', 'claim', 'submit', 'completed']) {
    await expect(h.page({ [key]: true })).rejects.toMatchObject({ code: 'invalid-input' })
  }
})
