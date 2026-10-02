// @vitest-environment jsdom
/** Inline plan edits retain conflicting text and reread the existing plan authority. */
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { definition, operation } from '../../../workspace/personal-workflow/tests/fixture.ts'
import { projectPlan } from '../../../workspace/personal-workflow/src/projection.ts'
import type { PlanRevision } from '@deepseek-ai/dsh-personal-workflow/types'
import type { ChatNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { WorkflowActions } from '../src/client/contract.ts'
import { ConversationPlan } from '../src/client/ConversationPlan.tsx'
import { zh } from '../src/client/locales.ts'
afterEach(cleanup)
it('keeps conflicting edits until explicit refresh and uses the newly read revision on the next save', async () => {
  let snapshot: PlanRevision = { revision: 1, definition: definition(), source: 'model', sessionId: null,
    createdAt: 1, approval: null }
  const node: ChatNode<'personal-plan'> = { key: 'personal-plan', kind: 'personal-plan', id: snapshot.definition.taskId,
    target: 'chat', anchorSeq: 1, location: { kind: 'unresolved' }, visibility: 'visible',
    data: { taskId: snapshot.definition.taskId, operationId: operation(1), snapshot } }
  const list = vi.fn(async () => [projectPlan(snapshot)])
  const save = vi.fn<WorkflowActions['save']>().mockRejectedValueOnce(new Error('version-conflict')).mockImplementation(async (request) => {
    snapshot = { ...snapshot, revision: 3, definition: request.definition }; return snapshot
  })
  render(<ConversationPlan node={node} list={list} save={save} t={makeTranslate(zh)} />)
  const goal = await screen.findByLabelText(zh.goal)
  fireEvent.change(goal, { target: { value: 'My revised report' } })
  snapshot = { ...snapshot, revision: 2 }
  fireEvent.click(screen.getByRole('button', { name: zh.save }))
  expect((await screen.findByRole('alert')).textContent).toContain('version-conflict')
  expect(screen.getByDisplayValue('My revised report')).toBeTruthy()
  expect(save.mock.calls[0]?.[0].expectedRevision).toBe(1)
  fireEvent.click(screen.getByRole('button', { name: zh.refresh }))
  await waitFor(() => { expect(screen.getByLabelText(zh.goal).value).toBe('CSV delivery') })
  fireEvent.change(screen.getByLabelText(zh.goal), { target: { value: 'Accepted new revision' } })
  fireEvent.click(screen.getByRole('button', { name: zh.save }))
  await waitFor(() => { expect(list).toHaveBeenCalledTimes(3) })
  expect(save.mock.calls[1]?.[0].expectedRevision).toBe(2)
  expect(save.mock.calls[1]?.[0].operationId).not.toBe(save.mock.calls[0]?.[0].operationId)
})
