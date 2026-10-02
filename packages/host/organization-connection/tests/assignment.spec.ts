import { OrganizationIntegration } from '../../../../apps/desktop/src/organization-integration.ts'
import { execFileSync } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
/** Real private Loader, HTTPS and native device owner; only the OS vault is substituted. */
import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID, randomBytes, createHash } from 'node:crypto'
import { bootOrganization } from '../../../../apps/desktop-host/src/organization-boot.ts'
import { OrganizationConnection } from '../src/index.ts'
import * as transport from '@deepseek-ai/dsh-organization-api/transport'
import { backupOrganization, restoreOrganization } from '@deepseek-ai/dsh-organization/maintenance'
import { request as httpsRequest } from 'node:https'
import { DatabaseSync } from 'node:sqlite'
import { readFile, writeFile } from 'node:fs/promises'
import { executionCommandSchema } from '@deepseek-ai/dsh-organization/execution'
import type { ConnectionResult } from '../src/types.ts'
import type { OrganizationTaskGrant } from '@deepseek-ai/dsh-organization'

const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => { vi.restoreAllMocks(); for (const close of cleanup.splice(0).reverse()) await close() })
const password = 'correct horse battery staple'
const vault = { isEncryptionAvailable: () => true, getSelectedStorageBackend: () => 'test-vault',
  encryptString: (text: string) => Buffer.from(text), decryptString: (bytes: Buffer) => bytes.toString() }
async function setup(native = false) {
  const root = await mkdtemp(join(tmpdir(), 'native-assignment-'))
  cleanup.push(() => rm(root, { recursive: true, force: true }))
  const app = await bootOrganization({ api: { directory: join(root, 'server'), host: '127.0.0.1', port: 0, names: ['127.0.0.1'], eventPollMs: 20 }, authority: { leaseTtlMs: 2000, ...native ? { executionCodex: [{ runtimeVersion: '0.153.4', model: 'native-test', efforts: ['medium'], maxTurns: 2, maxDurationMs: 10000 }] } : {} } })
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
  await vi.waitFor(async () => {
    expect(h.owner.snapshot().phase).toBe('ready')
    expect(preparation(await h.owner.perform({ kind: 'assignment-preparation', request: h.selector })).assignment.state).toBe('accepted')
  }, { timeout: 5000 })
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
  const created = await h.worker.perform({ kind: 'execution-command', request: { ...owner, kind: 'create-run',
    operationId: randomUUID(), configDigest: 'a'.repeat(64) } })
  const runId = created.receipt!.execution!.runId!
  const read = await h.worker.perform({ kind: 'execution-read', request: { ...h.selector, runId } })
  expect(read.execution?.run.state).toBe('prepared'); expect(read.execution?.delegation.used).toBe(0)
  const channel = h.worker.executionChannel({ ...h.selector, runId })
  await channel.command(executionCommandSchema.parse({ ...owner, runId, deviceId: lease.deviceId,
    kind: 'transition-run', state: 'running', operationId: randomUUID() }))
  await channel.command(executionCommandSchema.parse({ ...owner, runId, deviceId: lease.deviceId,
    kind: 'reserve-action', operationId: randomUUID(), actionId: randomUUID(), capability: 'model', requestDigest: 'b'.repeat(64) }))
  await expect(h.worker.perform({ kind: 'execution-command', request: { ...owner, runId, kind: 'settle-action',
    actionId: randomUUID(), outcome: 'succeeded', evidenceDigest: 'c'.repeat(64), operationId: randomUUID() } })).rejects.toThrow('forbidden')
  await vi.waitFor(() => { expect(h.worker.snapshot().phase).toBe('ready') })
  const after = await h.worker.perform({ kind: 'execution-read', request: { ...h.selector, runId } })
  expect(after.execution?.delegation.used).toBe(1)
  await expect(h.worker.perform({ kind: 'execution-command', request: { ...owner, deviceId: randomUUID(), runId,
    kind: 'transition-run', state: 'cancelled', operationId: randomUUID() } })).rejects.toThrow('invalid-input')
})

