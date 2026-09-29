/** Real Loader/SQLite approval authority, transaction faults and irreversible invalidation. */
import { randomUUID } from 'node:crypto'
import { afterEach, expect, it } from 'vitest'
import { openHarness, addMember, operationId } from './harness.ts'
import { openOrganizationDatabase } from '../src/database.ts'
import { assignmentHarness } from './assignment-harness.ts'

const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })
const setup = () => assignmentHarness(cleanup)

it('atomically persists exact-version approval, request, notification and author, then reopens and replays without another event', async () => {
  const h = await setup()
  let observed = 0
  h.ctx.on('organization/committed', () => {
    expect(h.db.prepare('SELECT count(*) AS n FROM assignment_notifications').get()?.n).toBe(1)
    observed++
  })
  const receipt = await h.service.assignmentCommand(h.owner.token, h.approve)
  expect(await h.read(receipt.assignmentId!)).toMatchObject({ approvedBy: h.owner.membershipId, assigneeId: h.other.membershipId,
    state: 'pending', planRevision: 1, createdRevision: receipt.revision })
  expect(await h.read(receipt.assignmentId!, h.other.token)).toMatchObject({ state: 'pending' })
  expect(h.db.prepare('SELECT state,kind,expiresAt FROM assignment_requests').get()).toMatchObject({ state: 'pending', kind: 'accept-assignment', expiresAt: null })
  expect(await h.service.assignmentCommand(h.owner.token, h.approve)).toEqual(receipt)
  expect(await h.service.receipt(h.owner.token, h.approve.operationId)).toEqual(receipt)
  expect(observed).toBe(1)
  await h.close()
  const reopened = await openHarness(h.root); cleanup.push(reopened.close)
  expect(await reopened.service.receipt(h.owner.token, h.approve.operationId)).toEqual(receipt)
  await reopened.service.readAssignment(h.other.token, { ...h.query, assignmentId: receipt.assignmentId }, (value) => { expect(value.state).toBe('pending') })
})

it('serializes competing approvals and rejects changed operation content and spoofed authors', async () => {
  const h = await setup()
  const results = await Promise.allSettled([h.approve, { ...h.approve, operationId: operationId() }]
    .map(input => h.service.assignmentCommand(h.owner.token, input)))
  expect(results.filter(item => item.status === 'fulfilled')).toHaveLength(1)
  expect(results.find(item => item.status === 'rejected')).toMatchObject({ reason: { code: 'version-conflict' } })
  await expect(h.service.assignmentCommand(h.owner.token, { ...h.approve, assigneeId: h.owner.membershipId })).rejects.toMatchObject({ code: 'operation-conflict' })
  await expect(h.service.assignmentCommand(h.owner.token, { ...h.approve, approvedBy: h.other.membershipId })).rejects.toMatchObject({ code: 'invalid-input' })
})

it('rolls back assignment, request, notification, audit and invalidations when the final receipt write fails', async () => {
  const h = await setup()
  const before = h.db.prepare('SELECT count(*) AS n FROM organization_events').get()
  let observed = 0
  h.ctx.on('organization/committed', () => { observed++ })
  h.db.exec("CREATE TRIGGER reject_receipt BEFORE INSERT ON operation_receipts BEGIN SELECT RAISE(ABORT,'injected disk fault'); END")
  await expect(h.service.assignmentCommand(h.owner.token, h.approve)).rejects.toThrow('injected disk fault')
  for (const table of ['task_assignments', 'assignment_requests', 'assignment_notifications']) expect(h.db.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n).toBe(0)
  expect(h.db.prepare('SELECT count(*) AS n FROM organization_events').get()).toEqual(before)
  expect(observed).toBe(0)
  expect(await h.service.receipt(h.owner.token, h.approve.operationId)).toBeNull()
  h.db.exec('DROP TRIGGER reject_receipt')
  const receipt = await h.service.assignmentCommand(h.owner.token, h.approve)
  h.db.exec("CREATE TRIGGER reject_receipt BEFORE INSERT ON operation_receipts BEGIN SELECT RAISE(ABORT,'injected disk fault'); END")
  await expect(h.projectGrant(h.other.membershipId!, [], h.otherGrant.revision)).rejects.toThrow('injected disk fault')
  expect((await h.read(receipt.assignmentId!)).state).toBe('pending')
})

