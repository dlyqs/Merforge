/** Real private Loader, HTTPS and native device owner; only the OS vault is substituted. */
import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID, randomBytes } from 'node:crypto'
import { bootOrganization } from '../../../../apps/desktop-host/src/organization-boot.ts'
import { OrganizationConnection } from '../src/index.ts'
import * as transport from '@deepseek-ai/dsh-organization-api/transport'
import type { ConnectionResult } from '../src/types.ts'
import type { OrganizationTaskGrant } from '@deepseek-ai/dsh-organization'

const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => { vi.restoreAllMocks(); for (const close of cleanup.splice(0).reverse()) await close() })
const password = 'correct horse battery staple'
const vault = { isEncryptionAvailable: () => true, getSelectedStorageBackend: () => 'test-vault',
  encryptString: (text: string) => Buffer.from(text), decryptString: (bytes: Buffer) => bytes.toString() }
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'native-assignment-'))
  cleanup.push(() => rm(root, { recursive: true, force: true }))
  const app = await bootOrganization({ api: { directory: join(root, 'server'), host: '127.0.0.1', port: 0, names: ['127.0.0.1'], eventPollMs: 20 }, authority: { leaseTtlMs: 2000 } })
  cleanup.push(app.close)
  const init = await app.authority.initialize({ operationId: randomUUID(), username: 'owner', password,
    organizationName: 'Team', recoveryToken: randomBytes(32).toString('base64url') })
  const organizationId = init.organizationId!
  const ownerLogin = await app.authority.login({ username: 'owner', password })
  const inviteToken = randomBytes(32).toString('base64url')
  await app.authority.execute(ownerLogin.token, { kind: 'invite', organizationId, operationId: randomUUID(), role: 'member', invitationToken: inviteToken })
  const employee = await app.authority.register({ operationId: randomUUID(), invitationToken: inviteToken, username: 'employee', password })
  const project = await app.authority.projectCommand(ownerLogin.token, { kind: 'create-project', organizationId, operationId: randomUUID(), name: 'Work' })
  const projectId = project.projectId!
  for (const [membershipId, actions] of [[employee.membershipId, ['read']]] as const) {
    await app.authority.grant(ownerLogin.token, { kind: 'set-grant', organizationId, projectId, membershipId, actions, expectedVersion: 0, operationId: randomUUID() })
  }
  const taskId = randomUUID(), planId = randomUUID(), phaseId = randomUUID()
  const query = { organizationId, projectId, planId }
  await app.authority.savePlan(ownerLogin.token, { ...query, operationId: randomUUID(), expectedRevision: 0,
    definition: { taskId, phases: [{ id: phaseId, title: 'Prepare' }], tasks: [{ id: taskId, phaseId, parentTaskId: null,
      goal: 'Prepare report', scope: 'Bounded report', acceptance: ['Reviewable draft'], artifacts: [], required: true, dependsOn: [], suggestedMembershipId: null }] } })
  await app.authority.grantTask(ownerLogin.token, { ...query, taskId, membershipId: employee.membershipId, scope: 'node', actions: ['read'], expectedVersion: 0, operationId: randomUUID() })
  const connect = async (username: string, machine: string) => {
    const connection = new OrganizationConnection({ trustPath: join(root, `${machine}.json`), reconnectMs: 100 }, { directory: join(root, machine), vault })
    cleanup.push(() => connection.close())
    await connection.perform({ kind: 'probe', origin: `https://127.0.0.1:${app.ready.port}` })
    await connection.perform({ kind: 'trust', fingerprint: app.ready.fingerprint })
    await connection.perform({ kind: 'login', username, password })
    await connection.perform({ kind: 'select', organizationId })
    return connection
  }
  const owner = await connect('owner', 'owner'), worker = await connect('employee', 'worker')
  await vi.waitFor(() =>{  expect(owner.snapshot().phase).toBe('ready') })
  const review = await owner.perform({ kind: 'assignment-review', request: { ...query, taskId, planRevision: 1, assigneeId: employee.membershipId } })
  expect(review.assignment?.result).toMatchObject({ kind: 'review', value: { assigneeCanRead: true } })
  const approved = await owner.perform({ kind: 'assignment-command', request: { ...query, kind: 'approve-assignment', taskId,
    assigneeId: employee.membershipId, planRevision: 1, operationId: randomUUID() } })
  await vi.waitFor(() =>{  expect(worker.snapshot().inbox?.items).toHaveLength(1) })
  const selector = { ...query, assignmentId: approved.receipt!.assignmentId! }
  return { root, app, owner, worker, connect, selector, query, taskId, employee }
}
function preparation(result: ConnectionResult) {
  if (result.assignment?.result.kind !== 'preparation') throw new Error('missing preparation')
  return result.assignment.result.value
}
async function acceptAndDelegate(h: Awaited<ReturnType<typeof setup>>) {
  const item = h.worker.snapshot().inbox!.items[0]!
  await h.worker.perform({ kind: 'assignment-participant', request: { ...h.selector, kind: 'answer-assignment',
    operationId: randomUUID(), requestId: item.request.id, expectedVersion: item.assignment.version, answer: 'accepted' } })
  await h.worker.perform({ kind: 'device-register', name: 'Employee computer' })
  const current = preparation(await h.worker.perform({ kind: 'assignment-preparation', request: h.selector }))
  const delegated = await h.worker.perform({ kind: 'assignment-delegate', request: { ...h.selector, kind: 'delegate',
    operationId: randomUUID(), expectedVersion: current.assignment.version, executorId: 'desktop-builtin',
    capabilities: ['task-read'], budget: 2, durationMs: 60000 } })
  return { ...h.selector, delegationId: delegated.receipt!.delegationId! }
}
it('consumes approval, persistent inbox, separate delegation, native claim, renewal and release through HTTPS', async () => {
  const h = await setup(), claim = await acceptAndDelegate(h)
  const result = await h.worker.perform({ kind: 'lease-claim', request: claim })
  expect(result.receipt?.lease?.state).toBe('held')
  expect(h.worker.snapshot().renewing).toBe(h.selector.assignmentId)
  await vi.waitFor(async () => {
    const current = preparation(await h.worker.perform({ kind: 'assignment-preparation', request: h.selector }))
    expect(current.lease!.version).toBeGreaterThan(result.receipt!.lease!.version)
  }, { timeout: 5000 })
  await h.worker.perform({ kind: 'lease-release', request: h.selector })
  expect(preparation(await h.worker.perform({ kind: 'assignment-preparation', request: h.selector })).lease?.state).toBe('released')
  await vi.waitFor(() =>{  expect(h.owner.snapshot().phase).toBe('ready') })
  const history = await h.owner.perform({ kind: 'assignment-tasks', request: { ...h.query, taskId: h.taskId } })
  expect(history.assignment?.result.kind).toBe('tasks')
  await h.worker.perform({ kind: 'logout' })
  expect(h.worker.snapshot().inbox).toBeUndefined()
  expect(h.worker.snapshot().renewing).toBeUndefined()
})
it('rejects renderer-selected device identity and stops renewal before sleep', async () => {
  const h = await setup(), claim = await acceptAndDelegate(h)
  await expect(h.worker.perform({ kind: 'lease-claim', request: { ...claim, deviceId: randomUUID() } })).rejects.toThrow()
  await vi.waitFor(() =>{  expect(h.owner.snapshot().phase).toBe('ready') })
  expect(preparation(await h.owner.perform({ kind: 'assignment-preparation', request: h.selector })).assignment.state).toBe('accepted')
  await h.worker.perform({ kind: 'lease-claim', request: claim })
  h.worker.suspend()
  expect(h.worker.snapshot().renewing).toBeUndefined()
  expect(h.worker.snapshot().phase).toBe('offline')
  await expect(h.worker.perform({ kind: 'lease-check', request: h.selector })).rejects.toThrow('unavailable')
  await h.worker.perform({ kind: 'reconnect' })
  expect(h.worker.snapshot().renewing).toBeUndefined()
  await h.worker.perform({ kind: 'lease-check', request: h.selector })
  expect(h.worker.snapshot().renewing).toBe(h.selector.assignmentId)
})
it('blocks writes after a committed claim loses its reply and reconciles the receipt without reclaiming', async () => {
  const h = await setup(), claim = await acceptAndDelegate(h)
  const original = transport.organizationRequest
  let dropped = false
  vi.spyOn(transport, 'organizationRequest').mockImplementation(async (...args) => {
    const response = await original(...args)
    if (!dropped && args[2] === '/organization/v1/device/command') { dropped = true; throw new Error('reply-lost') }
    return response
  })
  await expect(h.worker.perform({ kind: 'lease-claim', request: claim })).rejects.toThrow('unavailable')
  await vi.waitFor(() =>{  expect(h.worker.snapshot().phase).toBe('ready') })
  expect(h.worker.snapshot().pendingOperation).toBeDefined()
  await expect(h.worker.perform({ kind: 'lease-claim', request: claim })).rejects.toThrow('operation-pending')
  const reconciled = await h.worker.perform({ kind: 'reconcile' })
  expect(reconciled.receipt?.lease?.fencingEpoch).toBe(1)
  expect(h.worker.snapshot().renewing).toBeUndefined()
  expect(preparation(await h.worker.perform({ kind: 'assignment-preparation', request: h.selector })).lease?.fencingEpoch).toBe(1)
})