async function executionChannelFixture() {
  const h = await setup(), delegation = await acceptAndDelegate(h)
  const claimed = await h.worker.perform({ kind: 'lease-claim', request: delegation })
  const lease = claimed.receipt!.lease!
  const current = preparation(await h.worker.perform({ kind: 'assignment-preparation', request: h.selector }))
  const base = { ...h.selector, planRevision: 1 }
  const granted = await h.worker.perform({ kind: 'execution-command', request: { ...base, kind: 'grant-execution', operationId: randomUUID(),
    delegationId: delegation.delegationId, capabilities: ['model'], budget: 2, expiresAt: current.serverTime + 20000, configDigest: 'a'.repeat(64) } })
  const owner = { ...base, executionDelegationId: granted.receipt!.execution!.executionDelegationId,
    serverEpoch: lease.serverEpoch, fencingEpoch: lease.fencingEpoch }
  const created = await h.worker.perform({ kind: 'execution-command', request: { ...owner, kind: 'create-run',
    operationId: randomUUID(), configDigest: 'a'.repeat(64) } })
  const runId = created.receipt!.execution!.runId!
  const channel = h.worker.executionChannel({ ...h.selector, runId })
  const run = (await channel.read()).run
  const command = (fields: object) => executionCommandSchema.parse({ ...owner, runId, deviceId: run.deviceId,
    operationId: randomUUID(), ...fields })
  return { h, channel, command, runId }
}
it('keeps Run commands alive across projection refreshes but permanently retires the channel before sleep', async () => {
  const { h, channel, command } = await executionChannelFixture()
  await channel.command(command({ kind: 'transition-run', state: 'running' }))
  await vi.waitFor(() => { expect(h.worker.snapshot().generation).toBeGreaterThan(channel.generation) })
  expect(channel.signal.aborted).toBe(false)
  const initial = preparation(await h.worker.perform({ kind: 'assignment-preparation', request: h.selector })).lease!
  await vi.waitFor(async () => {
    const latest = preparation(await h.worker.perform({ kind: 'assignment-preparation', request: h.selector })).lease!
    expect(latest.version).toBeGreaterThan(initial.version)
  }, { timeout: 5000 })
  expect(channel.signal.aborted).toBe(false)
  const actionId = randomUUID()
  await channel.command(command({ kind: 'reserve-action', actionId, capability: 'model', requestDigest: 'b'.repeat(64) }))
  await channel.command(command({ kind: 'settle-action', actionId, outcome: 'succeeded', evidenceDigest: 'c'.repeat(64) }))
  expect((await channel.read()).actions).toMatchObject([{ actionId, state: 'succeeded' }])
  await expect(channel.command(command({ kind: 'transition-run', runId: randomUUID(), state: 'cancelled' }))).rejects.toThrow('forbidden')
  h.worker.suspend()
  expect(channel.signal.aborted).toBe(true)
  await h.worker.perform({ kind: 'reconnect' })
  await expect(channel.read()).rejects.toThrow()
  await expect(channel.command(command({ kind: 'transition-run', state: 'cancelled' }))).rejects.toThrow()
})

it('rejects delayed Run reads after logout and does not reuse the channel on a same-account login', async () => {
  const { h, channel } = await executionChannelFixture()
  const original = transport.organizationRequest
  const admitted = Promise.withResolvers<boolean>(), release = Promise.withResolvers<boolean>()
  vi.spyOn(transport, 'organizationRequest').mockImplementation(async (...args) => {
    const response = await original(...args)
    if (args[2] === '/organization/v1/execution/read') { admitted.resolve(true); await release.promise }
    return response
  })
  const reading = channel.read(), rejected = expect(reading).rejects.toThrow()
  await admitted.promise
  await h.worker.perform({ kind: 'logout' })
  release.resolve(true)
  await rejected
  await h.worker.perform({ kind: 'login', username: 'employee', password })
  await h.worker.perform({ kind: 'select', organizationId: h.query.organizationId })
  expect(channel.signal.aborted).toBe(true)
  await expect(channel.read()).rejects.toThrow()
})
it('retains an ambiguous Run command for receipt reconciliation without replay', async () => {
  const { h, channel, command } = await executionChannelFixture()
  const original = transport.organizationRequest
  let sent = 0
  vi.spyOn(transport, 'organizationRequest').mockImplementation(async (...args) => {
    const response = await original(...args)
    if (args[2] === '/organization/v1/execution/command') { sent++; throw new Error('reply-lost') }
    return response
  })
  await expect(channel.command(command({ kind: 'transition-run', state: 'running' }))).rejects.toThrow('unavailable')
  expect(channel.signal.aborted).toBe(true)
  expect(h.worker.snapshot().pendingOperation).toBeDefined()
  await vi.waitFor(() => { expect(h.worker.snapshot().phase).toBe('ready') })
  await h.worker.perform({ kind: 'reconcile' })
  expect(sent).toBe(1)
  await expect(channel.read()).rejects.toThrow()
})