it('revokes once, preserves history and permits a fresh approval without reviving an old receipt', async () => {
  const h = await setup()
  const receipt = await h.service.assignmentCommand(h.owner.token, h.approve)
  const revoke = { ...h.query, kind: 'revoke-assignment', operationId: operationId(), assignmentId: receipt.assignmentId, expectedVersion: receipt.revision }
  await expect(h.service.assignmentCommand(h.other.token, revoke)).rejects.toMatchObject({ code: 'forbidden' })
  const revoked = await h.service.assignmentCommand(h.owner.token, revoke)
  expect(await h.service.assignmentCommand(h.owner.token, revoke)).toEqual(revoked)
  expect((await h.read(receipt.assignmentId!)).state).toBe('revoked')
  expect(h.db.prepare('SELECT state FROM assignment_requests').get()?.state).toBe('cancelled')
  await expect(h.service.assignmentCommand(h.owner.token, { ...revoke, operationId: operationId() })).rejects.toMatchObject({ code: 'version-conflict' })
  const next = await h.service.assignmentCommand(h.owner.token, { ...h.approve, operationId: operationId() })
  expect(next.assignmentId).not.toBe(receipt.assignmentId)
  expect(await h.service.assignmentCommand(h.owner.token, h.approve)).toEqual(receipt)
  expect((await h.read(receipt.assignmentId!)).state).toBe('revoked')
  const reopened = openOrganizationDatabase(h.path, 100); reopened.close()
})

it.each(['project', 'task', 'member', 'account', 'author'] as const)('permanently invalidates on %s authority loss and does not revive after regrant', async (mode) => {
  const h = await setup()
  const receipt = await h.service.assignmentCommand(h.owner.token, h.approve)
  if (mode === 'project' || mode === 'author') {
    const member = mode === 'project' ? h.other.membershipId! : h.owner.membershipId
    const version = mode === 'project' ? h.otherGrant.revision : h.ownerGrant.revision
    const revoked = await h.projectGrant(member, [], version)
    if (mode === 'project') await expect(h.read(receipt.assignmentId!, h.other.token)).rejects.toMatchObject({ code: 'forbidden' })
    else await expect(h.service.receipt(h.owner.token, h.approve.operationId)).rejects.toMatchObject({ code: 'forbidden' })
    await h.projectGrant(member, ['read', 'write'], revoked.revision)
  } else if (mode === 'task') {
    const input = { ...h.query, operationId: operationId(), taskId: h.approve.taskId, membershipId: h.other.membershipId,
      scope: 'node', actions: [] as string[], expectedVersion: h.taskGrant.revision }
    const revoked = await h.service.grantTask(h.owner.token, input)
    await expect(h.read(receipt.assignmentId!, h.other.token)).rejects.toMatchObject({ code: 'forbidden' })
    await h.service.grantTask(h.owner.token, { ...input, operationId: operationId(), actions: ['read'], expectedVersion: revoked.revision })
  } else {
    const member = (await h.service.members(h.owner.token, h.owner.organizationId)).find(value => value.id === h.other.membershipId)!
    const input = mode === 'member'
      ? { kind: 'set-membership', organizationId: h.owner.organizationId, membershipId: member.id, role: 'member', expectedVersion: member.version }
      : { kind: 'set-account', accountId: member.accountId, expectedVersion: member.accountVersion }
    const revoked = await h.service.execute(h.owner.token, { ...input, operationId: operationId(), enabled: false })
    await h.service.execute(h.owner.token, { ...input, operationId: operationId(), expectedVersion: revoked.revision, enabled: true })
  }
  expect(await h.read(receipt.assignmentId!)).toMatchObject({ state: 'invalidated', reason: 'authority-lost' })
  expect(h.db.prepare('SELECT state FROM assignment_requests').get()?.state).toBe('cancelled')
  expect(await h.service.assignmentCommand(h.owner.token, h.approve)).toEqual(receipt)
  const reopened = openOrganizationDatabase(h.path, 100); reopened.close()
})

