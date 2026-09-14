import { z } from 'zod';

export const CONTRACT_VERSION = '0.1' as const;
export const createGoalSchema = z
  .object({ objective: z.string().trim().min(1).max(2000) })
  .strict();
export const taskStatusSchema = z.enum(['ready', 'completed']);
export const goalSchema = z.object({
  id: z.string().uuid(),
  objective: z.string(),
  createdAt: z.string().datetime(),
});
export const taskSchema = z.object({
  id: z.string().uuid(),
  goalId: z.string().uuid(),
  title: z.string(),
  status: taskStatusSchema,
  createdAt: z.string().datetime(),
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
  id: z.number().int(),
  goalId: z.string().uuid(),
  taskId: z.string().uuid(),
  type: z.enum(['goal_created', 'mock_completed']),
  createdAt: z.string().datetime(),
});
export const goalDetailSchema = goalSchema.extend({
  tasks: z.array(taskSchema),
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
