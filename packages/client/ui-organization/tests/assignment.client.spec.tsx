// @vitest-environment jsdom
/** Explicit preparation gestures and stale-content behavior without opening a browser. */
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { randomUUID } from 'node:crypto'
import { brandString } from '@deepseek-ai/dsh-brand'
import { preparationSchema, taskAssignmentsPageSchema } from '@deepseek-ai/dsh-organization/assignment'
import { workgraphPageSchema } from '@deepseek-ai/dsh-organization/workgraph'
import type { ConnectionResult, OrganizationDesktopSnapshot } from '@deepseek-ai/dsh-organization-connection/types'
import type { OrganizationProps } from '../src/client/contract.ts'
import { AssignmentPanel } from '../src/client/AssignmentPanel.tsx'
import { ExecutionPanel } from '../src/client/ExecutionPanel.tsx'
import { executionViewSchema, executionCommandSchema } from '@deepseek-ai/dsh-organization/execution'
import { ConversationTask } from '../src/client/ConversationTask.tsx'
import { AssignmentBatch } from '../src/client/AssignmentBatch.tsx'
import { assignmentBatchRequestSchema } from '../../../host/organization-connection/src/assignment-batch.ts'
import { Inbox } from '../src/client/Inbox.tsx'
import { zh } from '../src/client/locales.ts'
afterEach(cleanup)

it('pages authorized Run history without starting execution and hides it when offline', async () => {
  const h = fixture(true), base = h.connection.getMockImplementation()!
  const a = h.prep.assignment, deviceId = randomUUID(), executionDelegationId = randomUUID()
  const selector = { organizationId: a.organizationId, projectId: a.projectId, planId: a.planId,
    assignmentId: a.id, planRevision: a.planRevision, deviceId }
  const view = executionViewSchema.parse({
    run: { ...selector, id: randomUUID(), executionDelegationId, serverEpoch: randomUUID(), fencingEpoch: 1,
      configDigest: 'a'.repeat(64), state: 'paused', createdRevision: 3, version: 3 },
    delegation: { ...selector, id: executionDelegationId, delegationId: randomUUID(), capabilities: ['model'],
      configDigest: 'a'.repeat(64), state: 'active', budget: 10, used: 1, expiresAt: Date.now() + 60000,
      createdRevision: 3, version: 3 }, actions: [], serverTime: Date.now(), eligible: false, modelPolicy: [],
    assigneeId: a.assigneeId, approvedBy: a.approvedBy, humanRequests: [],
  })
  h.connection.mockImplementation(async (action) => {
    if (action.kind === 'execution-list') return { generation: 1, executions: { items: [view.run], total: 2,
      offset: (action.request as { offset: number }).offset } }
    if (action.kind === 'execution-read') return { generation: 1, execution: view }
    return base(action)
  })
  const rendered = render(<ExecutionPanel {...h.props} task={h.task} projectId={h.projectId} current />)
  fireEvent.click(await screen.findByRole('button', { name: zh.next }))
  await waitFor(() => {
    expect(h.connection.mock.calls.some(([action]) => action.kind === 'execution-list'
      && (action.request as { offset: number }).offset === 1)).toBe(true)
  })
  expect(h.props.execution).not.toHaveBeenCalled()
  expect(h.connection.mock.calls.some(([action]) => action.kind === 'execution-command')).toBe(false)
  h.offline(); rendered.rerender(<ExecutionPanel {...h.props} task={h.task} projectId={h.projectId} current={false} />)
  expect(screen.queryByRole('button', { name: zh.executionTranscript })).toBeNull()
})

it('reports a failed execution history read instead of silently hiding the failure', async () => {
  const h = fixture(true)
  h.connection.mockRejectedValue(new Error('forbidden'))
  render(<ExecutionPanel {...h.props} task={h.task} projectId={h.projectId} current />)
  await screen.findByText(zh.forbidden)
})

