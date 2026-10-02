/** Native durable data validation and immutable dispatch associations. */
import { expect, it } from 'vitest'
import { readAgentBackend, type AgentBackendSelection } from '@deepseek-ai/dsh-agent'
import { brandString } from '@deepseek-ai/dsh-brand'
import { SessionSeq } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionEventMap } from '@deepseek-ai/dsh-session'
import type { CodexInputId, CodexThreadId, CodexTurnId } from '@deepseek-ai/dsh-codex-runtime'
import { codexBridgeProjection as projection } from '../src/projection.ts'

const selection: AgentBackendSelection = { kind: 'codex', model: 'native', effort: 'medium', runtimeVersion: '0.153.4' }
const threadId = brandString<CodexThreadId>('thread')
const inputId = brandString<CodexInputId>('input')
const turnId = brandString<CodexTurnId>('turn')
function event<Type extends keyof SessionEventMap>(type: Type, data: SessionEventMap[Type]): SessionEvent<Type> {
  return { seq: SessionSeq(0), time: 0, type, data }
}
function bound() {
  let state = projection.apply(projection.init(), event('agent/backend', selection))
  state = projection.apply(state, event('codex/thread-preparing', { cwd: '/cwd', selection }))
  return projection.apply(state, event('codex/thread-bound', { threadId, cwd: '/cwd', runtimeVersion: '0.153.4' }))
}

it('refuses incompatible backend records and duplicate selections while old API logs remain routable', () => {
  expect(readAgentBackend([])).toBeUndefined()
  expect(() => readAgentBackend([event('agent/backend', { ...selection, runtimeVersion: 'old' } as never)])).toThrow()
  expect(() => readAgentBackend([event('agent/backend', selection), event('agent/backend', selection)])).toThrow('multiple')
})

it('refuses malformed persisted event fields and snapshots', () => {
  expect(() => projection.apply(bound(), event('codex/send-intent', { turn: -1, inputId, threadId, params: {} }))).toThrow()
  expect(() => projection.stateSchema.parse({ ...bound(), threadId: 42 })).toThrow()
})

it('rejects receipts without their exact dispatch and repeated accepted receipts', () => {
  const state = projection.apply(bound(), event('codex/send-intent', { turn: 1, inputId, threadId, params: {} }))
  expect(() => projection.apply(state, event('codex/send-receipt', { turn: 1, inputId: brandString<CodexInputId>('other'), threadId, turnId }))).toThrow('no intent')
  const receipt = event('codex/send-receipt', { turn: 1, inputId, threadId, turnId })
  const running = projection.apply(state, receipt)
  expect(() => projection.apply(running, receipt)).toThrow('no intent')
  expect(() => projection.apply(running, event('codex/turn-result', { turn: 1, inputId, threadId,
    turnId: brandString<CodexTurnId>('other'), status: 'completed', finalText: null, items: [], usage: 'unknown', recovered: false }))).toThrow('another thread or turn')
})
