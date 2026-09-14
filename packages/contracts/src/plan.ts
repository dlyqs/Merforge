import { z } from 'zod';

export const planDefinitionSchema = z
  .object({
    schemaVersion: z.literal('plan.v1'),
    phases: z
      .array(
        z
          .object({
            title: z.string().trim().min(1).max(500),
            requiresApproval: z.boolean(),
            tasks: z
              .array(
                z
                  .object({
                    title: z.string().trim().min(1).max(2000),
                    executorId: z.enum(['mock', 'human']),
                    acceptanceVersion: z.literal('summary.v1'),
                  })
                  .strict(),
              )
              .min(1)
              .max(100),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict();
export const createPlanSchema = z
  .object({
    objective: z.string().trim().min(1).max(2000),
    revision: z.literal(1),
    definition: planDefinitionSchema,
  })
  .strict();
export const revisionCommandSchema = z
  .object({ revision: z.number().int().positive() })
  .strict();
export const revisePlanSchema = revisionCommandSchema.extend({
  definition: planDefinitionSchema,
});
export const decisionSchema = revisionCommandSchema.extend({
  decision: z.enum(['approved', 'rejected']),
  actor: z.string().trim().min(1).max(100),
});
export const continuePlanSchema = revisionCommandSchema.extend({
  phaseId: z.string().uuid().optional(),
});
export const modeCommandSchema = revisionCommandSchema
  .extend({
    controlVersion: z.number().int().nonnegative(),
    mode: z.enum(['manual', 'auto', 'auto_until']),
    startPhaseId: z.string().uuid().optional(),
    stopPhaseId: z.string().uuid().optional(),
  })
  .superRefine((v, ctx) => {
    if (
      v.mode === 'auto_until' ? !v.stopPhaseId : v.startPhaseId || v.stopPhaseId
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Invalid mode boundaries',
      });
  });
export const phaseStatusSchema = z.enum([
  'pending',
  'in_progress',
  'completed',
  'blocked',
]);
export const planStatusSchema = z.enum([
  'idle',
  'running',
  'waiting',
  'blocked',
  'completed',
]);
export const approvalSchema = z.object({
  id: z.string().uuid(),
  planId: z.string().uuid(),
  revision: z.number().int().positive(),
  phaseId: z.string().uuid().nullable(),
  kind: z.enum(['review', 'phase_entry']),
  decision: z.enum(['pending', 'approved', 'rejected']),
  actor: z.string().nullable(),
  createdAt: z.string().datetime(),
  decidedAt: z.string().datetime().nullable(),
});
export const phaseSchema = z.object({
  id: z.string().uuid(),
  planId: z.string().uuid(),
  revision: z.number().int().positive(),
  position: z.number().int().positive(),
  title: z.string(),
  requiresApproval: z.boolean(),
  status: phaseStatusSchema,
});
export const planDetailSchema = z.object({
  id: z.string().uuid(),
  goalId: z.string().uuid(),
  revision: z.number().int().positive(),
  review: z.enum(['pending', 'approved', 'rejected']),
  status: planStatusSchema,
  stopReason: z.string().nullable(),
  mode: z.enum(['manual', 'auto', 'auto_until']),
  controlVersion: z.number().int().nonnegative(),
  authorized: z.boolean(),
  startPhaseId: z.string().uuid().nullable(),
  stopPhaseId: z.string().uuid().nullable(),
  activePhaseId: z.string().uuid().nullable(),
  limitPhaseId: z.string().uuid().nullable(),
  revisions: z.array(
    z.object({
      revision: z.number().int().positive(),
      definition: planDefinitionSchema,
      createdAt: z.string().datetime(),
    }),
  ),
  phases: z.array(phaseSchema),
  approvals: z.array(approvalSchema),
});
export const apiErrorSchema = z.object({
  error: z.string(),
  code: z.enum(['NOT_FOUND', 'CONFLICT', 'INVALID_INPUT']).optional(),
});
export type PlanDefinition = z.infer<typeof planDefinitionSchema>;
export type PlanDetail = z.infer<typeof planDetailSchema>;
export type CreatePlan = z.infer<typeof createPlanSchema>;
export type RevisePlan = z.infer<typeof revisePlanSchema>;
export type Decision = z.infer<typeof decisionSchema>;
export type ContinuePlan = z.infer<typeof continuePlanSchema>;
export type ModeCommand = z.infer<typeof modeCommandSchema>;
