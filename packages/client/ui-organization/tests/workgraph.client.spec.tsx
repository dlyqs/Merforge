// @vitest-environment jsdom
/** Task interaction regressions run with DOM controls only, without a browser or page. */
import { useSyncExternalStore } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { OrganizationDesktopSnapshot, ConnectionResult } from '@deepseek-ai/dsh-organization-connection/types'
import { workgraphPageSchema, workgraphVersionSchema } from '@deepseek-ai/dsh-organization/workgraph'
import { randomUUID } from 'node:crypto'
import type { OrganizationProps } from '../src/client/contract.ts'
import { OrganizationTaskList, OrganizationTasks } from '../src/client/Tasks.tsx'
import { createOrganizationTaskStore } from '../src/client/task-store.ts'
import { OrganizationHierarchy } from '../src/client/Hierarchy.tsx'
import { MemberSelect } from '../src/client/MemberSelect.tsx'
import { readNavigationProjects } from '../src/client/projects.ts'
import { ProjectDetails } from '../src/client/Project.tsx'
import { Workbench } from '../src/client/Workbench.tsx'
import { TaskSharing } from '../src/client/TaskSharing.tsx'
import { TaskCanvas } from '../src/client/TaskCanvas.tsx'
import { OrganizationDialog } from '../src/client/OrganizationDialog.tsx'
import { zh } from '../src/client/locales.ts'
import { taskRows } from '../src/client/workgraph-view.ts'
import { brandString } from '@deepseek-ai/dsh-brand'
import { workgraphSharingViewSchema } from '@deepseek-ai/dsh-organization/workgraph'

