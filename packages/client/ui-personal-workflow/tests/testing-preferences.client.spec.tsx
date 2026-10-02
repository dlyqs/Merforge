// @vitest-environment jsdom
/** Temporary testing settings expose only committed values and recover from conflicts. */
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { TestingPreferences } from '../src/client/TestingPreferences.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)
it('waits for saved settings and refreshes after a failed write without silently enabling the override', async () => {
  const write = Promise.withResolvers<{ forceDecomposition: boolean; revision: number }>()
  const readPreferences = vi.fn().mockResolvedValue({ forceDecomposition: false, revision: 0 })
  const setPreferences = vi.fn().mockReturnValueOnce(write.promise).mockRejectedValueOnce(new Error('revision-conflict'))
  const props = { readPreferences, setPreferences, readPlanningPreferences: vi.fn().mockResolvedValue({ enabled: true, granularity: 'balanced', revision: 0 }), setPlanningPreferences: vi.fn(), t: makeTranslate(zh, commonZh) } as ComponentProps<typeof TestingPreferences>
  render(<TestingPreferences {...props} />)
  const toggle = screen.getByRole('switch', { name: zh.forceDecomposition })
  await waitFor(() => { expect(toggle.hasAttribute('disabled')).toBe(false) })
  expect(setPreferences).not.toHaveBeenCalled()
  fireEvent.click(toggle)
  expect(toggle.getAttribute('aria-checked')).toBe('false')
  expect(toggle.hasAttribute('disabled')).toBe(true)
  write.resolve({ forceDecomposition: true, revision: 1 })
  await waitFor(() => { expect(toggle.getAttribute('aria-checked')).toBe('true') })
  expect(setPreferences).toHaveBeenCalledWith({ forceDecomposition: true, expectedRevision: 0 })
  fireEvent.click(toggle)
  await screen.findByRole('alert')
  expect(toggle.hasAttribute('disabled')).toBe(true)
  readPreferences.mockResolvedValue({ forceDecomposition: true, revision: 2 })
  fireEvent.click(screen.getByRole('button', { name: zh.refresh }))
  await waitFor(() => { expect(toggle.hasAttribute('disabled')).toBe(false) })
  expect(toggle.getAttribute('aria-checked')).toBe('true')
})

it('shows automatic recognition by default and saves only explicit preference gestures', async () => {
  const setPlanningPreferences = vi.fn().mockResolvedValue({ enabled: false, granularity: 'balanced', revision: 1 })
  const props = {
    readPreferences: vi.fn().mockResolvedValue({ forceDecomposition: false, revision: 0 }), setPreferences: vi.fn(),
    readPlanningPreferences: vi.fn().mockResolvedValue({ enabled: true, granularity: 'balanced', revision: 0 }),
    setPlanningPreferences, t: makeTranslate(zh, commonZh),
  } as ComponentProps<typeof TestingPreferences>
  render(<TestingPreferences {...props} />)
  const toggle = screen.getByRole('switch', { name: zh.defaultPlanning })
  await waitFor(() => { expect(toggle.hasAttribute('disabled')).toBe(false) })
  expect(toggle.getAttribute('aria-checked')).toBe('true')
  expect(setPlanningPreferences).not.toHaveBeenCalled()
  fireEvent.click(toggle)
  await waitFor(() => { expect(toggle.getAttribute('aria-checked')).toBe('false') })
  expect(setPlanningPreferences).toHaveBeenCalledWith({ enabled: false, granularity: 'balanced', expectedRevision: 0 })
  expect(setPlanningPreferences).toHaveBeenCalledTimes(1)
})
