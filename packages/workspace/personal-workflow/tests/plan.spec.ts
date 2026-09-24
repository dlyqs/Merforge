import { describe, expect, it } from 'vitest'
import { definitionSchema } from '../src/schema.ts'
import { projectPlan, exportPlan } from '../src/projection.ts'
import type { PlanRevision, TaskObservation } from '../src/types.ts'
import { definition, ids, operation, phase } from './fixture.ts'

const snapshot = (): PlanRevision => ({ revision: 1, definition: definition(), source: 'user', sessionId: null, createdAt: 1, approval: { operationId: operation(2), time: 2 } })
const done = (indices: number[]): TaskObservation[] => indices.map(index => ({ taskId: ids[index]!, status: 'completed', evidence: ['verified:output'] }))

describe('task definition and readiness', () => {
  it('releases parallel siblings, then the join, and requires parent evidence', () => {
    const plan = snapshot()
    expect(projectPlan(plan).ready).toEqual([ids[1]])
    expect(projectPlan(plan, done([1])).ready).toEqual([ids[2], ids[3]])
    expect(projectPlan(plan, done([1, 2])).ready).toEqual([ids[3]])
    expect(projectPlan(plan, done([1, 2, 3])).ready).toEqual([ids[4]])
    const view = projectPlan(plan, done([1, 2, 3, 4]))
    expect(view.ready).toEqual([ids[0]])
    expect(view.tasks[0]).toMatchObject({ completedChildren: 4, requiredChildren: 4, status: 'ready' })
    expect(projectPlan(plan, done([0, 1, 2, 3, 4])).tasks.every(task => task.status === 'completed')).toBe(true)
  })
  it('excludes review, occupied, paused, cancelled and unverified completion from candidates', () => {
    const plan = snapshot()
    expect(projectPlan({ ...plan, approval: null }).ready).toEqual([])
    for (const status of ['running', 'paused', 'needs_reconciliation', 'cancelled', 'completed'] as const) {
      expect(projectPlan(plan, [{ taskId: ids[1]!, status, evidence: [] }]).ready).toEqual([])
    }
    expect(projectPlan(plan, done([0])).tasks[0]?.status).toBe('needs_reconciliation')
  })
  it.each(['missing', 'self', 'parent', 'cross-branch', 'tree', 'duplicate', 'phase', 'late'])(
    'rejects %s invalid references or completion relationships', (kind) => {
      const plan = definition()
      const tasks = plan.tasks.map(task => ({ ...task, dependsOn: [...task.dependsOn] }))
      if (kind === 'missing') tasks[2]!.dependsOn = [ids[7]!]
      if (kind === 'self') tasks[2]!.dependsOn = [ids[2]!]
      if (kind === 'parent') tasks[2]!.dependsOn = [ids[0]!]
      if (kind === 'cross-branch') tasks[1]!.dependsOn = [ids[4]!]
      if (kind === 'tree') { tasks[1]!.parentTaskId = ids[2]!; tasks[2]!.parentTaskId = ids[1]! }
      if (kind === 'duplicate') tasks.push(tasks[1]!)
      if (kind === 'phase') tasks[1]!.phaseId = '10000000-0000-4000-8000-000000000099' as typeof phase
      const late = '10000000-0000-4000-8000-000000000002' as typeof phase
      if (kind === 'late') tasks[1]!.phaseId = late
      expect(() => definitionSchema.parse({ ...plan, tasks, phases: [...plan.phases, { id: late, title: 'Later' }] })).toThrow()
    },
  )
  it('detects a cycle formed only when necessary child completion is included', () => {
    const plan = definition()
    const tasks = plan.tasks.map(task => ({ ...task, dependsOn: [...task.dependsOn] }))
    tasks[2]!.parentTaskId = ids[1]!
    tasks[2]!.dependsOn = [ids[3]!]
    tasks[3]!.dependsOn = [ids[1]!]
    expect(() => definitionSchema.parse({ ...plan, tasks })).toThrow(/completion cycle/)
  })
  it('does not turn optional children into parent completion prerequisites', () => {
    const plan = snapshot()
    const changed = { ...plan, definition: {
      ...plan.definition, tasks: plan.definition.tasks.map(task => ({ ...task, required: task.id === ids[0] })),
    } }
    expect(projectPlan(changed).ready).toContain(ids[0])
  })
  it('exports the exact structured version and review record including multiline copy', () => {
    const plan = snapshot()
    const changed = { ...plan, definition: { ...plan.definition, tasks: plan.definition.tasks.map(task => ({ ...task, goal: 'Goal\n## text' })) } }
    const markdown = exportPlan(changed)
    expect(JSON.parse(markdown.split('    ').at(-1)!)).toEqual(changed)
    expect(markdown).toContain('Revision: 1')
    expect(markdown.endsWith('\n')).toBe(true)
  })
})
