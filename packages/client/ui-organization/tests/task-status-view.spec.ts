/** Pure phase progress and expandable shared-context presentation. */
import { expect, it } from 'vitest'
import { taskStageView } from '../src/client/task-status-view.ts'
import { sharedContextView } from '../src/client/shared-context-view.ts'
import { zh, type OrganizationKey } from '../src/client/locales.ts'
const t = (key: OrganizationKey) => zh[key]
it('uses task acceptance to complete a phase and shows partial progress and blocking', () => {
  const phases = [{ id: 'phase', title: 'Prepare' }]
  const task = { id: 'one', phaseId: 'phase', goal: 'First', dependsOn: [] }
  expect(taskStageView(phases, [{ ...task, status: 'pending' }], t).phases[0]?.status).toBe('pending')
  expect(taskStageView(phases, [{ ...task, status: 'blocked' }], t).phases[0]?.status).toBe('blocked')
  expect(taskStageView(phases, [{ ...task, status: 'completed' }, { ...task, id: 'two', status: 'pending' }], t).phases[0]?.status).toBe('running')
  const complete = taskStageView(phases, [{ ...task, status: 'completed' }], t)
  expect(complete.phases[0]?.status).toBe('completed')
  expect(complete.tasks[0]?.statusLabel).toBe(zh['task-status-completed'])
})
it('keeps background and goal visible and moves later Markdown sections into expandable content', () => {
  const text = '## 背景\n产品需要发布。\n\n## 总体目标\n完成发布。\n\n## 约束\n保留兼容。\n\n## 相关资源\n设计稿。'
  const view = sharedContextView(text)
  expect(view.preview).toContain('完成发布。')
  expect(view.preview).not.toContain('保留兼容。')
  expect(view.more).toContain('设计稿。')
})
it('preserves plain text without truncating the remaining paragraphs', () => {
  expect(sharedContextView('Background\n\nGoal\n\nConstraints\n\nResources')).toEqual({ preview: 'Background\n\nGoal', more: 'Constraints\n\nResources' })
  expect(sharedContextView('Short background')).toEqual({ preview: 'Short background', more: '' })
})
