/** Real Loader/SQLite planning permission, charging, privacy and cold-store regressions. */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, expect, it, vi } from 'vitest'
import { openHarness, initialize, addMember } from './harness.ts'
import { planningPolicySchema, planningReadSchema, type planningViewSchema } from '../src/planning-schema.ts'
import { openOrganizationDatabase } from '../src/database.ts'
import type { z } from 'zod'
const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => { vi.useRealTimers(); for (const close of cleanup.splice(0).reverse()) await close() })
const selection = { model: 'deepseek-flash', endpoint: 'https://api.deepseek.com/anthropic/v1' }
const policy = planningPolicySchema.parse({ models: [selection], ttlMs: 10000, permitTtlMs: 1000,
  maxRequests: 2, maxInputBytes: 500, maxOutputBytes: 500, maxTotalBytes: 1000, maxDurationMs: 10000 })
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'organization-planning-')); cleanup.push(() => rm(root, { recursive: true, force: true }))
  const h = await openHarness(root, { planning: policy }); cleanup.push(h.close)
  const owner = await initialize(h.service), member = await addMember(h.service, owner.token, owner.organizationId)
  const hidden = await addMember(h.service, owner.token, owner.organizationId, 'hidden')
  const project = await h.service.projectCommand(owner.token, { kind: 'create-project', operationId: randomUUID(),
    organizationId: owner.organizationId, name: 'CSV goal' })
  const grant = await h.service.grant(owner.token, { kind: 'set-grant', operationId: randomUUID(), organizationId: owner.organizationId,
    projectId: project.projectId, membershipId: member.membershipId, actions: ['read'], expectedVersion: 0 })
  const query = planningReadSchema.parse({ organizationId: owner.organizationId, projectId: project.projectId,
    conversationId: randomUUID() })
  const open = { ...query, operationId: randomUUID(), kind: 'open-planning', selection }
  const reserve = { ...query, operationId: randomUUID(), kind: 'reserve-planning-request',
    requestDigest: 'a'.repeat(64), inputBytes: 250, outputBytes: 250 }
  const read = async () => {
    let view: z.output<typeof planningViewSchema> | undefined
    await h.service.readPlanning(member.token, query, (v) => { view = v })
    if (!view) throw new Error('missing planning view')
    return view
  }
  return { ...h, root, owner, member, hidden, project, grant, query, open, reserve, read }
}
it('grants read-only planning without assignment or write access and returns minimal current project peers', async () => {
  const h = await setup()
  const receipt = await h.service.planningCommand(h.member.token, h.open)
  expect((await h.read()).eligible).toBe(true)
  expect(receipt).not.toHaveProperty('assignmentId')
  await expect(h.service.projectCommand(h.member.token, { kind: 'rename-project', operationId: randomUUID(),
    organizationId: h.query.organizationId, projectId: h.query.projectId, expectedVersion: h.project.revision,
    name: 'unauthorized' })).rejects.toMatchObject({ code: 'forbidden' })
  await expect(h.service.readPlanningCandidates(h.member.token, h.query, () => {})).rejects.toMatchObject({ code: 'invalid-input' })
  await h.service.readPlanningCandidates(h.member.token, { organizationId: h.query.organizationId, projectId: h.query.projectId },
    (page) => {
      expect(page.items.map(i => i.username)).toEqual(['alice', 'owner'])
      expect(JSON.stringify(page)).not.toMatch(/accountId|password|role|hidden|token/)
    })
  await expect(h.service.readPlanning(h.hidden.token, h.query, () => {})).rejects.toMatchObject({ code: 'forbidden' })
})
it('atomically charges concurrent attempts, identical replay and lost dispatch without a free retry', async () => {
  const h = await setup(); await h.service.planningCommand(h.member.token, h.open)
  const first = await h.service.planningCommand(h.member.token, h.reserve)
  expect(await h.service.planningCommand(h.member.token, h.reserve)).toEqual(first)
  await expect(h.service.planningCommand(h.member.token, { ...h.reserve,
    inputBytes: 249 })).rejects.toMatchObject({ code: 'operation-conflict' })
  const results = await Promise.allSettled([1, 2].map(() => h.service.planningCommand(h.member.token,
    { ...h.reserve, operationId: randomUUID() })))
  expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
  expect((await h.read()).grant).toMatchObject({ usedRequests: 2, usedBytes: 1000 })
  expect(await h.service.receipt(h.member.token, h.reserve.operationId)).toEqual(first)
  const consume = { ...h.query, operationId: randomUUID(), kind: 'consume-planning-request',
    permitId: first.planning?.permitId, requestDigest: h.reserve.requestDigest }
  const consumed = await h.service.planningCommand(h.member.token, consume)
  expect(await h.service.receipt(h.member.token, consume.operationId)).toEqual(consumed)
  await expect(h.service.planningCommand(h.member.token, consume)).rejects.toMatchObject({ code: 'operation-conflict' })
  await expect(h.service.planningCommand(h.member.token, { ...consume,
    operationId: randomUUID() })).rejects.toMatchObject({ code: 'forbidden' })
})
it('refuses foreign project, credential fields, mismatched digest and expiry at final consumption', async () => {
  const h = await setup(); await h.service.planningCommand(h.member.token, h.open)
  for (const patch of [{ apiKey: 'secret' }, { projectId: randomUUID() }, { selection: { ...selection, endpoint: 'http://localhost/v1' } }])
    await expect(h.service.planningCommand(h.member.token, { ...h.open, ...patch, operationId: randomUUID() })).rejects.toBeDefined()
  const reservation = await h.service.planningCommand(h.member.token, h.reserve)
  const consume = { ...h.query, operationId: randomUUID(), kind: 'consume-planning-request',
    permitId: reservation.planning?.permitId, requestDigest: 'b'.repeat(64) }
  await expect(h.service.planningCommand(h.member.token, consume)).rejects.toMatchObject({ code: 'forbidden' })
  vi.setSystemTime(Date.now() + policy.permitTtlMs + 1)
  await expect(h.service.planningCommand(h.member.token, { ...consume, operationId: randomUUID(),
    requestDigest: h.reserve.requestDigest })).rejects.toMatchObject({ code: 'forbidden' })
})
it('denies revoked read at final send and receipt lookup, and keeps restored grants ineligible', async () => {
  const h = await setup(); await h.service.planningCommand(h.member.token, h.open)
  const reserved = await h.service.planningCommand(h.member.token, h.reserve)
  await h.service.grant(h.owner.token, { kind: 'set-grant', operationId: randomUUID(), organizationId: h.query.organizationId,
    projectId: h.query.projectId, membershipId: h.member.membershipId, actions: [], expectedVersion: h.grant.revision })
  await expect(h.service.planningCommand(h.member.token, { ...h.query, operationId: randomUUID(), kind: 'consume-planning-request',
    permitId: reserved.planning?.permitId, requestDigest: h.reserve.requestDigest })).rejects.toMatchObject({ code: 'forbidden' })
  await expect(h.service.receipt(h.member.token, h.reserve.operationId)).rejects.toMatchObject({ code: 'forbidden' })
})
it('cold reopen refuses previous epoch and changed model policy while preserving charged usage', async () => {
  const h = await setup(); await h.service.planningCommand(h.member.token, h.open)
  await h.service.planningCommand(h.member.token, h.reserve)
  await h.close()
  const reopened = await openHarness(h.root, { planning: { ...policy, models: [] } }); cleanup.push(reopened.close)
  await reopened.service.readPlanning(h.member.token, h.query, (view) => {
    expect(view.eligible).toBe(false); expect(view.grant?.usedRequests).toBe(1)
  })
  await expect(reopened.service.planningCommand(h.member.token, { ...h.reserve,
    operationId: randomUUID() })).rejects.toMatchObject({ code: 'forbidden' })
})
it('explicit renewal after restart preserves cumulative limits and refuses permits from the previous qualification', async () => {
  const h = await setup(); await h.service.planningCommand(h.member.token, h.open)
  const reserved = await h.service.planningCommand(h.member.token, h.reserve)
  await h.close()
  const reopened = await openHarness(h.root, { planning: { ...policy, maxRequests: 10 } }); cleanup.push(reopened.close)
  await reopened.service.planningCommand(h.member.token, { ...h.open, operationId: randomUUID() })
  await reopened.service.readPlanning(h.member.token, h.query, (view) => {
    expect(view.eligible).toBe(true); expect(view.grant).toMatchObject({ usedRequests: 1, usedBytes: 500,
      limits: { maxRequests: 2 } })
  })
  await expect(reopened.service.planningCommand(h.member.token, { ...h.query, operationId: randomUUID(),
    kind: 'consume-planning-request', permitId: reserved.planning?.permitId,
    requestDigest: h.reserve.requestDigest })).rejects.toMatchObject({ code: 'forbidden' })
  await reopened.service.planningCommand(h.member.token, { ...h.reserve, operationId: randomUUID() })
  await expect(reopened.service.planningCommand(h.member.token, { ...h.reserve,
    operationId: randomUUID() })).rejects.toMatchObject({ code: 'rate-limited' })
  await reopened.close()
  const cold = openOrganizationDatabase(h.path, 5000); cold.close()
})
it.each(['member', 'account'] as const)('refuses a pending permit after %s disable and removes that candidate', async (kind) => {
  const h = await setup(); await h.service.planningCommand(h.member.token, h.open)
  const reserved = await h.service.planningCommand(h.member.token, h.reserve)
  await h.service.execute(h.owner.token, kind === 'member' ? { kind: 'set-membership', operationId: randomUUID(),
    organizationId: h.query.organizationId, membershipId: h.member.membershipId, expectedVersion: h.member.revision,
    role: 'member', enabled: false } : { kind: 'set-account', operationId: randomUUID(), accountId: h.member.accountId,
    expectedVersion: h.member.revision, enabled: false })
  await expect(h.service.planningCommand(h.member.token, { ...h.query, operationId: randomUUID(),
    kind: 'consume-planning-request', permitId: reserved.planning?.permitId,
    requestDigest: h.reserve.requestDigest })).rejects.toBeDefined()
  await h.service.readPlanningCandidates(h.owner.token, { organizationId: h.query.organizationId, projectId: h.query.projectId },
    (page) => { expect(page.items.map(i => i.username)).toEqual(['owner']) })
})
it('migrates v12 monotonically and rolls back a corrupt migration before changing its stamp', async () => {
  const h = await setup(); await h.close()
  const db = new DatabaseSync(h.path)
  db.exec('DROP TABLE planning_goals; DROP TABLE planning_reapprovals; DROP TABLE planning_events; DROP TABLE planning_permits; DROP TABLE planning_grants; PRAGMA user_version=12'); db.close()
  const upgraded = openOrganizationDatabase(h.path, 5000)
  expect(upgraded.prepare('PRAGMA user_version').get()?.user_version).toBe(14)
  upgraded.exec('DROP TABLE planning_goals; DROP TABLE planning_reapprovals; DROP TABLE planning_events; DROP TABLE planning_permits; DROP TABLE planning_grants; PRAGMA user_version=12')
  upgraded.prepare('UPDATE memberships SET enabled=0 WHERE id=?').run(h.owner.membershipId ?? null); upgraded.close()
  expect(() => openOrganizationDatabase(h.path, 5000)).toThrow('incompatible-store')
  const cold = new DatabaseSync(h.path)
  try {
    expect(cold.prepare('PRAGMA user_version').get()?.user_version).toBe(12)
    expect(cold.prepare("SELECT name FROM sqlite_master WHERE name='planning_grants'").get()).toBeUndefined()
  } finally { cold.close() }
})
it('rejects cold-store usage corruption instead of resetting planning counters', async () => {
  const h = await setup(); await h.service.planningCommand(h.member.token, h.open)
  await h.service.planningCommand(h.member.token, h.reserve)
  await h.close()
  const db = new DatabaseSync(h.path)
  db.exec("UPDATE planning_grants SET data=json_set(data,'$.usedRequests',0)"); db.close()
  expect(() => openOrganizationDatabase(h.path, 5000)).toThrow('incompatible-store')
})
it('rejects corrupted permit ownership and a missing opening event on cold reopen', async () => {
  const h = await setup(); await h.service.planningCommand(h.member.token, h.open)
  await h.service.planningCommand(h.member.token, h.reserve); await h.close()
  const db = new DatabaseSync(h.path)
  const original = db.prepare('SELECT data FROM planning_permits').get()?.data
  db.prepare("UPDATE planning_permits SET data=json_set(data,'$.projectId',?)").run(randomUUID())
  expect(() => openOrganizationDatabase(h.path, 5000)).toThrow('incompatible-store')
  db.prepare('UPDATE planning_permits SET data=?').run(String(original))
  db.exec("DELETE FROM planning_events WHERE revision IN (SELECT revision FROM organization_events WHERE kind='open-planning')")
  db.close()
  expect(() => openOrganizationDatabase(h.path, 5000)).toThrow('incompatible-store')
})