it('recovers local registration and revocation material after lost responses', async () => {
  const h = await setup(), original = transport.organizationRequest
  let drop = true
  vi.spyOn(transport, 'organizationRequest').mockImplementation(async (...args) => {
    const response = await original(...args)
    if (drop && args[2] === '/organization/v1/device/command') { drop = false; throw new Error('reply-lost') }
    return response
  })
  await expect(h.worker.perform({ kind: 'device-register', name: 'Recoverable computer' })).rejects.toThrow('unavailable')
  await vi.waitFor(() => { expect(h.worker.snapshot().phase).toBe('ready') })
  const registered = await h.worker.perform({ kind: 'reconcile' })
  const local = await h.worker.perform({ kind: 'device-read' })
  expect(local.assignment?.result).toMatchObject({ kind: 'device', value: { id: registered.receipt?.deviceId } })
  drop = true
  await expect(h.worker.perform({ kind: 'device-revoke', expectedVersion: registered.receipt!.revision })).rejects.toThrow('unavailable')
  await vi.waitFor(() => { expect(h.worker.snapshot().phase).toBe('ready') })
  await h.worker.perform({ kind: 'reconcile' })
  expect((await h.worker.perform({ kind: 'device-read' })).assignment?.result).toEqual({ kind: 'device', value: null })
  const replacement = await h.worker.perform({ kind: 'device-register', name: 'Replacement computer' })
  expect(replacement.receipt?.deviceId).not.toBe(registered.receipt?.deviceId)
  const login = await h.app.authority.login({ username: 'employee', password })
  await h.app.authority.deviceCommand(login.token, { kind: 'revoke-device', operationId: randomUUID(),
    organizationId: h.query.organizationId, deviceId: replacement.receipt!.deviceId, expectedVersion: replacement.receipt!.revision })
  await h.worker.perform({ kind: 'reconnect' })
  const rotated = await h.worker.perform({ kind: 'device-register', name: 'Confirmed rotation' })
  expect(rotated.receipt?.deviceId).not.toBe(replacement.receipt?.deviceId)
})
it('discards a delayed preparation response after leaving the organization', async () => {
  const h = await setup(), original = transport.organizationRequest
  const admitted = Promise.withResolvers<boolean>(), release = Promise.withResolvers<boolean>()
  vi.spyOn(transport, 'organizationRequest').mockImplementation(async (...args) => {
    const response = await original(...args)
    if (args[2] === '/organization/v1/assignment/preparation') { admitted.resolve(true); await release.promise }
    return response
  })
  const reading = h.worker.perform({ kind: 'assignment-preparation', request: h.selector })
  const rejected = expect(reading).rejects.toThrow('superseded')
  await admitted.promise
  await h.worker.perform({ kind: 'personal' })
  release.resolve(true)
  await rejected
  expect(h.worker.snapshot().inbox).toBeUndefined()
})

