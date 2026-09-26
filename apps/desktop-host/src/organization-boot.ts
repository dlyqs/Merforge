/** Private organization composition: only the authority and its restricted HTTPS consumer. */
import { Context, FiberState } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import Organization from '@deepseek-ai/dsh-organization'
import OrganizationApi from '@deepseek-ai/dsh-organization-api'
import { join } from 'node:path'
import { z } from 'zod'

/** Private IPC configuration; the database is always derived from the dedicated directory. */
export const organizationBootSchema = z.object({
  api: OrganizationApi.Config,
  authority: Organization.Config.omit({ path: true }).prefault({}),
}).strict()

/**
 * Boot the shipped organization-only YAML via the Loader, without personal profile/environment files.
 * @param input - Private process configuration; unknown keys and invalid limits reject.
 * @returns Owned context, authority and ready API; disposal closes admission before storage.
 */
export async function bootOrganization(input: unknown) {
  const config = organizationBootSchema.parse(input)
  const ctx = new Context()
  try {
    await ctx.plugin(Loader)
    ctx.loader.builtins.include = Include
    ctx.loader.builtins.organization = Organization
    ctx.loader.builtins['organization-api'] = OrganizationApi
    await ctx.loader.create({ name: 'cordis:include', config: {
      path: new URL('../organization.yml', import.meta.url).href,
      patches: [
        { id: 'organization', config: { ...config.authority, path: join(config.api.directory, 'organization.sqlite') } },
        { id: 'organization-api', config: config.api },
      ],
    } })
    await ctx.loader.await()
    for (const entry of ctx.loader.entries()) {
      if (entry.disabled) continue
      if (entry.fiber?.state === FiberState.FAILED) await entry.fiber.await()
      if (entry.fiber?.state !== FiberState.ACTIVE) throw new Error('organization-boot-failed')
    }
    const authority = ctx.get('organization')
    const api = ctx.get('organizationApi')
    if (!authority || !api) throw new Error('organization-boot-failed')
    const ready = api.status()
    return { ctx, authority, ready, close: () => ctx.fiber.dispose() }
  } catch (error) { await ctx.fiber.dispose(); throw error }
}
