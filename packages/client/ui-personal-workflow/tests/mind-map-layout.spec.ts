/** Geometry regressions for hierarchy exploration and temporarily invalid parent edits. */
import { expect, it } from 'vitest'
import type { TaskId } from '@deepseek-ai/dsh-personal-workflow/types'
import { definition } from '../../../workspace/personal-workflow/tests/fixture.ts'
import { layoutMindMap, mapGeometry, taskAncestors } from '../src/client/mind-map-layout.ts'

it('places children below parents and siblings side by side without implying execution dependencies', () => {
  const plan = definition()
  const map = layoutMindMap(plan.tasks, new Set())
  expect(map.invalidHierarchy).toBe(false)
  expect(map.nodes).toHaveLength(plan.tasks.length)
  expect(map.edges).toHaveLength(plan.tasks.length - 1)
  expect(map.edges.every(edge => edge.parent === plan.taskId)).toBe(true)
  const siblings = map.nodes.filter(node => node.depth === 1)
  for (let index = 1; index < siblings.length; index++) {
    const previous = siblings[index - 1]
    const current = siblings[index]
    if (!previous || !current) throw new Error('missing sibling')
    expect(current.x).toBeGreaterThanOrEqual(previous.x + mapGeometry.nodeWidth + mapGeometry.columnGap)
  }
  const root = map.nodes.find(node => node.task.id === plan.taskId)
  expect(root?.x).toBe((map.width - mapGeometry.nodeWidth) / 2)
  expect(root?.y).toBe(mapGeometry.padding)
  for (const child of siblings) {
    expect(child.y).toBe(mapGeometry.padding + mapGeometry.nodeHeight + mapGeometry.rowGap)
  }
  expect(new Set(siblings.map(node => node.branch)).size).toBe(siblings.length)
})

it('collapses descendants without treating hidden tasks as disconnected roots', () => {
  const plan = definition()
  const map = layoutMindMap(plan.tasks, new Set([plan.taskId]))
  expect(map.nodes.map(node => node.task.id)).toEqual([plan.taskId])
  expect(map.nodes[0]?.children).toHaveLength(4)
  expect(map.edges).toEqual([])
  expect(map.invalidHierarchy).toBe(false)
  expect(map.width).toBe(mapGeometry.padding * 2 + mapGeometry.nodeWidth)
  expect(map.height).toBe(mapGeometry.padding * 2 + mapGeometry.nodeHeight)
  expect(layoutMindMap(plan.tasks, new Set()).nodes).toHaveLength(5)
})

it('allocates separate subtree bands for uneven branches and exposes selected ancestors', () => {
  const plan = definition()
  const first = plan.tasks[1]
  const second = plan.tasks[2]
  if (!first || !second) throw new Error('missing fixture tasks')
  const leaf = { ...first, id: 'nested-leaf' as TaskId, parentTaskId: first.id }
  const sibling = { ...leaf, id: 'nested-sibling' as TaskId }
  const tasks = [...plan.tasks, leaf, sibling]
  const map = layoutMindMap(tasks, new Set())
  for (const node of map.nodes) {
    expect(node.x).toBeGreaterThanOrEqual(mapGeometry.padding)
    expect(node.y).toBeGreaterThanOrEqual(mapGeometry.padding)
    expect(node.x + mapGeometry.nodeWidth).toBeLessThanOrEqual(map.width - mapGeometry.padding)
    expect(node.y + mapGeometry.nodeHeight).toBeLessThanOrEqual(map.height - mapGeometry.padding)
    for (const other of map.nodes.filter(item => item.depth === node.depth && item.x > node.x)) {
      expect(other.x).toBeGreaterThanOrEqual(node.x + mapGeometry.nodeWidth + mapGeometry.columnGap)
    }
  }
  expect(taskAncestors(tasks, leaf.id)).toEqual(new Set([first.id, plan.taskId]))
  const folded = layoutMindMap(tasks, new Set([first.id]))
  expect(folded.nodes.some(node => node.task.id === leaf.id)).toBe(false)
  expect(folded.nodes.some(node => node.task.id === second.id)).toBe(true)
  expect(folded.invalidHierarchy).toBe(false)
})

it('retains cyclic draft nodes for editing without following their parent links forever', () => {
  const plan = definition()
  const first = plan.tasks[1]
  const second = plan.tasks[2]
  if (!first || !second) throw new Error('missing fixture tasks')
  const tasks = plan.tasks.map(task => task.id === first.id ? { ...task, parentTaskId: second.id }
    : task.id === second.id ? { ...task, parentTaskId: first.id } : task)
  const map = layoutMindMap(tasks, new Set())
  expect(map.invalidHierarchy).toBe(true)
  expect(new Set(map.nodes.map(node => node.task.id))).toEqual(new Set(tasks.map(task => task.id)))
  expect(map.edges.length).toBeLessThan(tasks.length)
  expect(taskAncestors(tasks, first.id)).toEqual(new Set([second.id]))
})

it('keeps orphaned draft nodes visible and handles an empty plan', () => {
  const plan = definition()
  const tasks = plan.tasks.map(task => task.parentTaskId === null ? task : { ...task, parentTaskId: 'missing-parent' as TaskId })
  expect(layoutMindMap(tasks, new Set()).invalidHierarchy).toBe(true)
  expect(layoutMindMap(tasks, new Set()).nodes).toHaveLength(tasks.length)
  expect(layoutMindMap([], new Set()).nodes).toEqual([])
  expect(taskAncestors([], null)).toEqual(new Set())
})
