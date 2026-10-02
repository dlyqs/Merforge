/** Real HTTPS/SQLite draft writes, subtree isolation, invalidation and original-issuer reapproval. */
import { workgraphVersionSchema } from '../src/workgraph-schema.ts'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, expect, it } from 'vitest'
import { workgraphHarness } from '../../../api/organization-api/tests/workgraph-harness.ts'
import { planningDraftSchema, planningPlanViewSchema } from '../src/planning-schema.ts'
import { receiptSchema } from '../src/schema.ts'
import { openOrganizationDatabase } from '../src/database.ts'
const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })
async function setup() {
  const h = await workgraphHarness(); cleanup.push(h.close)
  const query = { organizationId: h.query.organizationId, projectId: h.query.projectId, conversationId: randomUUID() }
  const open = { ...query, kind: 'open-planning', operationId: randomUUID(), selection: { model: 'deepseek-flash', endpoint: 'https://api.deepseek.com/anthropic/v1' } }
  expect((await h.call('/planning/command', open)).status).toBe(200)
  expect((await h.call('/planning/command', { ...open, operationId: randomUUID() }, h.member.token)).status).toBe(200)
  const phase = randomUUID(), root = randomUUID(), leaf = randomUUID()
  const task = (id: string, parentTaskId: string | null) => ({ id, parentTaskId, phaseId: phase, goal: 'CSV report', scope: 'Revenue only',
    acceptance: ['Validated totals'], artifacts: ['report.csv'], required: true, dependsOn: [], suggestedMembershipId: null })
  const draft = planningDraftSchema.parse({ ...query, kind: 'save-planning-draft', goalId: randomUUID(), assessmentId: randomUUID(),
    settingsRevision: 0, planId: randomUUID(), operationId: randomUUID(), expectedRevision: 0,
    definition: { taskId: root, phases: [{ id: phase, title: 'Report' }], tasks: [task(root, null), task(leaf, root)] } })
  return { ...h, query, draft }
}
it('writes one authoritative tree per goal and operation, refuses changed keys and stale revisions, and survives reopen', async () => {
  const h = await setup()
  const first = await h.call('/planning/command', h.draft)
  expect(first.status).toBe(200)
  expect((await h.call('/planning/command', h.draft)).body).toEqual(first.body)
  expect((await h.call('/planning/command', { ...h.draft, settingsRevision: 2 })).status).toBe(400)
  expect((await h.call('/planning/command', { ...h.draft, operationId: randomUUID(), planId: randomUUID() })).status).toBe(400)
  expect((await h.call('/planning/command', { ...h.draft, operationId: randomUUID() })).status).toBe(400)
  const revised = { ...h.draft, operationId: randomUUID(), expectedRevision: 1, definition: { ...h.draft.definition,
    tasks: h.draft.definition.tasks.map(t => ({ ...t, goal: 'Updated CSV report' })) } }
  expect(receiptSchema.parse((await h.call('/planning/command', revised)).body).planning?.planRevision).toBe(2)
  const read = await h.call('/planning/plan', { ...h.query, kind: 'read-planning-plan', planId: h.draft.planId, taskId: h.draft.definition.taskId })
  expect(planningPlanViewSchema.parse(read.body).version.revision).toBe(2)
  await h.app.close()
  const db = openOrganizationDatabase(join(h.root, 'service', 'organization.sqlite'), 5000)
  try { expect(db.prepare('SELECT count(*) AS n FROM planning_goals').get()?.n).toBe(1) } finally { db.close() }
}, 20000)
it('merges an editable leaf, preserves hidden siblings and invalidates the old approval', async () => {
  const h = await setup(), target = h.grant.taskId
  expect((await h.call('/assignment/command', { ...h.save, definition: undefined, expectedRevision: undefined,
    kind: 'approve-assignment' })).status).not.toBe(200)
  const assignment = receiptSchema.parse((await h.call('/assignment/command', { organizationId: h.save.organizationId,
    projectId: h.save.projectId, planId: h.save.planId, taskId: target, planRevision: 1, assigneeId: h.member.membershipId,
    kind: 'approve-assignment', operationId: randomUUID() })).body)
  expect(assignment.assignmentId).toBeDefined()
  expect((await h.call('/workgraph/grant', { ...h.grant, operationId: randomUUID(), actions: ['read', 'edit'],
    expectedVersion: h.receipt.revision })).status).toBe(200)
  const selected = { ...h.query, kind: 'read-planning-plan', planId: h.save.planId, taskId: target }
  const before = planningPlanViewSchema.parse((await h.call('/planning/plan', selected, h.member.token)).body)
  expect(JSON.stringify(before)).not.toMatch(/HIDDEN_ROOT|HIDDEN_TASK/)
  expect(before.canEdit).toBe(true)
  const root = before.version.definition.tasks[0]!, child = { ...root, id: randomUUID(), parentTaskId: root.id }
  const draft = { ...h.draft, planId: h.save.planId, expectedRevision: 1,
    definition: { ...before.version.definition, tasks: [root, child] } }
  const expanded = await h.call('/planning/command', { ...draft,
    definition: { ...draft.definition, tasks: [{ ...root, scope: 'Other project' }, child] } },
  h.member.token)
  expect(expanded.status).toBe(403)
  expect((await h.call('/planning/command', draft, h.member.token)).status).toBe(200)
  expect((await h.call('/planning/plan', selected, h.member.token)).status).toBe(403)
  const db = new DatabaseSync(join(h.root, 'service', 'organization.sqlite'), { readOnly: true })
  try {
    const version = workgraphVersionSchema.parse(JSON.parse(String(db.prepare('SELECT value FROM plan_revisions WHERE planId=? AND revision=2').get(h.save.planId)?.value)))
    expect(version.definition.tasks.find((t: { id: string }) => t.id === h.save.definition.tasks[2]!.id))
      .toEqual(h.save.definition.tasks[2])
    expect(db.prepare('SELECT state FROM task_assignments WHERE id=?').get(assignment.assignmentId!)?.state).toBe('invalidated')
    expect(db.prepare('SELECT membershipId FROM planning_reapprovals WHERE taskId=?').get(child.id)?.membershipId).toBe(h.owner.membershipId)
  } finally { db.close() }
  // Even a later explicit root grant does not transfer the immutable reapproval owner.
  expect((await h.call('/workgraph/grant', { ...h.grant, operationId: randomUUID(), taskId: h.save.definition.taskId,
    expectedVersion: 0, actions: ['read', 'edit'] })).status).toBe(200)
  const review = await h.call('/assignment/review', { organizationId: h.save.organizationId, projectId: h.save.projectId,
    planId: h.save.planId, taskId: child.id, planRevision: 2, assigneeId: h.member.membershipId }, h.member.token)
  expect(review.status).toBe(403)
  const rootGrant = dbGrantVersion(h.root, h.save.planId, h.owner.membershipId)
  expect((await h.call('/workgraph/grant', { ...h.grant, operationId: randomUUID(), taskId: h.save.definition.taskId,
    membershipId: h.owner.membershipId, expectedVersion: rootGrant, actions: ['read', 'edit'] })).status).toBe(200)
  expect((await h.call('/assignment/command', { organizationId: h.save.organizationId, projectId: h.save.projectId,
    planId: h.save.planId, taskId: child.id, planRevision: 2, assigneeId: h.member.membershipId,
    kind: 'approve-assignment', operationId: randomUUID() })).status).toBe(200)
}, 20000)
function dbGrantVersion(root: string, planId: string, membershipId: string): number {
  const db = new DatabaseSync(join(root, 'service', 'organization.sqlite'), { readOnly: true })
  try { return Number(db.prepare('SELECT version FROM task_grants WHERE planId=? AND membershipId=?').get(planId, membershipId)?.version) }
  finally { db.close() }
}