function fixture(approved: boolean, admin = false) {
  const organizationId = brandString<import('@deepseek-ai/dsh-organization').OrganizationId>(randomUUID())
  const projectId = brandString<import('@deepseek-ai/dsh-organization').OrganizationProjectId>(randomUUID())
  const memberId = brandString<import('@deepseek-ai/dsh-organization').MembershipId>(randomUUID())
  const task = workgraphPageSchema.parse({ items: [{ id: randomUUID(), planId: randomUUID(), revision: 1,
    phaseId: randomUUID(), phaseTitle: 'Preparation', parentTaskId: null, goal: 'Visible target', scope: 'Limited scope', acceptance: ['Review'],
    artifacts: [], required: true, dependsOn: [], suggestedMembershipId: memberId, assignable: true, hasUndisclosedPrerequisite: false }],
  total: 1, offset: 0, revision: 1, cursor: 'cursor' }).items[0]!
  const id = randomUUID()
  const prep = preparationSchema.parse({ serverTime: 100, delegationMaxBudget: 100, delegationMaxDurationMs: 3600000,
    assignment: { id, organizationId, projectId, planId: task.planId, taskId: task.id, planRevision: 1,
      approvedBy: randomUUID(), assigneeId: memberId, state: 'pending', reason: null, createdAt: 1, createdRevision: 2, version: 2 },
    request: { id: randomUUID(), assignmentId: id, kind: 'accept-assignment', state: 'pending', expiresAt: null, answeredRevision: null },
    delegations: [], lease: null })
  const history = taskAssignmentsPageSchema.parse({ items: approved ? [prep.assignment] : [], total: approved ? 1 : 0, offset: 0, revision: 2, cursor: 'cursor' })
  const item = { assignment: prep.assignment, request: prep.request, notificationId: brandString<import('@deepseek-ai/dsh-organization').OrganizationNotificationId>(randomUUID()), readAt: null }
  let state: OrganizationDesktopSnapshot = { connection: { revision: 1, generation: 1, phase: 'ready', mode: 'organization', organizationId,
    organizations: [{ id: organizationId, membershipId: memberId, name: 'Team', role: admin ? 'admin' : 'member', version: 1 }], members: admin ? [{ id: memberId, username: 'Alice', accountId: brandString(randomUUID()), accountVersion: 1, accountEnabled: true, enabled: true, version: 1, role: 'member' }] : [] },
  server: { phase: 'disabled', settings: { host: 'localhost', port: 19487, names: [], restoreOnLaunch: false } } }
  const reply = (result: NonNullable<ConnectionResult['assignment']>['result']): ConnectionResult => ({ assignment: { generation: state.connection.generation, result } })
  const connection = vi.fn<OrganizationProps['connection']>(async (action) => {
    if (action.kind === 'assignment-review') return reply({ kind: 'review', value: { planRevision: task.revision, assigneeId: memberId, assigneeCanRead: true } })
    if (action.kind === 'assignment-tasks') return reply({ kind: 'tasks', value: history })
    if (action.kind === 'assignment-preparation') return reply({ kind: 'preparation', value: prep })
    if (action.kind === 'device-read') return reply({ kind: 'device', value: null })
    if (action.kind === 'assignment-inbox') return reply({ kind: 'inbox', value: { items: [item], total: 1, unread: 1, offset: 0, revision: 2, cursor: brandString('cursor') } })
    if (action.kind === 'assignment-participant') {
      const input = action.request as { kind: string }
      if (input.kind === 'answer-assignment') {
        prep.assignment.state = 'accepted'; prep.request.state = 'accepted'
      }
    }
    return {}
  })
  const props: OrganizationProps = { connection, context: vi.fn(), execution: vi.fn(), executionReport: vi.fn(),
    available: true, server: vi.fn(), secret: vi.fn(),
    t: makeTranslate(zh), useModelCatalogRevision: selector => selector(0), useOrganization: selector => selector(state) }
  return { props, task, projectId, connection, prep,
    offline: () => { state = { ...state, connection: { ...state.connection, generation: 2, phase: 'offline' } } } }
}
it('requires version confirmation before approval and preserves the assignee draft after a refusal', async () => {
  const h = fixture(false), base = h.connection.getMockImplementation()!
  h.connection.mockImplementation(async (action) => { if (action.kind === 'assignment-command') throw new Error('forbidden'); return base(action) })
  render(<AssignmentPanel {...h.props} task={h.task} projectId={h.projectId} current />)
  const approve = await screen.findByRole('button', { name: zh.approveAssignment })
  expect((approve as HTMLButtonElement).disabled).toBe(true)
  await screen.findByText(zh.approvalAccessReady)
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.click(approve)
  await screen.findByText(zh.forbidden)
  expect((screen.getByLabelText(zh.assignee)).value).toBe(h.task.suggestedMembershipId)
  const writes = h.connection.mock.calls.map(([action]) => action).filter(action => action.kind === 'assignment-command')
  expect(writes).toHaveLength(1)
  expect(writes[0]).toMatchObject({ request: { kind: 'approve-assignment', planRevision: 1, taskId: h.task.id } })
  expect(h.connection.mock.calls.some(([action]) => action.kind === 'workgraph-grant' || action.kind === 'command')).toBe(false)
})
it('accepts without delegating or claiming and hides old details when offline', async () => {
  const h = fixture(true)
  const view = render(<AssignmentPanel {...h.props} task={h.task} projectId={h.projectId} current />)
  fireEvent.click(await screen.findByRole('button', { name: zh.acceptAssignment }))
  await screen.findByRole('button', { name: zh.registerDevice })
  expect(h.connection.mock.calls.some(([action]) => action.kind === 'assignment-delegate' || action.kind === 'lease-claim')).toBe(false)
  expect(screen.getByText(zh.preparationOnly)).toBeTruthy()
  h.offline(); view.rerender(<AssignmentPanel {...h.props} task={h.task} projectId={h.projectId} current={false} />)
  expect(screen.queryByText(h.prep.assignment.approvedBy)).toBeNull()
  expect(screen.queryByRole('button', { name: zh.registerDevice })).toBeNull()
  expect(screen.getByRole('status').textContent).toBe(zh.qualificationRecheck)
})
it('marks a persistent notification read without answering and queries the processed view explicitly', async () => {
  const h = fixture(true)
  render(<Inbox {...h.props} />)
  fireEvent.click(await screen.findByRole('button', { name: zh.markReadOnly }))
  await waitFor(() => {
    const action = h.connection.mock.calls.find(([action]) => action.kind === 'assignment-participant')?.[0]
    expect(action && 'request' in action ? action.request : null).toMatchObject({ kind: 'read-notification' })
  })
  expect(h.prep.request.state).toBe('pending')
  fireEvent.click(screen.getByRole('button', { name: zh['inbox-processed'] }))
  await waitFor(() => {
    const action = h.connection.mock.calls.filter(([action]) => action.kind === 'assignment-inbox').at(-1)?.[0]
    expect(action && 'request' in action ? action.request : null).toMatchObject({ state: 'processed' })
  })
})

