import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { SessionSeq } from '@deepseek-ai/dsh-session'
import { executionActionSchema } from '@deepseek-ai/dsh-organization/execution'
import { actionDigest } from '../src/action-guard.ts'
import { inspectActions } from '../src/recovery.ts'
import { fixture } from './harness.ts'
it('distinguishes a durable pre-dispatch journal from an issued attempt with no observable result', () => {
  const { authority } = fixture()
  const { id: runId, configDigest: _digest, state: _state, version, createdRevision, ...selector } = authority.execution.run
  const action = executionActionSchema.parse({ ...selector, runId, version, createdRevision,
    actionId: randomUUID(), capability: 'model', requestDigest: 'a'.repeat(64), state: 'unknown', expiresAt: Date.now(), evidenceDigest: null })
  authority.execution.actions = [action]
  const event = (stage: 'reserved' | 'issued') => ({ type: 'organization/execution-action' as const,
    seq: SessionSeq(1), time: Date.now(), data: { action, stage } })
  const before = inspectActions([event('reserved')], authority)
  expect(before.actions[0]?.status).toBe('not-issued')
  expect(before.settlements[0]?.outcome).toBe('not-issued')
  expect(inspectActions([event('reserved'), event('issued')], authority)).toMatchObject({
    actions: [{ status: 'unknown', reason: 'unobservable' }], settlements: [],
  })
  expect(inspectActions([], authority)).toMatchObject({ actions: [{ status: 'unknown', reason: 'missing-evidence' }], settlements: [] })
  expect(actionDigest({ outcome: 'not-issued' })).toBe(before.settlements[0]?.evidenceDigest)
})
