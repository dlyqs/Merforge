/** Safe setup views and fixed Desktop capability, independent of Session records. */
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { CodexAccount, CodexFailureCategory, CodexModel } from '@deepseek-ai/dsh-codex-runtime'
/** One application-owned login attempt; never a native login ID. */
export type CodexSetupAttemptId = Branded<'CodexSetupAttemptId'>
/** Electron-owned window lifetime; replaced on document navigation. */
export type CodexSetupOwnerId = Branded<'CodexSetupOwnerId'>
/** Fixed setup causes, without raw exceptions. */
export type CodexSetupCategory = CodexFailureCategory | 'busy' | 'login-required' | 'login-failed' | 'models-empty' | 'catalog'
/** Availability and login are independent observations. */
export interface CodexSetupSnapshot {
  readonly revision: number
  readonly runtime: { readonly version: '0.153.4'; readonly status: 'unknown' | 'ready' | 'error'; readonly category?: CodexSetupCategory | undefined }
  readonly account: { readonly status: 'unknown' } | { readonly status: 'known'; readonly value: CodexAccount } | { readonly status: 'error'; readonly category: CodexSetupCategory }
  readonly catalog: { readonly status: 'unknown' | 'ready' | 'empty' | 'error'; readonly models: readonly CodexModel[]; readonly category?: CodexSetupCategory | undefined }
  readonly login: { readonly status: 'idle' | 'starting' | 'waiting' | 'verifying' | 'succeeded' | 'failed' | 'cancelled' | 'timeout'
    readonly category?: CodexSetupCategory | undefined
    readonly cancellation?: 'canceled' | 'notFound' | 'unconfirmed' | undefined
    readonly cleanup?: 'done' | 'failed' | undefined }
}
/** Owner-only code; URL and native login ID remain on the Host. */
export interface CodexSetupView {
  readonly snapshot: CodexSetupSnapshot
  readonly device?: { readonly attemptId: CodexSetupAttemptId; readonly userCode: string } | undefined
}
/** Fixed Renderer operations; no arbitrary address, credential import or logout. */
export type CodexSetupOperation = { readonly kind: 'snapshot' | 'detect' | 'start' }
  | { readonly kind: 'cancel' | 'openVerification'; readonly attemptId: CodexSetupAttemptId }
/** Desktop-only consumer used by settings; subscriptions carry safe state only. */
export interface CodexSetupDesktopBridge {
  /** Read state and the current window's ephemeral code. @returns current view. */
  snapshot(): Promise<CodexSetupView>
  /** Refresh independent availability observations. @returns refreshed view. */
  detect(): Promise<CodexSetupView>
  /** Start one explicitly requested login. @returns owner view after preparation. */
  start(): Promise<CodexSetupView>
  /** Cancel the owned attempt and await cleanup. @param attemptId - current owned ID. @returns settled view. */
  cancel(attemptId: CodexSetupAttemptId): Promise<CodexSetupView>
  /** Open the current Host-validated endpoint. @param attemptId - current owned ID. @returns open completion. */
  openVerification(attemptId: CodexSetupAttemptId): Promise<void>
  /** Observe safe state. @param listener - state observer. @returns disposer. */
  subscribe(listener: (snapshot: CodexSetupSnapshot) => void): () => void
}
