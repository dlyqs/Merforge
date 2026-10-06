/** Typed consumer of the live two-identity Desktop fixture. */
import type { PlanningKit } from './conversation-planning-fixture.mjs'
import type { ExecutionKit } from './organization-execution-fixture.mjs'

/** Both model routes must be explicit; no scripted provider fallback is available. */
export type LiveDeliveryKit = PlanningKit & ExecutionKit & {
  planningRoute: NonNullable<PlanningKit['planningRoute']>
  liveRoute: NonNullable<ExecutionKit['liveRoute']>
}
/** Verify live planning, human waiting, rework and approval completion without windows.
 * @param kit Source composition with explicit real provider routes.
 * @returns Completion after isolated resources have been closed.
 */
export function liveDeliveryScenario(kit: LiveDeliveryKit): Promise<void>
