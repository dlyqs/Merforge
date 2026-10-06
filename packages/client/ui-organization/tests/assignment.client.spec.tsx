// @vitest-environment jsdom
/** Explicit preparation gestures and stale-content behavior without opening a browser. */
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { randomUUID } from 'node:crypto'
import { brandString } from '@deepseek-ai/dsh-brand'
import { preparationSchema, taskAssignmentsPageSchema } from '@deepseek-ai/dsh-organization/assignment'
import { workgraphPageSchema } from '@deepseek-ai/dsh-organization/workgraph'
import type { ConnectionResult, OrganizationDesktopSnapshot } from '@deepseek-ai/dsh-organization-connection/types'
import type { OrganizationProps } from '../src/client/contract.ts'
import { AssignmentPanel } from '../src/client/AssignmentPanel.tsx'
import { DeliveryPanel } from '../src/client/DeliveryPanel.tsx'
import { Workbench } from '../src/client/Workbench.tsx'
import { ExecutionPanel } from '../src/client/ExecutionPanel.tsx'
import { executionViewSchema, executionCommandSchema, executionRunSchema } from '@deepseek-ai/dsh-organization/execution'
import { ConversationTask } from '../src/client/ConversationTask.tsx'
import { AssignmentBatch } from '../src/client/AssignmentBatch.tsx'
import { assignmentBatchRequestSchema } from '../../../host/organization-connection/src/assignment-batch.ts'
import { readTaskRequests } from '../src/client/task-requests.ts'
import { deliveryCommandSchema, deliveryPageSchema } from '@deepseek-ai/dsh-organization/delivery'
import { TaskExecutionStatus } from '../src/client/TaskExecutionStatus.tsx'
import { taskExecutionState } from '../src/client/task-execution-view.ts'
import { fileSize } from '../src/client/delivery-view.ts'
import { conversationResultSchema } from '@deepseek-ai/dsh-organization-conversation/protocol'
import { zh } from '../src/client/locales.ts'
afterEach(cleanup)

it.each(['accept-delivery', 'reject-delivery'] as const)('offers %s in the selected task after evidence confirmation', async (kind) => {
  const h = fixture(true), base = h.connection.getMockImplementation()!
  const a = h.prep.assignment, handlerId = a.assigneeId
  a.approvedBy = handlerId; a.assigneeId = brandString(randomUUID()); a.state = 'accepted'
  h.prep.request.state = 'accepted'
  const selector = { organizationId: a.organizationId, projectId: a.projectId, planId: a.planId,
    assignmentId: a.id, runId: randomUUID(), planRevision: a.planRevision }
  const artifactId = randomUUID(), sha256 = 'a'.repeat(64), submissionId = randomUUID()
  const page = deliveryPageSchema.parse({ artifacts: [{ ...selector, id: artifactId, employeeId: a.assigneeId,
    path: 'report.txt', mediaType: 'text/plain', description: 'Task report', kind: 'file', size: 5, sha256, createdRevision: 3 }],
  submissions: [{ ...selector, id: submissionId, employeeId: a.assigneeId, handlerId, kind: 'accept-delivery',
    state: 'submitted', artifactIds: [artifactId], summary: 'Completed task', target: 'Review report', createdRevision: 4,
    reviewState: 'pending', acceptance: null }], total: 1, offset: 0,
  limits: { artifactMaxFiles: 10, artifactMaxFileBytes: 1000, artifactMaxTotalBytes: 10000 } })
  h.connection.mockImplementation(async (action) => {
    if (action.kind === 'delivery-read') return { generation: 1, delivery: page }
    return base(action)
  })
  render(<DeliveryPanel {...h.props} assignment={a} />)
  await screen.findByRole('button', { name: zh.reviewAccept })
  if (kind === 'reject-delivery') fireEvent.click(screen.getByRole('button', { name: zh.taskRejectToggle }))
  const button = screen.getByRole('button', { name: kind === 'accept-delivery' ? zh.reviewAccept : zh.reviewReject })
  expect(button.disabled).toBe(true)
  expect(h.connection.mock.calls.some(([action]) => action.kind === 'delivery-command')).toBe(false)
  if (kind === 'reject-delivery') {
    fireEvent.change(screen.getByLabelText(zh.reviewReason), { target: { value: 'Missing result' } })
    fireEvent.change(screen.getByLabelText(zh.reviewRequirements), { target: { value: 'Add result' } })
  } else expect(screen.queryByLabelText(zh.reviewReason)).toBeNull()
  fireEvent.click(screen.getByLabelText(zh.reviewConfirm))
  fireEvent.click(button)
  await waitFor(() => {
    const action = h.connection.mock.calls.find(([action]) => action.kind === 'delivery-command')?.[0]
    expect(action?.kind).toBe('delivery-command')
    if (action?.kind !== 'delivery-command') throw new Error('missing decision')
    expect(deliveryCommandSchema.parse(action.request)).toMatchObject({ ...selector, kind, submissionId,
      artifacts: [{ artifactId, sha256 }], confirmed: true,
      ...(kind === 'reject-delivery' ? { reason: 'Missing result', requirements: 'Add result' } : {}) })
  })
})

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

