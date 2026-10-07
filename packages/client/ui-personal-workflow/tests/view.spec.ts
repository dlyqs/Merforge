/** Tree and affiliation projections never create execution facts. */
import { expect, it } from 'vitest'
import { completedRunPhases, overlappingArtifacts, phaseProgress, selectPlans } from '../src/client/view.ts'
import { definition, ids, phaseDefinition } from '../../../workspace/personal-workflow/tests/fixture.ts'
import { projectPlan } from '../../../workspace/personal-workflow/src/projection.ts'
import type { ProjectId, BotId } from '@deepseek-ai/dsh-personal-project/types'

it('finds exact shared artifact declarations without claiming resource isolation', () => {
  const tasks = definition().tasks
  expect(overlappingArtifacts(tasks, tasks[0]!)).toEqual([])
  expect(overlappingArtifacts([...tasks, { ...tasks[1]!, artifacts: tasks[0]!.artifacts }], tasks[0]!)).toEqual(tasks[0]!.artifacts)
})
it('shows the same plan under Project and Bot without changing its review state', () => {
  const projectId = 'project' as ProjectId
  const botId = 'bot' as BotId
  const view = projectPlan({ revision: 1, definition: { ...definition(), projectId, botId }, approval: null, source: 'model', sessionId: null, createdAt: 1 })
  expect(selectPlans([view], projectId, null)[0]).toBe(selectPlans([view], null, botId)[0])
  expect(view.tasks.every(task => task.status === 'pending_review')).toBe(true)
  expect(selectPlans([view], null, null)).toEqual([view])
})

it('counts phase completions separately from root verification and reports only a consecutive milestone', () => {
  const plan = phaseDefinition(6)
  expect(phaseProgress(plan, [])).toMatchObject({ done: 0, total: 6, through: undefined })
  expect(phaseProgress(plan, [ids[1]!, ids[3]!])).toMatchObject({ done: 2, through: plan.phases[0] })
  expect(phaseProgress(plan, plan.tasks.map(task => task.id))).toMatchObject({ done: 6, total: 6, through: plan.phases[5] })
})

it('includes admitted predecessor phases and excludes unfinished current work', () => {
  const plan = phaseDefinition(6)
  expect(completedRunPhases(plan, { taskId: ids[3]!, status: 'paused' })).toEqual([ids[1], ids[2]])
  expect(completedRunPhases(plan, { taskId: ids[3]!, status: 'completed' })).toEqual([ids[1], ids[2], ids[3]])
  expect(phaseProgress(plan, completedRunPhases(plan, { taskId: plan.taskId, status: 'running' }))).toMatchObject({ done: 6, total: 6 })
})
