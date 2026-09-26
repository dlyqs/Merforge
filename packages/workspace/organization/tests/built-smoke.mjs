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
  await ctx.fiber.dispose()
  ctx = new Context()
  await ctx.plugin(Organization, { path })
  assert.deepEqual(await ctx.organization.initialize(request), first)
  assert.equal((await ctx.organization.organizations(login.token))[0].name, request.organizationName)
  await ctx.organization.logout(login.token)
  await assert.rejects(ctx.organization.authenticate(login.token), { code: 'unauthenticated' })
  console.log('organization built smoke: initialize, login, reopen, receipt and revocation passed')
} finally {
  await ctx.fiber.dispose()
  await rm(root, { recursive: true, force: true })
}
