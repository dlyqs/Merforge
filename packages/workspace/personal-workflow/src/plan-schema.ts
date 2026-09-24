/** JSON and durable-record validation for personal task plans. */
import { z } from 'zod'
import type { TaskId, PhaseId, OperationId, PlanDefinition } from './types.ts'
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

function graphErrors(plan: PlanDefinition): string[] {
  const errors: string[] = []
  const tasks = new Map(plan.tasks.map(task => [task.id, task]))
  const phases = new Map(plan.phases.map((phase, index) => [phase.id, index]))
  if (tasks.size !== plan.tasks.length) errors.push('duplicate task identity')
  if (phases.size !== plan.phases.length) errors.push('duplicate phase identity')
  const roots = plan.tasks.filter(task => task.parentTaskId === null)
  if (roots.length !== 1 || roots[0]?.id !== plan.taskId || !roots[0].required) errors.push('plan requires exactly one required root matching taskId')
  const parents = new Map<TaskId, readonly TaskId[]>()
  const waits = new Map<TaskId, TaskId[]>()
  for (const task of plan.tasks) {
    parents.set(task.id, task.parentTaskId === null ? [] : [task.parentTaskId])
    waits.set(task.id, [...task.dependsOn])
    if (!phases.has(task.phaseId)) errors.push('unknown phase')
    if (new Set(task.dependsOn).size !== task.dependsOn.length) errors.push('duplicate dependency')
    if (task.parentTaskId !== null && !tasks.has(task.parentTaskId)) errors.push('unknown parent')
    for (const dependency of task.dependsOn) {
      const prerequisite = tasks.get(dependency)
      if (!prerequisite) errors.push('unknown or cross-plan dependency')
      else if (plan.phases.findIndex(phase => phase.id === prerequisite.phaseId)
        > plan.phases.findIndex(phase => phase.id === task.phaseId)) errors.push('dependency in a later phase')
    }
  }
  for (const task of plan.tasks) {
    if (task.parentTaskId === null || !task.required) continue
    waits.get(task.parentTaskId)?.push(task.id)
    const parent = tasks.get(task.parentTaskId)
    if (parent && plan.phases.findIndex(phase => phase.id === task.phaseId)
      > plan.phases.findIndex(phase => phase.id === parent.phaseId)) errors.push('required child in a later phase than its parent')
  }
  if (cyclic(parents)) errors.push('task hierarchy cycle')
  if (cyclic(waits)) errors.push('unsatisfiable dependency or parent completion cycle')
  return errors
}

function cyclic(edges: ReadonlyMap<TaskId, readonly TaskId[]>): boolean {
  const pending = new Map([...edges].map(([id, dependencies]) => [id, new Set(dependencies).size]))
  const consumers = new Map<TaskId, TaskId[]>()
  for (const [id, dependencies] of edges) for (const dependency of new Set(dependencies)) {
    const list = consumers.get(dependency) ?? []
    list.push(id)
    consumers.set(dependency, list)
  }
  const ready = [...pending].filter(([, size]) => size === 0).map(([id]) => id)
  let visited = 0
  for (let index = 0; index < ready.length; index++) {
    const id = ready[index]
    if (id === undefined) break
    visited++
    for (const consumer of consumers.get(id) ?? []) {
      const previous = pending.get(consumer)
      if (previous === undefined) continue
      const count = previous - 1
      pending.set(consumer, count)
      if (count === 0) ready.push(consumer)
    }
  }
  return visited !== edges.size
}

/** Complete plan parser, including effective completion edges. */
export const definitionSchema = z.object({
  taskId, projectId: z.uuid().transform(value => value as ProjectId).nullable(),
  botId: z.uuid().transform(value => value as BotId).nullable(),
  phases: z.array(z.object({ id: phaseId, title: text }).strict()).min(1),
  tasks: z.array(task).min(1),
}).strict().superRefine((plan, ctx) => {
  for (const message of graphErrors(plan)) ctx.addIssue({ code: 'custom', message })
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
