/** Personal planning preference and model-input validation. */
import { z } from 'zod'
import type { GoalId, WorkflowPreferences } from './types.ts'

/** Persisted profile preference parser; no legacy plan or testing domain is rewritten. */
export const preferencesSchema = z.object({
  enabled: z.boolean(), granularity: z.enum(['balanced', 'fine']), revision: z.number().int().nonnegative(),
}).strict() satisfies z.ZodType<WorkflowPreferences>
/** Validate the user-only compare-and-set input. */
export const setPreferencesSchema = preferencesSchema.omit({ revision: true }).extend({ expectedRevision: z.number().int().nonnegative() })
/** Validate model routing at its JSON entry; identity is resolved by the writer. */
export const assessmentSchema = z.object({
  modeRevision: z.number().int().nonnegative(), decision: z.enum(['simple', 'clarify', 'infeasible', 'complex']),
  explanation: z.string().trim().min(1), route: z.enum(['new_goal', 'clarification', 'modify', 'query']).optional(),
  goalId: z.uuid().transform(value => value as GoalId).nullable().optional(),
}).strict()
