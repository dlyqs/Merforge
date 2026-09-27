// @vitest-environment jsdom
/** Review failures preserve the user's exact draft and never start execution. */
import { useSyncExternalStore } from 'react'
import { createWorkflowStore } from '../src/client/store.ts'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { definition, operation } from '../../../workspace/personal-workflow/tests/fixture.ts'
import { projectPlan } from '../../../workspace/personal-workflow/src/projection.ts'
import type { ProjectId } from '@deepseek-ai/dsh-personal-project/types'
import type { PlanRevision } from '@deepseek-ai/dsh-personal-workflow/types'
import { WorkflowList } from '../src/client/WorkflowList.tsx'
import type { WorkflowListProps } from '../src/client/contract.ts'
import { Workflow } from '../src/client/Workflow.tsx'
import type { WorkflowProps } from '../src/client/contract.ts'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)
it('retains a failed edit, retries the same operation, and reviews only the new version', async () => {
  const projectId = 'project' as ProjectId
  let snapshot: PlanRevision = { revision: 1, definition: { ...definition(), projectId }, source: 'model', sessionId: null, createdAt: 1, approval: null }
  const save = vi.fn<WorkflowProps['save']>().mockRejectedValueOnce(new Error('invalid-dependency')).mockImplementation(async (request) => {
    snapshot = { ...snapshot, definition: request.definition, revision: 2 }
    return snapshot
  })
  const approve = vi.fn<WorkflowProps['approve']>().mockImplementation(async () => {
    snapshot = { ...snapshot, approval: { operationId: operation(8), time: 2 } }
    return snapshot
  })
  const store = createWorkflowStore().create()
  store.actions.select(snapshot.definition.taskId)
  const props = {
    actions: store.actions,
    useStore: selector => selector(useSyncExternalStore(callback => store.subscribe(callback), () => store.getSnapshot())),
    t: makeTranslate(zh, commonZh), list: async () => [projectPlan(snapshot)], save, approve,
    exportPlan: vi.fn(), openSession: vi.fn(),
    useSessions: selector => selector({ ids: [], byId: {}, phase: 'ready', projectionsBySession: {} }),
  } satisfies Partial<WorkflowProps>
  render(<Workflow {...props as WorkflowProps} />)
  await screen.findByText(zh.edit)
  fireEvent.click(screen.getByText(zh.edit))
  fireEvent.change(screen.getByLabelText(zh.goal), { target: { value: 'Revised delivery' } })
  fireEvent.click(screen.getByText(zh.save))
  expect((await screen.findByRole('alert')).textContent).toContain('invalid-dependency')
  expect((screen.getByLabelText(zh.goal)).value).toBe('Revised delivery')
  fireEvent.click(screen.getByText(zh.save))
  await waitFor(() =>{  expect(screen.queryByLabelText(zh.goal)).toBeNull() })
  expect(save.mock.calls[0]?.[0].operationId).toBe(save.mock.calls[1]?.[0].operationId)
  fireEvent.click(screen.getByText(zh.approve))
  await screen.findByText(zh.approved)
  expect(approve.mock.calls[0]?.[0].expectedRevision).toBe(2)
  expect(screen.getAllByText(zh.ready).length).toBeGreaterThan(0)
  expect(props.openSession).not.toHaveBeenCalled()
})

it('selects a plan from the secondary list and renders review in the main workspace without a dialog', async () => {
  const snapshot: PlanRevision = { revision: 1, definition: definition(), source: 'model', sessionId: null, createdAt: 1, approval: null }
  const store = createWorkflowStore().create()
  const shared = {
    actions: store.actions,
    useStore: selector => selector(useSyncExternalStore(callback => store.subscribe(callback), () => store.getSnapshot())),
    t: makeTranslate(zh, commonZh), list: async () => [projectPlan(snapshot)],
  } satisfies Partial<WorkflowProps>
  const openTasks = vi.fn()
  const props = {
    ...shared, save: vi.fn(), approve: vi.fn(), exportPlan: vi.fn(), openSession: vi.fn(),
    useSessions: selector => selector({ ids: [], byId: {}, phase: 'ready', projectionsBySession: {} }),
  } satisfies Partial<WorkflowProps>
  render(<><WorkflowList {...{ ...shared, openTasks } as WorkflowListProps} /><Workflow {...props as WorkflowProps} /></>)
  const navigation = screen.getByRole('navigation', { name: zh.plans })
  const plan = await within(navigation).findByRole('button', { name: /CSV delivery/ })
  fireEvent.click(plan)
  expect(openTasks).toHaveBeenCalledOnce()
  expect(plan.getAttribute('aria-pressed')).toBe('true')
  await screen.findByText(zh.dependencies)
  expect(screen.queryByRole('dialog')).toBeNull()
  fireEvent.click(screen.getByText(zh.edit))
  expect(plan.hasAttribute('disabled')).toBe(true)
  fireEvent.click(screen.getByText(zh.cancel))
  expect(plan.hasAttribute('disabled')).toBe(false)
})