it('keeps dispatch disabled when the assignee has a visibility gap', async () => {
  const h = fixture(false), base = h.connection.getMockImplementation()!
  h.connection.mockImplementation(async (action) => {
    const result = await base(action)
    if (result.assignment?.result.kind === 'review') result.assignment.result.value.assigneeCanRead = false
    return result
  })
  render(<AssignmentPanel {...h.props} task={h.task} projectId={h.projectId} current />)
  await screen.findByText(zh.approvalAccessMissing)
  expect(screen.getByRole<HTMLButtonElement>('button', { name: zh.approveAssignment }).disabled).toBe(true)
  expect(h.connection.mock.calls.some(([action]) => action.kind === 'assignment-command')).toBe(false)
})


it('grants only missing read access in place, preserves project write and still requires explicit dispatch', async () => {
  const h = fixture(false, true), base = h.connection.getMockImplementation()!
  let shared = false
  h.connection.mockImplementation(async (action) => {
    if (action.kind === 'grants') return { grants: [{
      projectId: h.projectId, membershipId: h.prep.assignment.assigneeId, actions: ['write'], version: 7,
    }] }
    if (action.kind === 'workgraph-grants') return { workgraph: { generation: 1, requestId: brandString(randomUUID()),
      organizationId: h.prep.assignment.organizationId,
      principal: { serverId: brandString(randomUUID()), accountId: brandString(randomUUID()) },
      result: { kind: 'grants', value: [] } } }
    if (action.kind === 'workgraph-grant') { shared = true; return {} }
    const result = await base(action)
    if (result.assignment?.result.kind === 'review') result.assignment.result.value.assigneeCanRead = shared
    return result
  })
  render(<AssignmentPanel {...h.props} task={h.task} projectId={h.projectId} current />)
  expect(await screen.findByRole('option', { name: /Alice/ })).toBeTruthy()
  fireEvent.click(await screen.findByRole('button', { name: zh.shareTaskAccess }))
  await screen.findByText(zh.approvalAccessReady)
  expect(h.connection.mock.calls.find(([action]) => action.kind === 'command')?.[0]).toMatchObject({ command: {
    kind: 'set-grant', membershipId: h.prep.assignment.assigneeId, actions: ['read', 'write'], expectedVersion: 7,
  } })
  expect(h.connection.mock.calls.find(([action]) => action.kind === 'workgraph-grant')?.[0]).toMatchObject({ request: {
    taskId: h.task.id, planId: h.task.planId, membershipId: h.prep.assignment.assigneeId, scope: 'node', actions: ['read'], expectedVersion: 0,
  } })
  expect(screen.getByRole<HTMLButtonElement>('button', { name: zh.approveAssignment }).disabled).toBe(true)
  expect(h.connection.mock.calls.some(([action]) => action.kind === 'assignment-command')).toBe(false)
})