it('denies admin approval without root edit, recipient missing read and stale revisions', async () => {
  const h = await setup()
  const admin = await addMember(h.service, h.owner.token, h.owner.organizationId, 'admin2', 'admin')
  await h.projectGrant(admin.membershipId!, ['read', 'write'])
  await expect(h.service.assignmentCommand(admin.token, h.approve)).rejects.toMatchObject({ code: 'forbidden' })
  await expect(h.service.assignmentCommand(h.owner.token, { ...h.approve, assigneeId: admin.membershipId })).rejects.toMatchObject({ code: 'forbidden' })
  await expect(h.service.assignmentCommand(h.owner.token, { ...h.approve, planRevision: 2 })).rejects.toMatchObject({ code: 'version-conflict' })
  const receipt = await h.service.assignmentCommand(h.owner.token, h.approve)
  await expect(h.read(receipt.assignmentId!, admin.token)).rejects.toMatchObject({ code: 'forbidden' })
  const organization = await h.service.execute(h.owner.token, { kind: 'create-organization', operationId: operationId(), name: 'Other' })
  await expect(h.service.assignmentCommand(h.owner.token, { ...h.approve, organizationId: organization.organizationId })).rejects.toMatchObject({ code: 'forbidden' })
})

it('serializes approve/edit in either order and permanently retires even text-only old definitions', async () => {
  const h = await setup()
  const [receipt] = await Promise.all([
    h.service.assignmentCommand(h.owner.token, h.approve),
    h.service.savePlan(h.owner.token, { ...h.save, operationId: operationId(), expectedRevision: 1 }),
  ])
  expect(await h.read(receipt.assignmentId!)).toMatchObject({ state: 'invalidated', reason: 'revision-changed' })
  const outcomes = await Promise.allSettled([
    h.service.savePlan(h.owner.token, { ...h.save, operationId: operationId(), expectedRevision: 2 }),
    h.service.assignmentCommand(h.owner.token, { ...h.approve, operationId: operationId(), planRevision: 2 }),
  ])
  expect(outcomes[1]).toMatchObject({ status: 'rejected', reason: { code: 'version-conflict' } })
  const reopened = openOrganizationDatabase(h.path, 100); reopened.close()
})

it('rejects non-leaves and all unsatisfied prerequisites including those inherited from a parent', async () => {
  const h = await setup()
  const definition = structuredClone(h.save.definition)
  const root = definition.tasks[0]!
  const branch = { ...root, id: randomUUID(), parentTaskId: root.id }
  const dependency = { ...root, id: randomUUID(), parentTaskId: root.id }
  const leaf = { ...root, id: randomUUID(), parentTaskId: branch.id }
  branch.dependsOn = [dependency.id]
  definition.tasks.push(branch, dependency, leaf)
  await h.service.savePlan(h.owner.token, { ...h.save, definition, operationId: operationId(), expectedRevision: 1 })
  for (const taskId of [root.id, branch.id, leaf.id]) {
    await expect(h.service.assignmentCommand(h.owner.token, {
      ...h.approve, operationId: operationId(), taskId, planRevision: 2, assigneeId: h.owner.membershipId,
    }))
      .rejects.toMatchObject({ code: 'invalid-input' })
  }
  await h.service.assignmentCommand(h.owner.token, {
    ...h.approve, operationId: operationId(), taskId: dependency.id, planRevision: 2, assigneeId: h.owner.membershipId,
  })
})

it('migrates v3 atomically and rolls back DDL/version when the old database is invalid', async () => {
  const h = await setup()
  await h.close()
  h.db.exec('DROP TABLE execution_human_requests; DROP TABLE execution_events; DROP TABLE execution_actions; DROP TABLE execution_runs; DROP TABLE execution_delegations; DROP TABLE device_actions; DROP TABLE assignment_leases; DROP TABLE organization_devices; DROP TABLE assignment_actions; DROP TABLE assignment_delegations; DROP TABLE assignment_notifications; DROP TABLE assignment_requests; DROP TABLE task_assignments; PRAGMA user_version=3')
  h.db.exec('UPDATE plan_tasks SET active=0')
  expect(() => openOrganizationDatabase(h.path, 100)).toThrow('incompatible-store')
  expect(h.db.prepare('PRAGMA user_version').get()?.user_version).toBe(3)
  expect(h.db.prepare("SELECT name FROM sqlite_master WHERE name='task_assignments'").get()).toBeUndefined()
  h.db.exec('UPDATE plan_tasks SET active=1')
  const migrated = await openHarness(h.root); cleanup.push(migrated.close)
  expect(h.db.prepare('PRAGMA user_version').get()?.user_version).toBe(8)
  await migrated.service.assignmentCommand(h.owner.token, h.approve)
})

