/** Real Loader/SQLite approval authority, transaction faults and irreversible invalidation. */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { openHarness, initialize, addMember, operationId } from './harness.ts'
import type { OrganizationAssignment } from '../src/assignment-types.ts'

export async function assignmentHarness(cleanup: (() => Promise<unknown>)[]) {
  const root = await mkdtemp(join(tmpdir(), 'organization-assignment-'))
  cleanup.push(() => rm(root, { recursive: true, force: true }))
  const h = await openHarness(root)
  cleanup.push(h.close)
  const owner = await initialize(h.service)
  const other = await addMember(h.service, owner.token, owner.organizationId)
  const project = await h.service.projectCommand(owner.token, { kind: 'create-project', operationId: operationId(), organizationId: owner.organizationId, name: 'Project' })
  const query = { organizationId: owner.organizationId, projectId: project.projectId, planId: randomUUID() }
  const projectGrant = (membershipId: string, actions: string[], expectedVersion = 0) => h.service.grant(owner.token,
    { organizationId: query.organizationId, projectId: query.projectId, kind: 'set-grant', operationId: operationId(), membershipId, actions, expectedVersion })
  const ownerGrant = await projectGrant(owner.membershipId, ['read', 'write'])
  const otherGrant = await projectGrant(other.membershipId!, ['read'])
  const taskId = randomUUID(), phaseId = randomUUID()
  const save = { ...query, operationId: operationId(), expectedRevision: 0, definition: {
    taskId, phases: [{ id: phaseId, title: 'Prepare' }], tasks: [{ id: taskId, phaseId, parentTaskId: null as string | null,
      goal: 'Approved work', scope: 'Shared scope', acceptance: ['A reviewed report'], artifacts: [],
      required: true, dependsOn: [] as string[], suggestedMembershipId: null }],
  } }
  await h.service.savePlan(owner.token, save)
  const taskGrant = await h.service.grantTask(owner.token, { ...query, operationId: operationId(), taskId,
    membershipId: other.membershipId, scope: 'node', actions: ['read'], expectedVersion: 0 })
  const approve = { ...query, kind: 'approve-assignment', operationId: operationId(), planRevision: 1, taskId, assigneeId: other.membershipId }
  const db = new DatabaseSync(h.path)
  cleanup.push(async () => { db.close() })
  const read = async (assignmentId: string, token = owner.token) => {
    let result: OrganizationAssignment | undefined
    await h.service.readAssignment(token, { ...query, assignmentId }, (value) => { result = value })
    return result!
  }
  return { ...h, root, owner, other, query, save, approve, db, read, projectGrant, ownerGrant, otherGrant, taskGrant }
}