it('reports a partial access update without dispatching or replaying the failed write', async () => {
  const h = fixture(false, true), base = h.connection.getMockImplementation()!
  h.connection.mockImplementation(async (action) => {
    if (action.kind === 'grants') return { grants: [] }
    if (action.kind === 'workgraph-grants') throw new Error('unavailable')
    const result = await base(action)
    if (result.assignment?.result.kind === 'review') result.assignment.result.value.assigneeCanRead = false
    return result
  })
  render(<AssignmentPanel {...h.props} task={h.task} projectId={h.projectId} current />)
  fireEvent.click(await screen.findByRole('button', { name: zh.shareTaskAccess }))
  await screen.findByText(`${zh.partialAccessSaved} ${zh.unavailable}`)
  expect(h.connection.mock.calls.filter(([action]) => action.kind === 'command')).toHaveLength(1)
  expect(h.connection.mock.calls.some(([action]) => action.kind === 'assignment-command')).toBe(false)
})

it('selects native Codex without endpoint or file-tool controls and retains the exact failed grant draft', async () => {
  const h = fixture(true), base = h.connection.getMockImplementation()!
  const deviceId = brandString<import('@deepseek-ai/dsh-organization').OrganizationDeviceId>(randomUUID())
  const delegationId = brandString<import('@deepseek-ai/dsh-organization').OrganizationDelegationId>(randomUUID())
  const executionDelegationId = brandString<import('@deepseek-ai/dsh-organization').OrganizationExecutionDelegationId>(randomUUID())
  const runId = brandString<import('@deepseek-ai/dsh-organization').OrganizationRunId>(randomUUID())
  h.prep.assignment.state = 'accepted'
  const prepared = preparationSchema.parse({ ...h.prep, delegations: [{
    id: delegationId, assignmentId: h.prep.assignment.id, planRevision: 1,
    membershipId: h.prep.assignment.assigneeId, deviceId, executorId: 'desktop-builtin', capabilities: ['task-read'], budget: 3,
    expiresAt: 100000, state: 'active', createdRevision: 3, version: 3 }], lease: { assignmentId: h.prep.assignment.id, delegationId, deviceId, fencingEpoch: 1,
    serverEpoch: randomUUID(), expiresAt: 100000, state: 'held', createdRevision: 3, version: 3 } })
  h.prep.delegations = prepared.delegations; h.prep.lease = prepared.lease
  const openCodexSettings = vi.fn()
  h.props.openCodexSettings = openCodexSettings
  h.props.loadModels = vi.fn<NonNullable<OrganizationProps['loadModels']>>(async () => ({ default: { provider: 'codex', model: 'native-model' }, routableProviders: ['codex'],
    groups: [{ id: 'codex', backend: 'codex', name: 'Codex', models: [{ id: 'native-model', name: 'Native model',
      reasoning: { efforts: [{ id: 'medium', name: 'medium' }], defaultEffort: 'medium' } }] }], failures: [] }))
  const nativeCommand = (request: unknown) => {
    if (typeof request !== 'object' || request === null) throw new Error('invalid native command')
    return executionCommandSchema.parse({ ...request, deviceId })
  }
  let fail = true
  h.connection.mockImplementation(async (action) => {
    if (action.kind === 'execution-list') return { generation: 1, executions: { items: [], total: 0, offset: 0 } }
    if (action.kind === 'execution-command') {
      if (fail) { fail = false; throw new Error('unavailable') }
      const command = nativeCommand(action.request)
      return { receipt: { operationId: command.operationId, revision: 4,
        execution: { executionDelegationId, runId } } }
    }
    return base(action)
  })
  vi.mocked(h.props.execution).mockRejectedValue(new Error('native-execution-disabled'))
  render(<ExecutionPanel {...h.props} task={h.task} projectId={h.projectId} current />)
  const backend = await screen.findByLabelText(zh.executionBackend)
  fireEvent.change(backend, { target: { value: 'codex' } })
  fireEvent.click(screen.getByRole('button', { name: zh.openCodexSettings }))
  expect(openCodexSettings).toHaveBeenCalledOnce()
  expect(h.props.execution).not.toHaveBeenCalled()
  expect(screen.queryByLabelText(zh.executionEndpoint)).toBeNull()
  expect(screen.queryByLabelText(zh.executionRead)).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: zh.executionRefreshModels }))
  await screen.findByRole('option', { name: 'Native model' })
  fireEvent.change(screen.getByLabelText(zh.executionModel), { target: { value: 'native-model' } })
  for (const [label, value] of [[zh.executionDirectory, '/employee/work'], [zh.executionTurns, '3'],
    [zh.executionMinutes, '1'], [zh.executionMessage, 'Selected task input']] as const) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } })
  }
  fireEvent.click(screen.getByLabelText(zh.executionConfirm))
  fireEvent.click(screen.getByRole('button', { name: zh.executionStart }))
  await screen.findByText(zh.unavailable)
  h.prep.serverTime = 200
  fireEvent.click(screen.getByLabelText(zh.executionConfirm))
  fireEvent.click(screen.getByRole('button', { name: zh.executionStart }))
  await waitFor(() => { expect(h.props.execution).toHaveBeenCalledOnce() })
  const grants = h.connection.mock.calls.filter(([a]) => a.kind === 'execution-command'
    && nativeCommand(a.request).kind === 'grant-execution')
  expect(grants).toHaveLength(2); expect(grants[0]).toEqual(grants[1])
  expect(vi.mocked(h.props.execution).mock.calls[0]![0].inputs).toMatchObject({
    backend: { kind: 'codex', model: 'native-model', effort: 'medium' }, capabilities: ['codex-turn'],
  })
  expect(vi.mocked(h.props.execution).mock.calls[0]![0].inputs.endpoint).toBeUndefined()
})

