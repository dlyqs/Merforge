// @vitest-environment jsdom
/** Explicit task selection refreshes stale candidates without starting execution. */
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionTaskChoiceId } from '@deepseek-ai/dsh-api-session-controller/client'
import { Execution } from '../src/client/Execution.tsx'
import type { ExecutionProps } from '../src/client/contract.ts'
import { zh } from '../src/client/locales.ts'
import { definition, ids, phaseDefinition } from '../../../workspace/personal-workflow/tests/fixture.ts'
import { projectPlan } from '../../../workspace/personal-workflow/src/projection.ts'

afterEach(cleanup)
it('records an inclusive phase range and explicitly selected automatic relay batch', async () => {
  const definition = phaseDefinition(6)
  const view = projectPlan({ revision: 1, definition, source: 'user', sessionId: null, createdAt: 1,
    approval: { operationId: 'approved' as never, time: 1 } })
  const claim = vi.fn().mockRejectedValue(new Error('fixture write failure'))
  render(<Execution {...{
    sessionId: 'phase-execution' as SessionId, t: makeTranslate(zh, commonZh), useSession: () => false,
    candidates: vi.fn().mockResolvedValue([view]), readRun: vi.fn().mockResolvedValue(null), claim,
    limits: vi.fn().mockResolvedValue({ maxActions: 12, maxTurns: 10, maxDurationMs: 100000 }),
  } as ExecutionProps} />)
  fireEvent.click(screen.getByRole('button', { name: zh.selectTask }))
  fireEvent.click(await screen.findByRole('button', { name: 'Phase 1' }))
  fireEvent.click(screen.getByRole('tab', { name: zh.autoUntilShort }))
  fireEvent.change(screen.getByLabelText(zh.executeThroughPhase), { target: { value: definition.phases[2]!.id } })
  fireEvent.change(screen.getByLabelText(zh.phasesPerConversation), { target: { value: '2' } })
  fireEvent.click(screen.getByRole('button', { name: zh.claim }))
  await waitFor(() => { expect(claim).toHaveBeenCalledWith(expect.objectContaining({ authorization: {
    mode: 'auto_until', startPhaseId: definition.phases[0]!.id, stopPhaseId: definition.phases[2]!.id,
    relayEveryPhases: 2, maxActions: 12, maxTurns: 10, maxDurationMs: 100000,
  } })) })
})
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
  await screen.findByRole('button', { name: 'API agreement' })
  expect(screen.queryByRole('button', { name: 'Implementation' })).toBeNull()
  expect(claim).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'API agreement' }))
  expect(screen.getByRole('tab', { name: zh.manualShort }).getAttribute('aria-selected')).toBe('true')
  expect(screen.queryByRole('combobox', { name: zh.selectTask })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: zh.claim }))
  await screen.findByRole('alert')
  await waitFor(() => { expect(candidates).toHaveBeenCalledTimes(2) })
  expect(screen.queryByRole('button', { name: 'API agreement' })).toBeNull()
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
    candidates: vi.fn().mockResolvedValue([]), readRun: vi.fn().mockResolvedValue(run),
    readPlan: vi.fn().mockResolvedValue(snapshot), handoff, openSession,
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
  const dialog = screen.getByRole('dialog', { name: zh.selectTask })
  const selected = await within(dialog).findByRole('button', { name: 'Assigned API agreement' })
  expect(selected.getAttribute('aria-pressed')).toBe('true')
  expect(within(dialog).queryByRole('combobox')).toBeNull()
  expect(selectTask).not.toHaveBeenCalled(); expect(claim).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: zh.executionSettings }))
  expect(openExecution).toHaveBeenCalledOnce()
  expect(claim).not.toHaveBeenCalled()
})

