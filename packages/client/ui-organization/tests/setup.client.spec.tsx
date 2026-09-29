// @vitest-environment jsdom
/** Setup feedback uses one dismissible message for both operation and connection errors. */
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { OrganizationProps } from '../src/client/contract.ts'
import type { OrganizationDesktopSnapshot } from '@deepseek-ai/dsh-organization-connection/types'
import { OrganizationDialog } from '../src/client/OrganizationDialog.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(() => { cleanup(); vi.useRealTimers() })

it('deduplicates native and operation failures, clears on editing and expires feedback', async () => {
  vi.useFakeTimers()
  const state: OrganizationDesktopSnapshot = {
    connection: { revision: 1, generation: 1, phase: 'disconnected', mode: 'personal', organizations: [], members: [] },
    server: { phase: 'disabled', settings: { host: '0.0.0.0', port: 19487, names: [], restoreOnLaunch: false } },
  }
  const props: OrganizationProps = { available: true, t: makeTranslate(zh),
    useOrganization: selector => selector(state), context: vi.fn(), server: vi.fn(), secret: vi.fn(),
    connection: vi.fn(async () => { state.connection.error = 'connection-refused'; throw new Error('connection-refused') }),
  }
  render(<OrganizationDialog {...props} initialSection="connection" onClose={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: zh.login }))
  fireEvent.change(screen.getByLabelText(zh.origin), { target: { value: '172.30.64.1:19487' } })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: zh.probe })) })
  expect(screen.getAllByRole('alert')).toHaveLength(1)
  expect(screen.getByRole('alert').textContent).toContain(zh['connection-refused'])
  fireEvent.change(screen.getByLabelText(zh.origin), { target: { value: '172.30.64.2:19487' } })
  expect(screen.queryByRole('alert')).toBeNull()
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: zh.probe })) })
  expect(screen.getAllByRole('alert')).toHaveLength(1)
  act(() => { vi.advanceTimersByTime(6000) })
  expect(screen.queryByRole('alert')).toBeNull()
})