it('rejects hidden identifiers, ancestor changes, cross-tree prerequisites and removed ID reuse', async () => {
  const h = await setup()
  expect((await h.call('/planning/command', h.draft)).status).toBe(200)
  const leaf = h.draft.definition.tasks[1]!
  const remove = { ...h.draft, operationId: randomUUID(), expectedRevision: 1,
    definition: { ...h.draft.definition, tasks: [h.draft.definition.tasks[0]!] } }
  expect((await h.call('/planning/command', remove)).status).toBe(200)
  expect((await h.call('/planning/command', { ...h.draft, operationId: randomUUID(), expectedRevision: 2 })).status).toBe(400)
  expect((await h.call('/planning/command', { ...remove, operationId: randomUUID(), expectedRevision: 2,
    definition: { ...remove.definition, tasks: [{ ...remove.definition.tasks[0], dependsOn: [h.grant.taskId] }] } })).status).toBe(400)
  expect((await h.call('/planning/plan', { ...h.query, kind: 'read-planning-plan', planId: h.draft.planId, taskId: leaf.id }, h.member.token)).status).toBe(403)
}, 20000)

it('migrates v13 planning grants without resetting charged usage', async () => {
  const h = await setup()
  expect((await h.call('/planning/command', { ...h.query, kind: 'reserve-planning-request', operationId: randomUUID(),
    requestDigest: 'a'.repeat(64), inputBytes: 100, outputBytes: 100 })).status).toBe(200)
  await h.app.close()
  const path = join(h.root, 'service', 'organization.sqlite'), old = new DatabaseSync(path)
  old.exec('DROP TABLE planning_goals; DROP TABLE planning_reapprovals; PRAGMA user_version=13'); old.close()
  const migrated = openOrganizationDatabase(path, 5000)
  try {
    expect(migrated.prepare('PRAGMA user_version').get()?.user_version).toBe(14)
    expect(migrated.prepare("SELECT json_extract(data,'$.usedRequests') AS n FROM planning_grants WHERE accountId=?").get(h.owner.accountId)?.n).toBe(1)
  } finally { migrated.close() }
}, 20000)