it('does not acknowledge native cancellation until the owned Host interval drains', async () => {
  const { h, channel, command, runId } = await executionChannelFixture()
  await channel.command(command({ kind: 'transition-run', state: 'running' }))
  const entered = Promise.withResolvers<boolean>(), aborted = Promise.withResolvers<boolean>(), release = Promise.withResolvers<boolean>()
  const running = channel.run(async (signal) => {
    entered.resolve(true)
    await new Promise<void>((resolve) =>{  signal.addEventListener('abort', () => { aborted.resolve(true); resolve() }, { once: true }) })
    await release.promise
    signal.throwIfAborted()
  })
  const rejected = expect(running).rejects.toThrow()
  await entered.promise
  await vi.waitFor(() => { expect(h.worker.snapshot().phase).toBe('ready') })
  const { deviceId: _device, ...request } = command({ kind: 'transition-run', state: 'cancelled' })
  let acknowledged = false
  const stopping = h.worker.perform({ kind: 'execution-command', request }).then((result) => { acknowledged = true; return result })
  try {
    await aborted.promise
    expect(acknowledged).toBe(false)
  } finally { release.resolve(true) }
  await rejected
  expect((await stopping).receipt?.execution?.runId).toBe(runId)
  expect(acknowledged).toBe(true)
})
it('delivers a durable execution question through HTTPS, keeps replies separate and rechecks continuation', async () => {
  const { h, channel, command, runId } = await executionChannelFixture()
  await channel.command(command({ kind: 'transition-run', state: 'running' }))
  const view = await channel.read(), requestId = randomUUID()
  await channel.command(command({ kind: 'request-execution-human', requestId, handlerId: view.approvedBy,
    requestKind: 'work-question', prompt: 'Please verify the report.', actionId: null, requestDigest: null,
    expiresAt: view.delegation.expiresAt }))
  await vi.waitFor(() => { expect(h.owner.snapshot().inbox?.items.some(i => i.request.id === requestId)).toBe(true) })
  const answer = { ...h.selector, kind: 'answer-execution-question', requestId, runId, planRevision: 1,
    answer: 'Report verified.', operationId: randomUUID() }
  await h.owner.perform({ kind: 'assignment-participant', request: answer })
  await h.owner.perform({ kind: 'assignment-participant', request: answer })
  expect((await channel.read()).run.state).toBe('waiting-human')
  await channel.command(command({ kind: 'resume-run' }))
  expect((await channel.read()).run.state).toBe('running')
  h.worker.suspend()
  await expect(channel.command(command({ kind: 'resume-run' }))).rejects.toThrow()
})

