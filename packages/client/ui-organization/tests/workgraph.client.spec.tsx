// @vitest-environment jsdom
/** Task interaction regressions run with DOM controls only, without a browser or page. */
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { OrganizationDesktopSnapshot, ConnectionResult } from '@deepseek-ai/dsh-organization-connection/types'
import { workgraphPageSchema, workgraphVersionSchema } from '@deepseek-ai/dsh-organization/workgraph'
import { randomUUID } from 'node:crypto'
import type { OrganizationProps } from '../src/client/contract.ts'
import { Workbench } from '../src/client/Workbench.tsx'
import { OrganizationDialog } from '../src/client/OrganizationDialog.tsx'
import { TaskGrants } from '../src/client/TaskGrants.tsx'
import { zh } from '../src/client/locales.ts'
import { taskRows } from '../src/client/workgraph-view.ts'
import { brandString } from '@deepseek-ai/dsh-brand'

afterEach(cleanup)
function fixture() {
  const organizationId = brandString<import('@deepseek-ai/dsh-organization/types').OrganizationId>(randomUUID())
  const project = { id: brandString<import('@deepseek-ai/dsh-organization/types').OrganizationProjectId>(randomUUID()), organizationId, name: 'Shared project', version: 1 }
  const member = brandString<import('@deepseek-ai/dsh-organization/types').MembershipId>(randomUUID())
  const version = workgraphVersionSchema.parse({ organizationId, projectId: project.id, planId: randomUUID(), revision: 1,
    createdBy: member, createdAt: 1,
    definition: { taskId: '10000000-0000-4000-8000-000000000001', phases: [{ id: '10000000-0000-4000-8000-000000000002', title: 'Preparation' }], tasks: [{
      id: '10000000-0000-4000-8000-000000000001', parentTaskId: null, phaseId: '10000000-0000-4000-8000-000000000002', goal: 'Visible task',
      scope: 'Authorized scope',
      acceptance: ['Review'], artifacts: [], required: true, dependsOn: [], suggestedMembershipId: null,
    }] } })
  const page = workgraphPageSchema.parse({ items: [{ ...version.definition.tasks[0], planId: version.planId, revision: 1, phaseTitle: 'Preparation', assignable: false, hasUndisclosedPrerequisite: true }], total: 1, offset: 0, revision: 1, cursor: 'cursor' })
  let state: OrganizationDesktopSnapshot = { connection: { revision: 1, generation: 1, phase: 'ready', mode: 'organization', organizationId,
    organizations: [{ id: organizationId, membershipId: member, name: 'Team', role: 'member', version: 1 }], members: [],
    projects: { items: [project], offset: 0, total: 1, revision: 1, cursor: page.cursor } },
  server: { phase: 'disabled', settings: { host: 'localhost', port: 19487, names: [], restoreOnLaunch: false } } }
  const reply = (result: NonNullable<ConnectionResult['workgraph']>['result']): ConnectionResult => ({ workgraph: {
    generation: state.connection.generation, requestId: brandString(randomUUID()), organizationId,
    principal: { serverId: brandString(randomUUID()), accountId: brandString(randomUUID()), organizationId, membershipId: member, role: 'member' }, result,
  } })
  const connection = vi.fn<OrganizationProps['connection']>(async (action) => {
    if (action.kind === 'workgraph-tasks') return reply({ kind: 'tasks', value: page })
    if (action.kind === 'workgraph-read') return reply({ kind: 'plan', value: version })
    return {}
  })
  const context = vi.fn<OrganizationProps['context']>()
  const props: OrganizationProps = { connection, context, available: true, server: vi.fn(), secret: vi.fn(),
    t: makeTranslate(zh), useOrganization: selector => selector(state) }
  return { props, project, page, version, connection, context, reply,
    setState: (patch: Partial<typeof state.connection>) => { state = { ...state, connection: { ...state.connection, ...patch } } } }
}
it('retains a failed save draft and retries the identical operation; conflicts require explicit replacement', async () => {
  const h = fixture(); render(<Workbench {...h.props} project={h.project} onBack={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Visible task' }))
  fireEvent.click(screen.getByRole('button', { name: zh.editTask }))
  await screen.findByLabelText(zh.taskGoal)
  fireEvent.change(screen.getByLabelText(zh.taskGoal), { target: { value: 'Local edit' } })
  const base = h.connection.getMockImplementation()!
  h.connection.mockImplementation(async (action) => { if (action.kind === 'workgraph-save') throw new Error('unavailable'); return base(action) })
  fireEvent.click(screen.getByRole('button', { name: zh.saveTask }))
  await screen.findByText(zh.unavailable)
  expect((screen.getByLabelText(zh.taskGoal)).value).toBe('Local edit')
  h.connection.mockImplementation(async (action) => { if (action.kind === 'workgraph-save') throw new Error('version-conflict'); return base(action) })
  fireEvent.click(screen.getByRole('button', { name: zh.saveTask }))
  await screen.findByRole('alert')
  const saves = h.connection.mock.calls.filter(([action]) => action.kind === 'workgraph-save')
  expect(saves).toHaveLength(2); expect(saves[0]).toEqual(saves[1])
  expect((screen.getByLabelText(zh.taskGoal).closest('fieldset') as HTMLFieldSetElement).disabled).toBe(true)
})
it('uses native context action and hides expired content including delayed results', async () => {
  const h = fixture(); const late = Promise.withResolvers<Awaited<ReturnType<OrganizationProps['context']>>>()
  h.context.mockReturnValue(late.promise)
  const view = render(<Workbench {...h.props} project={h.project} onBack={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Visible task' }))
  fireEvent.click(screen.getByRole('button', { name: zh.myContext }))
  expect(h.context).toHaveBeenCalledWith(expect.objectContaining({ taskId: h.page.items[0]!.id, projectId: h.project.id }))
  h.setState({ generation: 2, phase: 'offline' }); view.rerender(<Workbench {...h.props} project={h.project} onBack={vi.fn()} />)
  late.resolve({ generation: 1, result: { sessionId: 'organization-context:test' as import('@deepseek-ai/dsh-session').SessionId, mode: 'pre-execution',
    owner: { serverId: brandString(randomUUID()), accountId: brandString(randomUUID()),
      organizationId: h.project.organizationId,
      planId: h.version.planId, taskId: h.page.items[0]!.id, version: 1 }, snapshot: h.page.items[0]! } })
  await waitFor(() =>{  expect(screen.queryByText('Authorized scope')).toBeNull() })
  expect(screen.queryByText(zh.contextReadonly)).toBeNull()
})
it('drops task drafts and project selection immediately on organization switch', async () => {
  const h = fixture(); const view = render(<OrganizationDialog {...h.props} initialSection="projects" onClose={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: zh.tasks }))
  await screen.findByRole('button', { name: 'Visible task' })
  fireEvent.click(screen.getByRole('button', { name: zh.createTask }))
  fireEvent.change(screen.getByLabelText(zh.taskGoal), { target: { value: 'Private draft' } })
  h.setState({ organizationId: brandString(randomUUID()), generation: 2, projects: undefined })
  view.rerender(<OrganizationDialog {...h.props} initialSection="projects" onClose={vi.fn()} />)
  expect(screen.queryByDisplayValue('Private draft')).toBeNull()
  expect(screen.queryByText('Shared project')).toBeNull()
})
it('administers grants from identifiers without requesting task content', async () => {
  const h = fixture(); h.connection.mockImplementation(async action => action.kind === 'workgraph-grants' ? h.reply({ kind: 'grants', value: [] }) : {})
  render(<TaskGrants {...h.props} projectId={h.project.id} />)
  fireEvent.change(screen.getByLabelText(zh.planId), { target: { value: h.version.planId } })
  fireEvent.click(screen.getByRole('button', { name: zh.inspectGrants }))
  await waitFor(() =>{  expect(h.connection).toHaveBeenCalledTimes(1) })
  expect(h.connection.mock.calls[0]![0].kind).toBe('workgraph-grants')
})
it('orders visible children after their parent without inventing off-page ancestors', () => {
  const h = fixture(), root = h.page.items[0]!
  const child = { ...root, id: brandString<import('@deepseek-ai/dsh-organization').OrganizationTaskId>(randomUUID()), parentTaskId: root.id }
  expect(taskRows([child, root]).map(row => row.depth)).toEqual([0, 1])
  expect(taskRows([child]).map(row => row.depth)).toEqual([0])
})
it('creates a complete single-task definition and opens only the saved read-only task snapshot', async () => {
  const h = fixture()
  h.context.mockResolvedValue({ generation: 1, result: { mode: 'pre-execution', sessionId: 'organization-context:local' as import('@deepseek-ai/dsh-session').SessionId,
    owner: { version: 1, serverId: brandString(randomUUID()), accountId: brandString(randomUUID()),
      organizationId: h.project.organizationId,
      planId: h.version.planId, taskId: h.page.items[0]!.id },
    snapshot: { ...h.page.items[0]!, goal: 'Original saved goal', revision: h.version.revision } } })
  render(<Workbench {...h.props} project={h.project} onBack={vi.fn()} />)
  await screen.findByRole('button', { name: 'Visible task' })
  fireEvent.click(screen.getByRole('button', { name: zh.createTask }))
  for (const [label, value] of [[zh.taskGoal, 'New task'], [zh.taskScope, 'New scope'], [zh.taskAcceptance, 'Review new task']]) {
    fireEvent.change(screen.getByLabelText(label!), { target: { value } })
  }
  fireEvent.click(screen.getByRole('button', { name: zh.saveTask }))
  await waitFor(() =>{  expect(screen.queryByLabelText(zh.taskGoal)).toBeNull() })
  expect(h.connection.mock.calls.find(([action]) => action.kind === 'workgraph-save')?.[0]).toMatchObject({
    request: { expectedRevision: 0, definition: { tasks: [{ parentTaskId: null, goal: 'New task', scope: 'New scope', acceptance: ['Review new task'] }] } },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Visible task' }))
  fireEvent.click(screen.getByRole('button', { name: zh.myContext }))
  await screen.findByText('Original saved goal')
  expect(screen.getByText(zh.contextReadonly)).toBeTruthy()
  expect(screen.queryByRole('textbox', { name: /send|message/i })).toBeNull()
})

it('shows the saved context revision separately when the current task has changed', async () => {
  const h = fixture(), original = h.page.items[0]!
  h.page.items = [{ ...original, revision: workgraphVersionSchema.parse({ ...h.version, revision: 2 }).revision }]
  h.context.mockResolvedValue({ generation: 1, result: {
    sessionId: 'organization-context:test' as import('@deepseek-ai/dsh-session').SessionId, mode: 'pre-execution',
    owner: { serverId: brandString(randomUUID()), accountId: brandString(randomUUID()), organizationId: h.project.organizationId,
      planId: h.version.planId, taskId: original.id, version: 1 }, snapshot: original,
  } })
  render(<Workbench {...h.props} project={h.project} onBack={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Visible task' }))
  fireEvent.click(screen.getByRole('button', { name: zh.myContext }))
  await screen.findByText(zh.contextOldVersion)
  expect(screen.getByText(zh.contextReadonly)).toBeTruthy()
  expect(screen.getAllByText('版本 1')).toHaveLength(1)
})


it('does not repeat a denied task request after native generation refresh and allows explicit retry', async () => {
  const h = fixture()
  h.connection.mockRejectedValueOnce(new Error('forbidden'))
  const view = render(<Workbench {...h.props} project={h.project} onBack={vi.fn()} />)
  await screen.findByText(zh.forbidden)
  h.setState({ generation: 2 })
  await act(async () => { view.rerender(<Workbench {...h.props} project={h.project} onBack={vi.fn()} />) })
  expect(h.connection).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole('button', { name: zh.searchAction }))
  await screen.findByRole('button', { name: 'Visible task' })
  expect(h.connection).toHaveBeenCalledTimes(2)
})


it('edits selected task access using names and the displayed grant version without identifier inputs', async () => {
  const h = fixture(), task = h.page.items[0]!, memberId = h.version.createdBy
  h.setState({ members: [{ id: memberId, accountId: brandString(randomUUID()), username: 'Alice', enabled: true,
    accountEnabled: true, accountVersion: 1, role: 'member', version: 1 }] })
  h.connection.mockImplementation(async action => action.kind === 'workgraph-grants' ? h.reply({ kind: 'grants', value: [{
    planId: task.planId, taskId: task.id, membershipId: memberId, scope: 'node', actions: ['read'], active: true, version: 8,
  }] }) : {})
  render(<TaskGrants {...h.props} projectId={h.project.id} task={task} />)
  fireEvent.click(await screen.findByRole('button', { name: /Alice/ }))
  expect(screen.queryByLabelText(zh.planId)).toBeNull()
  expect(screen.queryByLabelText(zh.taskId)).toBeNull()
  fireEvent.change(screen.getByRole('combobox', { name: zh.accessLevel }), { target: { value: 'none' } })
  fireEvent.click(screen.getByRole('button', { name: zh.saveAccess }))
  await screen.findByText(zh.accessSaved)
  expect(h.connection.mock.calls.find(([action]) => action.kind === 'workgraph-grant')?.[0]).toMatchObject({ request: {
    planId: task.planId, taskId: task.id, membershipId: memberId, scope: 'node', actions: [], expectedVersion: 8,
  } })
  expect(h.connection.mock.calls.some(([action]) => action.kind === 'workgraph-read')).toBe(false)
})