it('retires accepted preparation after a text revision and never revives it after reapproval', async () => {
  const h = await setup(), claim = await acceptAndDelegate(h)
  await h.worker.perform({ kind: 'lease-claim', request: claim })
  await vi.waitFor(() => { expect(h.owner.snapshot().phase).toBe('ready') })
  const read = await h.owner.perform({ kind: 'workgraph-read', request: h.query })
  if (read.workgraph?.result.kind !== 'plan') throw new Error('missing plan')
  const definition = structuredClone(read.workgraph.result.value.definition)
  definition.tasks[0]!.scope = 'Revised preparation'
  await h.owner.perform({ kind: 'workgraph-save', request: { ...h.query, definition, expectedRevision: 1, operationId: randomUUID() } })
  await h.worker.perform({ kind: 'reconnect' })
  const retired = preparation(await h.worker.perform({ kind: 'assignment-preparation', request: h.selector }))
  expect(retired.assignment).toMatchObject({ state: 'invalidated', reason: 'revision-changed', planRevision: 1 })
  expect(retired.lease?.state).toBe('invalidated')
  await expect(h.worker.perform({ kind: 'lease-claim', request: claim })).rejects.toThrow('version-conflict')
  await vi.waitFor(() => { expect(h.owner.snapshot().phase).toBe('ready') })
  const approved = await h.owner.perform({ kind: 'assignment-command', request: { ...h.query,
    kind: 'approve-assignment', taskId: h.taskId, planRevision: 2, assigneeId: h.employee.membershipId, operationId: randomUUID() } })
  expect(approved.receipt!.assignmentId).not.toBe(h.selector.assignmentId)
  await h.worker.perform({ kind: 'reconnect' })
  expect(preparation(await h.worker.perform({ kind: 'assignment-preparation', request: h.selector })).assignment.state).toBe('invalidated')
  const fresh = preparation(await h.worker.perform({ kind: 'assignment-preparation', request: { ...h.selector, assignmentId: approved.receipt!.assignmentId } }))
  expect(fresh.assignment.state).toBe('pending')
  expect(fresh.lease).toBeNull()
})

