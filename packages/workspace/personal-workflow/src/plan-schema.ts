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
  planningMode: z.enum(['hierarchical', 'phases']).optional(),
  taskId, projectId: z.uuid().transform(value => value as ProjectId).nullable(),
  botId: z.uuid().transform(value => value as BotId).nullable(),
  phases: z.array(z.object({ id: phaseId, title: text }).strict()).min(1),
  tasks: z.array(task).min(1),
}).strict().superRefine((plan, ctx) => {
  for (const message of taskGraphErrors(plan)) ctx.addIssue({ code: 'custom', message })
  if (plan.planningMode !== 'phases') return
  const leaves = plan.tasks.filter(task => task.id !== plan.taskId)
  if (leaves.length !== plan.phases.length || leaves.some(task => task.parentTaskId !== plan.taskId || !task.required)) {
    ctx.addIssue({ code: 'custom', message: 'phase plans require one required direct task per phase' })
  }
  for (const [index, phase] of plan.phases.entries()) {
    const tasks = leaves.filter(task => task.phaseId === phase.id)
    const previous = leaves.find(task => task.phaseId === plan.phases[index - 1]?.id)
    if (tasks.length !== 1 || (previous !== undefined && !tasks[0]?.dependsOn.includes(previous.id))) {
      ctx.addIssue({ code: 'custom', message: 'phase tasks must declare consecutive execution dependencies' })
    }
  }
  if (plan.tasks.find(task => task.id === plan.taskId)?.phaseId !== plan.phases.at(-1)?.id) {
    ctx.addIssue({ code: 'custom', message: 'phase plan root verification belongs to the final phase' })
  }
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
  goalId: z.uuid().transform(value => value as import('./types.ts').GoalId).optional(),
  approval: z.object({ operationId: operationIdSchema, time: z.number().int().nonnegative() }).strict().nullable(),
}).strict()
