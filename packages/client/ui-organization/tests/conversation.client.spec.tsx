// @vitest-environment jsdom
/** Native conversation controls tested in a detached DOM; no application or browser is started. */
import { randomUUID } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { conversationRequestSchema, conversationResultSchema } from '@deepseek-ai/dsh-organization-conversation/protocol'
import { planningReadSchema, planningViewSchema } from '@deepseek-ai/dsh-organization/planning'
import type { OrganizationDesktopSnapshot } from '@deepseek-ai/dsh-organization-connection/types'
import type { OrganizationProps } from '../src/client/contract.ts'
import { ProjectConversation } from '../src/client/Conversation.tsx'
import { zh } from '../src/client/locales.ts'
afterEach(cleanup)
function fixture() {
  const result = conversationResultSchema.parse({ sessionId: `organization-conversation:${randomUUID()}`,
    owner: { serverId: randomUUID(), accountId: randomUUID(),
      organizationId: randomUUID(), projectId: randomUUID(), conversationId: randomUUID() },
    settings: { enabled: true, granularity: 'balanced', revision: 0 }, entries: [{ role: 'assistant', text: 'Private report' }],
    goals: [], state: 'ready', truncated: false })
  const project = { id: result.owner.projectId, organizationId: result.owner.organizationId, name: 'Reports', version: 1 }
  const planning = planningViewSchema.parse({ project, grant: null, eligible: false, canWrite: true, plans: [], serverTime: 0,
    policy: { models: [{ model: 'test-model', endpoint: 'https://example.test/v1' }], ttlMs: 1000, permitTtlMs: 1000, maxRequests: 10,
      maxInputBytes: 100000, maxOutputBytes: 100000, maxTotalBytes: 1000000, maxDurationMs: 10000 } })
  let state: OrganizationDesktopSnapshot = { connection: { phase: 'ready', mode: 'organization', revision: 1, generation: 1,
    organizationId: project.organizationId, organizations: [], members: [] }, server: { phase: 'disabled',
    settings: { host: 'localhost', port: 19487, names: [], restoreOnLaunch: false } } }
  const conversation = vi.fn<NonNullable<OrganizationProps['conversation']>>(async () => ({ generation: 1, result }))
  const connection = vi.fn<OrganizationProps['connection']>(async () => ({ generation: 1, planning }))
  const props: OrganizationProps = { available: true, conversation, connection, server: vi.fn(), secret: vi.fn(), context: vi.fn(),
    execution: vi.fn(), executionReport: vi.fn(), t: makeTranslate(zh), useModelCatalogRevision: f => f(0), useOrganization: f => f(state) }
  return { result, props, project, conversation, connection, change: (generation: number) => {
    state = { ...state, connection: { ...state.connection, generation, phase: 'offline' } }
  } }
}
it('ordinary send uses default planning, retains failed input and retries the same input identity', async () => {
  const h = fixture(); render(<ProjectConversation {...h.props} project={h.project} />)
  await screen.findByText('Private report')
  fireEvent.change(screen.getByLabelText(zh.conversationModel), { target: { value: '0' } })
  fireEvent.change(screen.getByLabelText(zh.conversationMessage), { target: { value: 'Build a revenue report' } })
  h.conversation.mockRejectedValueOnce(new Error('offline'))
  fireEvent.click(screen.getByRole('button', { name: zh.conversationSend }))
  await screen.findByRole('alert')
  expect(screen.getByDisplayValue('Build a revenue report')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: zh.conversationSend }))
  await waitFor(() => { expect(h.conversation.mock.calls.filter(([r]) => r.kind === 'send')).toHaveLength(2) })
  const sends = h.conversation.mock.calls.filter(([r]) => r.kind === 'send')
  expect(sends[0]).toEqual(sends[1])
  expect(sends[0]?.[0]).toMatchObject({ route: 'new_goal', text: 'Build a revenue report' })
  expect(h.connection.mock.calls.some(([a]) => a.kind === 'assignment-command')).toBe(false)
})
it('hides old text on generation change and discards a late read result', async () => {
  const h = fixture(), late = Promise.withResolvers<Awaited<ReturnType<NonNullable<OrganizationProps['conversation']>>>>()
  h.conversation.mockReturnValueOnce(late.promise)
  const view = render(<ProjectConversation {...h.props} project={h.project} />)
  h.change(2); view.rerender(<ProjectConversation {...h.props} project={h.project} />)
  await act(async () => { late.resolve({ generation: 1, result: h.result }); await late.promise })
  expect(screen.queryByText('Private report')).toBeNull()
  expect(screen.getByText(zh.conversationUnavailable)).toBeTruthy()
})
it('disposes an active conversation by requesting a stop and ignores the late send', async () => {
  const h = fixture(), view = render(<ProjectConversation {...h.props} project={h.project} />)
  await screen.findByText('Private report')
  const late = Promise.withResolvers<Awaited<ReturnType<NonNullable<OrganizationProps['conversation']>>>>()
  h.conversation.mockImplementation(async r => r.kind === 'send' ? late.promise : { generation: 1, result: h.result })
  fireEvent.change(screen.getByLabelText(zh.conversationModel), { target: { value: '0' } })
  fireEvent.change(screen.getByLabelText(zh.conversationMessage), { target: { value: 'Wait' } })
  fireEvent.click(screen.getByRole('button', { name: zh.conversationSend })); view.unmount()
  expect(h.conversation.mock.calls.some(([r]) => r.kind === 'stop')).toBe(true)
  await act(async () => { late.resolve({ generation: 1, result: h.result }); await late.promise })
})