it('uses the same explicit acceptance and execution controls inside a conversation without starting work on open', async () => {
  const h = fixture(true), base = h.connection.getMockImplementation()!
  h.connection.mockImplementation(async (action) => {
    if (action.kind === 'workgraph-tasks') return { workgraph: { generation: 1, requestId: brandString(randomUUID()),
      principal: { serverId: brandString(randomUUID()), accountId: brandString(randomUUID()) },
      organizationId: h.prep.assignment.organizationId,
      result: { kind: 'tasks', value: { items: [h.task], total: 1, offset: 0, revision: 1, cursor: brandString('cursor') } } } }
    return base(action)
  })
  render(<ConversationTask {...h.props} projectId={h.projectId} planId={h.task.planId}
    taskId={h.task.id} assignmentId={h.prep.assignment.id} />)
  const accept = await screen.findByRole('button', { name: zh.acceptAssignment })
  expect(screen.getByText(zh.executionTitle)).toBeTruthy()
  expect(screen.getByText(zh.integrationTitle)).toBeTruthy()
  expect(h.connection.mock.calls.every(([a]) => !['assignment-participant', 'execution-command', 'lease-claim', 'assignment-delegate'].includes(a.kind))).toBe(true)
  fireEvent.click(accept)
  await screen.findByRole('button', { name: zh.registerDevice })
  expect(h.connection.mock.calls.filter(([a]) => a.kind === 'assignment-participant')).toHaveLength(1)
  expect(h.props.execution).not.toHaveBeenCalled()
})
it('reviews exact leaf assignments before batch confirmation and presents partial results separately', async () => {
  const h = fixture(false), base = h.connection.getMockImplementation()!
  const second = { ...h.task, id: brandString<import('@deepseek-ai/dsh-organization').OrganizationTaskId>(randomUUID()), goal: 'Second report' }
  const definition = { taskId: h.task.id, phases: [{ id: h.task.phaseId, title: 'Reports' }], tasks: [h.task, second] }
  h.connection.mockImplementation(async (action) => {
    if (action.kind === 'assignment-batch') {
      const request = assignmentBatchRequestSchema.parse(action.request)
      return { generation: 1, assignmentBatch: { organizationId: h.prep.assignment.organizationId,
        projectId: h.projectId, planId: h.task.planId, planRevision: h.task.revision,
        owner: { serverId: brandString(randomUUID()), accountId: brandString(randomUUID()) },
        items: request.commands.map((command, index) => ({ command, state: index === 0 ? 'confirmed' : 'conflict' })) } }
    }
    return base(action)
  })
  render(<AssignmentBatch {...h.props} projectId={h.projectId} proposal={{ status: 'shared', planId: h.task.planId, revision: h.task.revision, definition }} />)
  fireEvent.click(screen.getByLabelText(h.task.goal)); fireEvent.click(screen.getByLabelText(second.goal))
  expect(screen.getByRole('button', { name: zh.conversationBatchConfirm }).disabled).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: zh.reviewApprovalAccess }))
  const confirmation = screen.getByLabelText(zh.confirmApproval.replace('{revision}', String(h.task.revision)))
  await waitFor(() =>{  expect(confirmation.disabled).toBe(false) })
  fireEvent.click(confirmation); fireEvent.click(screen.getByRole('button', { name: zh.conversationBatchConfirm }))
  await screen.findByText(zh['conversationBatch-confirmed']); await screen.findByText(zh['conversationBatch-conflict'])
  expect(h.connection.mock.calls.filter(([a]) => a.kind === 'assignment-batch')).toHaveLength(1)
  expect(h.connection.mock.calls.filter(([a]) => a.kind === 'assignment-review')).toHaveLength(2)
})

it('keeps task conversation Run reads on the original assignment after a later reassignment', async () => {
  const h = fixture(true), base = h.connection.getMockImplementation()!
  const newer = { ...h.prep.assignment, id: brandString<import('@deepseek-ai/dsh-organization').OrganizationAssignmentId>(randomUUID()) }
  h.connection.mockImplementation(async (action) => {
    if (action.kind === 'assignment-tasks') return { assignment: { generation: 1,
      result: { kind: 'tasks', value: { items: [newer], total: 2, offset: 0, revision: 3, cursor: brandString('new') } } } }
    if (action.kind === 'execution-list') return { generation: 1, executions: { items: [], total: 0, offset: 0 } }
    return base(action)
  })
  render(<ExecutionPanel {...h.props} task={h.task} projectId={h.projectId} current assignmentId={h.prep.assignment.id} />)
  await waitFor(() => {
    expect(h.connection.mock.calls.some(([a]) => a.kind === 'execution-list')).toBe(true)
  })
  for (const [action] of h.connection.mock.calls) if (action.kind === 'assignment-preparation' || action.kind === 'execution-list')
    expect(action.request).toMatchObject({ assignmentId: h.prep.assignment.id })
  expect(h.props.execution).not.toHaveBeenCalled()
})
