import { planDetailSchema } from './plan.js';
export * from './plan.js';
export * from './task-package.js';
import { z } from 'zod';

export const CONTRACT_VERSION = '0.4' as const;
export const createGoalSchema = z
  .object({
    objective: z.string().trim().min(1).max(2000),
    executorId: z.enum(['mock', 'human']).optional(),
  })
  .strict();
export const taskStatusSchema = z.enum([
  'ready',
  'running',
  'waiting_human',
  'verifying',
  'completed',
  'failed',
  'interrupted',
]);
export const executorIdSchema = z.enum(['mock', 'human', 'codex']);
export const attemptStatusSchema = taskStatusSchema.exclude(['ready']);
export const goalSchema = z.object({
  id: z.string().uuid(),
  objective: z.string(),
  createdAt: z.string().datetime(),
});
export const taskSchema = z.object({
  id: z.string().uuid(),
  goalId: z.string().uuid(),
  phaseId: z.string().uuid().nullable().optional(),
  position: z.number().int().positive().nullable().optional(),
  title: z.string(),
  status: taskStatusSchema,
  executorId: executorIdSchema,
  acceptanceVersion: z.string(),
  createdAt: z.string().datetime(),
});
export const attemptSchema = z.object({
  id: z.string().uuid(),
  taskId: z.string().uuid(),
  sequence: z.number().int().positive(),
  executorId: executorIdSchema,
  status: attemptStatusSchema,
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime().nullable(),
  error: z.string().nullable(),
});
export const runSchema = z.object({
  id: z.string().uuid(),
  taskId: z.string().uuid(),
  executorId: z.literal('mock'),
  status: z.literal('completed'),
  createdAt: z.string().datetime(),
});
export const evidenceSchema = z.object({
  id: z.string().uuid(),
  runId: z.string().uuid(),
  kind: z.literal('mock'),
  summary: z.string(),
  createdAt: z.string().datetime(),
});
export const eventSchema = z.object({
  planId: z.string().uuid().nullable(),
  revision: z.number().int().positive().nullable(),
  phaseId: z.string().uuid().nullable(),
  approvalId: z.string().uuid().nullable(),
  controlVersion: z.number().int().nonnegative().nullable(),
  id: z.number().int(),
  goalId: z.string().uuid(),
  taskId: z.string().uuid().nullable(),
  attemptId: z.string().uuid().nullable(),
  fromStatus: taskStatusSchema.nullable(),
  toStatus: taskStatusSchema.nullable(),
  errorCode: z.string().nullable(),
  type: z.string(),
  createdAt: z.string().datetime(),
});
export const mockOptionsSchema = z
  .object({
    delayMs: z.number().int().min(0).max(60000).optional(),
    outcome: z.enum(['success', 'failure']).optional(),
  })
  .strict();
export const acceptedSchema = z.object({
  goalId: z.string().uuid(),
  taskId: z.string().uuid(),
  attemptId: z.string().uuid(),
});
export const artifactSchema = z.object({
  id: z.string().uuid(),
  attemptId: z.string().uuid(),
  kind: executorIdSchema,
  payload: z.unknown(),
  createdAt: z.string().datetime(),
});
export type MockOptions = z.infer<typeof mockOptionsSchema>;
export type Accepted = z.infer<typeof acceptedSchema>;
export const ACCEPTANCE_VERSION = 'summary.v1' as const;
export const submissionSchema = z.object({ summary: z.string().trim().min(1) });
export const humanSubmissionSchema = z
  .object({
    artifact: z
      .unknown()
      .refine((value) => value !== undefined, 'Artifact is required'),
  })
  .strict();
export const verificationResultSchema = z.object({
  acceptanceVersion: z.string(),
  verdict: z.enum(['PASS', 'FAIL']),
  reasons: z.array(z.string()).min(1),
});
export const verificationSchema = verificationResultSchema.extend({
  id: z.string().uuid(),
  attemptId: z.string().uuid(),
  artifactId: z.string().uuid(),
  createdAt: z.string().datetime(),
});
export type VerificationResult = z.infer<typeof verificationResultSchema>;
export const goalDetailSchema = goalSchema.extend({
  plan: planDetailSchema.nullable().optional(),
  tasks: z.array(taskSchema),
  attempts: z.array(attemptSchema),
  artifacts: z.array(artifactSchema),
  verifications: z.array(verificationSchema),
  runs: z.array(runSchema),
  evidence: z.array(evidenceSchema),
  events: z.array(eventSchema),
});
export const goalListSchema = z.array(goalSchema);
export type Goal = z.infer<typeof goalSchema>;
export type Task = z.infer<typeof taskSchema>;
export type Run = z.infer<typeof runSchema>;
export type Evidence = z.infer<typeof evidenceSchema>;
export type GoalDetail = z.infer<typeof goalDetailSchema>;
export type CreateGoal = z.infer<typeof createGoalSchema>;

export type Attempt = z.infer<typeof attemptSchema>;
export type TaskStatus = z.infer<typeof taskStatusSchema>;
export * from './interaction.js';