it('keeps the explicitly selected earlier goal after its modification completes', async () => {
  const h = fixture()
  h.result.goals.push(
    { id: randomUUID() as typeof h.result.goals[number]['id'], classification: 'complex' },
    { id: randomUUID() as typeof h.result.goals[number]['id'], classification: 'simple' },
  )
  render(<ProjectConversation {...h.props} project={h.project} />)
  await screen.findByText('Private report')
  fireEvent.change(screen.getByLabelText(zh.conversationGoal), { target: { value: h.result.goals[0]!.id } })
  fireEvent.change(screen.getByLabelText(zh.conversationModel), { target: { value: '0' } })
  fireEvent.change(screen.getByLabelText(zh.conversationMessage), { target: { value: 'Refine the first goal' } })
  fireEvent.click(screen.getByRole('button', { name: zh.conversationSend }))
  await waitFor(() => { expect(screen.getByLabelText(zh.conversationMessage).value).toBe('') })
  expect(screen.getByLabelText(zh.conversationGoal).value).toBe(h.result.goals[0]!.id)
  expect(h.conversation.mock.calls.find(([r]) => r.kind === 'send')?.[0]).toMatchObject({
    route: 'modify', goalId: h.result.goals[0]!.id,
  })
})

it('sends an explicit progress query on the existing goal without proposing a new root', async () => {
  const h = fixture(), id = randomUUID() as typeof h.result.goals[number]['id']
  h.result.goals.push({ id, classification: 'complex' })
  render(<ProjectConversation {...h.props} project={h.project} />)
  await screen.findByText('Private report')
  fireEvent.change(screen.getByLabelText(zh.conversationModel), { target: { value: '0' } })
  fireEvent.change(screen.getByLabelText(zh.conversationMessageIntent), { target: { value: 'query' } })
  fireEvent.change(screen.getByLabelText(zh.conversationMessage), { target: { value: 'What remains?' } })
  fireEvent.click(screen.getByRole('button', { name: zh.conversationSend }))
  await waitFor(() =>{  expect(h.conversation.mock.calls.find(([r]) => r.kind === 'send')?.[0]).toMatchObject({ route: 'query', goalId: id }) })
})

it('opens a bound task through the strict planning reader and continues its assignment goal', async () => {
  const h = fixture(), assignmentId = randomUUID()
  const request = conversationRequestSchema.parse({ organizationId: h.result.owner.organizationId, projectId: h.result.owner.projectId,
    kind: 'open', operationId: randomUUID(), conversationId: assignmentId,
    assignment: { planId: randomUUID(), assignmentId } })
  const base = h.connection.getMockImplementation()!
  h.connection.mockImplementation(async (action) => {
    if (action.kind === 'planning-read') planningReadSchema.parse(action.request)
    return base(action)
  })
  h.result.goals.push({ id: assignmentId as typeof h.result.goals[number]['id'], classification: 'unassessed' })
  render(<ProjectConversation {...h.props} project={h.project} assignment={request.assignment} />)
  await screen.findByText('Private report')
  expect(screen.queryByRole('button', { name: zh.conversationNewGoal })).toBeNull()
  fireEvent.change(screen.getByLabelText(zh.conversationModel), { target: { value: '0' } })
  fireEvent.change(screen.getByLabelText(zh.conversationMessage), { target: { value: 'Discuss my assignment' } })
  fireEvent.click(screen.getByRole('button', { name: zh.conversationSend }))
  await waitFor(() => {
    expect(h.conversation.mock.calls.find(([r]) => r.kind === 'send')?.[0]).toMatchObject({
      route: 'modify', goalId: assignmentId, assignment: request.assignment,
    })
  })
})