it('keeps execution drafts and the selected section when task authority refreshes', async () => {
  const h = fixture(true), base = h.connection.getMockImplementation()!
  h.prep.assignment.state = 'accepted'
  h.connection.mockImplementation(async (action) => {
    if (action.kind === 'workgraph-tasks') return { workgraph: { generation: h.generation(),
      result: { kind: 'tasks', value: { items: [h.task], total: 1, offset: 0, revision: 1, cursor: brandString('cursor') } } } }
    if (action.kind === 'execution-list') return { generation: h.generation(), executions: { items: [], total: 0, offset: 0 } }
    return base(action)
  })
  const props = { ...h.props, projectId: h.projectId, planId: h.task.planId, taskId: h.task.id, onClose: () => {} }
  const view = render(<ConversationTask {...props} />)
  fireEvent.click(await screen.findByRole('tab', { name: zh.taskExecutionTab }))
  const message = await screen.findByLabelText<HTMLTextAreaElement>(zh.executionMessage)
  fireEvent.change(message, { target: { value: 'Keep this unfinished instruction' } })
  h.refresh(); view.rerender(<ConversationTask {...props} />)
  await waitFor(() => {
    expect(screen.getByRole('tab', { name: zh.taskExecutionTab }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByLabelText<HTMLTextAreaElement>(zh.executionMessage).value).toBe('Keep this unfinished instruction')
  })
  expect(h.props.execution).not.toHaveBeenCalled()
})

it.each([false, true])('publishes optional attachments only after confirming the result with isolated Run=%s', async (withRun) => {
  const h = fixture(true), base = h.connection.getMockImplementation()!
  const a = h.prep.assignment
  a.state = 'accepted'
  const selector = { organizationId: a.organizationId, projectId: a.projectId, planId: a.planId,
    assignmentId: a.id, planRevision: a.planRevision }
  const run = withRun ? executionRunSchema.parse({ ...selector, id: randomUUID(),
    executionDelegationId: randomUUID(), configDigest: 'a'.repeat(64), state: 'succeeded', createdRevision: 3, version: 3 }) : undefined
  const page = deliveryPageSchema.parse({ artifacts: [], submissions: [], total: 0, offset: 0,
    limits: { artifactMaxFiles: 10, artifactMaxFileBytes: 1000, artifactMaxTotalBytes: 10000 } })
  h.connection.mockImplementation(async (action) => {
    if (action.kind === 'delivery-read') return { generation: 1, delivery: { ...page } }
    if (action.kind === 'delivery-command') {
      const command = deliveryCommandSchema.parse(action.request)
      if (command.kind === 'publish-artifact') page.artifacts.push({ ...selector, runId: run?.id ?? null,
        id: brandString(randomUUID()), employeeId: a.assigneeId, kind: command.artifactKind,
        path: command.path, mediaType: command.mediaType, description: command.description,
        size: command.size, sha256: command.sha256, createdRevision: 4 })
      return { receipt: { operationId: brandString(command.operationId), organizationId: a.organizationId, revision: 4,
        delivery: { artifactId: page.artifacts.at(-1)!.id } } }
    }
    return base(action)
  })
  render(<DeliveryPanel {...h.props} assignment={a} run={run} submissionReady />)
  const input = await screen.findByLabelText(zh.deliveryFiles)
  const file = new File(['Task result'], 'report.txt', { type: 'text/plain' })
  Object.defineProperty(file, 'arrayBuffer', { value: async () => new TextEncoder().encode('Task result').buffer })
  fireEvent.change(input, { target: { files: [file] } })
  expect(h.connection.mock.calls.some(([action]) => action.kind === 'delivery-command')).toBe(false)
  fireEvent.change(screen.getByLabelText(zh.deliverySummary), { target: { value: 'Completed and checked' } })
  expect(screen.getByRole<HTMLButtonElement>('button', { name: zh.deliverySubmit }).disabled).toBe(true)
  fireEvent.click(screen.getByLabelText(zh.taskSubmitConfirm))
  fireEvent.click(screen.getByRole('button', { name: zh.deliverySubmit }))
  await waitFor(() => {
    const writes = h.connection.mock.calls.flatMap(([action]) => action.kind === 'delivery-command'
      ? [deliveryCommandSchema.parse(action.request)] : [])
    expect(writes).toHaveLength(2)
    expect(writes[1]).toMatchObject({ kind: 'submit-delivery', runId: run?.id ?? null, artifactIds: [page.artifacts[0]?.id],
      summary: 'Completed and checked', target: '', confirmed: true })
  })
})

it.each(['pending', 'cancelled', 'expired'] as const)('gates submission for a stopped Run with a %s human request', async (state) => {
  const h = fixture(true), base = h.connection.getMockImplementation()!
  const a = h.prep.assignment
  a.state = 'accepted'
  const selector = { organizationId: a.organizationId, projectId: a.projectId, planId: a.planId,
    assignmentId: a.id, planRevision: a.planRevision, deviceId: randomUUID() }
  const runId = randomUUID(), executionDelegationId = randomUUID()
  const view = executionViewSchema.parse({
    run: { ...selector, id: runId, executionDelegationId, serverEpoch: randomUUID(), fencingEpoch: 1,
      configDigest: 'a'.repeat(64), state: 'paused', createdRevision: 3, version: 3 },
    delegation: { ...selector, id: executionDelegationId, delegationId: randomUUID(), capabilities: ['model'],
      configDigest: 'a'.repeat(64), state: 'active', budget: 10, used: 1, expiresAt: Date.now() + 60000,
      createdRevision: 3, version: 3 }, actions: [], serverTime: Date.now(), eligible: false, modelPolicy: [],
    assigneeId: a.assigneeId, approvedBy: a.approvedBy, humanRequests: [{ id: randomUUID(), assignmentId: a.id,
      runId, planRevision: a.planRevision, handlerId: a.assigneeId, kind: 'work-question', prompt: 'Check this result',
      actionId: null, requestDigest: null, state, expiresAt: Date.now() + 60000, answer: null,
      createdRevision: 3, version: 3, answeredRevision: null }],
  })
  const page = deliveryPageSchema.parse({ artifacts: [{ organizationId: a.organizationId, projectId: a.projectId,
    planId: a.planId, assignmentId: a.id, planRevision: a.planRevision, runId, id: randomUUID(), employeeId: a.assigneeId,
    kind: 'file', path: 'report.txt', mediaType: 'text/plain', description: 'Result', size: 5,
    sha256: 'a'.repeat(64), createdRevision: 4 }], submissions: [], total: 0, offset: 0,
  limits: { artifactMaxFiles: 10, artifactMaxFileBytes: 1000, artifactMaxTotalBytes: 10000 } })
  h.connection.mockImplementation(async (action) => {
    if (action.kind === 'execution-list') return { generation: 1, executions: { items: [view.run], total: 1, offset: 0 } }
    if (action.kind === 'execution-read') return { generation: 1, execution: view }
    if (action.kind === 'delivery-read') return { generation: 1, delivery: page }
    return base(action)
  })
  render(<ExecutionPanel {...h.props} task={h.task} projectId={h.projectId} current section="delivery" />)
  const runSelect = await screen.findByLabelText(zh.executionRun)
  if (runSelect) fireEvent.change(runSelect, { target: { value: runId } })
  fireEvent.click(await screen.findByRole('checkbox', { name: 'report.txt' }))
  fireEvent.change(screen.getByLabelText(zh.deliverySummary), { target: { value: 'Completed and checked' } })
  const confirm = screen.getByRole<HTMLInputElement>('checkbox', { name: zh.taskSubmitConfirm })
  expect(confirm.disabled).toBe(state === 'pending')
  fireEvent.click(confirm)
  expect(screen.getByRole<HTMLButtonElement>('button', { name: zh.deliverySubmit }).disabled).toBe(state === 'pending')
  expect(h.connection.mock.calls.some(([action]) => action.kind === 'delivery-command')).toBe(false)
})

function fixture(approved: boolean, admin = false) {
  const organizationId = brandString<import('@deepseek-ai/dsh-organization').OrganizationId>(randomUUID())
  const projectId = brandString<import('@deepseek-ai/dsh-organization').OrganizationProjectId>(randomUUID())
  const memberId = brandString<import('@deepseek-ai/dsh-organization').MembershipId>(randomUUID())
  const task = workgraphPageSchema.parse({ items: [{ id: randomUUID(), planId: randomUUID(), revision: 1,
    phaseId: randomUUID(), phaseTitle: 'Preparation', parentTaskId: null, goal: 'Visible target', scope: 'Limited scope', acceptance: ['Review'],
    artifacts: [], required: true, dependsOn: [], suggestedMembershipId: memberId, assignable: true, status: 'pending', hasUndisclosedPrerequisite: false }],
  total: 1, offset: 0, revision: 1, cursor: 'cursor' }).items[0]!
  const id = randomUUID()
  const prep = preparationSchema.parse({ serverTime: 100,
    assignment: { id, organizationId, projectId, planId: task.planId, taskId: task.id, planRevision: 1,
      approvedBy: randomUUID(), assigneeId: memberId, state: 'pending', reason: null, createdAt: 1, createdRevision: 2, version: 2 },
    request: { id: randomUUID(), assignmentId: id, kind: 'accept-assignment', state: 'pending', expiresAt: null, answeredRevision: null },
  })
  const history = taskAssignmentsPageSchema.parse({ items: approved ? [prep.assignment] : [], total: approved ? 1 : 0, offset: 0, revision: 2, cursor: 'cursor' })
  const item = { assignment: prep.assignment, request: prep.request, notificationId: brandString<import('@deepseek-ai/dsh-organization').OrganizationNotificationId>(randomUUID()), readAt: null }
  let state: OrganizationDesktopSnapshot = { connection: { identityGeneration: 1, revision: 1, generation: 1, phase: 'ready', mode: 'organization', organizationId,
    organizations: [{ id: organizationId, membershipId: memberId, name: 'Team', role: admin ? 'admin' : 'member', version: 1 }], members: admin ? [{ id: memberId, username: 'Alice', accountId: brandString(randomUUID()), accountVersion: 1, accountEnabled: true, enabled: true, version: 1, role: 'member' }] : [] },
  server: { phase: 'disabled', settings: { host: 'localhost', port: 19487, names: [], restoreOnLaunch: false } } }
  const reply = (result: NonNullable<ConnectionResult['assignment']>['result']): ConnectionResult => ({ assignment: { generation: state.connection.generation, result } })
  const connection = vi.fn<OrganizationProps['connection']>(async (action) => {
    if (action.kind === 'assignment-review') return reply({ kind: 'review', value: { planRevision: task.revision, assigneeId: memberId, canAssign: true } })
    if (action.kind === 'assignment-tasks') return reply({ kind: 'tasks', value: history })
    if (action.kind === 'assignment-preparation') return reply({ kind: 'preparation', value: prep })
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
    t: makeTranslate(zh), useModelCatalogRevision: selector => selector(0),
    useTaskExecutionRevision: selector => selector(0),
    useOrganization: selector => selector(state) }
  return { props, task, projectId, connection, prep, generation: () => state.connection.generation,
    refresh: () => { state = { ...state, connection: { ...state.connection, generation: state.connection.generation + 1 } } },
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
  await waitFor(() => expect(h.prep.assignment.state).toBe('accepted'))
  expect(screen.queryByText(zh.taskExecutionReady)).toBeNull()
  expect(h.connection.mock.calls.some(([action]) => action.kind === 'assignment-delegate' || action.kind === 'lease-claim')).toBe(false)
  expect(screen.getByText(zh.preparationOnly)).toBeTruthy()
  h.offline(); view.rerender(<AssignmentPanel {...h.props} task={h.task} projectId={h.projectId} current={false} />)
  expect(screen.queryByText(h.prep.assignment.approvedBy)).toBeNull()
  expect(screen.queryByText(zh.taskExecutionReady)).toBeNull()
  expect(screen.getByRole('status').textContent).toBe(zh.qualificationRecheck)
})
it('reads pending task actions without answering or acknowledging notifications', async () => {
  const h = fixture(true)
  const items = await readTaskRequests(h.props.connection, h.prep.assignment.organizationId, 1, () => true)
  expect(items?.[0]?.assignment.id).toBe(h.prep.assignment.id)
  expect(h.connection.mock.calls[0]?.[0]).toMatchObject({ kind: 'assignment-inbox', request: { state: 'pending' } })
  expect(h.connection.mock.calls.some(([action]) => action.kind === 'assignment-participant')).toBe(false)
  expect(h.prep.request.state).toBe('pending')
})

it('keeps dispatch disabled when assignment eligibility fails', async () => {
  const h = fixture(false), base = h.connection.getMockImplementation()!
  h.connection.mockImplementation(async (action) => {
    const result = await base(action)
    if (result.assignment?.result.kind === 'review') result.assignment.result.value.canAssign = false
    return result
  })
  render(<AssignmentPanel {...h.props} task={h.task} projectId={h.projectId} current />)
  await screen.findByText(zh.approvalAccessMissing)
  expect(screen.getByRole<HTMLButtonElement>('button', { name: zh.approveAssignment }).disabled).toBe(true)
  expect(h.connection.mock.calls.some(([action]) => action.kind === 'assignment-command')).toBe(false)
})


it('lets an ordinary leader confirm dispatch without separate permission commands', async () => {
  const h = fixture(false)
  render(<AssignmentPanel {...h.props} task={h.task} projectId={h.projectId} current />)
  await screen.findByText(zh.approvalAccessReady)
  expect(screen.queryByText('授予必要查看权限')).toBeNull()
  fireEvent.click(screen.getByRole('checkbox', { name: zh.confirmApproval.replace('{revision}', String(h.task.revision)) }))
  fireEvent.click(screen.getByRole('button', { name: zh.approveAssignment }))
  await waitFor(() => { expect(h.connection.mock.calls.some(([a]) => a.kind === 'assignment-command')).toBe(true) })
  expect(h.connection.mock.calls.some(([a]) => ['grants', 'workgraph-grant', 'workgraph-grants', 'command'].includes(a.kind))).toBe(false)
})

it('selects native Codex without endpoint or file-tool controls and retains the exact failed grant draft', async () => {
  const h = fixture(true), base = h.connection.getMockImplementation()!
  const executionDelegationId = brandString<import('@deepseek-ai/dsh-organization').OrganizationExecutionDelegationId>(randomUUID())
  const runId = brandString<import('@deepseek-ai/dsh-organization').OrganizationRunId>(randomUUID())
  h.prep.assignment.state = 'accepted'
  const openCodexSettings = vi.fn()
  h.props.openCodexSettings = openCodexSettings
  h.props.loadModels = vi.fn<NonNullable<OrganizationProps['loadModels']>>(async () => ({ default: { provider: 'codex', model: 'native-model' }, routableProviders: ['codex'],
    groups: [{ id: 'codex', backend: 'codex', name: 'Codex', models: [{ id: 'native-model', name: 'Native model',
      reasoning: { efforts: [{ id: 'medium', name: 'medium' }], defaultEffort: 'medium' } }] }], failures: [] }))
  const nativeCommand = (request: unknown) => {
    if (typeof request !== 'object' || request === null) throw new Error('invalid native command')
    return executionCommandSchema.parse(request)
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
    taskId={h.task.id} assignmentId={h.prep.assignment.id} onClose={() => {}} />)
  fireEvent.click(await screen.findByRole('tab', { name: zh.taskPreparationTab }))
  const accept = await screen.findByRole('button', { name: zh.acceptAssignment })
  expect(screen.getByRole('tab', { name: zh.taskExecutionTab })).toBeTruthy()
  expect(screen.getByRole('tab', { name: zh.taskDeliveryTab })).toBeTruthy()
  expect(h.connection.mock.calls.every(([a]) => !['assignment-participant', 'execution-command', 'lease-claim', 'assignment-delegate'].includes(a.kind))).toBe(true)
  fireEvent.click(accept)
  await waitFor(() => expect(h.prep.assignment.state).toBe('accepted'))
  expect(screen.queryByText(zh.taskExecutionReady)).toBeNull()
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


it.each(['commit abc123: fix task', 'https://example.test/result'])('submits a text-only result without uploading files: %s', async (content) => {
  const h = fixture(true), base = h.connection.getMockImplementation()!
  h.prep.assignment.state = 'accepted'
  h.connection.mockImplementation(async action => action.kind === 'delivery-read' ? { generation: 1,
    delivery: deliveryPageSchema.parse({ artifacts: [], submissions: [], total: 0, offset: 0,
      limits: { artifactMaxFiles: 10, artifactMaxFileBytes: 1024 ** 2, artifactMaxTotalBytes: 1024 ** 3 } }) } : base(action))
  render(<DeliveryPanel {...h.props} assignment={h.prep.assignment} />)
  fireEvent.change(await screen.findByLabelText(zh.deliverySummary), { target: { value: content } })
  expect(screen.getByRole<HTMLButtonElement>('button', { name: zh.deliverySubmit }).disabled).toBe(true)
  fireEvent.click(screen.getByLabelText(zh.taskSubmitConfirm))
  fireEvent.click(screen.getByRole('button', { name: zh.deliverySubmit }))
  await waitFor(() => {
    const writes = h.connection.mock.calls.filter(([action]) => action.kind === 'delivery-command')
    expect(writes).toHaveLength(1)
    expect(deliveryCommandSchema.parse(writes[0]![0].request)).toMatchObject({ kind: 'submit-delivery', summary: content, target: '', artifactIds: [], runId: null })
  })
  expect(screen.getByText(/单文件 1 MB，总计 1 GB/)).toBeTruthy()
  expect(fileSize(1024 ** 3, 'bytes')).toBe('1 GB')
})

it('refreshes task conversation execution from authorized records and ignores generated introductions', async () => {
  const h = fixture(true)
  const report = conversationResultSchema.parse({ sessionId: `organization-conversation:${randomUUID()}`,
    owner: { serverId: randomUUID(), accountId: randomUUID(), organizationId: h.prep.assignment.organizationId,
      projectId: h.projectId, conversationId: h.prep.assignment.id,
      assignment: { planId: h.task.planId, assignmentId: h.prep.assignment.id } },
    settings: { enabled: false, granularity: 'balanced', revision: 0 }, entries: [], goals: [], truncated: false, state: 'ready',
    history: [{ type: 'step/start', seq: 0, time: 1, data: { step: 1, turn: 1 } },
      { type: 'turn/end', seq: 1, time: 1, data: { turn: 1, reason: { kind: 'completed' } } }] })
  const conversation = vi.fn<NonNullable<OrganizationProps['conversation']>>(async () => ({ generation: 1, result: report }))
  let revision = 0
  const props = { ...h.props, conversation,
    useTaskExecutionRevision: h.props.useTaskExecutionRevision }
  props.useTaskExecutionRevision = selector => selector(revision)
  const view = render(<TaskExecutionStatus {...props} task={h.task} projectId={h.projectId} current />)
  await screen.findByText(zh['taskConversation-unstarted'])
  const input = { type: 'organization/planning-input' as const, seq: 2, time: 2, data: {
    request: { kind: 'send' as const, target: { taskId: h.task.id, planId: h.task.planId } },
    authority: { plan: { version: { revision: h.task.revision } } } } }
  // Native reports are validated by the Host; the fixture supplies the consumed task fields.
  const history = [...report.history, input, { type: 'step/start', seq: 3, time: 2, data: { step: 1, turn: 2 } }]
  report.history = history as typeof report.history
  report.running = true; revision++
  view.rerender(<TaskExecutionStatus {...props} task={h.task} projectId={h.projectId} current />)
  await screen.findByText(zh['taskConversation-running'])
  report.history.push({ type: 'turn/end', seq: 4, time: 3, data: { turn: 2, reason: { kind: 'completed' } } })
  report.running = false; revision++
  view.rerender(<TaskExecutionStatus {...props} task={h.task} projectId={h.projectId} current />)
  await screen.findByText(zh['taskConversation-executed'])
  expect(taskExecutionState(report.history, { ...h.task, revision: 2 }, false)).toBe('unstarted')
  expect(taskExecutionState(report.history.slice(0, -1), h.task, false)).toBe('interrupted')
  expect(conversation.mock.calls.every(([request]) => request.kind === 'read')).toBe(true)
})

it('retains selected files when clearing the native file input before batched state updates commit', async () => {
  const h = fixture(true), base = h.connection.getMockImplementation()!
  h.prep.assignment.state = 'accepted'
  h.connection.mockImplementation(async action => action.kind === 'delivery-read' ? { generation: 1,
    delivery: deliveryPageSchema.parse({ artifacts: [], submissions: [], total: 0, offset: 0,
      limits: { artifactMaxFiles: 10, artifactMaxFileBytes: 1024 ** 2, artifactMaxTotalBytes: 1024 ** 3 } }) } : base(action))
  render(<DeliveryPanel {...h.props} assignment={h.prep.assignment} />)
  const input = await screen.findByLabelText<HTMLInputElement>(zh.deliveryFiles)
  let files = [new File(['Result'], 'native-result.pdf', { type: 'application/pdf' })]
  Object.defineProperty(input, 'files', { configurable: true, get: () => files })
  Object.defineProperty(input, 'value', { configurable: true, get: () => '', set: (value: string) => { if (!value) files = [] } })
  act(() => {
    fireEvent.change(screen.getByLabelText(zh.deliverySummary), { target: { value: 'Native selection result' } })
    fireEvent.change(input)
  })
  expect(input.files).toHaveLength(0)
  expect(screen.getByText('native-result.pdf')).toBeTruthy()
  fireEvent.click(screen.getByLabelText(zh.taskSubmitConfirm))
  expect(screen.getByRole<HTMLButtonElement>('button', { name: zh.deliverySubmit }).disabled).toBe(false)
})

it('keeps oversized attachments visible and explains why submission is blocked until removal', async () => {
  const h = fixture(true), base = h.connection.getMockImplementation()!
  h.prep.assignment.state = 'accepted'
  h.connection.mockImplementation(async action => action.kind === 'delivery-read' ? { generation: 1,
    delivery: deliveryPageSchema.parse({ artifacts: [], submissions: [], total: 0, offset: 0,
      limits: { artifactMaxFiles: 10, artifactMaxFileBytes: 1024 ** 2, artifactMaxTotalBytes: 1024 ** 3 } }) } : base(action))
  render(<DeliveryPanel {...h.props} assignment={h.prep.assignment} />)
  const input = await screen.findByLabelText(zh.deliveryFiles)
  expect(screen.getByText(zh.deliverySummaryRequired)).toBeTruthy()
  fireEvent.change(screen.getByLabelText(zh.deliverySummary), { target: { value: 'Result with attachment' } })
  fireEvent.change(input, { target: { files: [new File([new Uint8Array(1024 ** 2 + 1)], 'too-large.pdf')] } })
  expect(screen.getByText('too-large.pdf')).toBeTruthy()
  expect(screen.getByRole('alert').textContent).toBe(zh.deliveryFileExceeded.replace('{bytes}', '1 MB'))
  expect(screen.getByLabelText<HTMLInputElement>(zh.taskSubmitConfirm).disabled).toBe(true)
  expect(screen.getByRole<HTMLButtonElement>('button', { name: zh.deliverySubmit }).disabled).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: zh.taskRemoveFile }))
  expect(screen.queryByRole('alert')).toBeNull()
  fireEvent.change(input, { target: { files: [new File(['Result'], 'small.pdf')] } })
  expect(screen.getByText('small.pdf')).toBeTruthy()
  fireEvent.click(screen.getByLabelText(zh.taskSubmitConfirm))
  expect(screen.getByRole<HTMLButtonElement>('button', { name: zh.deliverySubmit }).disabled).toBe(false)
})

it('refreshes the issuer delivery panel after an employee submission changes the native generation', async () => {
  const h = fixture(true), base = h.connection.getMockImplementation()!
  const a = h.prep.assignment, handlerId = a.assigneeId
  a.approvedBy = handlerId; a.assigneeId = brandString(randomUUID()); a.state = 'accepted'
  let submitted = false
  const submission = { organizationId: a.organizationId, projectId: a.projectId, planId: a.planId,
    assignmentId: a.id, planRevision: a.planRevision, runId: null, id: randomUUID(), employeeId: a.assigneeId,
    handlerId, kind: 'accept-delivery', state: 'submitted', artifactIds: [], summary: 'Employee result after refresh',
    target: '', createdRevision: 4, reviewState: 'pending', acceptance: null }
  h.connection.mockImplementation(async (action) => {
    if (action.kind === 'delivery-read') return { generation: h.generation(), delivery: deliveryPageSchema.parse({
      artifacts: [], submissions: submitted ? [submission] : [], total: submitted ? 1 : 0, offset: 0,
      limits: { artifactMaxFiles: 10, artifactMaxFileBytes: 1000, artifactMaxTotalBytes: 10000 } }) }
    return base(action)
  })
  const view = render(<ExecutionPanel {...h.props} task={h.task} projectId={h.projectId} current section="delivery" />)
  await screen.findByText(zh.taskDeliveryEmpty)
  submitted = true; h.refresh()
  view.rerender(<ExecutionPanel {...h.props} task={h.task} projectId={h.projectId} current section="delivery" />)
  await screen.findAllByText(submission.summary)
  expect(screen.getByRole('button', { name: zh.reviewAccept })).toBeTruthy()
})

it.each(['panel', 'workbench'] as const)('continues uploading and submitting through native refreshes in %s', async (surface) => {
  const h = fixture(true), base = h.connection.getMockImplementation()!
  const a = h.prep.assignment; a.state = 'accepted'
  const page = deliveryPageSchema.parse({ artifacts: [], submissions: [], total: 0, offset: 0,
    limits: { artifactMaxFiles: 10, artifactMaxFileBytes: 1000, artifactMaxTotalBytes: 10000 } })
  const selector = { organizationId: a.organizationId, projectId: a.projectId, planId: a.planId,
    assignmentId: a.id, planRevision: a.planRevision, runId: null }
  const props = { ...h.props, task: h.task, projectId: h.projectId, current: true, section: 'delivery' as const }
  let refreshView = () => {}, deliveryReads = 0
  h.connection.mockImplementation(async (action) => {
    if (action.kind === 'workgraph-tasks') return { workgraph: { generation: h.generation(), requestId: brandString(randomUUID()),
      principal: { serverId: brandString(randomUUID()), accountId: brandString(randomUUID()) }, organizationId: a.organizationId,
      result: { kind: 'tasks', value: workgraphPageSchema.parse({ items: [h.task], total: 1, offset: 0, revision: 1, cursor: 'tasks' }) } } }
    if (action.kind === 'execution-list') return { generation: h.generation(), executions: { items: [], total: 0, offset: 0 } }
    if (action.kind === 'delivery-read') { deliveryReads++; return { generation: h.generation(), delivery: { ...page } } }
    if (action.kind === 'delivery-command') {
      const command = deliveryCommandSchema.parse(action.request)
      const id = brandString(randomUUID())
      if (command.kind === 'publish-artifact') page.artifacts.push({ ...selector, id,
        employeeId: a.assigneeId, kind: command.artifactKind, path: command.path, description: command.description,
        mediaType: command.mediaType, size: command.size, sha256: command.sha256, createdRevision: 4 })
      else if (command.kind === 'submit-delivery') {
        page.submissions.push({ ...selector, id, employeeId: a.assigneeId, handlerId: a.approvedBy,
          kind: 'accept-delivery', state: 'submitted', artifactIds: command.artifactIds, summary: command.summary,
          target: command.target, createdRevision: 5, reviewState: 'pending', acceptance: null })
        page.total++
      }
      const previousReads = deliveryReads
      act(() => { h.refresh(); refreshView() })
      await waitFor(() => { expect(deliveryReads).toBeGreaterThan(previousReads) })
      return { generation: h.generation(), receipt: { operationId: command.operationId,
        organizationId: a.organizationId, revision: 5, delivery: command.kind === 'publish-artifact' ? { artifactId: id } : { submissionId: id } } }
    }
    return base(action)
  })
  const content = () => surface === 'panel' ? <ExecutionPanel {...props} /> : <Workbench {...h.props}
    project={{ id: h.projectId, organizationId: a.organizationId, name: 'Team project' }} initialTaskId={h.task.id} onBack={() => {}} />
  const view = render(content()); refreshView = () => { view.rerender(content()) }
  if (surface === 'workbench') fireEvent.click(await screen.findByRole('tab', { name: zh.taskDeliveryTab }))
  const input = await screen.findByLabelText(zh.deliveryFiles)
  const file = new File(['Result'], 'refresh-result.txt')
  Object.defineProperty(file, 'arrayBuffer', { value: async () => new TextEncoder().encode('Result').buffer })
  fireEvent.change(input, { target: { files: [file] } })
  fireEvent.change(screen.getByLabelText(zh.deliverySummary), { target: { value: 'Result survives refresh' } })
  fireEvent.click(screen.getByLabelText(zh.taskSubmitConfirm))
  fireEvent.click(screen.getByRole('button', { name: zh.deliverySubmit }))
  await screen.findByText(zh.deliverySubmitted)
  expect(page.submissions[0]).toMatchObject({ summary: 'Result survives refresh', artifactIds: [page.artifacts[0]?.id] })
  expect(h.connection.mock.calls.filter(([action]) => action.kind === 'delivery-command')).toHaveLength(2)
})


it.each([[0, '0 字节'], [512, '512 字节'], [1023, '1023 字节'], [1024, '1 KB'], [53351, '52.1 KB'], [1024 ** 2, '1 MB'], [1024 ** 3, '1 GB']])(
  'formats %s attachment bytes as %s', (bytes, expected) => {
    expect(fileSize(bytes, '字节')).toBe(expected)
  })

it('omits empty approval history and the redundant supplementary input', async () => {
  const h = fixture(true), a = h.prep.assignment
  a.state = 'accepted'
  h.connection.mockResolvedValue({ generation: 1, delivery: deliveryPageSchema.parse({ artifacts: [], submissions: [], total: 0, offset: 0,
    limits: { artifactMaxFiles: 10, artifactMaxFileBytes: 1000, artifactMaxTotalBytes: 10000 } }) })
  render(<DeliveryPanel {...h.props} assignment={a} />)
  await screen.findByLabelText(zh.deliverySummary)
  expect(screen.queryByText(zh.taskSubmissionHistory)).toBeNull()
  expect(screen.queryByLabelText(zh.deliveryTarget)).toBeNull()
})

it('puts collapsible approval records first and opens a local attachment without downloading', async () => {
  const h = fixture(true), a = h.prep.assignment
  a.state = 'accepted'
  const selector = { organizationId: a.organizationId, projectId: a.projectId, planId: a.planId,
    assignmentId: a.id, runId: null, planRevision: a.planRevision }
  const artifactId = randomUUID(), modifiedAt = 1700000000000, submittedAt = 1700000100000
  const page = deliveryPageSchema.parse({ artifacts: [{ ...selector, id: artifactId, employeeId: a.assigneeId,
    path: 'project-facts.md', mediaType: 'text/markdown', description: 'project-facts.md', kind: 'file', size: 53351,
    modifiedAt, sha256: 'a'.repeat(64), createdRevision: 3 }],
  submissions: ['pending', 'rejected', 'accepted'].map((reviewState, index) => ({ ...selector, id: randomUUID(),
    employeeId: a.assigneeId, handlerId: a.approvedBy, kind: 'accept-delivery', state: 'submitted',
    submittedAt, artifactIds: index === 0 ? [artifactId] : [], summary: `Submission ${index}`, target: '', createdRevision: 4 + index,
    reviewState, acceptance: null })), total: 3, offset: 0,
  limits: { artifactMaxFiles: 10, artifactMaxFileBytes: 100000, artifactMaxTotalBytes: 1000000 } })
  h.connection.mockResolvedValue({ generation: 1, delivery: page })
  const openDeliveryFile = vi.fn(async () => true)
  const view = render(<DeliveryPanel {...h.props} assignment={a} openDeliveryFile={openDeliveryFile} />)
  await screen.findByText(zh.taskSubmissionHistory)
  const records = view.container.querySelectorAll<HTMLDetailsElement>('details[data-state]')
  expect(Array.from(records, record => [record.dataset.state, record.open])).toEqual([['pending', true], ['rejected', false], ['accepted', false]])
  expect(view.container.querySelector('section')?.firstElementChild?.textContent).toContain(zh.taskSubmissionHistory)
  records[0]!.open = false
  fireEvent(records[0]!, new Event('toggle'))
  expect(records[0]!.open).toBe(false)
  records[0]!.open = true
  expect(screen.queryByText(zh.deliveryHint)).toBeNull()
  expect(screen.queryByText(zh.taskEvidenceDetails)).toBeNull()
  expect(screen.getByText('52.1 KB')).toBeTruthy()
  expect(screen.getByText(zh.deliverySubmittedAt.replace('{time}', new Date(submittedAt).toLocaleString('zh-CN')))).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'project-facts.md' }))
  await waitFor(() => { expect(openDeliveryFile).toHaveBeenCalledWith(artifactId) })
  expect(h.connection.mock.calls.some(([action]) => action.kind === 'delivery-download')).toBe(false)
})

