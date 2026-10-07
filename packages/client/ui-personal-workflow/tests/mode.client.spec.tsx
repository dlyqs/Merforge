// @vitest-environment jsdom
/** Mode selection is an explicit gesture, not an input submission side effect. */
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { Mode } from '../src/client/Mode.tsx'
import type { ModeProps } from '../src/client/contract.ts'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)
it('stays off until a gesture commits and preserves failed gesture identity for retry', async () => {
  const setMode = vi.fn<ModeProps['setMode']>().mockRejectedValueOnce(new Error('disk')).mockResolvedValue({ enabled: true, revision: 1 })
  const props = {
    sessionId: 'mode' as SessionId, personalPlanning: true, t: makeTranslate(zh, commonZh),
    readMode: vi.fn().mockResolvedValue({ enabled: false, revision: 0 }), setMode,
    readPlanningPreferences: vi.fn().mockResolvedValue({ enabled: true, granularity: 'balanced', revision: 0 }), setPlanningPreferences: vi.fn(),
    useSession: () => false, readTesting: vi.fn().mockResolvedValue({ forceDecomposition: false, revision: 0 }),
  } as Partial<ModeProps>
  render(<Mode {...props as ModeProps} />)
  fireEvent.click(await screen.findByRole('button', { name: zh.mode }))
  const toggle = await screen.findByRole('switch', { name: zh.planningTitle })
  expect(setMode).not.toHaveBeenCalled()
  expect(screen.queryByRole('button', { name: zh.refresh })).toBeNull()
  fireEvent.click(toggle)
  await screen.findByRole('alert')
  fireEvent.click(toggle)
  await waitFor(() => { expect(setMode).toHaveBeenCalledTimes(2) })
  expect(setMode.mock.calls[0]?.[0]).toEqual(setMode.mock.calls[1]?.[0])
})

it('preserves the explicit conversation choice without a test override label', async () => {
  const props = {
    sessionId: 'forced-mode' as SessionId, personalPlanning: true, t: makeTranslate(zh, commonZh),
    readMode: vi.fn().mockResolvedValue({ enabled: false, revision: 1 }), setMode: vi.fn(),
    readPlanningPreferences: vi.fn().mockResolvedValue({ enabled: true, granularity: 'balanced', revision: 0 }), setPlanningPreferences: vi.fn(),
    readTesting: vi.fn().mockResolvedValue({ forceDecomposition: true, revision: 1 }), useSession: () => false,
  } as Partial<ModeProps>
  render(<Mode {...props as ModeProps} />)
  fireEvent.click(await screen.findByRole('button', { name: zh.mode }))
  const toggle = await screen.findByRole('switch', { name: zh.planningTitle })
  expect(toggle.getAttribute('aria-checked')).toBe('false')
  expect(screen.queryByText(zh.testingOverrides)).toBeNull()
  expect(props.setMode).not.toHaveBeenCalled()
})


it('persists the Agent phase preference independently of the conversation planning switch', async () => {
  const setPlanningPreferences = vi.fn().mockResolvedValue({ enabled: true, granularity: 'fine', revision: 2 })
  const setMode = vi.fn()
  render(<Mode {...{
    sessionId: 'preference' as SessionId, personalPlanning: true, t: makeTranslate(zh, commonZh), useSession: () => false,
    readMode: vi.fn().mockResolvedValue({ enabled: false, revision: 0 }), setMode,
    readTesting: vi.fn().mockResolvedValue({ forceDecomposition: false, revision: 0 }),
    readPlanningPreferences: vi.fn().mockResolvedValue({ enabled: true, granularity: 'balanced', revision: 1 }), setPlanningPreferences,
  } as ModeProps} />)
  expect(screen.queryByRole('dialog')).toBeNull()
  fireEvent.click(await screen.findByRole('button', { name: zh.mode }))
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(zh.fineGranularity) }))
  await waitFor(() => { expect(setPlanningPreferences).toHaveBeenCalledWith({ enabled: true, granularity: 'fine', expectedRevision: 1 }) })
  expect(setMode).not.toHaveBeenCalled()
})

it('switches account preferences in the panel and carries their committed revision into the planning switch', async () => {
  const setPlanningPreferences = vi.fn().mockResolvedValue({ enabled: false, granularity: 'fine', revision: 4 })
  const setMode = vi.fn().mockResolvedValue({ enabled: true, revision: 5 })
  render(<Mode {...{
    sessionId: 'account-mode' as SessionId, personalPlanning: false, t: makeTranslate(zh, commonZh), useSession: () => false,
    readMode: vi.fn().mockResolvedValue({ enabled: false, revision: 3 }), setMode,
    readPlanningPreferences: vi.fn().mockResolvedValue({ enabled: false, granularity: 'balanced', revision: 3 }), setPlanningPreferences,
  } as ModeProps} />)
  fireEvent.click(await screen.findByRole('button', { name: zh.mode }))
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(zh.fineAllocation) }))
  await waitFor(() => { expect(setPlanningPreferences).toHaveBeenCalledWith({ enabled: false, granularity: 'fine', expectedRevision: 3 }) })
  fireEvent.click(screen.getByRole('switch', { name: zh.planningTitle }))
  await waitFor(() => { expect(setMode).toHaveBeenCalledWith(expect.objectContaining({ enabled: true, expectedRevision: 4 })) })
  expect(screen.queryByRole('menuitem')).toBeNull()
})