it('shares immutable bytes and formal employee submissions over HTTPS, including stopped backup and restore', async () => {
  const { h, channel, command, runId } = await executionChannelFixture()
  await channel.command(command({ kind: 'transition-run', state: 'running' }))
  await channel.command(command({ kind: 'transition-run', state: 'succeeded' }))
  const bytes = Buffer.from('name,total\nalpha,42\n')
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const base = { ...h.selector, runId, planRevision: 1 }
  const upload = { ...base, kind: 'publish-artifact', operationId: randomUUID(), artifactKind: 'test-report',
    path: 'report.csv', description: 'Independent CSV evidence', mediaType: 'text/csv', size: bytes.length, sha256, bytes: bytes.toString('base64') }
  await vi.waitFor(() =>{  expect(h.worker.snapshot().phase).toBe('ready') })
  const published = await h.worker.perform({ kind: 'delivery-command', request: upload })
  const artifactId = published.receipt!.delivery!.artifactId!
  expect((await h.worker.perform({ kind: 'delivery-command', request: upload })).receipt).toEqual(published.receipt)
  expect((await h.owner.perform({ kind: 'delivery-read', request: h.selector })).delivery?.submissions).toEqual([])
  const submitted = await h.worker.perform({ kind: 'delivery-command', request: { ...base, kind: 'submit-delivery',
    operationId: randomUUID(), artifactIds: [artifactId], summary: 'Completed report', target: 'Review CSV before import', confirmed: true } })
  await vi.waitFor(() =>{  expect(h.owner.snapshot().inbox?.items.some(i => i.request.kind === 'accept-delivery'
    && i.request.id === submitted.receipt!.delivery!.submissionId)).toBe(true) })
  const result = await h.owner.perform({ kind: 'delivery-download', request: { ...h.selector, artifactId } })
  const output = join(h.root, 'received.csv')
  await writeFile(output, Buffer.from(result.artifact!.bytes, 'base64'))
  expect(createHash('sha256').update(await readFile(output)).digest('hex')).toBe(sha256)
  expect(result.artifact!.artifact).not.toHaveProperty('sessionId')
  const decision = { ...base, kind: 'accept-delivery', operationId: randomUUID(), submissionId: submitted.receipt!.delivery!.submissionId,
    artifacts: [{ artifactId, sha256 }], confirmed: true }
  await expect(h.worker.perform({ kind: 'delivery-command', request: decision })).rejects.toThrow('forbidden')
  expect(h.worker.snapshot().organizationId).toBe(h.query.organizationId)
  const accepted = await h.owner.perform({ kind: 'delivery-command', request: decision })
  expect((await h.owner.perform({ kind: 'delivery-command', request: decision })).receipt).toEqual(accepted.receipt)
  await vi.waitFor(async () => {
    expect((await h.worker.perform({ kind: 'delivery-read', request: h.selector })).delivery?.submissions[0]?.reviewState).toBe('accepted')
  })

  const target = join(h.root, 'target')
  await mkdir(target)
  const git = (...args: string[]) => execFileSync('git', ['-C', target, ...args], { encoding: 'utf8' })
  git('init'); git('-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '--allow-empty', '-m', 'baseline')
  await writeFile(join(target, 'report.csv'), bytes)
  await writeFile(join(target, 'untouched.txt'), 'unchanged')
  const integration = new OrganizationIntegration()
  const query = { ...h.query, taskId: h.taskId, planRevision: 1 }
  await vi.waitFor(() => { expect(h.owner.snapshot().phase).toBe('ready') })
  expect((await h.owner.perform({ kind: 'integration-read', request: query })).integration?.delivered).toBe(false)
  await expect(h.owner.perform({ kind: 'integration-verify', request: query })).rejects.toThrow('forbidden')
  const verified = await integration.perform(h.owner, { kind: 'integration-verify', request: query }, async () => target, () => {})
  const integrationId = verified.receipt!.integration!.integrationId
  await vi.waitFor(() => { expect(h.owner.snapshot().phase).toBe('ready') })
  const confirm = { kind: 'integration-confirm', request: { ...query, integrationId, confirmed: true } }
  await expect(new OrganizationIntegration().perform(h.owner, confirm, async () => target, () => {})).rejects.toThrow('version-conflict')
  const confirmed = await integration.perform(h.owner, confirm, async () => { throw new Error('unexpected dialog') }, () => {})
  expect(confirmed.receipt?.integration?.delivered).toBe(true)
  await vi.waitFor(() => { expect(h.owner.snapshot().phase).toBe('ready') })
  expect((await h.owner.perform({ kind: 'integration-read', request: query })).integration?.delivered).toBe(true)
  expect(await readFile(join(target, 'untouched.txt'), 'utf8')).toBe('unchanged')
  expect(execFileSync(process.execPath, ['-e', 'process.stdout.write(require("node:fs").readFileSync(process.argv[1]))', join(target, 'report.csv')])).toEqual(bytes)

  await h.worker.close(); await h.owner.close(); await h.app.close()
  const backup = join(h.root, 'backup'), servicePath = join(h.root, 'server')
  backupOrganization(servicePath, backup, 100)
  restoreOrganization(backup, servicePath, 100)
  const restarted = await bootOrganization({ api: { directory: servicePath, host: '127.0.0.1', port: 0, names: ['127.0.0.1'] } })
  cleanup.push(restarted.close)
  const login = await restarted.authority.login({ username: 'owner', password })
  await restarted.authority.downloadArtifact(login.token, { ...h.selector, artifactId }, (value) =>{  expect(value.bytes).toBe(bytes.toString('base64')) })
  await restarted.authority.readDelivery(login.token, h.selector, (value) => {
    expect(value.submissions[0]?.acceptance?.id).toBe(accepted.receipt!.delivery!.acceptanceId)
  })
  await restarted.authority.readIntegration(login.token, query, (value) => { expect(value.delivered).toBe(true) })
  await restarted.close()
  const damaged = new DatabaseSync(join(backup, 'organization.sqlite'))
  damaged.prepare('UPDATE organization_artifacts SET bytes=?').run(Buffer.from('damaged'))
  damaged.close()
  expect(() => restoreOrganization(backup, servicePath, 100)).toThrow('invalid-backup-hash')
}, 20000)

it('refuses artifact disclosure when the native identity changes during an HTTPS download', async () => {
  const { h, runId } = await executionChannelFixture()
  const bytes = Buffer.from('explicit shared data')
  const publish = await h.worker.perform({ kind: 'delivery-command', request: { ...h.selector, runId, planRevision: 1,
    kind: 'publish-artifact', operationId: randomUUID(), artifactKind: 'file', path: 'evidence.txt', description: 'Selected evidence',
    mediaType: 'text/plain', size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.toString('base64') } })
  const original = transport.organizationRequest, arrived = Promise.withResolvers<boolean>(), release = Promise.withResolvers<boolean>()
  vi.spyOn(transport, 'organizationRequest').mockImplementation(async (...args) => {
    const response = await original(...args)
    if (args[2] === '/organization/v1/delivery/download') { arrived.resolve(true); await release.promise }
    return response
  })
  const download = h.worker.perform({ kind: 'delivery-download', request: { ...h.selector, artifactId: publish.receipt!.delivery!.artifactId } })
  const rejected = expect(download).rejects.toThrow('superseded')
  await arrived.promise
  await h.worker.perform({ kind: 'personal' })
  release.resolve(true)
  await rejected
}, 15000)

it('does not publish an interrupted HTTPS upload or an upload with mismatched bytes', async () => {
  const { h, runId } = await executionChannelFixture()
  const login = await h.app.authority.login({ username: 'employee', password })
  const bytes = Buffer.alloc(20000, 65)
  const upload = { ...h.selector, runId, planRevision: 1, kind: 'publish-artifact', operationId: randomUUID(),
    artifactKind: 'file', path: 'selected.txt', description: 'Selected bytes', mediaType: 'text/plain', size: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.toString('base64') }
  const body = JSON.stringify(upload)
  await new Promise<void>((resolve) => {
    const req = httpsRequest({ hostname: '127.0.0.1', port: h.app.ready.port, ca: h.app.ready.certificate,
      path: '/organization/v1/delivery/command', method: 'POST', headers: { authorization: `Bearer ${login.token}`,
        'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } })
    req.on('error', () => { /* This test intentionally interrupts its owned upload socket. */ })
    req.on('close', resolve)
    req.write(body.slice(0, 1000), () => { setTimeout(() => req.destroy(), 30) })
  })
  await h.app.authority.readDelivery(login.token, h.selector, (value) => { expect(value.artifacts).toEqual([]) })
  await expect(h.app.authority.receipt(login.token, upload.operationId)).resolves.toBeNull()
  const trust = { origin: `https://127.0.0.1:${h.app.ready.port}`, certificate: h.app.ready.certificate,
    fingerprint: h.app.ready.fingerprint, expiresAt: h.app.ready.expiresAt, timeoutMs: 1000, maxResponseBytes: 1048576 }
  const wrong = await transport.organizationRequest(trust, 'POST', '/organization/v1/delivery/command', { ...upload, size: 1 }, login.token)
  expect(wrong.status).toBe(400)
  const correct = await transport.organizationRequest(trust, 'POST', '/organization/v1/delivery/command', upload, login.token)
  expect(correct.status).toBe(200)
}, 15000)


it('rejects through fixed HTTPS actions, notifies the employee and prevents old Run authority from entering rework', async () => {
  const { h, channel, command, runId } = await executionChannelFixture()
  await channel.command(command({ kind: 'transition-run', state: 'cancelled' }))
  const bytes = Buffer.from('first report'), sha256 = createHash('sha256').update(bytes).digest('hex')
  const base = { ...h.selector, runId, planRevision: 1 }
  const uploaded = await h.worker.perform({ kind: 'delivery-command', request: { ...base, kind: 'publish-artifact', operationId: randomUUID(),
    artifactKind: 'file', path: 'report.txt', description: 'Report', mediaType: 'text/plain', size: bytes.length, sha256, bytes: bytes.toString('base64') } })
  const artifactId = uploaded.receipt!.delivery!.artifactId!
  const submitted = await h.worker.perform({ kind: 'delivery-command', request: { ...base, kind: 'submit-delivery', operationId: randomUUID(),
    artifactIds: [artifactId], summary: 'Report ready', target: 'Review report', confirmed: true } })
  const decision = { ...base, kind: 'reject-delivery', operationId: randomUUID(), submissionId: submitted.receipt!.delivery!.submissionId,
    artifacts: [{ artifactId, sha256 }], confirmed: true, reason: 'Insufficient rows', requirements: 'Include all departments' }
  await vi.waitFor(() => { expect(h.owner.snapshot().phase).toBe('ready') })
  const rejected = await h.owner.perform({ kind: 'delivery-command', request: decision })
  expect((await h.owner.perform({ kind: 'delivery-command', request: decision })).receipt).toEqual(rejected.receipt)
  await vi.waitFor(() => { expect(h.worker.snapshot().inbox?.items.some(i => i.request.kind === 'accept-delivery'
    && i.request.reviewState === 'rejected')).toBe(true) })
  const page = await h.worker.perform({ kind: 'delivery-read', request: h.selector })
  expect(page.delivery?.submissions[0]?.acceptance?.reworkRevision).toBe(2)
  await expect(channel.command(command({ kind: 'reserve-action', actionId: randomUUID(), capability: 'model', requestDigest: 'a'.repeat(64) }))).rejects.toThrow()
  const current = preparation(await h.worker.perform({ kind: 'assignment-preparation', request: h.selector }))
  expect(current.assignment).toMatchObject({ state: 'invalidated', reason: 'revision-changed' })
  const approved = await h.owner.perform({ kind: 'assignment-command', request: { ...h.query, kind: 'approve-assignment',
    operationId: randomUUID(), taskId: h.taskId, planRevision: 2, assigneeId: h.employee.membershipId } })
  await vi.waitFor(() => { expect(h.worker.snapshot().inbox?.items.some(i => i.assignment.id === approved.receipt!.assignmentId
    && i.request.kind === 'accept-assignment' && i.request.state === 'pending')).toBe(true) })
  expect((await h.owner.perform({ kind: 'delivery-download', request: { ...h.selector, artifactId } })).artifact?.bytes).toBe(bytes.toString('base64'))
}, 20000)

it('carries native backend grants and scheduling permits through signed HTTPS while retiring the Run channel on identity change', async () => {
  const h = await setup(true), delegation = await acceptAndDelegate(h)
  const claimed = await h.worker.perform({ kind: 'lease-claim', request: delegation })
  const lease = claimed.receipt!.lease!
  const backend = { kind: 'codex', dispatch: 'device-native', runtimeVersion: '0.153.4', model: 'native-test', effort: 'medium',
    maxTurns: 2, maxDurationMs: 10000 }
  const base = { ...h.selector, planRevision: 1 }
  const granted = await h.worker.perform({ kind: 'execution-command', request: { ...base, kind: 'grant-execution', operationId: randomUUID(),
    delegationId: delegation.delegationId, backend, capabilities: ['codex-turn'], budget: 2, expiresAt: Date.now() + 20000, configDigest: 'a'.repeat(64) } })
  const owner = { ...base, executionDelegationId: granted.receipt!.execution!.executionDelegationId,
    serverEpoch: lease.serverEpoch, fencingEpoch: lease.fencingEpoch }
  const created = await h.worker.perform({ kind: 'execution-command', request: { ...owner, backend, kind: 'create-run',
    operationId: randomUUID(), configDigest: 'a'.repeat(64) } })
  const runId = created.receipt!.execution!.runId!
  const channel = h.worker.executionChannel({ ...h.selector, runId })
  const view = await channel.read()
  expect(view.run.backend).toEqual(backend)
  expect(view.codexPolicy).toHaveLength(1)
  const command = (fields: object) => executionCommandSchema.parse({ ...owner, deviceId: lease.deviceId,
    runId, operationId: randomUUID(), ...fields })
  await channel.command(command({ kind: 'transition-run', state: 'running' }))
  const actionId = randomUUID()
  await channel.command(command({ kind: 'reserve-action', actionId, capability: 'codex-turn', requestDigest: 'b'.repeat(64) }))
  await expect(h.worker.perform({ kind: 'execution-command', request: { ...owner, runId, kind: 'settle-action', actionId,
    outcome: 'succeeded', evidenceDigest: 'c'.repeat(64), operationId: randomUUID() } })).rejects.toThrow('forbidden')
  await channel.command(command({ kind: 'settle-action', actionId, outcome: 'unknown', evidenceDigest: 'c'.repeat(64) }))
  await channel.command(command({ kind: 'transition-run', state: 'paused', stopReason: 'employee-stop' }))
  expect((await channel.read()).run.stopReason).toBe('employee-stop')
  await h.worker.perform({ kind: 'personal' })
  expect(channel.signal.aborted).toBe(true)
  await expect(channel.read()).rejects.toThrow()
}, 20000)
