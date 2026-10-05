/** Creator deletion retires current task access and preserves immutable history through restart. */
import { afterEach, expect, it } from 'vitest'
import { assignmentHarness } from './assignment-harness.ts'
import { operationId } from './harness.ts'
import { openOrganizationDatabase } from '../src/database.ts'
const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })

it('distinguishes creator and assignee removal and atomically invalidates assignment on shared deletion', async () => {
  const h = await assignmentHarness(cleanup)
  expect(await h.service.planRemoval(h.owner.token, h.query)).toMatchObject({ global: true, local: false, revision: 1 })
  expect(await h.service.planRemoval(h.other.token, h.query)).toMatchObject({ global: false, local: false })
  const assignment = await h.service.assignmentCommand(h.owner.token, h.approve)
  expect(await h.service.planRemoval(h.other.token, h.query)).toMatchObject({ global: false, local: true })
  const input = { ...h.query, operationId: operationId(), expectedRevision: 1 }
  await expect(h.service.deletePlan(h.other.token, input)).rejects.toMatchObject({ code: 'forbidden' })
  await expect(h.service.deletePlan(h.owner.token, { ...input, expectedRevision: 2 })).rejects.toMatchObject({ code: 'version-conflict' })
  const receipt = await h.service.deletePlan(h.owner.token, input)
  expect(await h.service.deletePlan(h.owner.token, input)).toEqual(receipt)
  expect(await h.service.receipt(h.owner.token, input.operationId)).toEqual(receipt)
  for (const member of [h.owner, h.other]) {
    await expect(h.service.readPlan(member.token, h.query, () => {})).rejects.toMatchObject({ code: 'forbidden' })
    await expect(h.service.readTasks(member.token, h.query, () => {})).rejects.toMatchObject({ code: 'forbidden' })
    await h.service.readTasks(member.token, { organizationId: h.query.organizationId, projectId: h.query.projectId }, page => {
      expect(page.total).toBe(0)
    })
  }
  expect(h.db.prepare('SELECT state,reason FROM task_assignments WHERE id=?').get(assignment.assignmentId!))
    .toMatchObject({ state: 'invalidated', reason: 'authority-lost' })
  expect(h.db.prepare('SELECT count(*) AS n FROM plan_revisions WHERE planId=?').get(h.query.planId)?.n).toBe(1)
  await h.close()
  const reopened = openOrganizationDatabase(h.path, 5000)
  try { expect(reopened.prepare('SELECT revision FROM deleted_plans WHERE planId=?').get(h.query.planId)?.revision).toBe(receipt.revision) }
  finally { reopened.close() }
})
