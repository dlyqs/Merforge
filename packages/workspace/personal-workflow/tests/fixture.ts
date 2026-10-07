/** Deterministic fork/join plan with independent implementation and data branches. */
import type { OperationId, PhaseId, TaskId, PlanDefinition, SavePlanRequest } from '../src/types.ts'

export const ids = Array.from({ length: 8 }, (_, index) => `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}` as TaskId)
export const phase = '10000000-0000-4000-8000-000000000001' as PhaseId
export const operation = (index: number) => `20000000-0000-4000-8000-${String(index).padStart(12, '0')}` as OperationId
export function definition(): PlanDefinition {
  return {
    taskId: ids[0]!, projectId: null, botId: null, phases: [{ id: phase, title: 'Deliver CSV' }],
    tasks: [
      { id: ids[0]!, parentTaskId: null, dependsOn: [], goal: 'CSV delivery' },
      { id: ids[1]!, parentTaskId: ids[0]!, dependsOn: [], goal: 'API agreement' },
      { id: ids[2]!, parentTaskId: ids[0]!, dependsOn: [ids[1]!], goal: 'Implementation' },
      { id: ids[3]!, parentTaskId: ids[0]!, dependsOn: [ids[1]!], goal: 'Test data' },
      { id: ids[4]!, parentTaskId: ids[0]!, dependsOn: [ids[2]!, ids[3]!], goal: 'Integration' },
    ].map(task => ({ ...task, phaseId: phase, scope: 'CSV export', acceptance: ['Verify actual output'], artifacts: [`out/${task.id}`], cwd: null, required: true })),
  }
}
export function proposal(index = 1, expectedRevision = 0): SavePlanRequest {
  return { operationId: operation(index), expectedRevision, definition: definition() }
}

/** @param count - Number of required ordered phases. @returns Flat phase plan with final root verification. */
export function phaseDefinition(count = 6): PlanDefinition {
  const phases = Array.from({ length: count }, (_, index) => ({ id: `10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}` as PhaseId, title: `Phase ${index + 1}` }))
  const template = definition().tasks[0]!
  return { taskId: ids[0]!, projectId: null, botId: null, planningMode: 'phases', phases,
    tasks: [
      { ...template, phaseId: phases.at(-1)!.id },
      ...phases.map((phase, index) => ({ ...template, id: ids[index + 1]!, parentTaskId: ids[0]!, phaseId: phase.id,
        goal: phase.title, dependsOn: index === 0 ? [] : [ids[index]!], artifacts: [`out/${ids[index + 1]!}`] })),
    ],
  }
}