it.each(['pending', 'accepted'] as const)('hides execution for another assignee with a %s assignment', async (state) => {
  const h = fixture(true), base = h.connection.getMockImplementation()!
  h.prep.assignment.assigneeId = brandString(randomUUID())
  h.prep.assignment.state = state
  h.connection.mockImplementation(async (action) => {
    if (action.kind === 'assignment-tasks') return { assignment: { generation: h.generation(),
      result: { kind: 'tasks', value: { items: [h.prep.assignment], total: 1, offset: 0, revision: 2, cursor: brandString('cursor') } } } }
    if (action.kind === 'workgraph-tasks') return { workgraph: { generation: h.generation(),
      result: { kind: 'tasks', value: { items: [h.task], total: 1, offset: 0, revision: 1, cursor: brandString('cursor') } } } }
    return base(action)
  })
  render(<ConversationTask {...h.props} projectId={h.projectId} planId={h.task.planId} taskId={h.task.id} onClose={() => {}} />)
  fireEvent.click(await screen.findByRole('tab', { name: zh.taskPreparationTab }))
  await waitFor(() => expect(screen.getAllByText(zh[`assignment-${state}`]).length).toBeGreaterThan(0))
  expect(screen.queryByRole('tab', { name: zh.taskExecutionTab })).toBeNull()
  expect(screen.getByRole('tab', { name: zh.taskDeliveryTab })).toBeTruthy()
  expect(h.props.execution).not.toHaveBeenCalled()
})