it('retains hidden external prerequisites when the employee splits an authorized subtree', async () => {
  const h = await setup(), target = h.grant.taskId, hidden = h.save.definition.tasks[2]!.id
  const definition = { ...h.save.definition, tasks: h.save.definition.tasks.map(t => t.id === target
    ? { ...t, dependsOn: [hidden] } : t) }
  expect((await h.call('/workgraph/save', { ...h.save, operationId: randomUUID(), expectedRevision: 1, definition })).status).toBe(200)
  expect((await h.call('/workgraph/grant', { ...h.grant, operationId: randomUUID(),
    expectedVersion: h.receipt.revision, actions: ['read', 'edit'] })).status).toBe(200)
  const read = planningPlanViewSchema.parse((await h.call('/planning/plan', { ...h.query, kind: 'read-planning-plan',
    planId: h.save.planId, taskId: target }, h.member.token)).body)
  expect(read.version.definition.tasks[0]!.dependsOn).toEqual([])
  expect(JSON.stringify(read)).not.toContain(hidden)
  const root = read.version.definition.tasks[0]!, child = { ...root, id: randomUUID(), parentTaskId: root.id }
  expect((await h.call('/planning/command', { ...h.draft, planId: h.save.planId, expectedRevision: 2,
    definition: { ...read.version.definition, tasks: [root, child] } }, h.member.token)).status).toBe(200)
  await h.app.close()
  const db = openOrganizationDatabase(join(h.root, 'service', 'organization.sqlite'), 5000)
  try {
    const version = workgraphVersionSchema.parse(JSON.parse(String(db.prepare(
      'SELECT value FROM plan_revisions WHERE planId=? AND revision=3').get(h.save.planId)?.value)))
    expect(version.definition.tasks.find(t => t.id === target)?.dependsOn).toEqual([hidden])
    expect(version.definition.tasks.find(t => t.id === hidden)).toEqual(h.save.definition.tasks[2])
  } finally { db.close() }
}, 20000)
