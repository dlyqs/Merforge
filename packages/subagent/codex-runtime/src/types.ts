/** Fixed Codex protocol values and consumer persistence obligations. */
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'

/** Native thread identity, independent of a Harness Session ID. */
export type CodexThreadId = Branded<'CodexThreadId'>
/** Native turn identity. */
export type CodexTurnId = Branded<'CodexTurnId'>
/** Native stream item identity. */
export type CodexItemId = Branded<'CodexItemId'>
/** Stable consumer input identity for history reconciliation. */
export type CodexInputId = Branded<'CodexInputId'>
/** One server callback identity within a native connection. */
export type CodexRequestId = Branded<'CodexRequestId'>
/** Effort values published by the pinned official schema. */
export type CodexEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra'
/** Safe account state; contains no native account identity or token. */
export interface CodexAccount {
  readonly kind: 'none' | 'apiKey' | 'chatgpt' | 'amazonBedrock'
  readonly requiresOpenaiAuth: boolean
}
/** Native model picker information with explicit effort choices. */
export interface CodexModel {
  readonly id: string
  readonly model: string
  readonly displayName: string
  readonly isDefault: boolean
  readonly efforts: readonly CodexEffort[]
  readonly defaultEffort: CodexEffort
}
/** Fixed protocol support, separate from unverified controlled execution. */
export interface CodexCapabilities {
  readonly version: '0.153.4'
  readonly persistentText: boolean
  readonly controlledTools: false
  readonly organizationExecution: false
  readonly completeModelLog: false
  readonly perModelRequestPermit: false
  readonly steering: false
  readonly fork: false
  readonly attachments: false
}
/** Safe process/protocol diagnostic categories. */
export type CodexFailureCategory = 'payload' | 'unknown-start' | 'startup' | 'protocol' | 'frame-limit' | 'eof' | 'process' | 'rpc' | 'timeout' | 'closed' | 'unknown-send' | 'unknown-thread' | 'cleanup'
/** Deployment-owned limits; all waits and retained protocol queues are bounded. */
export interface CodexRuntimeLimits {
  readonly startupTimeoutMs: number
  readonly rpcTimeoutMs: number
  readonly turnTimeoutMs: number
  readonly humanTimeoutMs: number
  readonly interruptTimeoutMs: number
  readonly disposeGraceMs: number
  readonly maxFrameBytes: number
  readonly maxEarlyEvents: number
  readonly maxTurnBytes: number
  readonly modelCacheMs: number
  readonly modelPageSize: number
  readonly maxModelPages: number
}
/** Fixed diagnostic facts; excludes account identity, paths and protocol payloads. */
export interface CodexRuntimeDiagnostic {
  readonly stage: 'initialize' | 'ready' | 'thread-bound' | 'input-committed' | 'turn-accepted' | 'terminal' | 'error' | 'cleanup'
  readonly category?: CodexFailureCategory
  readonly status?: CodexTurnTerminal['status']
}
/** Fully resolved runtime launch; no arbitrary argv or installed-CLI fallback. */
export interface CodexRuntimeSpec {
  readonly cwd: string
  readonly env: Record<string, string>
  readonly limits: CodexRuntimeLimits
  /** Read-only setup connections do not reserve execution; login has its own admission. */
  readonly purpose?: 'setup'
  readonly experimentalApi: boolean
  /** Application tools advertised at thread creation; native tools remain Codex-owned. */
  readonly dynamicTools?: readonly CodexDynamicTool[]
  /**
   * Handle a validated current-turn callback; cancellation revokes its answer.
   * @param request - exact native request and connection-scoped identity.
   * @param signal - turn, timeout and process lifetime.
   * @returns JSON response conforming to the selected callback method.
   */
  readonly onRequest?: (request: CodexServerRequest, signal: AbortSignal) => Promise<unknown>
  /**
   * Observe fixed lifecycle facts without raw prompt, stderr or account information.
   * @param diagnostic - safe phase, category and terminal status.
   */
  readonly onDiagnostic?: (diagnostic: CodexRuntimeDiagnostic) => void
  /**
   * Spawn through the caller-owned subprocess service with its ambient scrub.
   * @param spec - fixed official command and managed-range lifetime.
   * @returns the owned child handle.
   */
  readonly spawn: (spec: SubprocessSpawnSpec) => SubprocessHandle
}
/** Persistent native thread information retained only on the Host. */
export interface CodexThread {
  readonly id: CodexThreadId
  readonly cwd: string
  readonly model: string
  readonly ephemeral: false
  readonly runtimeVersion: '0.153.4'
  /** Native typed history used for reconciliation, not a complete model request log. */
  readonly turns: readonly Record<string, unknown>[]
}
/** Explicit personal native selection. Controlled and organization modes are refused. */
export interface CodexThreadSelection {
  readonly mode: 'native' | 'controlled' | 'organization'
  readonly model: string
  readonly effort: CodexEffort
}
/** Text-only send inputs and the mandatory durable intent commit. */
export interface CodexSendRequest {
  readonly inputId: CodexInputId
  readonly texts: readonly string[]
  /**
   * Commit input, selection and method before the first protocol write.
   * @param intent - exact outgoing turn/start parameters and input identity.
   * @returns completion of durable persistence; rejection prevents sending.
   */
  readonly persistIntent: (intent: CodexSendIntent) => Promise<void>
}
/** Consumer-protected log record; never a general diagnostic entry. */
export interface CodexSendIntent {
  readonly inputId: CodexInputId
  readonly threadId: CodexThreadId
  readonly method: 'turn/start'
  readonly params: Readonly<Record<string, unknown>>
}
/** Current-turn events accepted only after a matching start response. */
export type CodexTurnEvent =
  | { readonly turnId: CodexTurnId; readonly type: 'text-delta'; readonly itemId: CodexItemId; readonly text: string }
  | { readonly turnId: CodexTurnId; readonly type: 'item'; readonly itemId: CodexItemId; readonly item: Readonly<Record<string, unknown>> }
