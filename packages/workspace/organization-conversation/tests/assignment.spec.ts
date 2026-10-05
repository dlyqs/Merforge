/** Real authority/native/IPC/JSONL task conversations and durable per-item human approvals. */
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { OrganizationConnection } from '@deepseek-ai/dsh-organization-connection'
import * as transport from '@deepseek-ai/dsh-organization-api/transport'
import { approveAssignmentSchema } from '@deepseek-ai/dsh-organization/assignment'
import { addMember } from '../../organization/tests/harness.ts'
import { workgraphHarness, password } from '../../../api/organization-api/tests/workgraph-harness.ts'
import { organizationConversation } from '../../../../apps/desktop/src/organization-conversation.ts'
import { conversationRequestSchema } from '../src/protocol.ts'
import { boot, reply, selection } from './harness.ts'
const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => { vi.restoreAllMocks(); for (const close of cleanup.splice(0).reverse()) await close() })
async function setup() {
  const remote = await workgraphHarness(); cleanup.push(remote.close)
  const connect = async (name: string, username: string) => {
    const connection = new OrganizationConnection({ trustPath: join(remote.root, name), reconnectMs: 100 })
    cleanup.push(() => connection.close())
    await connection.perform({ kind: 'probe', origin: remote.trust.origin })
    await connection.perform({ kind: 'trust', fingerprint: remote.trust.fingerprint })
    await connection.perform({ kind: 'login', username, password })
    await connection.perform({ kind: 'select', organizationId: remote.query.organizationId })
    return connection
  }
  const owner = await connect('owner', 'owner')
  const command = approveAssignmentSchema.parse({ ...remote.query, kind: 'approve-assignment', operationId: randomUUID(),
    taskId: remote.grant.taskId, planRevision: 1, assigneeId: remote.member.membershipId })
  const query = { ...remote.query, planRevision: 1 }
  return { remote, owner, connect, command, query }
}
it('assigns visible and previously unshared leaves and reopens without repeating approvals or notifications', async () => {
  const h = await setup(), hidden = h.remote.save.definition.tasks[2]!
  const request = { ...h.query, confirmed: true, commands: [h.command, { ...h.command, taskId: hidden.id, operationId: randomUUID() }] }
  const result = await h.owner.perform({ kind: 'assignment-batch', request })
  expect(result.assignmentBatch?.items.map(i => i.state)).toEqual(['confirmed', 'confirmed'])
  const ids = result.assignmentBatch!.items.map(i => i.receipt!.assignmentId).sort()
  await h.owner.close()
  const reopened = await h.connect('owner', 'owner')
  const read = await reopened.perform({ kind: 'assignment-batch-read', request: h.query })
  expect(read.assignmentBatch!.items.map(i => i.receipt!.assignmentId).sort()).toEqual(ids)
  const replay = await reopened.perform({ kind: 'assignment-batch', request })
  expect(replay.assignmentBatch!.items.map(i => i.receipt!.assignmentId).sort()).toEqual(ids)
  const worker = await h.connect('worker', 'reader')
  expect(worker.snapshot().inbox!.items.map(i => i.assignment.id).sort()).toEqual(ids)
  expect(worker.snapshot().inbox!.items.every(i => i.assignment.state === 'pending')).toBe(true)
}, 20000)
it('reconciles a lost batch reply after restart without sending another approval and leaves remaining items unconfirmed', async () => {
  const h = await setup(), original = transport.organizationRequest
  let writes = 0
  const lost = vi.spyOn(transport, 'organizationRequest').mockImplementation(async (...args) => {
    const response = await original(...args)
    if (args[2] === '/organization/v1/assignment/command') { writes++; throw new Error('lost-after-commit') }
    return response
  })
  const request = { ...h.query, confirmed: true, commands: [h.command,
    { ...h.command, taskId: h.remote.save.definition.tasks[2]!.id, operationId: randomUUID() }] }
  await h.owner.perform({ kind: 'assignment-batch', request }).catch(() => {})
  expect(writes).toBe(1)
  await h.owner.close(); lost.mockRestore()
  const reopened = await h.connect('owner', 'owner')
  const reconciled = await reopened.perform({ kind: 'assignment-batch-read', request: h.query })
  expect(reconciled.assignmentBatch?.items.map(i => i.state)).toEqual(['confirmed', 'unconfirmed'])
  await reopened.perform({ kind: 'reconcile' })
  const history = await reopened.perform({ kind: 'assignment-tasks', request: { ...h.remote.query, taskId: h.command.taskId } })
  expect(history.assignment?.result).toMatchObject({ kind: 'tasks', value: { total: 1 } })
  expect(writes).toBe(1)
}, 20000)
it('opens one employee-only task conversation after offline approval, recovers local failure and reopens the same JSONL', async () => {
  const h = await setup()
  const employee = await addMember(h.remote.app.authority, h.remote.owner.token, h.query.organizationId, 'new-worker')
  await h.owner.perform({ kind: 'reconnect' })
  const approved = await h.owner.perform({ kind: 'assignment-command', request: { ...h.command, assigneeId: employee.membershipId } })
  const leaderRoot = join(h.remote.root, 'leader-host')
  await mkdir(leaderRoot); const leader = await boot(leaderRoot); cleanup.push(leader.close)
  const leaderRequest = conversationRequestSchema.parse({ kind: 'open', operationId: randomUUID(),
    organizationId: h.query.organizationId, projectId: h.query.projectId, conversationId: randomUUID() })
  await organizationConversation(h.owner, leader.host, leaderRequest, () => {}, new AbortController().signal)
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(reply(undefined, 'LEADER_PRIVATE_THREAD'))
  await organizationConversation(h.owner, leader.host, conversationRequestSchema.parse({ ...leaderRequest,
    kind: 'send', operationId: randomUUID(), route: 'new_goal', text: 'Leader confidential planning', selection }),
  () => {}, new AbortController().signal)
  fetch.mockClear().mockResolvedValue(reply(undefined, 'Employee private analysis'))
  const worker = await h.connect('worker', 'new-worker')
  expect(worker.snapshot().projects?.items.map(p => p.id)).toContain(h.query.projectId)
  const root = join(h.remote.root, 'employee-host')
  await mkdir(root)
  const local = await boot(root); cleanup.push(local.close)
  const request = conversationRequestSchema.parse({ organizationId: h.query.organizationId, projectId: h.query.projectId, kind: 'open', operationId: randomUUID(),
    conversationId: approved.receipt!.assignmentId,
    assignment: { planId: h.remote.query.planId, assignmentId: approved.receipt!.assignmentId } })
  const perform = (input = request) => organizationConversation(worker, local.host, input, () => {}, new AbortController().signal)
  const domain = local.ctx.storageDomain.get('organization_conversation')!
  const unit = Reflect.get(domain, 'unit') as import('@deepseek-ai/dsh-storage').KvUnit
  const original = unit.setGlobal.bind(unit); let writes = 0
  const failed = vi.spyOn(unit, 'setGlobal').mockImplementation(async (...args) => {
    if (++writes === 2) throw new Error('local-ready-write-failed')
    return original(...args)
  })
  await expect(perform()).rejects.toThrow(); failed.mockRestore()
  const [one, two] = await Promise.all([perform(), perform(conversationRequestSchema.parse({ ...request, operationId: randomUUID() }))])
  expect(one.result.sessionId).toBe(two.result.sessionId)
  expect(one.result.entries).toHaveLength(1)
  expect(one.result.entries[0]?.role).toBe('assistant')
  expect(one.result.entries[0]?.text).toContain(h.remote.save.definition.tasks.find(t => t.id === h.remote.grant.taskId)!.goal)
  expect(fetch).not.toHaveBeenCalled()
  expect(two.result.history.filter(e => e.type === 'assistant/message' && e.data.message.source.provider === 'organization-assignment')).toHaveLength(1)
  expect(two.result.history.filter(e => e.type === 'organization/assignment-context')).toHaveLength(1)
  expect(two.result.execution?.target.taskId).toBe(h.remote.grant.taskId)
  await expect(perform(conversationRequestSchema.parse({ ...request, kind: 'select-task', operationId: randomUUID(),
    target: { planId: h.query.planId, taskId: h.remote.save.definition.tasks[2]!.id } }))).rejects.toThrow()
  await expect(perform(conversationRequestSchema.parse({ ...request, operationId: randomUUID(), assignment: undefined }))).rejects.toThrow()
  expect(one.result.assignment).toMatchObject({ id: approved.receipt!.assignmentId, state: 'pending', approvedBy: h.remote.owner.membershipId })
  expect(one.result.goals[0]?.proposal?.definition?.tasks.map(t => t.id)).toEqual([h.remote.grant.taskId])
  expect(JSON.stringify(one)).not.toMatch(/HIDDEN_ROOT|HIDDEN_TASK|LEADER_PRIVATE_THREAD|Leader confidential planning/)
  await perform(conversationRequestSchema.parse({ ...request, kind: 'send', operationId: randomUUID(), route: 'query',
    goalId: request.assignment!.assignmentId, text: 'Explain this assigned task', selection }))
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(fetch.mock.calls[0]?.[1]?.body).not.toMatch(/HIDDEN_ROOT|HIDDEN_TASK|LEADER_PRIVATE_THREAD|Leader confidential planning/)
  await perform(conversationRequestSchema.parse({ ...request, kind: 'rename', title: 'My assigned CSV task', operationId: randomUUID() }))
  await local.service.verifyBindings()
  await local.close()
  const reopened = await boot(root); cleanup.push(reopened.close)
  const read = await organizationConversation(worker, reopened.host, { ...request, kind: 'read' }, () => {}, new AbortController().signal)
  expect(read.result.sessionId).toBe(one.result.sessionId)
  expect(read.result.title).toBe('My assigned CSV task')
  expect(read.result.entries.at(-1)?.text).toBe('Employee private analysis')
  await expect(organizationConversation(h.owner, reopened.host, request, () => {}, new AbortController().signal)).rejects.toThrow('forbidden')
  const prep = await worker.perform({ kind: 'assignment-preparation', request: { ...h.remote.query, assignmentId: approved.receipt!.assignmentId } })
  expect(prep.assignment?.result).toMatchObject({ kind: 'preparation', value: { assignment: { state: 'pending' } } })
  const logs = (await readdir(join(root, 'conversations'), { recursive: true })).filter(p => p.endsWith('.jsonl'))
  expect(logs).toHaveLength(1)
  expect(await readFile(join(root, 'conversations', logs[0]!), 'utf8')).toContain('Employee private analysis')
  expect(worker.snapshot().inbox?.items).toHaveLength(1)
  await reopened.service.verifyBindings()
  await organizationConversation(worker, reopened.host, conversationRequestSchema.parse({ ...request, kind: 'delete', operationId: randomUUID() }),
    () => {}, new AbortController().signal)
  await expect(organizationConversation(worker, reopened.host, { ...request, operationId: randomUUID() as typeof request.operationId },
    () => {}, new AbortController().signal)).rejects.toThrow()
  expect((await readdir(join(root, 'conversations'), { recursive: true })).filter(p => p.endsWith('.jsonl'))).toHaveLength(0)
}, 20000)
it('denies new goals, other-task targets, stale assignment sends and revoked task reads', async () => {
  const h = await setup(), approved = await h.owner.perform({ kind: 'assignment-command', request: h.command })
  const worker = await h.connect('worker', 'reader'), root = join(h.remote.root, 'employee-host')
  await mkdir(root); const local = await boot(root); cleanup.push(local.close)
  const request = conversationRequestSchema.parse({ kind: 'open', organizationId: h.query.organizationId, projectId: h.query.projectId,
    conversationId: approved.receipt!.assignmentId, operationId: randomUUID(),
    assignment: { planId: h.query.planId, assignmentId: approved.receipt!.assignmentId } })
  const perform = (input: unknown) => organizationConversation(worker, local.host, input, () => {}, new AbortController().signal)
  await perform(request)
  const send = { ...request, kind: 'send', operationId: randomUUID(), route: 'modify', goalId: request.assignment!.assignmentId, text: 'Refine', selection }
  await expect(perform({ ...send, route: 'new_goal', goalId: undefined })).rejects.toThrow()
  await expect(perform({ ...send, target: { planId: h.query.planId, taskId: h.remote.save.definition.tasks[2]!.id } })).rejects.toThrow()
  await h.owner.perform({ kind: 'assignment-command', request: { ...h.remote.query, kind: 'revoke-assignment',
    assignmentId: approved.receipt!.assignmentId, expectedVersion: approved.receipt!.revision, operationId: randomUUID() } })
  await vi.waitFor(() =>{  expect(worker.snapshot().phase).toBe('ready') })
  await expect(perform(send)).rejects.toThrow()
  expect((await perform(request)).result.assignment?.state).toBe('revoked')
  await h.remote.app.authority.grantTask(h.remote.owner.token, { ...h.remote.grant, actions: [], scope: 'subtree', expectedVersion: approved.receipt!.revision,
    operationId: randomUUID() })
  await vi.waitFor(() =>{  expect(worker.snapshot().phase).toBe('ready') })
  await expect(perform(request)).rejects.toThrow()
}, 20000)

