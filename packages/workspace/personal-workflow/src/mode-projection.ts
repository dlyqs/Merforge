/** Log-derived mode for synchronous tool visibility and Client projection. */
import { z } from 'zod'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { WorkflowMode } from './types.ts'

/** Validation for durable mode data and projection snapshots. */
export const workflowModeSchema = z.object({ enabled: z.boolean(), revision: z.number().int().nonnegative() }).strict()
/** Tool visibility uses the log selection; operations additionally require its durable commit. */
export const workflowModeProjection = {
  key: 'personalWorkflowMode', stateVersion: 1, stateSchema: workflowModeSchema,
  init: () => ({ enabled: false, revision: 0 }),
  apply: (state, event) => event.type === 'personal-workflow/mode'
    ? workflowModeSchema.parse({ enabled: event.data.enabled, revision: event.data.revision }) : state,
  wire: { viewSchema: workflowModeSchema, view: state => state },
} satisfies ProjectionDefinition<'personalWorkflowMode', WorkflowMode>
