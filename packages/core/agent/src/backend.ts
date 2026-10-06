/** External conversation drivers share the factory's Session and lifecycle ownership. */
import { z } from 'zod'
import type { Context } from '@deepseek-ai/cordis'
import type { Scope } from '@deepseek-ai/dsh-scope'
import type { Session, SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import type { Agent, AgentBackendSelection } from './types.ts'
import type { AgentOptions } from './runtime-types.ts'

/** Driver resources that the single factory unwinds after activity drains. */
export interface ScopedAgentDriver extends Agent {
  readonly scope: Scope
}

/** Safe external model choices, independent of API adapter routes. */
export interface AgentDriverCatalog {
  /** Version observed from the native executor, absent for providers without version discovery. */
  readonly runtimeVersion?: string

  readonly models: readonly {
    readonly id: string
    readonly name: string
    readonly efforts: readonly string[]
    readonly defaultEffort: string
  }[]
}

/** External provider owns its native resources; the factory owns Session publication. */
export interface AgentDriverProvider {
  readonly kind: 'codex'
  /**
   * Construct an unpublished driver without launching native work.
   * @param ctx - factory context.
   * @param id - Session identity.
   * @param options - validated durable backend selection.
   * @param session - factory-owned Session.
   * @returns the driver and its scoped registrations.
   */
  create(ctx: Context, id: SessionId, options: AgentOptions, session: Session): ScopedAgentDriver
  /** @returns safe model discovery, or an actionable availability error. */
  catalog(): Promise<AgentDriverCatalog>
  /**
   * Validate an explicit model and effort against native discovery.
   * @param model - native model id.
   * @param effort - requested effort, or native model default.
   * @returns complete persistent selection.
   */
  resolve(model: string, effort?: string): Promise<AgentBackendSelection>
}

/**
 * Read the immutable backend selection, refusing conflicting or inherited associations.
 * @param events - complete Session prefix.
 * @returns external selection, or undefined for the API driver.
 */
export function readAgentBackend(events: readonly SessionEvent[]): AgentBackendSelection | undefined {
  let selected: AgentBackendSelection | undefined
  for (const event of events) {
    if (event.type !== 'agent/backend') continue
    if (selected !== undefined) throw new Error('Session has multiple backend selections')
    selected = z.object({ kind: z.literal('codex'), model: z.string().min(1),
      effort: z.enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']),
      runtimeVersion: z.string().max(100).regex(/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/u) }).parse(event.data)
  }
  return selected
}
