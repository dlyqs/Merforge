/** Incremental external transcript state; crash recovery never replays an intent. */
import { z } from 'zod'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { CodexInputId, CodexThreadId, CodexTurnId } from '@deepseek-ai/dsh-codex-runtime'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { CodexBridgeProjection } from './types.ts'

const selectionSchema = z.object({ kind: z.literal('codex'), model: z.string().min(1),
  effort: z.enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']), runtimeVersion: z.literal('0.153.4') })
const id = z.string().min(1)
const turn = z.number().int().positive()
const resultStatus = z.enum(['completed', 'interrupted', 'failed', 'unknown'])
const schema: z.ZodType<CodexBridgeProjection> = z.object({ selection: selectionSchema.nullable(),
  threadId: id.transform(value => brandString<CodexThreadId>(value)).nullable(),
  inputId: id.transform(value => brandString<CodexInputId>(value)).nullable(),
  turnId: id.transform(value => brandString<CodexTurnId>(value)).nullable(),
  status: z.enum(['unbound', 'ready', 'preparing', 'sending', 'running', 'completed', 'interrupted', 'failed', 'unknown']) })
const eventSchemas = {
  'agent/backend': selectionSchema,
  'codex/thread-preparing': z.object({ cwd: id, selection: selectionSchema }),
  'codex/thread-bound': z.object({ threadId: id, cwd: id, runtimeVersion: z.literal('0.153.4') }),
  'codex/recovery': z.object({ threadId: id, status: z.enum(['verified', 'unknown']) }),
  'codex/send-intent': z.object({ turn, inputId: id, threadId: id, params: z.json() }),
  'codex/send-receipt': z.object({ turn, inputId: id, threadId: id, turnId: id }),
  'codex/item': z.object({ turn, threadId: id, turnId: id, itemId: id, item: z.json() }),
  'codex/turn-result': z.object({ turn, inputId: id, threadId: id.nullable(), turnId: id.nullable(), status: resultStatus,
    finalText: z.string().nullable(), items: z.array(z.json()), usage: z.literal('unknown'), recovered: z.boolean() }),
  'codex/diagnostic': z.object({ category: id }),
}

/** Fold the native association and current dispatch state for Host and Client. */
export const codexBridgeProjection = {
  key: 'codexBridge',
  init: (): CodexBridgeProjection => ({ selection: null, threadId: null, status: 'unbound', inputId: null, turnId: null }),
  stateSchema: schema,
  apply(state, event) {
    // Event data arrives from durable files as well as live appends.
    if (event.type in eventSchemas) eventSchemas[event.type as keyof typeof eventSchemas].parse(event.data)
    switch (event.type) {
      case 'agent/backend':
        if (state.selection !== null) throw new Error('duplicate native backend selection')
        return { ...state, selection: event.data }
      case 'codex/thread-preparing':
        if (state.status !== 'unbound' || JSON.stringify(state.selection) !== JSON.stringify(event.data.selection)) throw new Error('conflicting native thread preparation')
        return { ...state, status: 'preparing' }
      case 'codex/thread-bound':
        if (state.status !== 'preparing' || state.threadId !== null) throw new Error('duplicate native thread association')
        return { ...state, threadId: event.data.threadId, status: 'ready' }
      case 'codex/recovery':
        if (state.threadId !== event.data.threadId) throw new Error('recovery uses another native thread')
        return { ...state, status: event.data.status === 'unknown' ? 'unknown' : 'ready' }
      case 'codex/send-intent':
        if (state.threadId !== event.data.threadId) throw new Error('native send uses another thread')
        return { ...state, inputId: event.data.inputId, turnId: null, status: 'sending' }
      case 'codex/send-receipt':
        if (state.threadId !== event.data.threadId || state.inputId !== event.data.inputId || state.turnId !== null) throw new Error('native receipt has no intent')
        return { ...state, turnId: event.data.turnId, status: 'running' }
      case 'codex/turn-result':
        if (state.inputId !== event.data.inputId && state.status !== 'preparing') throw new Error('native result has no intent')
        if (state.threadId !== event.data.threadId || (state.turnId !== null && state.turnId !== event.data.turnId)) throw new Error('native result uses another thread or turn')
        return { ...state, inputId: event.data.inputId, turnId: event.data.turnId, status: event.data.status }
      default: return state
    }
  },
  wire: { viewSchema: schema, view: state => state },
  stateVersion: 1,
} satisfies ProjectionDefinition<'codexBridge', CodexBridgeProjection>
