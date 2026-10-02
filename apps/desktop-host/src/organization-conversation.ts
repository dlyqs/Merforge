/** Private Node IPC consumer; public Host remotes cannot mint organization authority. */
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { conversationHostMessageSchema, type ConversationAuthority } from '@deepseek-ai/dsh-organization-conversation'

/**
 * Attach planning operations to the owned parent channel and drain them on disposal.
 * @param ctx - Loaded personal Host containing the isolated conversation plugin.
 * @param channel - Private Node IPC channel, never a Renderer port.
 */
export function installOrganizationConversationControl(ctx: Context, channel: {
  on(event: 'message', listener: (message: unknown) => void): unknown
  off(event: 'message', listener: (message: unknown) => void): unknown
  send(message: object): void
}): void {
  interface Active {
    nonce: string
    cancel: AbortController
    done: Promise<void>
    authorizations: Map<string, { resolve: (authority: ConversationAuthority) => void; reject: (error: Error) => void }>
  }
  const pending = new Map<string, Active>()
  const receive = (input: unknown) => {
    const parsed = conversationHostMessageSchema.safeParse(input)
    if (!parsed.success) return
    const message = parsed.data
    if (message.type !== 'organization-conversation-operation') {
      const active = pending.get(message.requestId)
      if (!active || active.nonce !== message.nonce) return
      if (message.type === 'organization-conversation-cancel') { active.cancel.abort(); return }
      const authorization = active.authorizations.get(message.authorizationId)
      if (!authorization) return
      active.authorizations.delete(message.authorizationId)
      if (message.authority && !message.error) authorization.resolve(message.authority)
      else authorization.reject(new Error(message.error === 'version-conflict' ? 'version-conflict' : 'organization-conversation: denied'))
      return
    }
    if (pending.has(message.requestId)) return
    const cancel = new AbortController()
    const active: Active = {
      nonce: message.nonce, cancel, done: Promise.resolve(), authorizations: new Map(),
    }
    const timer = setTimeout(() => { cancel.abort() }, message.timeoutMs)
    const aborted = () => { for (const authorization of active.authorizations.values()) authorization.reject(new Error('organization-conversation: cancelled')); active.authorizations.clear() }
    cancel.signal.addEventListener('abort', aborted)
    pending.set(message.requestId, active)
    active.done = (async () => {
      try {
        const result = await ctx.organizationConversation.perform(message.request, command => new Promise((resolve, reject) => {
          cancel.signal.throwIfAborted()
          const id = randomUUID()
          active.authorizations.set(id, { resolve, reject })
          channel.send({ type: 'organization-conversation-authorize', requestId: message.requestId,
            nonce: message.nonce, authorizationId: id, ...(command ? { command } : {}) })
        }), cancel.signal)
        cancel.signal.throwIfAborted()
        channel.send({ type: 'organization-conversation-result', requestId: message.requestId, nonce: message.nonce, result })
      } catch (_error) {
        ctx.logger.info('component=conversation operationId=%s result=denied', message.request.operationId)
        channel.send({ type: 'organization-conversation-result', requestId: message.requestId,
          nonce: message.nonce, error: 'organization-conversation-unavailable' })
      } finally {
        clearTimeout(timer); cancel.signal.removeEventListener('abort', aborted); pending.delete(message.requestId)
      }
    })().catch((error: unknown) => { ctx.logger.warn('component=conversation result=ipc-unavailable',
      error instanceof Error ? error.name : 'Error') })
  }
  ctx.effect(() => {
    channel.on('message', receive)
    return async () => {
      channel.off('message', receive)
      for (const active of pending.values()) active.cancel.abort()
      await Promise.all([...pending.values()].map(active => active.done))
    }
  }, 'organization-conversation.ipc')
}
