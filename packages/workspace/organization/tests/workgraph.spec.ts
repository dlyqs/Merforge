/** Real Loader and SQLite tests for immutable organization planning definitions. */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { openOrganizationDatabase } from '../src/database.ts'
import { workgraphSaveSchema } from '../src/workgraph-schema.ts'
import type { OrganizationPlanVersion } from '../src/workgraph-types.ts'
import { openHarness, initialize, addMember, operationId } from './harness.ts'

const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })
async function setup(config = {}) {
  const root = await mkdtemp(join(tmpdir(), 'organization-graph-'))
  cleanup.push(() => rm(root, { recursive: true, force: true }))
  const harness = await openHarness(root, config)
  cleanup.push(harness.close)
  const owner = await initialize(harness.service)
  const project = await harness.service.projectCommand(owner.token, { kind: 'create-project', operationId: operationId(), organizationId: owner.organizationId, name: 'CSV report' })
  const grant = await harness.service.grant(owner.token, { kind: 'set-grant', operationId: operationId(), organizationId: owner.organizationId,
    projectId: project.projectId, membershipId: owner.membershipId, actions: ['read', 'write'], expectedVersion: project.revision })
  const phaseId = randomUUID(), taskId = randomUUID()
  const request = { operationId: operationId(), organizationId: owner.organizationId, projectId: project.projectId,
    planId: randomUUID(), expectedRevision: 0, definition: { taskId, phases: [{ id: phaseId, title: 'Prepare' }], tasks: [{
      id: taskId, phaseId, parentTaskId: null as string | null, goal: 'CSV report', scope: 'Shared text only', acceptance: ['A valid report'],
      artifacts: ['report.csv'], required: true, dependsOn: [] as string[], suggestedMembershipId: null as string | null,
    }] } }
  const query = { organizationId: owner.organizationId, projectId: project.projectId, planId: request.planId }
  async function read(revision?: number) {
    let result: OrganizationPlanVersion | undefined
    await harness.service.readPlan(owner.token, { ...query, ...(revision === undefined ? {} : { revision }) }, (value) => {
      result = value
    })
    if (!result) throw new Error('missing delivery')
    return result
  }
  return { ...harness, root, owner, request, query, read, grant }
}
function csv(request: Awaited<ReturnType<typeof setup>>['request']) {
  const definition = structuredClone(request.definition)
  const phases = ['Prepare CSV', 'Analyze CSV', 'Produce report'].map(title => ({ id: randomUUID(), title }))
  definition.phases = phases
  definition.tasks[0]!.phaseId = phases[2]!.id
  let previous: string | undefined
  for (const phase of phases) {
    const id = randomUUID()
    definition.tasks.push({ ...definition.tasks[0]!, id, phaseId: phase.id, parentTaskId: definition.taskId,
      goal: phase.title, dependsOn: previous ? [previous] : [] })
    previous = id
  }
  return definition
}

