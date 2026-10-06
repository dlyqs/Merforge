/** Complete-tree progress distinguishes issuer acceptance from dispatch and prerequisites. */
import { expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { workgraphDefinitionSchema } from '../src/workgraph-schema.ts'
import { taskStatuses } from '../src/workgraph-status.ts'

function tree() {
  const [root, group, first, second, consumer] = Array.from({ length: 5 }, () => randomUUID()) as [string, string, string, string, string]
  const phaseId = randomUUID()
  const node = (id: string, parentTaskId: string | null, dependsOn: string[] = [], required = true) => ({
    id, parentTaskId, phaseId, dependsOn, required, goal: 'Task', scope: 'Scope', acceptance: ['Reviewed'], artifacts: [], suggestedMembershipId: null,
  })
  const definition = workgraphDefinitionSchema.parse({ taskId: root, phases: [{ id: phaseId, title: 'Phase' }], tasks: [
    node(consumer, root, [group]), node(second, group, [], false), node(root, null), node(first, group), node(group, root),
  ] })
  return { definition, root: definition.taskId, group: definition.tasks[4]!.id, first: definition.tasks[3]!.id,
    second: definition.tasks[1]!.id, consumer: definition.tasks[0]!.id }
}

it('blocks only explicit prerequisites and keeps unordered siblings pending', () => {
  const h = tree(), result = taskStatuses(h.definition, new Set(), new Set())
  expect(result.get(h.first)).toBe('pending')
  expect(result.get(h.second)).toBe('pending')
  expect(result.get(h.group)).toBe('pending')
  expect(result.get(h.consumer)).toBe('blocked')
  expect(result.get(h.root)).toBe('blocked')
})
it('requires acceptance for every child including optional children, then releases consumers', () => {
  const h = tree()
  let result = taskStatuses(h.definition, new Set([h.first]), new Set())
  expect(result.get(h.first)).toBe('running')
  expect(result.get(h.group)).toBe('running')
  expect(result.get(h.consumer)).toBe('blocked')
  result = taskStatuses(h.definition, new Set(), new Set([h.first]))
  expect(result.get(h.group)).toBe('running')
  result = taskStatuses(h.definition, new Set(), new Set([h.first, h.second]))
  expect(result.get(h.group)).toBe('completed')
  expect(result.get(h.consumer)).toBe('pending')
  expect(result.get(h.root)).toBe('running')
  result = taskStatuses(h.definition, new Set(), new Set([h.first, h.second, h.consumer]))
  expect(result.get(h.root)).toBe('completed')
})
it('does not count a parent acceptance as completion of unaccepted descendants', () => {
  const h = tree(), result = taskStatuses(h.definition, new Set(), new Set([h.root, h.group]))
  expect(result.get(h.group)).toBe('pending')
  expect(result.get(h.consumer)).toBe('blocked')
})
it('retains blocking on dispatched tasks until the prerequisite is accepted', () => {
  const h = tree(), result = taskStatuses(h.definition, new Set([h.consumer]), new Set([h.first]))
  expect(result.get(h.consumer)).toBe('blocked')
})
