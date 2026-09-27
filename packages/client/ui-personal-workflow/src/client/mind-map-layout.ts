/** Deterministic task hierarchy geometry; prerequisite edges remain in the task details. */
import type { TaskDefinition, TaskId } from '@deepseek-ai/dsh-personal-workflow/types'

/** Fixed card geometry shared by layout, connectors and the canvas. */
export const mapGeometry = { nodeWidth: 232, nodeHeight: 116, columnGap: 28, rowGap: 76, padding: 48 }

/** One visible task card in unscaled canvas coordinates. */
export interface MapNode {
  task: TaskDefinition
  x: number
  y: number
  depth: number
  branch: number
  children: readonly TaskId[]
}

/** A parent-child connector; it does not express execution order. */
export interface MapEdge {
  parent: TaskId
  child: TaskId
  branch: number
  path: string
}

/** Visible canvas geometry and draft hierarchy diagnostics. */
export interface MapLayout {
  nodes: MapNode[]
  edges: MapEdge[]
  width: number
  height: number
  invalidHierarchy: boolean
}

interface Branch {
  task: TaskDefinition
  children: Branch[]
}

/** Find ancestors without looping when an unsaved parent edit introduces a cycle.
 * @param tasks - Current revision or unsaved editor draft.
 * @param selected - Task to reveal.
 * @returns Ancestor ids, excluding the selected task.
 */
export function taskAncestors(tasks: readonly TaskDefinition[], selected: TaskId | null): Set<TaskId> {
  const byId = new Map(tasks.map(task => [task.id, task]))
  const ancestors = new Set<TaskId>()
  let parent = selected === null ? null : byId.get(selected)?.parentTaskId
  while (parent != null && parent !== selected && !ancestors.has(parent)) {
    ancestors.add(parent)
    parent = byId.get(parent)?.parentTaskId
  }
  return ancestors
}

/** Lay out siblings in separate horizontal bands and center parents over their descendants.
 * @param tasks - Revision tasks or an editable draft; order is presentation only.
 * @param collapsed - Tasks whose descendants are hidden.
 * @returns Visible geometry and a warning for disconnected or cyclic draft relationships.
 */
export function layoutMindMap(tasks: readonly TaskDefinition[], collapsed: ReadonlySet<TaskId>): MapLayout {
  const { nodeWidth, nodeHeight, columnGap, rowGap, padding } = mapGeometry
  const children = new Map<TaskId | null, TaskDefinition[]>()
  for (const task of tasks) {
    const siblings = children.get(task.parentTaskId) ?? []
    siblings.push(task)
    children.set(task.parentTaskId, siblings)
  }
  const visited = new Set<TaskId>()
  let invalidHierarchy = false
  const build = (task: TaskDefinition): Branch => {
    visited.add(task.id)
    const descendants: Branch[] = []
    for (const child of children.get(task.id) ?? []) {
      if (visited.has(child.id)) { invalidHierarchy = true; continue }
      descendants.push(build(child))
    }
    return { task, children: descendants }
  }
  const roots = (children.get(null) ?? []).map(build)
  for (const task of tasks) {
    if (visited.has(task.id)) continue
    invalidHierarchy = true
    roots.push(build(task))
  }
  const widths = new Map<TaskId, number>()
  const measure = (branch: Branch): number => {
    const visible = collapsed.has(branch.task.id) ? [] : branch.children
    const width = Math.max(nodeWidth, visible.reduce((sum, child) => sum + measure(child), 0) + Math.max(0, visible.length - 1) * columnGap)
    widths.set(branch.task.id, width)
    return width
  }
  roots.forEach(measure)
  const nodes: MapNode[] = []
  const edges: MapEdge[] = []
  let height = padding * 2
  const place = (branch: Branch, left: number, depth: number, color: number): MapNode => {
    const width = widths.get(branch.task.id) ?? nodeWidth
    const node: MapNode = { task: branch.task, x: left + (width - nodeWidth) / 2, y: padding + depth * (nodeHeight + rowGap),
      depth, branch: color, children: branch.children.map(child => child.task.id) }
    nodes.push(node)
    height = Math.max(height, node.y + nodeHeight + padding)
    if (!collapsed.has(branch.task.id)) {
      let childLeft = left
      branch.children.forEach((child, index) => {
        const next = place(child, childLeft, depth + 1, depth === 0 ? index % 4 : color)
        const x = node.x + nodeWidth / 2; const y = node.y + nodeHeight
        const endX = next.x + nodeWidth / 2; const bend = y + rowGap / 2
        edges.push({ parent: node.task.id, child: child.task.id, branch: next.branch,
          path: `M ${x} ${y} C ${x} ${bend}, ${endX} ${bend}, ${endX} ${next.y}` })
        childLeft += (widths.get(child.task.id) ?? nodeWidth) + columnGap
      })
    }
    return node
  }
  let left = padding
  roots.forEach((root) => {
    place(root, left, 0, 0)
    left += (widths.get(root.task.id) ?? nodeWidth) + columnGap
  })
  return { nodes, edges, width: left + padding - (roots.length > 0 ? columnGap : 0), height, invalidHierarchy }
}
