/** Actual Loader/setup/subprocess composition through the fixed parent IPC consumer. */
import { EventEmitter } from 'node:events'
import { expect, it, vi } from 'vitest'
import { setup, owner, other } from '../../../packages/core/agent-codex/tests/setup-harness.ts'
import { codexSetupNativeMessageSchema } from '@deepseek-ai/dsh-agent-codex/setup-protocol'
import { installCodexSetupControl } from '../src/codex-setup.ts'
const nonce = '33333333-3333-4333-8333-333333333333'
it('crops the owner grant, rejects foreign cancellation and nonce changes, and broadcasts only safe state', async () => {
  const h = await setup()
  const emitter = new EventEmitter(), output: unknown[] = []
  installCodexSetupControl(h.ctx, {
    on: (event, listener) => emitter.on(event, listener),
    off: (event, listener) => emitter.off(event, listener),
    send: message => output.push(message),
  })
  let sequence = 0
  const request = async (operation: object, window = owner) => {
    const requestId = `44444444-4444-4444-8444-${String(++sequence).padStart(12, '0')}`
    emitter.emit('message', { type: 'codex-setup', version: 1, nonce, requestId, owner: window, operation })
    await vi.waitFor(() =>{  expect(output.some(value => codexSetupNativeMessageSchema.safeParse(value).data?.type === 'codex-setup-result' && (value as { requestId?: string }).requestId === requestId)).toBe(true) })
    return codexSetupNativeMessageSchema.parse(output.find(value => (value as { requestId?: string }).requestId === requestId))
  }
  const started = await request({ kind: 'start' })
  if (started.type !== 'codex-setup-result') throw new Error('Missing reply')
  const id = started.result!.device!.attemptId
  expect(started.result!.device!.userCode).toBe('FIXTURE-PRIVATE-CODE')
  const foreign = await request({ kind: 'snapshot' }, other)
  if (foreign.type !== 'codex-setup-result') throw new Error('Missing reply')
  expect(foreign.result!.device).toBeUndefined()
  expect(await request({ kind: 'cancel', attemptId: id }, other)).toMatchObject({ error: 'closed' })
  expect(await request({ kind: 'openVerification', attemptId: id })).toMatchObject({ verificationUrl: 'https://auth.openai.com/codex/device' })
  const before = output.length
  emitter.emit('message', { type: 'codex-setup', version: 1, nonce: other, requestId: other, owner, operation: { kind: 'snapshot' } })
  emitter.emit('message', { type: 'codex-setup', version: 1, nonce, requestId: other, owner, operation: { kind: 'logout' } })
  expect(output).toHaveLength(before)
  expect(await request({ kind: 'destroyOwner' })).toMatchObject({ result: { snapshot: { login: { status: 'cancelled', cleanup: 'done' } } } })
  const broadcasts = output.filter(value => codexSetupNativeMessageSchema.parse(value).type === 'codex-setup-changed')
  expect(broadcasts.length).toBeGreaterThan(0)
  expect(JSON.stringify(broadcasts)).not.toContain('FIXTURE-PRIVATE-CODE')
  expect(JSON.stringify(broadcasts)).not.toContain('verificationUrl')
  expect((await h.calls()).some(method => /thread|turn/.test(method))).toBe(false)
})
