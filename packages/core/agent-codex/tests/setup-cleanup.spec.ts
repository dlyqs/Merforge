/** Cleanup failure keeps authentication admission closed until Host restart. */
import { expect, it, vi } from 'vitest'
import { acquireCodexActivity } from '@deepseek-ai/dsh-codex-runtime'
import { setup, owner } from './setup-harness.ts'
it('reports cleanup failure separately from a confirmed cancellation', async () => {
  const h = await setup()
  const view = await h.service.start(owner)
  const child = h.children.at(-1)!
  const wait = child.waitForExit.bind(child)
  vi.spyOn(child, 'waitForExit').mockImplementation(async (signal) => {
    await wait(signal)
    throw new Error('fixture-cleanup-failure')
  })
  const result = await h.service.cancel(owner, view.device!.attemptId)
  expect(result.snapshot.login).toMatchObject({ status: 'cancelled', cancellation: 'canceled', cleanup: 'failed' })
  expect(() => acquireCodexActivity('execution')).toThrow('busy')
  expect(result.device).toBeUndefined()
  const outcome = await child.done
  expect(outcome.exitCode !== null || outcome.signal !== null).toBe(true)
})
