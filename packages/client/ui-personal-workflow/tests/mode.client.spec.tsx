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
    sessionId: 'mode' as SessionId, t: makeTranslate(zh, commonZh),
    readMode: vi.fn().mockResolvedValue({ enabled: false, revision: 0 }), setMode,
    useSession: () => false, readTesting: vi.fn().mockResolvedValue({ forceDecomposition: false, revision: 0 }),
  } as Partial<ModeProps>
  render(<Mode {...props as ModeProps} />)
  const toggle = await screen.findByRole('switch')
  expect(toggle.getAttribute('aria-checked')).toBe('false')
  expect(setMode).not.toHaveBeenCalled()
  fireEvent.click(toggle)
  await screen.findByRole('alert')
  expect(toggle.getAttribute('aria-checked')).toBe('false')
  fireEvent.click(toggle)
  await waitFor(() => { expect(toggle.getAttribute('aria-checked')).toBe('true') })
  expect(setMode.mock.calls[0]?.[0]).toEqual(setMode.mock.calls[1]?.[0])
})

it('preserves the explicit conversation choice without a test override label', async () => {
  const props = {
    sessionId: 'forced-mode' as SessionId, t: makeTranslate(zh, commonZh),
    readMode: vi.fn().mockResolvedValue({ enabled: false, revision: 1 }), setMode: vi.fn(),
    readTesting: vi.fn().mockResolvedValue({ forceDecomposition: true, revision: 1 }), useSession: () => false,
  } as Partial<ModeProps>
  render(<Mode {...props as ModeProps} />)
  const toggle = await screen.findByRole('switch')
  expect(toggle.getAttribute('aria-checked')).toBe('false')
  expect(screen.queryByText(zh.testingOverrides)).toBeNull()
  expect(props.setMode).not.toHaveBeenCalled()
})
