// @vitest-environment jsdom
/** Setup feedback uses one dismissible message for both operation and connection errors. */
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { OrganizationProps } from '../src/client/contract.ts'
import type { OrganizationDesktopSnapshot } from '@deepseek-ai/dsh-organization-connection/types'
import { OrganizationDialog } from '../src/client/OrganizationDialog.tsx'
import { zh } from '../src/client/locales.ts'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { OrganizationId, MembershipId } from '@deepseek-ai/dsh-organization/types'

afterEach(() => { cleanup(); vi.useRealTimers() })

it('shows member management only for administrators and leaves that section when administrator access is lost', () => {
  const organizationId = brandString<OrganizationId>('org'), membershipId = brandString<MembershipId>('member')
  const state: OrganizationDesktopSnapshot = { connection: { identityGeneration: 1, revision: 1, generation: 1,
    mode: 'organization', phase: 'ready', organizationId, members: [], organizations: [
      { id: organizationId, membershipId, name: 'Team', version: 1, role: 'member' },
    ] }, server: { phase: 'disabled', settings: { host: 'localhost', port: 19487, names: [], restoreOnLaunch: false } } }
  const props: OrganizationProps = { available: true, t: makeTranslate(zh), useModelCatalogRevision: selector => selector(0),
    useTaskExecutionRevision: selector => selector(0),
    useOrganization: selector => selector(state), connection: vi.fn(), context: vi.fn(), execution: vi.fn(), executionReport: vi.fn(),
    secret: vi.fn(), server: vi.fn() }
  const view = render(<OrganizationDialog {...props} onClose={vi.fn()} />)
  expect(screen.queryByRole('button', { name: zh.members })).toBeNull()
  state.connection.organizations[0]!.role = 'admin'
  view.rerender(<OrganizationDialog {...props} onClose={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: zh.members }))
  expect(screen.getByRole('heading', { name: zh.members })).toBeTruthy()
  state.connection.organizations[0]!.role = 'member'
  view.rerender(<OrganizationDialog {...props} onClose={vi.fn()} />)
  expect(screen.queryByRole('button', { name: zh.members })).toBeNull()
  expect(screen.queryByRole('heading', { name: zh.members })).toBeNull()
})

it('deduplicates native and operation failures, clears on editing and expires feedback', async () => {
  vi.useFakeTimers()
  const state: OrganizationDesktopSnapshot = {
    connection: { identityGeneration: 1, revision: 1, generation: 1, phase: 'disconnected', mode: 'personal', organizations: [], members: [] },
    server: { phase: 'disabled', settings: { host: '0.0.0.0', port: 19487, names: [], restoreOnLaunch: false } },
  }
  const props: OrganizationProps = { available: true, t: makeTranslate(zh),
    useModelCatalogRevision: selector => selector(0),
    useTaskExecutionRevision: selector => selector(0),
    useOrganization: selector => selector(state),
    context: vi.fn(), execution: vi.fn(), executionReport: vi.fn(), server: vi.fn(), secret: vi.fn(),
    connection: vi.fn(async () => { state.connection.error = 'connection-refused'; throw new Error('connection-refused') }),
  }
  render(<OrganizationDialog {...props} initialSection="connection" onClose={() => {}} />)
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


it('offers connection before registration and requires matching passwords with independent visibility controls', async () => {
  const state: OrganizationDesktopSnapshot = {
    connection: { identityGeneration: 1, revision: 1, generation: 1, phase: 'signed-out', mode: 'personal', organizations: [], members: [] },
    server: { phase: 'disabled', settings: { host: 'localhost', port: 19487, names: [], restoreOnLaunch: false } },
  }
  const connection = vi.fn<OrganizationProps['connection']>().mockResolvedValue({})
  render(<OrganizationDialog available t={makeTranslate(zh)}
    useModelCatalogRevision={selector => selector(0)} useOrganization={selector => selector(state)}
    connection={connection} context={vi.fn()} server={vi.fn()} secret={vi.fn()} initialSection="connection" onClose={vi.fn()} />)
  expect(screen.getByLabelText(zh.origin)).toBeDefined()
  fireEvent.click(screen.getByRole('button', { name: zh.register }))
  fireEvent.change(screen.getByLabelText(zh.invitation), { target: { value: 'invitation' } })
  fireEvent.change(screen.getByLabelText(zh.username), { target: { value: 'alice' } })
  fireEvent.change(screen.getByLabelText(zh.password), { target: { value: 'password-one' } })
  fireEvent.change(screen.getByLabelText(zh.confirmPassword), { target: { value: 'password-two' } })
  expect(screen.getByRole('button', { name: zh.register }).hasAttribute('disabled')).toBe(true)
  expect(screen.getByRole('alert').textContent).toBe(zh.passwordMismatch)
  fireEvent.click(screen.getAllByRole('button', { name: zh.showPassword })[0]!)
  expect(screen.getByLabelText(zh.password).getAttribute('type')).toBe('text')
  expect(screen.getByLabelText(zh.confirmPassword).getAttribute('type')).toBe('password')
  fireEvent.change(screen.getByLabelText(zh.confirmPassword), { target: { value: 'password-one' } })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: zh.register })) })
  expect(connection).toHaveBeenCalledExactlyOnceWith({ kind: 'register', invitationToken: 'invitation', username: 'alice', password: 'password-one' })
})
