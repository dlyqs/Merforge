/** Real Loader composition with a private temporary SQLite database. */
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import { expect } from 'vitest'
import Organization, { createOrganizationToken, type Config, type OrganizationId, type LoginToken } from '../src/index.ts'

export const password = 'correct horse battery staple'
export const operationId = () => randomUUID()

export async function openHarness(root: string, config: Partial<Config> = {}) {
  const ctx = new Context()
  const path = config.path ?? join(root, 'organization.sqlite')
  ctx.baseUrl = pathToFileURL(root).href + '/'
  const configPath = join(root, `cordis-${randomUUID()}.yml`)
  await writeFile(configPath, JSON.stringify([{ name: '@deepseek-ai/dsh-organization', config: { path, ...config } }]))
  try {
    await ctx.plugin(Loader)
    ctx.loader.builtins.include = Include
    ctx.loader.internal = { version: 'v2', async import(specifier: string) {
      if (specifier === '@deepseek-ai/dsh-organization') return { default: Organization }
      throw new Error(`unexpected plugin: ${specifier}`)
    } } as never
    await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
    await ctx.loader.await()
    expect([...ctx.loader.entries()].filter(entry => entry.fiber === undefined && !entry.disabled)).toEqual([])
    expect(ctx.get('organization')).toBeDefined()
    return { ctx, service: ctx.organization, path, close: () => ctx.fiber.dispose() }
  } catch (error) {
    await ctx.fiber.dispose()
    throw error
  }
}

export async function initialize(service: Organization) {
  const recoveryToken = createOrganizationToken()
  const input = { operationId: operationId(), username: 'owner', password, organizationName: 'Alpha', recoveryToken }
  const receipt = await service.initialize(input)
  const login = await service.login({ username: 'owner', password })
  if (!receipt.organizationId || !receipt.accountId || !receipt.membershipId) throw new Error('missing bootstrap identities')
  return { ...login, ...receipt, organizationId: receipt.organizationId, accountId: receipt.accountId,
    membershipId: receipt.membershipId, recoveryToken, input }
}

export async function invite(service: Organization, token: LoginToken, organizationId: OrganizationId, role: 'member' | 'admin' = 'member') {
  const invitationToken = createOrganizationToken()
  const input = { kind: 'invite', operationId: operationId(), organizationId, role, invitationToken }
  const receipt = await service.execute(token, input)
  return { invitationToken, receipt, input }
}

export async function addMember(service: Organization, token: LoginToken, organizationId: OrganizationId, username = 'alice', role: 'member' | 'admin' = 'member') {
  const invitation = await invite(service, token, organizationId, role)
  const input = { operationId: operationId(), invitationToken: invitation.invitationToken, username, password }
  const receipt = await service.register(input)
  const login = await service.login({ username, password })
  return { ...receipt, ...login, input }
}
