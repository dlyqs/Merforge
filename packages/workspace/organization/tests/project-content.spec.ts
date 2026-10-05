/** Persisted project context and creator-only editing through the Loader authority. */
import { afterEach, expect, it } from 'vitest'
import { assignmentHarness } from './assignment-harness.ts'
import { operationId } from './harness.ts'
import { openOrganizationDatabase, ORGANIZATION_SCHEMA_VERSION } from '../src/database.ts'
const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })

it('saves project content, rejects a writable participant and includes current context in conversation authorization', async () => {
  const h = await assignmentHarness(cleanup)
  const query = { organizationId: h.query.organizationId, projectId: h.query.projectId }
  let version = 0
  await h.service.readProject(h.owner.token, query, (project) => { version = project.version })
  const command = { ...query, kind: 'update-project', expectedVersion: version, name: 'Renamed project',
    background: 'Shared product requirements', summary: 'Release overview', goal: 'Ship a tested release', operationId: operationId() }
  await expect(h.service.projectCommand(h.other.token, command)).rejects.toMatchObject({ code: 'forbidden' })
  await expect(h.service.projectCommand(h.other.token, { ...query, kind: 'rename-project', expectedVersion: version,
    name: 'Participant rename', operationId: operationId() })).rejects.toMatchObject({ code: 'forbidden' })
  const receipt = await h.service.projectCommand(h.owner.token, command)
  await expect(h.service.projectCommand(h.owner.token, command)).resolves.toEqual(receipt)
  await h.service.readProject(h.other.token, query, (project) => { expect(project).toMatchObject({
    name: command.name, background: command.background, summary: command.summary, goal: command.goal, version: receipt.revision,
  }) })
  await expect(h.service.projectCommand(h.owner.token, { ...command, operationId: operationId() })).rejects.toMatchObject({ code: 'version-conflict' })
  await h.service.readPlanning(h.other.token, { ...query, conversationId: operationId() }, (view) => {
    expect(view.project).toMatchObject({ background: command.background, summary: command.summary, goal: command.goal })
  })
  await h.close()
  const db = openOrganizationDatabase(h.path, 5000)
  try { expect(db.prepare('SELECT background,summary,goal FROM organization_projects WHERE id=?').get(query.projectId!))
    .toEqual({ background: command.background, summary: command.summary, goal: command.goal }) }
  finally { db.close() }
})

it('migrates a v17 project to empty context fields without changing its identity or version', async () => {
  const h = await assignmentHarness(cleanup)
  const before = h.db.prepare('SELECT id,name,version FROM organization_projects WHERE id=?').get(h.query.projectId!)
  await h.close()
  h.db.exec('ALTER TABLE organization_projects DROP COLUMN background; ALTER TABLE organization_projects DROP COLUMN summary; ALTER TABLE organization_projects DROP COLUMN goal; DROP TABLE tree_requests; DROP TABLE plan_contexts; PRAGMA user_version=17')
  const db = openOrganizationDatabase(h.path, 5000)
  try {
    expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(ORGANIZATION_SCHEMA_VERSION)
    expect(db.prepare('SELECT id,name,version,background,summary,goal FROM organization_projects WHERE id=?').get(h.query.projectId!))
      .toEqual({ ...before, background: '', summary: '', goal: '' })
  } finally { db.close() }
})