afterEach(cleanup)
function fixture() {
  const organizationId = brandString<import('@deepseek-ai/dsh-organization/types').OrganizationId>(randomUUID())
  const project = { id: brandString<import('@deepseek-ai/dsh-organization/types').OrganizationProjectId>(randomUUID()), organizationId, name: 'Shared project', version: 1, createdBy: brandString<import('@deepseek-ai/dsh-organization/types').AccountId>(randomUUID()), background: 'Product background', summary: 'Project overview', goal: 'Release goal' }
  const member = brandString<import('@deepseek-ai/dsh-organization/types').MembershipId>(randomUUID())
  const version = workgraphVersionSchema.parse({ organizationId, projectId: project.id, planId: randomUUID(), revision: 1,
    createdBy: member, createdAt: 1,
    definition: { taskId: '10000000-0000-4000-8000-000000000001', phases: [{ id: '10000000-0000-4000-8000-000000000002', title: 'Preparation' }], tasks: [{
      id: '10000000-0000-4000-8000-000000000001', parentTaskId: null, phaseId: '10000000-0000-4000-8000-000000000002', goal: 'Visible task',
      scope: 'Authorized scope',
      acceptance: ['Review'], artifacts: [], required: true, dependsOn: [], suggestedMembershipId: null,
    }] } })
  const page = workgraphPageSchema.parse({ items: [{ ...version.definition.tasks[0], planId: version.planId, revision: 1, phaseTitle: 'Preparation', assignable: false, hasUndisclosedPrerequisite: true }], total: 1, offset: 0, revision: 1, cursor: 'cursor' })
  let state: OrganizationDesktopSnapshot = { connection: { identityGeneration: 1, revision: 1, generation: 1, phase: 'ready', mode: 'organization', organizationId, principal: { accountId: project.createdBy, serverId: brandString(randomUUID()) },
    organizations: [{ id: organizationId, membershipId: member, name: 'Team', role: 'member', version: 1 }], members: [],
    projects: { items: [project], offset: 0, total: 1, revision: 1, cursor: page.cursor } },
  server: { phase: 'disabled', settings: { host: 'localhost', port: 19487, names: [], restoreOnLaunch: false } } }
  const reply = (result: NonNullable<ConnectionResult['workgraph']>['result']): ConnectionResult => ({ workgraph: {
    generation: state.connection.generation, requestId: brandString(randomUUID()), organizationId,
    principal: { serverId: brandString(randomUUID()), accountId: brandString(randomUUID()), organizationId, membershipId: member, role: 'member' }, result,
  } })
  const connection = vi.fn<OrganizationProps['connection']>(async (action) => {
    if (action.kind === 'project-page') return { generation: state.connection.generation, projects: state.connection.projects }
    if (action.kind === 'workgraph-tasks') return reply({ kind: 'tasks', value: page })
    if (action.kind === 'workgraph-read') return reply({ kind: 'plan', value: version })
    if (action.kind === 'assignment-inbox') return { assignment: { generation: 1, result: { kind: 'inbox', value: { items: [], total: 0, unread: 0, offset: 0, revision: 1, cursor: brandString('cursor') } } } }
    return {}
  })
  const context = vi.fn<OrganizationProps['context']>()
  const props: OrganizationProps = { connection, context, available: true, server: vi.fn(), secret: vi.fn(),
    t: makeTranslate(zh), useModelCatalogRevision: selector => selector(0), useOrganization: selector => selector(state) }
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
  h.connection.mockImplementation(async (action) => { if (action.kind === 'workgraph-save') throw new Error('unavailable')
    return base(action) })
  fireEvent.click(screen.getByRole('button', { name: zh.saveTask }))
  await screen.findByText(zh.unavailable)
  expect((screen.getByLabelText(zh.taskGoal)).value).toBe('Local edit')
  h.connection.mockImplementation(async (action) => { if (action.kind === 'workgraph-save') throw new Error('version-conflict')
    return base(action) })
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
it('opens project information in the main destination and removes the manual task workbench', async () => {
  const h = fixture(), openProject = vi.fn(), onClose = vi.fn()
  render(<OrganizationDialog {...h.props} openProject={openProject} initialSection="projects" onClose={onClose} />)
  fireEvent.click(screen.getByRole('button', { name: zh.viewProject }))
  expect(openProject).toHaveBeenCalledWith(h.project)
  expect(onClose).toHaveBeenCalledOnce()
  expect(screen.queryByRole('button', { name: zh.createTask })).toBeNull()
  expect(screen.queryByRole('button', { name: zh.taskPermissions })).toBeNull()
  expect(h.connection.mock.calls.some(([a]) => a.kind === 'workgraph-save')).toBe(false)
})
it('orders visible children after their parent without inventing off-page ancestors', () => {
  const h = fixture(), root = h.page.items[0]!
  const child = { ...root, id: brandString<import('@deepseek-ai/dsh-organization').OrganizationTaskId>(randomUUID()), parentTaskId: root.id }
  expect(taskRows([child, root]).map(row => row.depth)).toEqual([0, 1])
  expect(taskRows([child]).map(row => row.depth)).toEqual([0])
})
it('offers model-created tasks without a manual create task action', async () => {
  const h = fixture()
  render(<Workbench {...h.props} project={h.project} onBack={vi.fn()} />)
  await screen.findByRole('button', { name: 'Visible task' })
  expect(screen.queryByRole('button', { name: zh.createTask })).toBeNull()
  expect(screen.queryByRole('button', { name: zh.taskPermissions })).toBeNull()
  expect(h.connection.mock.calls.some(([a]) => a.kind === 'workgraph-save')).toBe(false)
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


it('does not repeat denied task reads during refresh and removes task search controls', async () => {
  const h = fixture()
  const base = h.connection.getMockImplementation()!
  let denied = false
  h.connection.mockImplementation(async (action) => {
    if (action.kind === 'workgraph-tasks' && !denied) { denied = true; throw new Error('forbidden') }
    return base(action)
  })
  const view = render(<Workbench {...h.props} project={h.project} onBack={vi.fn()} />)
  await screen.findByText(zh.forbidden)
  h.setState({ generation: 2 })
  await act(async () => { view.rerender(<Workbench {...h.props} project={h.project} onBack={vi.fn()} />) })
  expect(h.connection.mock.calls.filter(([action]) => action.kind === 'workgraph-tasks')).toHaveLength(1)
  expect(screen.queryByRole('button', { name: zh.searchAction })).toBeNull()
  expect(screen.queryByRole('textbox')).toBeNull()
})


it('loads navigation pages with a consistent cursor independently of workspace search and rejects late identities', async () => {
  const h = fixture(), second = { ...h.project, id: brandString<typeof h.project.id>(randomUUID()), name: 'Second project' }
  h.connection.mockImplementation(async action => action.kind === 'project-page' ? { generation: 1,
    projects: { items: action.offset ? [second] : [h.project], total: 2, offset: action.offset, revision: 1, cursor: h.page.cursor } } : {})
  expect(await readNavigationProjects(h.connection, 1, () => true)).toEqual([h.project, second])
  expect(h.connection).toHaveBeenNthCalledWith(2, { kind: 'project-page', offset: 1, cursor: h.page.cursor })
  expect(await readNavigationProjects(h.connection, 2, () => true)).toBeUndefined()
})
it('selects a paginated authorized task node without assigning or starting it', async () => {
  const h = fixture(), second = { ...h.page.items[0]!, id: brandString<import('@deepseek-ai/dsh-organization').OrganizationTaskId>(randomUUID()), goal: 'Next node' }
  const principal = { serverId: brandString<import('@deepseek-ai/dsh-organization').ServerId>(randomUUID()), accountId: brandString<import('@deepseek-ai/dsh-organization').AccountId>(randomUUID()) }
  h.setState({ principal })
  h.connection.mockImplementation(async (action) => {
    if (action.kind === 'project-page') return { generation: 1, projects: { items: [h.project], total: 1, offset: 0, revision: 1, cursor: h.page.cursor } }
    if (action.kind === 'workgraph-tasks') {
      const request = action.request as { offset: number }
      return h.reply({ kind: 'tasks', value: { ...h.page, items: request.offset ? [second] : h.page.items, total: 2, offset: request.offset } })
    }
    if (action.kind === 'assignment-inbox') return { assignment: { generation: 1, result: { kind: 'inbox', value: { items: [], total: 0, unread: 0, offset: 0, revision: 1, cursor: brandString('cursor') } } } }
    return {}
  })
  const store = createOrganizationTaskStore().create(), openTasks = vi.fn()
  render(<OrganizationTaskList {...h.props} useStore={selector => selector(store.getSnapshot())} actions={store.actions}
    openTasks={openTasks} />)
  fireEvent.click(await screen.findByRole('button', { name: second.goal }))
  expect(store.getSnapshot().selected).toEqual({ ...principal, organizationId: h.project.organizationId, projectId: h.project.id,
    planId: second.planId, taskId: second.id })
  expect(openTasks).toHaveBeenCalledOnce()
  expect(h.connection.mock.calls.some(([action]) => action.kind === 'assignment-command' || action.kind === 'execution-command')).toBe(false)
  expect(h.connection.mock.calls.filter(([action]) => action.kind === 'workgraph-tasks')[1]?.[0]).toMatchObject({ request: { offset: 1, cursor: h.page.cursor } })
})
it('shows self and direct reports in the assignment selector and keeps indirect reports out', () => {
  const h = fixture(), c = h.props.useOrganization(s => s.connection), own = c.organizations[0]!.membershipId
  const lead = brandString<typeof own>(randomUUID()), junior = brandString<typeof own>(randomUUID())
  const peer = brandString<typeof own>(randomUUID())
  c.hierarchy = [{ id: own, username: 'Manager', role: 'member', enabled: true, supervisorId: null, version: 0 },
    { id: lead, username: 'Direct report', role: 'member', enabled: true, supervisorId: own, version: 1 },
    { id: junior, username: 'Indirect report', role: 'member', enabled: true, supervisorId: lead, version: 1 },
    { id: peer, username: 'Peer', role: 'member', enabled: true, supervisorId: null, version: 0 }]
  render(<MemberSelect t={h.props.t} connection={c} labelKey="assignee" value="" change={vi.fn()} assignableOnly />)
  expect(screen.getByRole('option', { name: /Manager/ })).toBeTruthy()
  expect(screen.getByRole('option', { name: 'Direct report' })).toBeTruthy()
  expect(screen.queryByRole('option', { name: 'Indirect report' })).toBeNull()
  expect(screen.queryByRole('option', { name: 'Peer' })).toBeNull()
})
it('draws reporting members and only administrators can explicitly save a new supervisor', async () => {
  const h = fixture(), org = h.props.useOrganization(s => s.connection.organizations[0]!)
  const own = org.membershipId, child = brandString<typeof own>(randomUUID())
  const nodes = [{ id: own, username: 'Manager', role: 'member' as const, enabled: true, supervisorId: null, version: 0 },
    { id: child, username: 'Employee', role: 'member' as const, enabled: true, supervisorId: own, version: 4 }]
  h.connection.mockImplementation(async action => action.kind === 'hierarchy' ? { hierarchy: nodes, generation: 1 } : {})
  const view = render(<OrganizationHierarchy {...h.props} />)
  fireEvent.click(await screen.findByRole('button', { name: /Employee/ }))
  expect(screen.queryByLabelText(zh.directSupervisor)).toBeNull()
  expect(h.connection.mock.calls.some(([action]) => action.kind === 'command')).toBe(false)
  h.setState({ organizations: [{ ...org, role: 'admin' }] }); view.rerender(<OrganizationHierarchy {...h.props} />)
  fireEvent.change(screen.getByLabelText(zh.directSupervisor), { target: { value: '' } })
  fireEvent.click(screen.getByRole('button', { name: zh.save }))
  await waitFor(() => { expect(h.connection.mock.calls.find(([action]) => action.kind === 'command')?.[0]).toMatchObject({ command: {
    kind: 'set-supervisor', membershipId: child, supervisorId: null, expectedVersion: 4, organizationId: h.project.organizationId } }) })
})

it('selects task nodes in the main canvas and keeps assignment controls in the right detail area', async () => {
  const h = fixture(), root = h.page.items[0]!
  const child = { ...root, id: brandString<typeof root.id>(randomUUID()), parentTaskId: root.id, goal: 'Assigned child', scope: 'Child scope' }
  const principal = { serverId: brandString<import('@deepseek-ai/dsh-organization').ServerId>(randomUUID()), accountId: brandString<import('@deepseek-ai/dsh-organization').AccountId>(randomUUID()) }
  h.setState({ principal })
  const base = h.connection.getMockImplementation()!
  h.connection.mockImplementation(async (action) => {
    if (action.kind === 'workgraph-tasks') return h.reply({ kind: 'tasks', value: { ...h.page, items: [root, child], total: 2 } })
    if (action.kind === 'assignment-tasks') return { assignment: { generation: 1, result: { kind: 'tasks',
      value: { items: [], total: 0, offset: 0, cursor: h.page.cursor } } } }
    return base(action)
  })
  const store = createOrganizationTaskStore().create()
  store.actions.selectTask({ ...principal, organizationId: h.project.organizationId, projectId: h.project.id,
    planId: root.planId, taskId: root.id })
  const props = { ...h.props, actions: store.actions, openTasks: vi.fn(),
    useStore: <T,>(selector: (state: ReturnType<typeof store.getSnapshot>) => T) =>
      selector(useSyncExternalStore(callback => store.subscribe(callback), () => store.getSnapshot())) }
  const view = render(<OrganizationTasks {...props} />)
  fireEvent.click(await screen.findByRole('button', { name: child.goal }))
  const detail = await screen.findByRole('region', { name: zh.taskDetail })
  expect(await within(detail).findByText(child.scope)).toBeTruthy()
  expect(await within(detail).findByLabelText(zh.assignee)).toBeTruthy()
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(h.connection.mock.calls.some(([action]) => action.kind === 'assignment-command' || action.kind === 'execution-command')).toBe(false)
  h.setState({ generation: 2, phase: 'offline' }); view.rerender(<OrganizationTasks {...props} />)
  expect(screen.queryByRole('region', { name: zh.taskDetail })).toBeNull()
})

it('edits owner project information and opens a task from the project page', async () => {
  const h = fixture(), openTask = vi.fn()
  render(<ProjectDetails {...h.props} project={h.project} openTask={openTask} />)
  const background = await screen.findByLabelText(zh.projectBackground)
  expect(background.value).toBe('Product background')
  fireEvent.change(background, { target: { value: 'Updated project background' } })
  fireEvent.click(screen.getByRole('button', { name: zh.save }))
  await waitFor(() => { expect(h.connection.mock.calls.find(([action]) => action.kind === 'command')?.[0]).toMatchObject({ kind: 'command', command: {
    kind: 'update-project', projectId: h.project.id, expectedVersion: 1, background: 'Updated project background', summary: 'Project overview', goal: 'Release goal',
  } }) })
  fireEvent.click(screen.getByRole('button', { name: 'Visible task' }))
  expect(openTask).toHaveBeenCalledWith(h.project, h.page.items[0])
})
it('shows project context to participants with read-only fields and no save action', async () => {
  const h = fixture()
  h.project.createdBy = brandString(randomUUID())
  render(<ProjectDetails {...h.props} project={h.project} />)
  const background = await screen.findByLabelText(zh.projectBackground)
  expect(background.readOnly).toBe(true)
  expect(screen.getByLabelText(zh.projectName).readOnly).toBe(true)
  expect(screen.queryByRole('button', { name: zh.save })).toBeNull()
  expect(h.connection.mock.calls.some(([action]) => action.kind === 'command')).toBe(false)
})
it('removes the inbox tab from the organization workbench', () => {
  const h = fixture()
  render(<OrganizationDialog {...h.props} initialSection="projects" onClose={vi.fn()} />)
  expect(screen.queryByRole('button', { name: '待我处理' })).toBeNull()
})

it.each([true, false])('confirms task removal outside the canvas using current creator permission %s', async creator => {
  const h = fixture(), base = h.connection.getMockImplementation()!, onBack = vi.fn()
  h.connection.mockImplementation(async action => action.kind === 'workgraph-removal'
    ? { generation: 1, planRemoval: { global: creator, local: !creator, revision: h.version.revision } } : base(action))
  render(<Workbench {...h.props} project={h.project} planId={h.version.planId} initialTaskId={h.page.items[0]!.id} onBack={onBack} />)
  const label = creator ? zh.deleteTask : zh.removeLocalTask
  const button = await screen.findByRole('button', { name: label })
  expect(button.closest('[data-task-canvas]')).toBeNull()
  expect(screen.queryByRole('button', { name: zh.back })).toBeNull()
  expect(screen.queryByText(h.project.name)).toBeNull()
  fireEvent.click(button)
  const dialog = screen.getByRole('dialog')
  expect(within(dialog).getByText(creator ? zh.deleteSharedTaskHint : zh.removeLocalTaskHint)).toBeTruthy()
  fireEvent.click(within(dialog).getByRole('button', { name: label }))
  await waitFor(() => { expect(onBack).toHaveBeenCalledOnce() })
  expect(h.connection).toHaveBeenCalledWith({ kind: creator ? 'workgraph-delete' : 'remove-plan', request: {
    organizationId: h.project.organizationId, projectId: h.project.id, planId: h.version.planId,
    ...(creator ? { expectedRevision: h.version.revision, operationId: expect.any(String) } : {}) } })
})

it('lets the creator edit shared background independently of the task definition', async () => {
  const h = fixture()
  let sharing = workgraphSharingViewSchema.parse({ sharedContext: 'Creator decisions and constraints', version: 1,
    canEdit: true, fullTreeVisible: true, canRequest: false, requests: [] })
  h.connection.mockImplementation(async action => {
    if (action.kind === 'workgraph-sharing') return { generation: 1, sharing }
    if (action.kind === 'workgraph-share') {
      sharing = { ...sharing, sharedContext: 'Updated constraints', version: 2 }
      return { generation: 1 }
    }
    return {}
  })
  render(<TaskSharing {...h.props} projectId={h.project.id} planId={h.version.planId} />)
  await screen.findByText(sharing.sharedContext)
  fireEvent.click(screen.getByRole('button', { name: zh.editSharedContext }))
  fireEvent.change(screen.getByRole('textbox', { name: zh.sharedTaskContext }), { target: { value: 'Updated constraints' } })
  fireEvent.click(screen.getByRole('button', { name: zh.save }))
  await screen.findByText('Updated constraints')
  expect(h.connection).toHaveBeenCalledWith({ kind: 'workgraph-share', request: {
    organizationId: h.project.organizationId, projectId: h.project.id, planId: h.version.planId,
    kind: 'edit-context', expectedVersion: 1, sharedContext: 'Updated constraints', operationId: expect.any(String),
  } })
  expect(h.connection.mock.calls.some(([action]) => action.kind === 'workgraph-save')).toBe(false)
})

it('shows employee request state and keeps background editing creator-only', async () => {
  const h = fixture(), member = h.props.useOrganization(s => s.connection.organizations[0]!.membershipId)
  let sharing = workgraphSharingViewSchema.parse({ sharedContext: 'Shared task purpose', version: 1,
    canEdit: false, fullTreeVisible: false, canRequest: true, requests: [] })
  h.connection.mockImplementation(async action => {
    if (action.kind === 'workgraph-sharing') return { generation: 1, sharing }
    if (action.kind === 'workgraph-share') {
      sharing = { ...sharing, requests: [{ id: brandString(randomUUID()), planId: h.version.planId, membershipId: member,
        state: 'pending', structureVersion: 1, version: 2, username: 'Employee' }] }
      return { generation: 1 }
    }
    return {}
  })
  render(<TaskSharing {...h.props} projectId={h.project.id} planId={h.version.planId} />)
  fireEvent.click(await screen.findByRole('button', { name: zh.requestFullTree }))
  await screen.findByText(zh.treeRequestPending)
  expect(screen.getByRole('button', { name: zh.requestFullTree }).disabled).toBe(true)
  expect(screen.queryByRole('button', { name: zh.editSharedContext })).toBeNull()
  expect(h.connection.mock.calls.find(([action]) => action.kind === 'workgraph-share')?.[0])
    .toMatchObject({ request: { kind: 'request-tree', planId: h.version.planId } })
})

it('retains creator request decisions and marks the employee node in the task map', async () => {
  const h = fixture(), member = h.props.useOrganization(s => s.connection.organizations[0]!.membershipId)
  const request = { id: brandString<import('@deepseek-ai/dsh-brand').Branded<'OrganizationTreeRequestId'>>(randomUUID()),
    planId: h.version.planId, membershipId: member, state: 'pending' as const, structureVersion: 1, version: 3, username: 'Employee' }
  const sharing = workgraphSharingViewSchema.parse({ sharedContext: 'Shared context', version: 1,
    canEdit: true, fullTreeVisible: true, canRequest: false, requests: [request] })
  h.connection.mockImplementation(async action => action.kind === 'workgraph-sharing' ? { generation: 1, sharing } : {})
  render(<TaskCanvas tasks={[{ ...h.page.items[0]!, assignedToMe: true }]} selected={h.page.items[0]!.id}
    onSelect={vi.fn()} t={h.props.t} introduction={<TaskSharing {...h.props} projectId={h.project.id} planId={h.version.planId} />} />)
  expect(screen.getByText(zh.assignedToMe)).toBeTruthy()
  fireEvent.click(await screen.findByRole('button', { name: zh.approveTreeRequest }))
  await waitFor(() => { expect(h.connection).toHaveBeenCalledWith({ kind: 'workgraph-share', request: {
    organizationId: h.project.organizationId, projectId: h.project.id, planId: h.version.planId,
    kind: 'decide-tree', requestId: request.id, expectedVersion: 3, answer: 'approved', operationId: expect.any(String),
  } }) })
  expect(screen.getByRole('button', { name: zh.approveTreeRequest }).closest('[data-fullscreen]')).toBeTruthy()
})

it('discards delayed shared background after the native identity generation retires', async () => {
  const h = fixture(), late = Promise.withResolvers<ConnectionResult>()
  h.connection.mockReturnValue(late.promise)
  const view = render(<TaskSharing {...h.props} projectId={h.project.id} planId={h.version.planId} />)
  h.setState({ phase: 'offline', generation: 2 })
  view.rerender(<TaskSharing {...h.props} projectId={h.project.id} planId={h.version.planId} />)
  await act(async () => { late.resolve({ generation: 1, sharing: workgraphSharingViewSchema.parse({
    sharedContext: 'Retired account context', version: 1, canEdit: true, fullTreeVisible: true, canRequest: false, requests: [],
  }) }) })
  expect(screen.queryByText('Retired account context')).toBeNull()
  expect(screen.queryByRole('button', { name: zh.editSharedContext })).toBeNull()
})
