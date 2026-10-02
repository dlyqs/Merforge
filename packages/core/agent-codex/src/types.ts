/** Durable native dispatch and observed-result vocabulary; no native credentials. */
import type { AgentBackendSelection } from '@deepseek-ai/dsh-agent/types'
import type { CodexThreadId, CodexTurnId, CodexItemId, CodexInputId, CodexRequestId } from '@deepseek-ai/dsh-codex-runtime'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'

/** Safe replayable current bridge state. */
export interface CodexBridgeProjection {
  readonly selection: AgentBackendSelection | null
  readonly threadId: CodexThreadId | null
  readonly dynamicTools: readonly string[] | null
  readonly status: 'unbound' | 'ready' | 'preparing' | 'sending' | 'running' | 'completed' | 'interrupted' | 'failed' | 'unknown'
  readonly inputId: CodexInputId | null
  readonly turnId: CodexTurnId | null
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Thread creation dispatch intent; a missing binding after restart stays unknown. */
    'codex/thread-preparing': { readonly cwd: string; readonly selection: AgentBackendSelection }
    /** Exact persistent native thread association, observed before any turn dispatch. */
    'codex/thread-bound': { readonly threadId: CodexThreadId; readonly cwd: string; readonly runtimeVersion: '0.153.4'; readonly dynamicTools?: readonly string[] }
    /** Exact outgoing turn/start params committed before the protocol write. */
    'codex/send-intent': { readonly turn: number; readonly inputId: CodexInputId; readonly threadId: CodexThreadId; readonly params: JsonValue }
    /** Native turn acceptance observed independently of its terminal. */
    'codex/send-receipt': { readonly turn: number; readonly inputId: CodexInputId; readonly threadId: CodexThreadId; readonly turnId: CodexTurnId }
    /** Native item observed for the associated turn; never a Harness tool execution. */
    'codex/item': { readonly turn: number; readonly threadId: CodexThreadId; readonly turnId: CodexTurnId; readonly itemId: CodexItemId; readonly item: JsonValue }
    /** Authoritative protocol terminal or unresolved dispatch observation; usage is unknown. */
    'codex/turn-result': { readonly turn: number; readonly inputId: CodexInputId; readonly threadId: CodexThreadId | null; readonly turnId: CodexTurnId | null; readonly status: 'completed' | 'interrupted' | 'failed' | 'unknown'; readonly finalText: string | null; readonly items: readonly JsonValue[]; readonly usage: 'unknown'; readonly recovered: boolean }
    /** Native callback scoped to the exact thread and turn; never a reusable approval. */
    'codex/request': { readonly turn: number; readonly requestId: CodexRequestId; readonly threadId: CodexThreadId; readonly turnId: CodexTurnId; readonly method: string; readonly params: JsonValue }
    /** Locally observed answer or revoked request; does not assert remote receipt. */
    'codex/request-result': { readonly turn: number; readonly requestId: CodexRequestId; readonly threadId: CodexThreadId; readonly turnId: CodexTurnId; readonly status: 'answered' | 'cancelled' | 'rejected'; readonly response: JsonValue }
    /** Recovery availability, separate from a previously observed native terminal. */
    'codex/recovery': { readonly threadId: CodexThreadId; readonly status: 'verified' | 'unknown' }
    /** Safe preparation, recovery, or cleanup diagnostic; no stderr or native account identity. */
    'codex/diagnostic': { readonly category: string }
  }
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap { codexBridge: CodexBridgeProjection }
  interface SessionProjectionMap { codexBridge: CodexBridgeProjection }
}
