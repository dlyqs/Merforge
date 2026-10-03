// @vitest-environment jsdom
/** Explicit task selection refreshes stale candidates without starting execution. */
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionTaskChoiceId } from '@deepseek-ai/dsh-api-session-controller/client'
import { Execution } from '../src/client/Execution.tsx'
import type { ExecutionProps } from '../src/client/contract.ts'
import { zh } from '../src/client/locales.ts'
import { definition, ids } from '../../../workspace/personal-workflow/tests/fixture.ts'
import { projectPlan } from '../../../workspace/personal-workflow/src/projection.ts'

afterEach(cleanup)
it('shows only ready candidates, defaults to manual and refreshes a rejected claim', async () => {
  const view = projectPlan({ revision: 1, definition: definition(), source: 'user', sessionId: null, createdAt: 1,
    approval: { operationId: 'approved' as never, time: 1 } })
  const candidates = vi.fn().mockResolvedValueOnce([view]).mockResolvedValue([])
  const claim = vi.fn().mockRejectedValue(new Error('task-not-ready-or-already-owned'))
  const props: Partial<ExecutionProps> = {
    sessionId: 'execution' as SessionId, t: makeTranslate(zh, commonZh), useSession: () => false,
    candidates, readRun: vi.fn().mockResolvedValue(null), claim,
    limits: vi.fn().mockResolvedValue({ maxActions: 12, maxTurns: 4, maxDurationMs: 100000 }),
  }
  render(<Execution {...props as ExecutionProps} />)
  fireEvent.click(screen.getByRole('button', { name: zh.selectTask }))
  await screen.findByRole('option', { name: 'API agreement' })
  expect(screen.queryByRole('option', { name: 'Implementation' })).toBeNull()
  expect(claim).not.toHaveBeenCalled()
  fireEvent.change(screen.getByRole('combobox', { name: zh.selectTask }), { target: { value: ids[1] } })
  expect((screen.getByLabelText(zh.executionMode)).value).toBe('manual')
  fireEvent.click(screen.getByRole('button', { name: zh.claim }))
  await screen.findByRole('alert')
  await waitFor(() => { expect(candidates).toHaveBeenCalledTimes(2) })
  expect(screen.queryByRole('option', { name: 'API agreement' })).toBeNull()
  expect(claim.mock.calls[0]?.[0]).toMatchObject({ taskId: ids[1], expectedRevision: 1,
    authorization: { mode: 'manual', maxActions: 12, maxTurns: 4, maxDurationMs: 100000 } })
})

it('retries a persisted prepared receiver after remount using its original operation identity and context', async () => {
  const source = 'source' as SessionId; const target = 'receiver' as SessionId
  const snapshot = { revision: 1, definition: definition(), source: 'user' as const, sessionId: null, createdAt: 1,
    approval: { operationId: 'approved' as never, time: 1 } }
  const authorization = { mode: 'manual' as const, stopPhaseId: snapshot.definition.phases[0]!.id,
    maxActions: 10, maxTurns: 3, maxDurationMs: 100000 }
  const baseline = { cwd: '/work', gitHead: null, gitDirty: null, gitFiles: [], files: [] }
  const run: import('@deepseek-ai/dsh-personal-workflow/types').TaskRun = {
    id: 'run' as never, taskId: ids[1]!, planId: ids[0]!, planRevision: 1, sessionId: source, sessions: [source],
    ownerEpoch: 1, status: 'paused', reason: 'handoff-prepared', authorization, startedAt: 1, turnsUsed: 1,
    baseline, permissionFingerprint: 'policy', actions: [], evidence: [], reconciliations: [],
    handoffs: [{ runId: 'run' as never, taskId: ids[1]!, planRevision: 1, id: 'handoff' as never, operationId: 'original-operation' as never, sourceSessionId: source, targetSessionId: target,
      ownerEpoch: 1, status: 'prepared', context: 'Persisted decisions and remaining work', baseline, snapshot,
      authorization, actionsUsed: 0, turnsUsed: 1, evidence: [], prerequisites: [] }],
  }
  const handoff = vi.fn().mockResolvedValue({ ...run, sessionId: target, ownerEpoch: 2, sessions: [source, target] })
  const openSession = vi.fn()
  const props: Partial<ExecutionProps> = { sessionId: source, t: makeTranslate(zh, commonZh), useSession: () => false,
    candidates: vi.fn().mockResolvedValue([]), readRun: vi.fn().mockResolvedValue(run), handoff, openSession,
    limits: vi.fn().mockResolvedValue({ maxActions: 10, maxTurns: 3, maxDurationMs: 100000 }) }
  render(<Execution {...props as ExecutionProps} />)
  fireEvent.click(screen.getByRole('button', { name: zh.selectTask }))
  const retryButton = await screen.findByRole('button', { name: zh.handoff })
  await waitFor(() => { expect((retryButton as HTMLButtonElement).disabled).toBe(false) })
  fireEvent.click(retryButton)
  await waitFor(() => { expect(openSession).toHaveBeenCalledWith(target) })
  expect(handoff).toHaveBeenCalledWith({ sessionId: source, runId: run.id, ownerEpoch: 1,
    operationId: 'original-operation', context: 'Persisted decisions and remaining work' })
})

it('preselects the assigned account task and opens its settings without claiming or starting a Run', async () => {
  const openExecution = vi.fn(), selectTask = vi.fn().mockResolvedValue(undefined), claim = vi.fn()
  const props: Partial<ExecutionProps> = { sessionId: 'organization-conversation:test' as SessionId,
    t: makeTranslate(zh, commonZh), useSession: () => false, claim,
    account: { assigned: true, taskId: brandString<SessionTaskChoiceId>(ids[1]!), taskTitle: 'Assigned API agreement', openExecution, selectTask,
      listTasks: vi.fn().mockResolvedValue([{ id: ids[1], title: 'Assigned API agreement', scope: 'Publish agreement', acceptance: ['Reviewed'], artifacts: ['api.md'] }]) } }
  render(<Execution {...props as ExecutionProps} />)
  const button = screen.getByRole('button', { name: 'Assigned API agreement' })
  expect(button.getAttribute('aria-pressed')).toBe('true')
  fireEvent.click(button)
  await screen.findByRole('option', { name: 'Assigned API agreement' })
  expect(screen.getByRole('combobox', { name: zh.selectTask }).value).toBe(ids[1])
  expect(selectTask).not.toHaveBeenCalled(); expect(claim).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: zh.executionSettings }))
  expect(openExecution).toHaveBeenCalledOnce()
  expect(claim).not.toHaveBeenCalled()
})
