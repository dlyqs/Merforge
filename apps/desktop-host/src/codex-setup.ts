/** Fixed setup commands carried only on the private Electron parent channel. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent-codex'
import { codexSetupHostMessageSchema } from '@deepseek-ai/dsh-agent-codex/setup-protocol'
/**
 * Install private setup control and await admitted operations on Host teardown.
 * @param ctx - loaded Desktop Host.
 * @param channel - owned Node parent channel.
 */
export function installCodexSetupControl(ctx: Context, channel: {
  on(event: 'message', listener: (message: unknown) => void): unknown
  off(event: 'message', listener: (message: unknown) => void): unknown
  send(message: object): void
}): void {
  const pending = new Set<Promise<void>>()
  let nonce: string | undefined
  let active = true
  const isActive = (): boolean => active
  const owners = new Set<import('@deepseek-ai/dsh-agent-codex/setup-types').CodexSetupOwnerId>()
  const receive = (input: unknown): void => {
    const parsed = codexSetupHostMessageSchema.safeParse(input)
    if (!active || !parsed.success) return
    const message = parsed.data
    if (nonce !== undefined && nonce !== message.nonce) return
    nonce = message.nonce
    owners.add(message.owner)
    const task = (async () => {
      const setup = ctx.get('codexSetup')
      try {
        if (!setup) throw new Error('closed')
        const { operation, owner } = message
        let verificationUrl: string | undefined
        switch (operation.kind) {
          case 'snapshot': break
          case 'detect': await setup.detect(); break
          case 'start': await setup.start(owner); break
          case 'cancel': await setup.cancel(owner, operation.attemptId); break
          case 'openVerification': verificationUrl = setup.verificationUrl(owner, operation.attemptId); break
          case 'destroyOwner': await setup.destroyOwner(owner); break
        }
        if (isActive()) channel.send({ type: 'codex-setup-result', version: 1, nonce, requestId: message.requestId,
          result: setup.view(owner), ...verificationUrl === undefined ? {} : { verificationUrl } })
      } catch (error) {
        const category = error instanceof Error && error.message === 'codex-setup: busy' ? 'busy' : 'closed'
        ctx.logger.info('component=codex-setup event=operation status=rejected category=%s', category)
        if (isActive()) channel.send({ type: 'codex-setup-result', version: 1, nonce, requestId: message.requestId, error: category })
      }
    })().catch((error: unknown) => { void error /* Parent disconnect is settled by Host shutdown. */ })
    pending.add(task)
    void task.finally(() => { pending.delete(task) })
  }
  ctx.on('codex-setup/changed', () => {
    const setup = ctx.get('codexSetup')
    if (!active || nonce === undefined || !setup) return
    try { channel.send({ type: 'codex-setup-changed', version: 1, nonce, snapshot: setup.snapshot() }) }
    catch (error) { void error /* The private parent owns disconnect shutdown. */ }
  })
  ctx.effect(() => {
    channel.on('message', receive)
    return async () => {
      active = false
      channel.off('message', receive)
      // Setup's disposer revokes its attempt and drains the same work before this wait.
      const setup = ctx.get('codexSetup')
      if (setup) await Promise.allSettled([...owners].map(owner => setup.destroyOwner(owner)))
      await Promise.allSettled([...pending])
    }
  }, 'codex-setup.ipc')
}