it.each(['request', 'notification', 'author', 'receipt', 'state'])('refuses damaged %s facts on database reopen', async (damage) => {
  const h = await setup()
  await h.service.assignmentCommand(h.owner.token, h.approve)
  await h.close()
  h.db.exec('PRAGMA foreign_keys=OFF')
  switch (damage) {
    case 'request': h.db.exec('DELETE FROM assignment_requests'); break
    case 'notification': h.db.exec('DELETE FROM assignment_notifications'); break
    case 'author': h.db.prepare('UPDATE task_assignments SET approvedBy=?').run(h.other.membershipId!); break
    case 'receipt': h.db.prepare("UPDATE operation_receipts SET response=json_set(response,'$.planRevision',2) WHERE operationId=?").run(h.approve.operationId); break
    case 'state': h.db.exec("UPDATE assignment_requests SET state='cancelled'"); break
  }
  expect(() => openOrganizationDatabase(h.path, 100)).toThrow('incompatible-store')
})

it.each(['member', 'account', 'project'])('refuses approval when target %s authority is already absent', async (mode) => {
  const h = await setup()
  const member = (await h.service.members(h.owner.token, h.owner.organizationId)).find(value => value.id === h.other.membershipId)!
  if (mode === 'project') await h.projectGrant(member.id, [], h.otherGrant.revision)
  else {
    const command = mode === 'member'
      ? { kind: 'set-membership', organizationId: h.owner.organizationId, membershipId: member.id, role: 'member', expectedVersion: member.version }
      : { kind: 'set-account', accountId: member.accountId, expectedVersion: member.accountVersion }
    await h.service.execute(h.owner.token, { ...command, operationId: operationId(), enabled: false })
  }
  await expect(h.service.assignmentCommand(h.owner.token, h.approve)).rejects.toMatchObject({ code: 'forbidden' })
  expect(h.db.prepare('SELECT count(*) AS n FROM task_assignments').get()?.n).toBe(0)
})

it('rolls back new v4 tables when validation fails after migration DDL', async () => {
  const h = await setup()
  await h.close()
  h.db.exec('DROP TABLE execution_human_requests; DROP TABLE execution_events; DROP TABLE execution_actions; DROP TABLE execution_runs; DROP TABLE execution_delegations; DROP TABLE device_actions; DROP TABLE assignment_leases; DROP TABLE organization_devices; DROP TABLE assignment_actions; DROP TABLE assignment_delegations; DROP TABLE assignment_notifications; DROP TABLE assignment_requests; DROP TABLE task_assignments; PRAGMA user_version=3')
  h.db.prepare("INSERT INTO organization_events(kind,actorId,organizationId,at) VALUES ('approve-assignment',?,?,?)")
    .run(h.owner.accountId, h.owner.organizationId, Date.now())
  expect(() => openOrganizationDatabase(h.path, 100)).toThrow('incompatible-store')
  expect(h.db.prepare('PRAGMA user_version').get()?.user_version).toBe(3)
  expect(h.db.prepare("SELECT name FROM sqlite_master WHERE name IN ('task_assignments','assignment_requests','assignment_notifications')").all()).toEqual([])
})

