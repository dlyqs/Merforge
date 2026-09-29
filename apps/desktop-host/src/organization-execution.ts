/** Private Node IPC consumer; public Host remotes cannot mint organization authority. */
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { executionHostMessageSchema, type ExecutionAuthority, type ExecutionCommand, type ExecutionReadAuthority, executionAuthoritySchema, executionReadAuthoritySchema } from '@deepseek-ai/dsh-organization-execution'

/**
 * Attach context reads to the owned parent channel and drain them on disposal.
 * @param ctx - Loaded personal Host containing the isolated context plugin.
 * @param channel - Private Node IPC channel, never a Renderer port.
 */
export function installOrganizationExecutionControl(ctx: Context, channel: {
  on(event: 'message', listener: (message: unknown) => void): unknown
  off(event: 'message', listener: (message: unknown) => void): unknown
  send(message: object): void
}): void {
  interface Active {
    nonce: string
    cancel: AbortController
    done: Promise<void>
    authorization?: { id: string
      resolve: (authority: ExecutionAuthority | ExecutionReadAuthority) => void
      reject: (error: Error) => void }
  }
  const pending = new Map<string, Active>()
  const receive = (input: unknown) => {
    const parsed = executionHostMessageSchema.safeParse(input)
    if (!parsed.success) return
    const message = parsed.data
    if (message.type !== 'organization-execution-open' && message.type !== 'organization-execution-report') {
      const active = pending.get(message.requestId)
      if (!active || active.nonce !== message.nonce) return
      if (message.type === 'organization-execution-cancel') { active.cancel.abort(); return }
      const authorization = active.authorization
      if (!authorization || authorization.id !== message.authorizationId) return
      delete active.authorization
      if (message.authority && !message.error) authorization.resolve(message.authority)
      else authorization.reject(new Error('organization-execution: denied'))
      return
    }
    if (pending.has(message.requestId)) return
    const cancel = new AbortController()
    const active: Active = {
      nonce: message.nonce, cancel, done: Promise.resolve(),
    }
    const timer = setTimeout(() => { cancel.abort() }, message.timeoutMs)
    const aborted = () => { active.authorization?.reject(new Error('organization-execution: cancelled')) }
    cancel.signal.addEventListener('abort', aborted)
    pending.set(message.requestId, active)
    active.done = (async () => {
      try {
        const bridge = (command?: ExecutionCommand): Promise<ExecutionAuthority | ExecutionReadAuthority> =>
          new Promise((resolve, reject) => {
            cancel.signal.throwIfAborted()
            const id = randomUUID()
            active.authorization = { id, resolve, reject }
            channel.send({ type: 'organization-execution-authorize', requestId: message.requestId, nonce: message.nonce, authorizationId: id, ...(command ? { command } : {}) })
          })
        if (message.type === 'organization-execution-report') {
          const report = await ctx.organizationExecution.report(message.request,
            async () => executionReadAuthoritySchema.parse(await bridge()), cancel.signal)
          cancel.signal.throwIfAborted()
          channel.send({ type: 'organization-execution-result', requestId: message.requestId, nonce: message.nonce, report })
        } else {
          const authorize = async (command?: ExecutionCommand) => executionAuthoritySchema.parse(await bridge(command))
          const result = await ctx.organizationExecution.open(message.request, authorize, cancel.signal)
          if (message.request.start) {
            await ctx.organizationExecution.executeConfigured(message.request, authorize, cancel.signal)
            result.mode = 'finished'
          }
          cancel.signal.throwIfAborted()
          channel.send({ type: 'organization-execution-result', requestId: message.requestId, nonce: message.nonce, result })
        }
      } catch (error) {
        ctx.logger.info('component=execution runId=%s result=denied', message.request.runId)
        channel.send({ type: 'organization-execution-result', requestId: message.requestId, nonce: message.nonce, error: error instanceof Error && /^organization-execution: [a-z-]+$/.test(error.message) ? error.message : 'organization-execution-unavailable' })
      } finally {
        clearTimeout(timer); cancel.signal.removeEventListener('abort', aborted); pending.delete(message.requestId)
      }
    })().catch((error: unknown) => { ctx.logger.warn('component=context result=ipc-unavailable', error instanceof Error ? error.name : 'Error') })
  }
  ctx.effect(() => {
    channel.on('message', receive)
    return async () => {
      channel.off('message', receive)
      for (const active of pending.values()) active.cancel.abort()
      await Promise.all([...pending.values()].map(active => active.done))
    }
  }, 'organization-execution.ipc')
}
