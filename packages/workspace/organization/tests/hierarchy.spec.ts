/** Loader-backed reporting authority, assignment admission and durable SQL migration. */
import { afterEach, expect, it } from 'vitest'
import { assignmentHarness } from './assignment-harness.ts'
import { addMember, operationId } from './harness.ts'
import { openOrganizationDatabase, ORGANIZATION_SCHEMA_VERSION } from '../src/database.ts'
const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })
it('allows self and direct reports, refuses peers and indirect reports, and retires approvals when reporting changes', async () => {
  const h = await assignmentHarness(cleanup)
  const manager = await addMember(h.service, h.owner.token, h.owner.organizationId, 'manager')
  const lead = await addMember(h.service, h.owner.token, h.owner.organizationId, 'lead')
  await h.projectGrant(manager.membershipId!, ['read', 'write'])
  await h.projectGrant(lead.membershipId!, ['read', 'write'])
  for (const member of [manager, lead]) await h.service.grantTask(h.owner.token, { ...h.query, operationId: operationId(),
    taskId: h.save.definition.taskId, membershipId: member.membershipId, scope: 'subtree', actions: ['read', 'edit'], expectedVersion: 0 })
  await expect(h.service.assignmentCommand(manager.token, h.approve)).rejects.toMatchObject({ code: 'forbidden' })
  const link = { kind: 'set-supervisor', organizationId: h.owner.organizationId, membershipId: h.other.membershipId,
    supervisorId: manager.membershipId, expectedVersion: 0, operationId: operationId() }
  await expect(h.service.execute(manager.token, link)).rejects.toMatchObject({ code: 'forbidden' })
  const linked = await h.service.execute(h.owner.token, link)
  await expect(h.service.execute(h.owner.token, link)).resolves.toEqual(linked)
  await h.service.execute(h.owner.token, { ...link, membershipId: manager.membershipId,
    supervisorId: lead.membershipId, operationId: operationId() })
  await expect(h.service.assignmentCommand(lead.token, h.approve)).rejects.toMatchObject({ code: 'forbidden' })
  await h.projectGrant(h.other.membershipId!, [], h.otherGrant.revision)
  await h.service.grantTask(h.owner.token, { ...h.query, operationId: operationId(), taskId: h.approve.taskId,
    membershipId: h.other.membershipId, scope: 'subtree', actions: [], expectedVersion: h.taskGrant.revision })
  const receipt = await h.service.assignmentCommand(manager.token, h.approve)
  expect(h.db.prepare('SELECT canRead,canWrite FROM resource_grants WHERE membershipId=?').get(h.other.membershipId!))
    .toMatchObject({ canRead: 1, canWrite: 1 })
  expect(h.db.prepare('SELECT canRead,canEdit FROM task_grants WHERE membershipId=?').get(h.other.membershipId!))
    .toMatchObject({ canRead: 1, canEdit: 1 })
  expect((await h.read(receipt.assignmentId!)).state).toBe('pending')
  await h.service.execute(h.owner.token, { ...link, supervisorId: null, expectedVersion: linked.revision,
    operationId: operationId() })
  expect((await h.read(receipt.assignmentId!)).state).toBe('invalidated')
  await expect(h.service.assignmentCommand(manager.token, { ...h.approve, operationId: operationId() }))
    .rejects.toMatchObject({ code: 'forbidden' })
  const own = await h.service.assignmentCommand(manager.token, { ...h.approve, assigneeId: manager.membershipId,
    operationId: operationId() })
  expect((await h.read(own.assignmentId!)).assigneeId).toBe(manager.membershipId)
  const chart = await h.service.hierarchy(h.other.token, h.owner.organizationId)
  expect(chart.find(n => n.id === manager.membershipId)?.supervisorId).toBe(lead.membershipId)
  expect(chart.some(n => 'accountId' in n || 'passwordHash' in n)).toBe(false)
})
it('rejects cycles, cross-organization parents and stale versions without changing the chart', async () => {
  const h = await assignmentHarness(cleanup)
  const first = await h.service.execute(h.owner.token, { kind: 'set-supervisor', operationId: operationId(),
    organizationId: h.owner.organizationId, membershipId: h.other.membershipId, supervisorId: h.owner.membershipId, expectedVersion: 0 })
  const chart = await h.service.hierarchy(h.owner.token, h.owner.organizationId)
  await expect(h.service.execute(h.owner.token, { kind: 'set-supervisor', operationId: operationId(), organizationId: h.owner.organizationId,
    membershipId: h.owner.membershipId, supervisorId: h.other.membershipId, expectedVersion: 0 })).rejects.toMatchObject({ code: 'invalid-input' })
  await expect(h.service.execute(h.owner.token, { kind: 'set-supervisor', operationId: operationId(), organizationId: h.owner.organizationId,
    membershipId: h.other.membershipId, supervisorId: null, expectedVersion: 0 })).rejects.toMatchObject({ code: 'version-conflict' })
  const otherOrg = await h.service.execute(h.other.token, { kind: 'create-organization', name: 'Other', operationId: operationId() })
  await expect(h.service.execute(h.owner.token, { kind: 'set-supervisor', operationId: operationId(), organizationId: h.owner.organizationId,
    membershipId: h.other.membershipId, supervisorId: otherOrg.membershipId, expectedVersion: first.revision })).rejects.toMatchObject({ code: 'forbidden' })
  expect(await h.service.hierarchy(h.owner.token, h.owner.organizationId)).toEqual(chart)
})
it('upgrades v14 without changing assignments and rejects persisted reporting cycles', async () => {
  const h = await assignmentHarness(cleanup)
  const receipt = await h.service.assignmentCommand(h.owner.token, h.approve)
  await h.close()
  h.db.exec('DROP TABLE organization_hierarchy; PRAGMA user_version=14')
  const migrated = openOrganizationDatabase(h.path, 5000)
  try {
    expect(migrated.prepare('PRAGMA user_version').get()?.user_version).toBe(ORGANIZATION_SCHEMA_VERSION)
    expect(migrated.prepare('SELECT state FROM task_assignments WHERE id=?').get(receipt.assignmentId!)?.state).toBe('pending')
    migrated.prepare('INSERT INTO organization_hierarchy VALUES (?,?,?)').run(h.owner.membershipId, h.other.membershipId!, 1)
    migrated.prepare('INSERT INTO organization_hierarchy VALUES (?,?,?)').run(h.other.membershipId!, h.owner.membershipId, 2)
  } finally { migrated.close() }
  expect(() => openOrganizationDatabase(h.path, 5000)).toThrow('incompatible-store')
})