it('refuses employee approvals, stale revisions and simultaneous confirmation without duplicating assignments', async () => {
  const h = await setup(), worker = await h.connect('worker', 'reader')
  const denied = await worker.perform({ kind: 'assignment-batch', request: { ...h.query, confirmed: true, commands: [h.command] } })
  expect(denied.assignmentBatch?.items[0]?.state).toBe('denied')
  expect(worker.snapshot().inbox?.items).toHaveLength(0)
  const stale = await h.owner.perform({ kind: 'assignment-batch', request: { ...h.query, planRevision: 2, confirmed: true,
    commands: [{ ...h.command, planRevision: 2, operationId: randomUUID() }] } })
  expect(stale.assignmentBatch?.items[0]?.state).toBe('conflict')
  const request = { ...h.query, confirmed: true, commands: [h.command] }
  const results = await Promise.allSettled([h.owner.perform({ kind: 'assignment-batch', request }), h.owner.perform({ kind: 'assignment-batch', request })])
  expect(results.some(r => r.status === 'fulfilled' && r.value.assignmentBatch?.items[0]?.state === 'confirmed')).toBe(true)
  const history = await h.owner.perform({ kind: 'assignment-tasks', request: { ...h.remote.query, taskId: h.command.taskId } })
  expect(history.assignment?.result).toMatchObject({ kind: 'tasks', value: { total: 1 } })
}, 20000)
