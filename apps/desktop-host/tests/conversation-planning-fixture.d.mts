/** Typed source consumers of the shared source/published composition fixture. */
import type { Context } from '@deepseek-ai/cordis'
import type { ConversationHost } from '../../desktop/src/organization-conversation.ts'
import type { FixtureHost } from './organization-execution-fixture.mjs'
import type { kit } from './conversation-planning-source-kit.ts'
export type PlanningKit = typeof kit & { planningRoute?: { model: string; endpoint: string; credential: string; maxTokens: number; contextWindow: number; idleTimeoutMs: number } }
export type PlanningHost = ConversationHost & { close(): Promise<void> }
export const selection: { model: string; endpoint: string }
export function planningReply(entry: string | { name: string; args: object }): Response
export function localPlanning(kit: PlanningKit, root: string): Promise<PlanningHost & { ctx: Context }>
export function planningScenario(kit: PlanningKit, createExecutionHost?: (root: string) => Promise<FixtureHost>, createPlanningHost?: (root: string) => Promise<PlanningHost>): Promise<void>