it('keeps revoked read authority terminal after granting it again and clears inbox on organization switch', async () => {
  const h = await setup(), claim = await acceptAndDelegate(h)
  await h.worker.perform({ kind: 'lease-claim', request: claim })
  const login = await h.app.authority.login({ username: 'owner', password })
  let grants: OrganizationTaskGrant[] = []
  await h.app.authority.readTaskGrants(login.token, h.query, (value) => { grants = value })
  const previous = grants.find(item => item.membershipId === h.employee.membershipId)!
  const request = { ...h.query, taskId: h.taskId, membershipId: h.employee.membershipId, scope: 'node', operationId: randomUUID() }
  const revoked = await h.app.authority.grantTask(login.token, { ...request, actions: [], expectedVersion: previous.version })
  await h.worker.perform({ kind: 'reconnect' })
  expect(h.worker.snapshot().inbox?.total).toBe(0)
  await expect(h.worker.perform({ kind: 'assignment-preparation', request: h.selector })).rejects.toThrow('forbidden')
  await h.app.authority.grantTask(login.token, { ...request, operationId: randomUUID(), actions: ['read'], expectedVersion: revoked.revision })
  await h.worker.perform({ kind: 'reconnect' })
  expect(preparation(await h.worker.perform({ kind: 'assignment-preparation', request: h.selector })).assignment)
    .toMatchObject({ state: 'invalidated', reason: 'authority-lost' })
  await expect(h.worker.perform({ kind: 'lease-claim', request: claim })).rejects.toThrow('version-conflict')
  const employeeLogin = await h.app.authority.login({ username: 'employee', password })
  const other = await h.app.authority.execute(employeeLogin.token, { kind: 'create-organization', name: 'Other organization', operationId: randomUUID() })
  await h.worker.perform({ kind: 'reconnect' })
  await h.worker.perform({ kind: 'select', organizationId: other.organizationId })
  expect(h.worker.snapshot().inbox?.total).toBe(0)
  expect(h.worker.snapshot().renewing).toBeUndefined()
  await expect(h.worker.perform({ kind: 'assignment-preparation', request: h.selector })).rejects.toThrow()
})

it('uses fixed signed execution actions over HTTPS and preserves preparation-only permissions', async () => {
  const h = await setup(), delegation = await acceptAndDelegate(h)
  const claimed = await h.worker.perform({ kind: 'lease-claim', request: delegation })
  const lease = claimed.receipt!.lease!
  const current = preparation(await h.worker.perform({ kind: 'assignment-preparation', request: h.selector }))
  expect(current.delegations[0]?.capabilities).toEqual(['task-read'])
  const base = { ...h.selector, planRevision: 1 }
  const granted = await h.worker.perform({ kind: 'execution-command', request: { ...base, kind: 'grant-execution', operationId: randomUUID(),
    delegationId: delegation.delegationId, capabilities: ['model'], budget: 1, expiresAt: current.serverTime + 20000, configDigest: 'a'.repeat(64) } })
  const owner = { ...base, executionDelegationId: granted.receipt!.execution!.executionDelegationId,
    serverEpoch: lease.serverEpoch, fencingEpoch: lease.fencingEpoch }
  const created = await h.worker.perform({ kind: 'execution-command', request: { ...owner, kind: 'create-run', operationId: randomUUID(), configDigest: 'a'.repeat(64) } })
  const runId = created.receipt!.execution!.runId!
  const read = await h.worker.perform({ kind: 'execution-read', request: { ...h.selector, runId } })
  expect(read.execution?.run.state).toBe('prepared'); expect(read.execution?.delegation.used).toBe(0)
  await h.worker.perform({ kind: 'execution-command', request: { ...owner, runId, kind: 'transition-run', state: 'running', operationId: randomUUID() } })
  await h.worker.perform({ kind: 'execution-command', request: { ...owner, runId, kind: 'reserve-action', operationId: randomUUID(),
    actionId: randomUUID(), capability: 'model', requestDigest: 'b'.repeat(64) } })
  const after = await h.worker.perform({ kind: 'execution-read', request: { ...h.selector, runId } })
  expect(after.execution?.delegation.used).toBe(1)
  await expect(h.worker.perform({ kind: 'execution-command', request: { ...owner, deviceId: randomUUID(), runId,
    kind: 'transition-run', state: 'cancelled', operationId: randomUUID() } })).rejects.toThrow('invalid-input')
})