it('shows the completed milestone before selection and clamps relay batches to a shortened phase range', async () => {
  const definition = phaseDefinition(6)
  const view = projectPlan({ revision: 3, definition, source: 'user', sessionId: null, createdAt: 1,
    approval: { operationId: 'approved' as never, time: 1 } }, [
    { taskId: ids[1]!, status: 'completed', evidence: ['Phase 1 accepted'] },
    { taskId: ids[2]!, status: 'completed', evidence: ['Phase 2 accepted'] },
  ])
  const claim = vi.fn().mockRejectedValue(new Error('fixture write failure'))
  render(<Execution {...{
    sessionId: 'progress' as SessionId, t: makeTranslate(zh, commonZh), useSession: () => false,
    candidates: vi.fn().mockResolvedValue([view]), readRun: vi.fn().mockResolvedValue(null), claim,
    limits: vi.fn().mockResolvedValue({ maxActions: 12, maxTurns: 10, maxDurationMs: 100000 }),
  } as ExecutionProps} />)
  fireEvent.click(screen.getByRole('button', { name: zh.selectTask }))
  await screen.findByText('已完成至 Phase 2')
  expect(screen.getByRole('progressbar', { name: zh.phaseSequence }).getAttribute('value')).toBe('2')
  fireEvent.click(screen.getByRole('button', { name: 'Phase 3' }))
  expect(screen.getByLabelText(zh.phasesPerConversation).disabled).toBe(true)
  fireEvent.click(screen.getByRole('tab', { name: zh.autoShort }))
  expect(screen.getByLabelText(zh.executeThroughPhase).value).toBe(definition.phases[5]!.id)
  expect(screen.getByLabelText(zh.phasesPerConversation).value).toBe('all')
  fireEvent.click(screen.getByRole('tab', { name: zh.autoUntilShort }))
  fireEvent.change(screen.getByLabelText(zh.executeThroughPhase), { target: { value: definition.phases[5]!.id } })
  fireEvent.change(screen.getByLabelText(zh.phasesPerConversation), { target: { value: '3' } })
  fireEvent.change(screen.getByLabelText(zh.executeThroughPhase), { target: { value: definition.phases[3]!.id } })
  expect(screen.getByLabelText(zh.phasesPerConversation).value).toBe('2')
  fireEvent.click(screen.getByRole('button', { name: zh.claim }))
  await waitFor(() => { expect(claim).toHaveBeenCalledWith(expect.objectContaining({ authorization: {
    mode: 'auto_until', startPhaseId: definition.phases[2]!.id, stopPhaseId: definition.phases[3]!.id, relayEveryPhases: 2,
    maxActions: 12, maxTurns: 10, maxDurationMs: 100000,
  } })) })
})

it('reads a bound Run’s exact plan revision and keeps phase progress visible after binding', async () => {
  const definition = phaseDefinition(6), sessionId = 'bound-phases' as SessionId
  const snapshot = { definition, revision: 7, source: 'user' as const, sessionId: null, createdAt: 1, approval: null }
  const run: import('@deepseek-ai/dsh-personal-workflow/types').TaskRun = {
    id: 'run' as never, taskId: ids[3]!, planId: definition.taskId, planRevision: 7, sessionId, sessions: [sessionId],
    ownerEpoch: 1, status: 'paused', reason: null, startedAt: 1, turnsUsed: 2,
    authorization: { mode: 'auto_until', startPhaseId: definition.phases[2]!.id, stopPhaseId: definition.phases[4]!.id,
      relayEveryPhases: 2, maxActions: 10, maxTurns: 4, maxDurationMs: 100000 },
    baseline: { cwd: '/work', gitHead: null, gitDirty: null, gitFiles: [], files: [] },
    permissionFingerprint: 'policy', actions: [], evidence: [], reconciliations: [], handoffs: [],
    sequence: { taskIds: [ids[3]!, ids[4]!, ids[5]!], completed: [] },
  }
  const readPlan = vi.fn().mockResolvedValue(snapshot)
  render(<Execution {...{ sessionId, t: makeTranslate(zh, commonZh), useSession: () => false,
    candidates: vi.fn().mockResolvedValue([]), readRun: vi.fn().mockResolvedValue(run), readPlan,
    limits: vi.fn().mockResolvedValue({ maxActions: 10, maxTurns: 4, maxDurationMs: 100000 }),
  } as ExecutionProps} />)
  fireEvent.click(screen.getByRole('button', { name: zh.selectTask }))
  await screen.findByText('已完成至 Phase 2')
  expect(readPlan).toHaveBeenCalledExactlyOnceWith({ taskId: definition.taskId, revision: 7 })
  expect(screen.getByRole('heading', { name: 'Phase 3' })).toBeTruthy()
  expect(screen.getByText('Phase 5')).toBeTruthy()
  expect(screen.getByText('每轮 2 个阶段')).toBeTruthy()
  expect(screen.getByRole('progressbar', { name: zh.phaseSequence }).getAttribute('max')).toBe('6')
})
