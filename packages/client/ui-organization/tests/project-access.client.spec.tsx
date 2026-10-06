// @vitest-environment jsdom
/** Contextual access forms retain server versions and refuse stale results without opening a page. */
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { randomUUID } from 'node:crypto'
import { brandString } from '@deepseek-ai/dsh-brand'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { OrganizationDesktopSnapshot, ConnectionResult } from '@deepseek-ai/dsh-organization-connection/types'
import type { OrganizationId, OrganizationProjectId, MembershipId } from '@deepseek-ai/dsh-organization/types'
import type { OrganizationProps } from '../src/client/contract.ts'
import { ProjectAccess } from '../src/client/ProjectAccess.tsx'
import { OrganizationDialog } from '../src/client/OrganizationDialog.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)
function fixture() {
  const organizationId = brandString<OrganizationId>(randomUUID()), projectId = brandString<OrganizationProjectId>(randomUUID())
  const memberId = brandString<MembershipId>(randomUUID())
  const project = { id: projectId, organizationId, name: 'Design project', version: 1,
    createdBy: brandString<import('@deepseek-ai/dsh-organization/types').AccountId>(randomUUID()), background: '', summary: '', goal: '' }
  let state: OrganizationDesktopSnapshot = { connection: { identityGeneration: 1, generation: 1, revision: 1, mode: 'organization', phase: 'ready', organizationId,
    principal: { serverId: brandString(randomUUID()), accountId: project.createdBy },
    organizations: [{ id: organizationId, name: 'Team', role: 'admin', version: 1, membershipId: memberId }],
    members: [{ id: memberId, username: 'Alice', accountId: brandString(randomUUID()), accountVersion: 1, accountEnabled: true, enabled: true, role: 'member', version: 1 }],
    projects: { items: [project], total: 1, offset: 0, revision: 1, cursor: brandString('cursor') } },
  server: { phase: 'disabled', settings: { host: 'localhost', port: 19487, names: [], restoreOnLaunch: false } } }
  const connection = vi.fn<OrganizationProps['connection']>(async action => action.kind === 'grants'
    ? { grants: [{ projectId, membershipId: memberId, actions: ['read'], version: 7 }] } : {})
  const props: OrganizationProps = { available: true, t: makeTranslate(zh),
    useModelCatalogRevision: selector => selector(0),
    useTaskExecutionRevision: selector => selector(0),
    useOrganization: selector => selector(state),
    connection, context: vi.fn(), execution: vi.fn(), executionReport: vi.fn(), server: vi.fn(), secret: vi.fn() }
  return { project, memberId, props, connection, offline: () => { state = { ...state, connection: { ...state.connection, phase: 'offline', generation: 2 } } } }
}

it('opens named project access directly without asking for a project identifier', async () => {
  const h = fixture()
  render(<OrganizationDialog {...h.props} initialSection="projects" onClose={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: zh.projectMembers }))
  await screen.findByRole('button', { name: /Alice/ })
  expect(screen.getByRole<HTMLSelectElement>('combobox', { name: zh.chooseProject }).value).toBe(h.project.id)
  expect(h.connection).toHaveBeenCalledExactlyOnceWith({ kind: 'grants', projectId: h.project.id })
  expect(screen.queryByText(h.project.id)).toBeNull()
})

it('changes a named member permission once with the version the user reviewed', async () => {
  const h = fixture()
  render(<ProjectAccess {...h.props} projectId={h.project.id} />)
  fireEvent.click(await screen.findByRole('button', { name: /Alice/ }))
  expect(screen.getByRole<HTMLSelectElement>('combobox', { name: zh.accessLevel }).value).toBe('read')
  expect(screen.getByRole<HTMLButtonElement>('button', { name: zh.saveAccess }).disabled).toBe(true)
  fireEvent.change(screen.getByRole('combobox', { name: zh.accessLevel }), { target: { value: 'write' } })
  fireEvent.click(screen.getByRole('button', { name: zh.saveAccess }))
  await screen.findByText(zh.accessSaved)
  expect(h.connection.mock.calls.filter(([action]) => action.kind === 'command')).toHaveLength(1)
  expect(h.connection.mock.calls.find(([action]) => action.kind === 'command')?.[0]).toMatchObject({ command: {
    kind: 'set-grant', projectId: h.project.id, membershipId: h.memberId, expectedVersion: 7, actions: ['read', 'write'],
  } })
})

it('does not display an old permission result after the native identity generation changes', async () => {
  const h = fixture(), late = Promise.withResolvers<ConnectionResult>()
  h.connection.mockReturnValue(late.promise)
  const view = render(<ProjectAccess {...h.props} projectId={h.project.id} />)
  h.offline(); view.rerender(<ProjectAccess {...h.props} projectId={h.project.id} />)
  await act(async () => { late.resolve({ grants: [{ projectId: h.project.id, membershipId: h.memberId, actions: ['write'], version: 8 }] }) })
  expect(screen.queryByRole('button', { name: /Alice/ })).toBeNull()
  expect(screen.getByRole<HTMLButtonElement>('button', { name: zh.saveAccess }).closest('fieldset')?.disabled).toBe(true)
})

it('opens a newly created project immediately using the committed receipt', async () => {
  const h = fixture(), openProject = vi.fn(), onClose = vi.fn()
  h.connection.mockImplementation(async (action) => {
    if (action.kind === 'command') return { receipt: { operationId: brandString(randomUUID()), revision: 9,
      projectId: h.project.id, organizationId: h.project.organizationId } }
    return {}
  })
  render(<OrganizationDialog {...h.props} openProject={openProject} initialSection="projects" onClose={onClose} />)
  fireEvent.click(screen.getByRole('button', { name: zh.createProject }))
  fireEvent.change(screen.getByLabelText(zh.projectName), { target: { value: 'New project' } })
  fireEvent.click(screen.getByRole('button', { name: zh.createProject }))
  await waitFor(() => { expect(openProject).toHaveBeenCalledExactlyOnceWith({
    organizationId: h.project.organizationId, id: h.project.id, name: 'New project', version: 9, createdBy: h.project.createdBy, background: '', summary: '', goal: '',
  }) })
  expect(onClose).toHaveBeenCalledOnce()
  expect(h.connection.mock.calls.some(([action]) => action.kind === 'workgraph-tasks')).toBe(false)
  expect(screen.queryByLabelText(zh.projectName)).toBeNull()
})