/** Authoritative terminal outcome; empty text may accompany native tool items. */
export interface CodexTurnTerminal {
  readonly turnId: CodexTurnId
  readonly status: 'completed' | 'interrupted' | 'failed'
  readonly items: readonly Readonly<Record<string, unknown>>[]
  readonly finalText: string | null
  /** No price or token estimate is synthesized. */
  readonly usage: 'unknown'
}
/** Accepted-send receipt; completion rejects on loss of authoritative observation. */
export interface CodexSendReceipt {
  readonly inputId: CodexInputId
  readonly threadId: CodexThreadId
  readonly turnId: CodexTurnId
  readonly terminal: Promise<CodexTurnTerminal>
}

/** Application function schema understood by the pinned experimental protocol. */
export interface CodexDynamicTool {
  readonly type: 'function'
  readonly name: string
  readonly description: string
  readonly inputSchema: unknown
}
/** Validated current-turn callback; payload validation belongs to its consumer. */
export interface CodexServerRequest {
  readonly requestId: CodexRequestId
  readonly method: 'item/tool/call' | 'item/tool/requestUserInput' | 'item/commandExecution/requestApproval' | 'item/fileChange/requestApproval'
  readonly threadId: CodexThreadId
  readonly turnId: CodexTurnId
  readonly params: Readonly<Record<string, unknown>>
}

/** Native login identity retained only by its managed connection. */
export type CodexLoginId = Branded<'CodexLoginId'>
/** Short-lived device grant; never log or persist these fields. */
export interface CodexDeviceCode {
  readonly loginId: CodexLoginId
  readonly userCode: string
  readonly verificationUrl: string
}
/** Cropped account lifecycle observations, without identity, plan or raw errors. */
export type CodexAccountNotification =
  | { readonly type: 'updated' }
  | { readonly type: 'completed'; readonly loginId: CodexLoginId | null; readonly success: boolean }
