/** Electron-owned organization subprocess. No parent IPC means no listener and no application launch. */
import { bootOrganization } from './organization-boot.ts'
import { OrganizationError } from '@deepseek-ai/dsh-organization'
import { z } from 'zod'

const controlSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('boot'), config: z.unknown() }).strict(),
  z.object({ type: z.literal('shutdown') }).strict(),
  z.object({ type: z.enum(['initialize', 'recover']), requestId: z.number().int().positive(), input: z.unknown() }).strict(),
])

function main(): void {
  if (!process.connected || !process.send) throw new Error('organization-parent-ipc-required')
  let application: ReturnType<typeof bootOrganization> | undefined
  const state: { stopping?: Promise<void> } = {}
  const send = (message: object): Promise<void> => new Promise((resolve) => {
    if (!process.connected || !process.send) { resolve(); return }
    process.send(message, () => { resolve() })
  })
  const stop = (): Promise<void> => state.stopping ??= (async () => {
    const running = await application?.catch(() => undefined)
    await running?.close()
    await send({ type: 'stopped' })
    if (process.connected) process.disconnect()
  })()
  const isStopping = (): boolean => state.stopping !== undefined
  let controlBusy = false
  const handle = async (input: unknown): Promise<void> => {
    const message = controlSchema.parse(input)
    if (message.type === 'shutdown') { await stop(); return }
    if (isStopping()) return
    if (message.type === 'boot') {
      if (application) throw new Error('organization-already-started')
      application = bootOrganization(message.config)
      const running = await application
      running.ctx.on('organization-api/failed', () => {
        void (async () => {
          try { await send({ type: 'failed', error: 'organization-listener-failed' }) } finally { await stop() }
        })().catch(() => { process.exitCode = 1 })
      })
      if (!isStopping()) await send({ type: 'ready', ...running.ready, ...await running.authority.identity() })
      return
    }
    if (!application || controlBusy) throw new Error('organization-control-unavailable')
    controlBusy = true
    try {
      const running = await application
      if (isStopping()) return
      const receipt = await running.authority[message.type](message.input)
      await send({ type: 'receipt', requestId: message.requestId, receipt })
    } catch (error) {
      await send({ type: 'receipt', requestId: message.requestId, error: error instanceof OrganizationError ? error.code : 'unavailable' })
    } finally { controlBusy = false }
  }
  process.on('message', (message: unknown) => {
    void handle(message).catch(async (error: unknown) => {
      process.exitCode = 1
      try { await send({ type: 'failed', error: failureCode(error) }) } finally { await stop() }
    })
  })
  process.once('disconnect', () => { void stop() })
  process.once('SIGTERM', () => { void stop() })
  process.once('SIGINT', () => { void stop() })
}

function failureCode(error: unknown): string {
  if (error instanceof z.ZodError) return 'organization-invalid-configuration'
  if (error instanceof Error) {
    if (error.message === 'organization-certificate-invalid') return error.message
    if ('code' in error) {
      if (error.code === 'EADDRINUSE') return 'organization-port-in-use'
      if (error.code === 'EADDRNOTAVAIL') return 'organization-bind-unavailable'
      if (typeof error.code === 'string' && (error.code.startsWith('ERR_SQLITE') || ['EACCES', 'ENOTDIR', 'EROFS'].includes(error.code))) {
        return 'organization-storage-unavailable'
      }
    }
  }
  return 'organization-start-or-control-failed'
}

if (import.meta.main) {
  try { main() } catch (error) {
    console.error(error instanceof Error ? error.message : 'organization-parent-ipc-required')
    process.exitCode = 1
  }
}
