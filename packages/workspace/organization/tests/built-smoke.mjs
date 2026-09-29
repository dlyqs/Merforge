/** Plain-Node smoke of the published organization entry; no application listener. */
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { Context } from '@deepseek-ai/cordis'
import Organization, { createOrganizationToken } from '../lib/index.js'

const root = await mkdtemp(join(tmpdir(), 'organization-built-'))
const path = join(root, 'organization.sqlite')
let ctx = new Context()
try {
  await ctx.plugin(Organization, { path })
  const request = { operationId: randomUUID(), username: 'owner', password: 'built smoke password',
    organizationName: 'Built organization', recoveryToken: createOrganizationToken() }
  const first = await ctx.organization.initialize(request)
  const login = await ctx.organization.login({ username: request.username, password: request.password })
  assert.equal(login.principal.accountId, first.accountId)
  const project = await ctx.organization.projectCommand(login.token, { kind: 'create-project', operationId: randomUUID(),
    organizationId: first.organizationId, name: 'Built WorkGraph' })
  await ctx.organization.grant(login.token, { kind: 'set-grant', operationId: randomUUID(), organizationId: first.organizationId,
    projectId: project.projectId, membershipId: first.membershipId, expectedVersion: project.revision, actions: ['read', 'write'] })
  const taskId = randomUUID(), phaseId = randomUUID(), planId = randomUUID()
  const query = { organizationId: first.organizationId, projectId: project.projectId, planId }
  const definition = { taskId, phases: [{ id: phaseId, title: 'Preparation' }], tasks: [{ id: taskId, phaseId,
    parentTaskId: null, goal: 'Built persistence', scope: 'Shared plan', acceptance: ['Reopens'], artifacts: [],
    required: true, dependsOn: [], suggestedMembershipId: null }] }
  const saved = await ctx.organization.savePlan(login.token, { ...query, operationId: randomUUID(), expectedRevision: 0, definition })
  assert.equal(saved.planRevision, 1)
  await ctx.fiber.dispose()
  ctx = new Context()
  await ctx.plugin(Organization, { path })
  assert.deepEqual(await ctx.organization.initialize(request), first)
  assert.equal((await ctx.organization.organizations(login.token))[0].name, request.organizationName)
  await ctx.organization.readPlan(login.token, query, value => assert.deepEqual(value.definition, definition))
  await ctx.organization.logout(login.token)
  await assert.rejects(ctx.organization.authenticate(login.token), { code: 'unauthenticated' })
  console.log('organization built smoke: initialize, login, WorkGraph save/reopen, receipt and revocation passed')
} finally {
  await ctx.fiber.dispose()
  await rm(root, { recursive: true, force: true })
}
