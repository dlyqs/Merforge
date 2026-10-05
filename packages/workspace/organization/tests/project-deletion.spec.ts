/** Creator-only shared deletion and durable deletion records through the real Loader authority. */
import { afterEach, expect, it } from 'vitest'
import { assignmentHarness } from './assignment-harness.ts'
import { operationId } from './harness.ts'
import { openOrganizationDatabase, ORGANIZATION_SCHEMA_VERSION } from '../src/database.ts'
const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })

it('refuses non-creators and stale versions, revokes all readers and reconciles the creator deletion after restart', async () => {
  const h = await assignmentHarness(cleanup)
  const input = { kind: 'delete-project', operationId: operationId(), organizationId: h.owner.organizationId,
    projectId: h.query.projectId, expectedVersion: Number(h.db.prepare('SELECT version FROM organization_projects WHERE id=?').get(h.query.projectId!)?.version) }
  await expect(h.service.projectCommand(h.other.token, input)).rejects.toMatchObject({ code: 'forbidden' })
  await expect(h.service.projectCommand(h.owner.token, { ...input, expectedVersion: 0 })).rejects.toMatchObject({ code: 'version-conflict' })
  const receipt = await h.service.projectCommand(h.owner.token, input)
  await expect(h.service.projectCommand(h.owner.token, input)).resolves.toEqual(receipt)
  const query = { organizationId: h.query.organizationId, projectId: h.query.projectId }
  for (const person of [h.owner, h.other]) {
    await expect(h.service.readProject(person.token, query, () => {})).rejects.toMatchObject({ code: 'forbidden' })
    await h.service.readProjects(person.token, { organizationId: query.organizationId }, page => { expect(page.total).toBe(0) })
    await h.service.readDeletedProjects(person.token, { organizationId: query.organizationId }, page => {
      expect(page.items).toEqual([query.projectId]); expect(page.total).toBe(1)
    })
  }
  await expect(h.service.grant(h.owner.token, { kind: 'set-grant', operationId: operationId(), ...query,
    membershipId: h.other.membershipId, expectedVersion: receipt.revision, actions: ['read'] })).rejects.toMatchObject({ code: 'forbidden' })
  expect(h.db.prepare('SELECT canRead,canWrite FROM resource_grants WHERE projectId=?').all(query.projectId))
    .toEqual([expect.objectContaining({ canRead: 0, canWrite: 0 }), expect.objectContaining({ canRead: 0, canWrite: 0 })])
  const employeeProject = await h.service.projectCommand(h.other.token, { kind: 'create-project', operationId: operationId(),
    organizationId: query.organizationId, name: 'Employee-created project' })
  await h.service.grant(h.owner.token, { kind: 'set-grant', operationId: operationId(), organizationId: query.organizationId,
    projectId: employeeProject.projectId, membershipId: h.owner.membershipId, expectedVersion: 0, actions: ['read', 'write'] })
  const employeeDeletion = { ...input, operationId: operationId(), projectId: employeeProject.projectId, expectedVersion: employeeProject.revision }
  await expect(h.service.projectCommand(h.owner.token, employeeDeletion)).rejects.toMatchObject({ code: 'forbidden' })
  await expect(h.service.projectCommand(h.other.token, employeeDeletion)).resolves.toMatchObject({ projectId: employeeProject.projectId })
  await h.close()
  const reopened = openOrganizationDatabase(h.path, 5000)
  try { expect(reopened.prepare('SELECT deletedRevision FROM organization_project_lifecycle WHERE projectId=?').get(query.projectId)?.deletedRevision).toBe(receipt.revision) }
  finally { reopened.close() }
})

it('backfills v16 creators from immutable creation events and refuses corrupted deletion ownership', async () => {
  const h = await assignmentHarness(cleanup)
  await h.close()
  h.db.exec('DROP TABLE organization_project_lifecycle; DROP TABLE tree_requests; DROP TABLE plan_contexts; PRAGMA user_version=16')
  const migrated = openOrganizationDatabase(h.path, 5000)
  try {
    expect(migrated.prepare('PRAGMA user_version').get()?.user_version).toBe(ORGANIZATION_SCHEMA_VERSION)
    expect(migrated.prepare('SELECT createdBy,deletedRevision FROM organization_project_lifecycle WHERE projectId=?').get(h.query.projectId))
      .toMatchObject({ createdBy: h.owner.accountId, deletedRevision: null })
    migrated.prepare('UPDATE organization_project_lifecycle SET createdBy=? WHERE projectId=?').run(h.other.accountId!, h.query.projectId)
  } finally { migrated.close() }
  expect(() => openOrganizationDatabase(h.path, 5000)).toThrow('incompatible-store')
})