describe('organization WorkGraph definitions', () => {
  it('persists a root then CSV stages, returns immutable history and survives Loader reopen', async () => {
    const h = await setup()
    const first = await h.service.savePlan(h.owner.token, h.request)
    const initial = await h.read()
    expect(first.planRevision).toBe(1)
    const definition = csv(h.request)
    await h.service.savePlan(h.owner.token, { ...h.request, operationId: operationId(), expectedRevision: 1, definition })
    expect((await h.read()).definition).toEqual(definition)
    expect(await h.read(1)).toEqual(initial)
    await h.close(); cleanup.pop()
    const reopened = await openHarness(h.root)
    cleanup.push(reopened.close)
    await reopened.service.readPlan(h.owner.token, h.query, (value) => { expect(value.definition).toEqual(definition) })
    const db = new DatabaseSync(h.path)
    try {
      expect(() => db.prepare('UPDATE plan_revisions SET value=?').run('{}')).toThrow('immutable')
      expect(() => db.prepare('DELETE FROM plan_revisions').run()).toThrow('immutable')
    } finally { db.close() }
  })

  it('serializes competing revisions and replays only identical operations without duplicate events', async () => {
    const h = await setup()
    const receipt = await h.service.savePlan(h.owner.token, h.request)
    let notifications = 0
    h.ctx.on('organization/committed', () => { notifications++ })
    expect(await h.service.savePlan(h.owner.token, h.request)).toEqual(receipt)
    expect(await h.service.receipt(h.owner.token, h.request.operationId)).toEqual(receipt)
    expect(notifications).toBe(0)
    await expect(h.service.savePlan(h.owner.token, { ...h.request, expectedRevision: 1 })).rejects.toMatchObject({ code: 'operation-conflict' })
    const attempts = await Promise.allSettled([1, 2].map(() => h.service.savePlan(h.owner.token, {
      ...h.request, operationId: operationId(), expectedRevision: 1,
    })))
    expect(attempts.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(attempts.find(result => result.status === 'rejected')).toMatchObject({ reason: { code: 'version-conflict' } })
    expect((await h.read()).revision).toBe(2)
  })

  it('rolls back the graph, audit, grant and receipt when a late SQLite write fails', async () => {
    const h = await setup()
    const db = new DatabaseSync(h.path)
    try {
      const before = db.prepare('SELECT count(*) AS n FROM organization_events').get()
      db.exec("CREATE TRIGGER reject_graph_receipt BEFORE INSERT ON operation_receipts BEGIN SELECT RAISE(ABORT,'test disk fault'); END")
      await expect(h.service.savePlan(h.owner.token, h.request)).rejects.toThrow('test disk fault')
      for (const table of ['organization_plans', 'plan_revisions', 'plan_tasks', 'task_grants', 'workgraph_events']) {
        expect(db.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n).toBe(0)
      }
      expect(db.prepare('SELECT count(*) AS n FROM organization_events').get()).toEqual(before)
      db.exec('DROP TRIGGER reject_graph_receipt')
      expect(await h.service.receipt(h.owner.token, h.request.operationId)).toBeNull()
      await h.service.savePlan(h.owner.token, h.request)
    } finally { db.close() }
  })

  it('requires root permission even for admins and suggested members, including receipts after project revocation', async () => {
    const h = await setup()
    const other = await addMember(h.service, h.owner.token, h.owner.organizationId, 'other', 'admin')
    h.request.definition.tasks[0]!.suggestedMembershipId = other.membershipId!
    await h.service.savePlan(h.owner.token, h.request)
    await h.service.grant(h.owner.token, { kind: 'set-grant', operationId: operationId(), organizationId: h.owner.organizationId,
      projectId: h.request.projectId, membershipId: other.membershipId, actions: ['read', 'write'], expectedVersion: 0 })
    await expect(h.service.readPlan(other.token, h.query, () => { throw new Error('leaked') })).rejects.toMatchObject({ code: 'forbidden' })
    await expect(h.service.savePlan(other.token, { ...h.request, expectedRevision: 1, operationId: operationId() })).rejects.toMatchObject({ code: 'forbidden' })
    await h.service.grant(h.owner.token, { kind: 'set-grant', operationId: operationId(), organizationId: h.owner.organizationId,
      projectId: h.request.projectId, membershipId: h.owner.membershipId, actions: [], expectedVersion: h.grant.revision })
    await expect(h.read(1)).rejects.toMatchObject({ code: 'forbidden' })
    await expect(h.service.savePlan(h.owner.token, h.request)).rejects.toMatchObject({ code: 'forbidden' })
    await expect(h.service.receipt(h.owner.token, h.request.operationId)).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('rejects cross-organization project and member references, and retires removed task identities', async () => {
    const h = await setup()
    const second = await h.service.execute(h.owner.token, { kind: 'create-organization', operationId: operationId(), name: 'Beta' })
    await expect(h.service.savePlan(h.owner.token, { ...h.request, organizationId: second.organizationId })).rejects.toMatchObject({ code: 'forbidden' })
    const members = await h.service.members(h.owner.token, second.organizationId!)
    const bad = structuredClone(h.request)
    bad.definition.tasks[0]!.suggestedMembershipId = members[0]!.id
    await expect(h.service.savePlan(h.owner.token, bad)).rejects.toMatchObject({ code: 'invalid-input' })
    const definition = csv(h.request)
    await h.service.savePlan(h.owner.token, { ...h.request, definition })
    await h.service.savePlan(h.owner.token, { ...h.request, operationId: operationId(), expectedRevision: 1 })
    await expect(h.service.savePlan(h.owner.token, { ...h.request, definition, operationId: operationId(), expectedRevision: 2 })).rejects.toMatchObject({ code: 'invalid-input' })
    await expect(h.service.savePlan(h.owner.token, { ...h.request, planId: randomUUID(), operationId: operationId() })).rejects.toMatchObject({ code: 'invalid-input' })
  })

  it('invalidates preexisting subtree grants after structural changes', async () => {
    const h = await setup()
    const other = await addMember(h.service, h.owner.token, h.owner.organizationId)
    const definition = csv(h.request)
    await h.service.savePlan(h.owner.token, { ...h.request, definition })
    const db = new DatabaseSync(h.path)
    try {
      const row = db.prepare('SELECT structureVersion FROM organization_plans').get()!
      db.prepare("INSERT INTO task_grants VALUES (?,?,?,'subtree',1,0,?,?)").run(h.request.planId, definition.tasks[1]!.id, other.membershipId!, row.structureVersion!, row.structureVersion!)
      const changed = structuredClone(definition)
      changed.tasks[2]!.parentTaskId = changed.tasks[1]!.id
      // Keep completion ordering valid when nesting the second stage.
      changed.tasks[1]!.phaseId = changed.tasks[2]!.phaseId
      changed.tasks[2]!.dependsOn = []
      await h.service.savePlan(h.owner.token, { ...h.request, definition: changed, operationId: operationId(), expectedRevision: 1 })
      const plan = db.prepare('SELECT structureVersion FROM organization_plans').get()!
      const grant = db.prepare('SELECT structureVersion FROM task_grants WHERE membershipId=?').get(other.membershipId!)!
      expect(grant.structureVersion).not.toBe(plan.structureVersion)
      expect((await h.read()).revision).toBe(2)
    } finally { db.close() }
  })

  it('enforces complete-version byte, task and depth limits', async () => {
    const h = await setup({ workgraphMaxTasks: 1, workgraphMaxDepth: 1, workgraphMaxBytes: 1200 })
    await h.service.savePlan(h.owner.token, h.request)
    await expect(h.service.savePlan(h.owner.token, {
      ...h.request, definition: csv(h.request), operationId: operationId(), expectedRevision: 1,
    })).rejects.toMatchObject({ code: 'invalid-input' })
    const definition = structuredClone(h.request.definition)
    definition.tasks[0]!.goal = '界'.repeat(400)
    await expect(h.service.savePlan(h.owner.token, { ...h.request, definition, operationId: operationId(), expectedRevision: 1 })).rejects.toMatchObject({ code: 'invalid-input' })
  })

  it('preserves an existing disabled member suggestion but refuses new assignments to that member', async () => {
    const h = await setup()
    const member = await addMember(h.service, h.owner.token, h.owner.organizationId)
    h.request.definition.tasks[0]!.suggestedMembershipId = member.membershipId!
    await h.service.savePlan(h.owner.token, h.request)
    const current = (await h.service.members(h.owner.token, h.owner.organizationId)).find(item => item.id === member.membershipId)!
    await h.service.execute(h.owner.token, { kind: 'set-membership', operationId: operationId(), organizationId: h.owner.organizationId,
      membershipId: member.membershipId, expectedVersion: current.version, enabled: false, role: 'member' })
    await h.service.savePlan(h.owner.token, { ...h.request, operationId: operationId(), expectedRevision: 1 })
    await expect(h.service.savePlan(h.owner.token, {
      ...h.request, definition: csv(h.request), operationId: operationId(), expectedRevision: 2,
    }))
      .rejects.toMatchObject({ code: 'invalid-input' })
    await h.close(); cleanup.pop()
    const reopened = await openHarness(h.root)
    cleanup.push(reopened.close)
    await reopened.service.readPlan(h.owner.token, h.query, (value) => {
      expect(value.definition.tasks[0]!.suggestedMembershipId).toBe(member.membershipId)
    })
  })

  it('applies exact complete UTF-8 limits on reads and root-inclusive depth limits on writes', async () => {
    const h = await setup()
    await h.service.savePlan(h.owner.token, h.request)
    const bytes = Buffer.byteLength(JSON.stringify(await h.read()))
    const exact = await openHarness(h.root, { workgraphMaxBytes: bytes, workgraphMaxDepth: 1 })
    cleanup.push(exact.close)
    await exact.service.readPlan(h.owner.token, h.query, (value) => { expect(value.revision).toBe(1) })
    await expect(exact.service.savePlan(h.owner.token, {
      ...h.request, definition: csv(h.request), operationId: operationId(), expectedRevision: 1,
    }))
      .rejects.toMatchObject({ code: 'invalid-input' })
    const short = await openHarness(h.root, { workgraphMaxBytes: bytes - 1 })
    cleanup.push(short.close)
    await expect(short.service.readPlan(h.owner.token, h.query, () => { throw new Error('oversized delivery') }))
      .rejects.toMatchObject({ code: 'invalid-input' })
    const depth = await openHarness(h.root, { workgraphMaxDepth: 1 })
    cleanup.push(depth.close)
    await expect(depth.service.savePlan(h.owner.token, {
      ...h.request, definition: csv(h.request), operationId: operationId(), expectedRevision: 1,
    }))
      .rejects.toMatchObject({ code: 'invalid-input' })
  })

  it('migrates an existing v2 database without losing identity, projects or grants', async () => {
    const h = await setup()
    await h.close(); cleanup.pop()
    const old = new DatabaseSync(h.path)
    try {
      old.exec('DROP TABLE integration_confirmations; DROP TABLE integration_events; DROP TABLE organization_integrations; DROP TABLE organization_acceptances; DROP TABLE delivery_events; DROP TABLE organization_submissions; DROP TABLE organization_artifacts; DROP TABLE execution_human_requests; DROP TABLE execution_events; DROP TABLE execution_actions; DROP TABLE execution_runs; DROP TABLE execution_delegations; DROP TABLE device_actions; DROP TABLE assignment_leases; DROP TABLE organization_devices; DROP TABLE assignment_actions; DROP TABLE assignment_delegations; DROP TABLE assignment_notifications; DROP TABLE assignment_requests; DROP TABLE task_assignments; DROP TABLE task_grants; DROP TABLE plan_tasks; DROP TABLE workgraph_events; DROP TABLE plan_revisions; DROP TABLE organization_plans; PRAGMA user_version=2')
    } finally { old.close() }
    const migrated = await openHarness(h.root)
    cleanup.push(migrated.close)
    await migrated.service.readProject(h.owner.token, { organizationId: h.owner.organizationId, projectId: h.request.projectId }, (value) => { expect(value.name).toBe('CSV report') })
    await migrated.service.savePlan(h.owner.token, h.request)
    const db = new DatabaseSync(h.path)
    try { expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(12) } finally { db.close() }
  })

  it('refuses damaged graph data and unknown database versions on open', async () => {
    const h = await setup()
    await h.service.savePlan(h.owner.token, h.request)
    await h.close(); cleanup.pop()
    const db = new DatabaseSync(h.path)
    try {
      db.exec('UPDATE plan_tasks SET active=0')
      expect(() => openOrganizationDatabase(h.path, 100)).toThrow('incompatible-store')
      db.exec('UPDATE plan_tasks SET active=1; UPDATE organization_plans SET currentRevision=2')
      expect(() => openOrganizationDatabase(h.path, 100)).toThrow('incompatible-store')
      db.exec('PRAGMA user_version=999')
      expect(() => openOrganizationDatabase(h.path, 100)).toThrow('incompatible-store')
    } finally { db.close() }
  })

  it('rejects malformed tree/phase/dependency input and execution fields at the service entry', async () => {
    const h = await setup()
    const valid = { ...h.request, definition: csv(h.request) }
    const cases: ((input: typeof valid) => void)[] = [
      (input) => { input.definition.tasks.push(input.definition.tasks[1]!) },
      (input) => { input.definition.tasks[1]!.parentTaskId = null },
      (input) => { input.definition.tasks[1]!.parentTaskId = randomUUID() },
      (input) => { input.definition.tasks[1]!.dependsOn = [randomUUID()] },
      (input) => { input.definition.tasks[1]!.dependsOn = [input.definition.taskId] },
      (input) => { input.definition.tasks[1]!.dependsOn = [input.definition.tasks[1]!.id] },
      (input) => {
        input.definition.tasks[1]!.parentTaskId = input.definition.tasks[2]!.id
        input.definition.tasks[2]!.parentTaskId = input.definition.tasks[1]!.id
      },
    ]
    for (const change of cases) {
      const input = structuredClone(valid); change(input)
      expect(workgraphSaveSchema.safeParse(input).success).toBe(false)
      expect(() => h.service.savePlan(h.owner.token, input)).toThrow('invalid-input')
    }
    for (const field of ['cwd', 'permissions', 'run', 'completed', 'approve', 'dispatch', 'claim', 'submit']) {
      const input = structuredClone(h.request)
      Object.assign(input.definition.tasks[0]!, { [field]: true })
      expect(() => h.service.savePlan(h.owner.token, input)).toThrow('invalid-input')
      expect(() => h.service.savePlan(h.owner.token, { ...h.request, [field]: true })).toThrow('invalid-input')
    }
  })
})
