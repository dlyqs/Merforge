/** JSON and durable-record validation for personal task plans. */
import { z } from 'zod'
import { taskGraphErrors } from '@deepseek-ai/dsh-task-graph'
import type { TaskId, PhaseId, OperationId } from './types.ts'
import type { ProjectId, BotId } from '@deepseek-ai/dsh-personal-project/types'
import { SessionId } from '@deepseek-ai/dsh-session'

const taskId = z.uuid().transform(value => value as TaskId)
const phaseId = z.uuid().transform(value => value as PhaseId)
/** Valid retry identity at Remote and model JSON entry points. */
export const operationIdSchema = z.uuid().transform(value => value as OperationId)
const text = z.string().trim().min(1)
const task = z.object({
  id: taskId, parentTaskId: taskId.nullable(), phaseId,
  goal: text, scope: text, acceptance: z.array(text).min(1), artifacts: z.array(text),
  cwd: text.nullable(), dependsOn: z.array(taskId), required: z.boolean(),
}).strict()

/** Complete plan parser, including effective completion edges. */
export const definitionSchema = z.object({
  taskId, projectId: z.uuid().transform(value => value as ProjectId).nullable(),
  botId: z.uuid().transform(value => value as BotId).nullable(),
  phases: z.array(z.object({ id: phaseId, title: text }).strict()).min(1),
  tasks: z.array(task).min(1),
}).strict().superRefine((plan, ctx) => {
  for (const message of taskGraphErrors(plan)) ctx.addIssue({ code: 'custom', message })
})
/** Human or model proposal JSON; review fields are forbidden. */
export const saveSchema = z.object({
  operationId: operationIdSchema, expectedRevision: z.number().int().nonnegative(), definition: definitionSchema,
}).strict()
/** Exact-version human approval JSON. */
export const approveSchema = z.object({
  taskId, operationId: operationIdSchema, expectedRevision: z.number().int().positive(),
}).strict()
/** Version-addressed read JSON. */
export const readSchema = z.object({ taskId, revision: z.number().int().positive().optional() }).strict()
/** Persisted immutable definition plus mutable exact-version approval. */
export const revisionSchema = z.object({
  revision: z.number().int().positive(), definition: definitionSchema,
  source: z.enum(['user', 'model']), sessionId: z.string().min(1).transform(SessionId).nullable(),
  createdAt: z.number().int().nonnegative(),
  approval: z.object({ operationId: operationIdSchema, time: z.number().int().nonnegative() }).strict().nullable(),
}).strict()