it('answers exactly once, keeps notification reads separate and reopens processed facts', async () => {
  const h = await setup()
  const approved = await h.service.assignmentCommand(h.owner.token, h.approve)
  let entry: import('../src/assignment-types.ts').OrganizationInboxItem | undefined
  await h.service.readInbox(h.other.token, { organizationId: h.query.organizationId }, (page) => {
    entry = page.items[0]; expect(page.total).toBe(1)
  })
  const item = entry!
  await h.service.participantCommand(h.other.token, { ...h.query, assignmentId: approved.assignmentId,
    kind: 'read-notification', operationId: operationId(), notificationId: item.notificationId })
  expect((await h.read(approved.assignmentId!)).state).toBe('pending')
  const answer = { ...h.query, assignmentId: approved.assignmentId, requestId: item.request.id,
    kind: 'answer-assignment', expectedVersion: approved.revision, answer: 'accepted', operationId: operationId() }
  await expect(h.service.participantCommand(h.owner.token, answer)).rejects.toMatchObject({ code: 'forbidden' })
  const results = await Promise.allSettled([answer, { ...answer, answer: 'rejected', operationId: operationId() }]
    .map(input => h.service.participantCommand(h.other.token, input)))
  expect(results[0].status).toBe('fulfilled')
  expect(results[1]).toMatchObject({ status: 'rejected', reason: { code: 'version-conflict' } })
  const receipt = await h.service.participantCommand(h.other.token, answer)
  expect(await h.service.receipt(h.other.token, answer.operationId)).toEqual(receipt)
  await expect(h.service.participantCommand(h.other.token, { ...answer, answer: 'rejected' })).rejects.toMatchObject({ code: 'operation-conflict' })
  await h.close()
  const reopened = await openHarness(h.root); cleanup.push(reopened.close)
  await reopened.service.readInbox(h.other.token, { organizationId: h.query.organizationId, state: 'processed' }, (page) => {
    expect(page.items[0]?.request).toMatchObject({ state: 'accepted', answeredRevision: receipt.revision })
    expect(page.items[0]?.assignment.state).toBe('accepted')
  })
  expect(await reopened.service.receipt(h.other.token, answer.operationId)).toEqual(receipt)
})

it('filters inbox counts and invalidates pagination and accepted work after lost authority', async () => {
  const h = await setup()
  const approved = await h.service.assignmentCommand(h.owner.token, h.approve)
  let cursor = '', requestId = ''
  await h.service.readInbox(h.other.token, { organizationId: h.query.organizationId }, (page) => {
    cursor = page.cursor; requestId = page.items[0]!.request.id
  })
  const answer = { ...h.query, assignmentId: approved.assignmentId, requestId, kind: 'answer-assignment', expectedVersion: approved.revision,
    answer: 'accepted', operationId: operationId() }
  await h.service.participantCommand(h.other.token, answer)
  const removed = await h.projectGrant(h.other.membershipId!, [], h.otherGrant.revision)
  await h.service.readInbox(h.other.token, { organizationId: h.query.organizationId, search: 'Approved' }, (page) => { expect(page.total).toBe(0); expect(page.unread).toBe(0) })
  await expect(h.service.readInbox(h.other.token, { organizationId: h.query.organizationId, cursor, offset: 1 }, () => {})).rejects.toMatchObject({ code: 'snapshot-required' })
  await expect(h.service.receipt(h.other.token, answer.operationId)).rejects.toMatchObject({ code: 'forbidden' })
  await h.projectGrant(h.other.membershipId!, ['read'], removed.revision)
  expect((await h.read(approved.assignmentId!)).state).toBe('invalidated')
  expect(h.db.prepare('SELECT state FROM assignment_requests').get()?.state).toBe('accepted')
  const reopened = openOrganizationDatabase(h.path, 100); reopened.close()
})

