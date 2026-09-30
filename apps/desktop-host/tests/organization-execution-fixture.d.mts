/** Typed source-test inputs for the shared source/published JavaScript fixture. */
import type { Context } from '@deepseek-ai/cordis'
import type { LocalCredentialProvider } from '@deepseek-ai/dsh-credentials-local'
import type { ExecutionHost, readOrganizationExecution } from '../../desktop/src/organization-execution.ts'
import type { kit } from './organization-execution-source-kit.ts'

/** Explicit live route replaces the scripted adapter only in the opt-in provider lane. */
export type ExecutionKit = typeof kit & {
  Credentials?: typeof LocalCredentialProvider
  liveRoute?: { model: string; endpoint: string; credential: string; maxTokens: number; contextWindow: number; idleTimeoutMs: number }
}
/** Local fixture and real IPC child implement the same private Host methods. */
export type FixtureHost = ExecutionHost & Parameters<typeof readOrganizationExecution>[1] & { close(): Promise<void> }
/** Wait for a native projection without replaying a command. */
export function until(predicate: () => boolean | Promise<boolean>): Promise<void>
/** Boot the isolated Loader composition with real tools and stores. */
export function localExecution(kit: ExecutionKit, root: string): Promise<FixtureHost & { ctx: Context }>
/** Exercise complete delivery or one failure at the native/tool dispatch point. */
export function executionScenario(kit: ExecutionKit, createHost?: (root: string) => Promise<FixtureHost>, fault?: string): Promise<void>
