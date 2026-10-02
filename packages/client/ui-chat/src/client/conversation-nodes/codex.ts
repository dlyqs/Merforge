/** Replayable native tool observations and protocol outcomes; no Harness tool claims. */
import type { Context } from '@deepseek-ai/cordis'
import type { ConversationNodeDefinition } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-agent-codex/types'
import { chatNode } from './common.ts'

/** Renderer-ready native observation. */
interface NativeObservation {
  readonly seq: number
  readonly kind: 'item' | 'result'
  readonly status: 'completed' | 'interrupted' | 'failed' | 'unknown' | null
  readonly text: string
}
declare module '../contract/chat-nodes.ts' {
  interface ChatNodeDataMap { codex: NativeObservation }
}
function observation(event: Parameters<ConversationNodeDefinition['match']>[0]): NativeObservation {
  if (event.type === 'codex/item') return { seq: event.seq, kind: 'item', status: null, text: JSON.stringify(event.data.item, null, 2) }
  if (event.type === 'codex/recovery') return { seq: event.seq, kind: 'result', status: 'unknown', text: '' }
  if (event.type === 'codex/turn-result') return { seq: event.seq, kind: 'result', status: event.data.status, text: event.data.recovered ? event.data.finalText ?? '' : '' }
  throw new Error('Native observation requires a Codex item or result')
}
/** Native items and results each own a stable independently replayable Chat node. */
export const codexObservationDefinition: ConversationNodeDefinition<NativeObservation> = {
  kind: 'codex-observation', target: 'chat',
  match(event) {
    if (event.type === 'codex/recovery' && event.data.status === 'unknown') return { id: `recovery/${event.seq}`, role: 'start' }
    if (event.type === 'codex/item') return { id: `${event.data.threadId}/${event.data.turnId}/${event.data.itemId}`, role: 'start' }
    if (event.type === 'codex/turn-result') return { id: String(event.data.inputId), role: 'start' }
    return null
  },
  start: (_context, match) => observation(match.event),
  update: (_context, match) => observation(match.event),
  buildViewNode: context => context.state === undefined ? null : chatNode(context, 'codex', context.state.seq, context.state),
}
/**
 * Register native observation presentation alongside ordinary user and assistant nodes.
 * @param ctx - Chat feature context.
 */
export function registerCodexObservation(ctx: Context): void { ctx.uiConversation.events.register(codexObservationDefinition) }