it('rejects expired requests and rolls an answer back together with its notification and audit', async () => {
  const h = await setup()
  const approved = await h.service.assignmentCommand(h.owner.token, h.approve)
  const requestId = String(h.db.prepare('SELECT id FROM assignment_requests').get()?.id)
  const answer = { ...h.query, assignmentId: approved.assignmentId, requestId, kind: 'answer-assignment', expectedVersion: approved.revision,
    answer: 'rejected', operationId: operationId() }
  h.db.prepare('UPDATE assignment_requests SET expiresAt=?').run(Date.now() - 1)
  await expect(h.service.participantCommand(h.other.token, answer)).rejects.toMatchObject({ code: 'version-conflict' })
  await h.service.readInbox(h.other.token, { organizationId: h.query.organizationId }, (page) => { expect(page.items[0]?.request.state).toBe('expired') })
  h.db.exec('UPDATE assignment_requests SET expiresAt=NULL')
  h.db.exec("CREATE TRIGGER reject_receipt BEFORE INSERT ON operation_receipts BEGIN SELECT RAISE(ABORT,'answer fault'); END")
  await expect(h.service.participantCommand(h.other.token, answer)).rejects.toThrow('answer fault')
  expect(h.db.prepare('SELECT state,answeredRevision FROM assignment_requests').get()).toMatchObject({ state: 'pending', answeredRevision: null })
  expect(h.db.prepare('SELECT count(*) AS n FROM assignment_actions').get()?.n).toBe(0)
  h.db.exec('DROP TRIGGER reject_receipt')
  await h.service.participantCommand(h.other.token, answer)
  expect((await h.read(approved.assignmentId!)).state).toBe('rejected')
  await h.service.assignmentCommand(h.owner.token, { ...h.approve, operationId: operationId() })
})

it('upgrades a v4 approval with its null deadline and original receipt intact', async () => {
  const h = await setup(), receipt = await h.service.assignmentCommand(h.owner.token, h.approve)
  await h.close()
  h.db.exec(`DROP TABLE execution_human_requests; DROP TABLE execution_events; DROP TABLE execution_actions; DROP TABLE execution_runs; DROP TABLE execution_delegations; DROP TABLE device_actions; DROP TABLE assignment_leases; DROP TABLE organization_devices;
    DROP TABLE assignment_actions; DROP TABLE assignment_delegations;
    ALTER TABLE assignment_requests DROP COLUMN answeredRevision;
    ALTER TABLE assignment_notifications DROP COLUMN readAt;
    PRAGMA user_version=4`)
  const reopened = await openHarness(h.root); cleanup.push(reopened.close)
  expect(await reopened.service.receipt(h.owner.token, h.approve.operationId)).toEqual(receipt)
  await reopened.service.readInbox(h.other.token, { organizationId: h.query.organizationId }, (page) => {
    expect(page.items[0]?.request).toMatchObject({ state: 'pending', expiresAt: null, answeredRevision: null })
  })
  expect(h.db.prepare('PRAGMA user_version').get()?.user_version).toBe(8)
})

it('delivers only authorized inbox invalidations and requires a snapshot after revoke', async () => {
  const h = await setup()
  let cursor = '', ownerCursor = ''
  await h.service.readInbox(h.other.token, { organizationId: h.query.organizationId }, (page) => { cursor = page.cursor })
  await h.service.readInbox(h.owner.token, { organizationId: h.query.organizationId }, (page) => { ownerCursor = page.cursor })
  const approved = await h.service.assignmentCommand(h.owner.token, h.approve)
  await h.service.readInboxEvents(h.other.token, { organizationId: h.query.organizationId, cursor }, (batch) => {
    expect(batch.events).toEqual([{ assignmentId: approved.assignmentId, revision: approved.revision }])
    cursor = batch.cursor
  })
  await h.service.readInboxEvents(h.owner.token, { organizationId: h.query.organizationId, cursor: ownerCursor }, (batch) => {
    expect(batch.events).toEqual([])
  })
  await h.projectGrant(h.other.membershipId!, [], h.otherGrant.revision)
  await expect(h.service.readInboxEvents(h.other.token, { organizationId: h.query.organizationId, cursor }, () => {})).rejects.toMatchObject({ code: 'snapshot-required' })
})

it('previews a visibility gap without granting access or creating an approval', async () => {
  const h = await setup()
  const { kind: _kind, operationId: _operationId, ...review } = h.approve
  await h.service.readApproval(h.owner.token, review, (value) => { expect(value.assigneeCanRead).toBe(true) })
  await h.projectGrant(h.other.membershipId!, [], h.otherGrant.revision)
  await h.service.readApproval(h.owner.token, review, (value) => { expect(value.assigneeCanRead).toBe(false) })
  expect(h.db.prepare('SELECT COUNT(*) AS count FROM task_assignments').get()?.count).toBe(0)
  await expect(h.service.assignmentCommand(h.owner.token, h.approve)).rejects.toMatchObject({ code: 'forbidden' })
})
