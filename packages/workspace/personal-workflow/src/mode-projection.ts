/** Log-derived mode for synchronous tool visibility and Client projection. */
import { z } from 'zod'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { WorkflowModeSelection } from './types.ts'

/** Validation for durable mode data and projection snapshots. */
export const workflowModeSchema = z.object({ enabled: z.boolean(), revision: z.number().int().nonnegative() }).strict()
/** Tool visibility uses the log selection; operations additionally require its durable commit. */
export const workflowModeProjection = {
  key: 'personalWorkflowMode', stateVersion: 2, stateSchema: workflowModeSchema.extend({ selected: z.boolean() }),
  init: () => ({ enabled: true, revision: 0, selected: false }),
  apply: (state, event) => event.type === 'personal-workflow/mode'
    ? { ...workflowModeSchema.parse({ enabled: event.data.enabled, revision: event.data.revision }), selected: true } : state,
  wire: { viewSchema: workflowModeSchema.extend({ selected: z.boolean() }), view: state => state },
} satisfies ProjectionDefinition<'personalWorkflowMode', WorkflowModeSelection>
