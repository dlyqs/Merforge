// @vitest-environment jsdom
/** Account workspace selection uses committed native state. */
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { OrganizationDesktopSnapshot } from '@deepseek-ai/dsh-organization-connection/types'
import type { OrganizationId, MembershipId } from '@deepseek-ai/dsh-organization/types'
import type { OrganizationProps } from '../src/client/contract.ts'
import { AccountMenu } from '../src/client/AccountMenu.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)
it('returns to the previously selected organization after the native personal action clears its id', async () => {
  const organizationId = 'org-selected' as OrganizationId
  let snapshot: OrganizationDesktopSnapshot = {
    connection: { identityGeneration: 1, revision: 1, generation: 1, phase: 'ready', mode: 'organization', organizationId, members: [], organizations: [
      { id: 'org-other' as OrganizationId, name: 'Other', version: 1, membershipId: 'member-other' as MembershipId, role: 'member' },
      { id: organizationId, name: 'Selected', version: 1, membershipId: 'member-selected' as MembershipId, role: 'member' },
    ] },
    server: { phase: 'disabled', settings: { host: 'localhost', port: 19487, names: [], restoreOnLaunch: false } },
  }
  const connection = vi.fn<OrganizationProps['connection']>().mockResolvedValue({})
  const props: OrganizationProps = { available: true, connection, server: vi.fn(), secret: vi.fn(),
    context: vi.fn(), execution: vi.fn(), executionReport: vi.fn(),
    useModelCatalogRevision: selector => selector(0), useOrganization: selector => selector(snapshot), t: makeTranslate(zh) }
  const view = render(<AccountMenu {...props} />)
  fireEvent.click(screen.getByRole('button', { name: zh.accountCenter }))
  fireEvent.click(screen.getByRole('button', { name: new RegExp(zh.personalDescription) }))
  await waitFor(() => { expect(connection).toHaveBeenCalledWith({ kind: 'personal' }) })
  snapshot = { ...snapshot, connection: { ...snapshot.connection, mode: 'personal', organizationId: undefined } }
  view.rerender(<AccountMenu {...props} />)
  await waitFor(() => { expect(screen.getByRole('button').hasAttribute('disabled')).toBe(false) })
  fireEvent.click(screen.getByRole('button', { name: zh.accountCenter }))
  fireEvent.click(screen.getByRole('button', { name: /Selected/ }))
  await waitFor(() => { expect(connection).toHaveBeenLastCalledWith({ kind: 'select', organizationId }) })
  expect(screen.queryByRole('dialog')).toBeNull()
})

it('keeps failed selections open, traps keyboard focus and restores the avatar on dismissal', async () => {
  const snapshot: OrganizationDesktopSnapshot = {
    connection: { identityGeneration: 1, revision: 0, generation: 0, phase: 'disconnected', mode: 'personal', organizations: [], members: [] },
    server: { phase: 'disabled', settings: { host: 'localhost', port: 19487, names: [], restoreOnLaunch: false } },
  }
  const connection = vi.fn<OrganizationProps['connection']>().mockRejectedValue(new Error('unavailable'))
  render(<AccountMenu available connection={connection} server={vi.fn()} secret={vi.fn()} context={vi.fn()}
    useModelCatalogRevision={selector => selector(0)} useOrganization={selector => selector(snapshot)} t={makeTranslate(zh)} />)
  const avatar = screen.getByRole('button', { name: zh.accountCenter })
  fireEvent.click(avatar)
  const dialog = screen.getByRole('dialog')
  expect(dialog.contains(document.activeElement)).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: new RegExp(zh.personalDescription) }))
  await waitFor(() => { expect(screen.getByRole('alert').textContent).toBe(zh.failure) })
  expect(screen.getByRole('button', { name: new RegExp(zh.personalDescription) }).getAttribute('aria-pressed')).toBe('true')
  const manage = screen.getByRole('button', { name: zh.account })
  manage.focus()
  fireEvent.keyDown(manage, { key: 'Tab' })
  expect(document.activeElement).toBe(screen.getByRole('button', { name: zh.close }))
  fireEvent.keyDown(dialog, { key: 'Escape' })
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(document.activeElement).toBe(avatar)
})
