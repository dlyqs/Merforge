/** Private conversation reservations and ownership must match the separate durable Session log. */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type {} from './index.ts'
/** Companion identity. */
export const name = 'organization-conversation-invariant'
/** Registry required to own the reversible check. */
export const inject = ['invariants']
const install: InvariantInstaller = Object.assign(async (ctx: Context, fail: (message: string) => never) => {
  try { await ctx.organizationConversation.verifyBindings() }
  catch (error) { fail(error instanceof Error ? error.message : 'binding/log mismatch') }
}, { inject: ['organizationConversation'] })
/**
 * Register durable cross-store consistency checking.
 * @param ctx - Invariant registration owner.
 * @returns Disposer after initial disk comparison completes.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register('@deepseek-ai/dsh-organization-conversation', install))
