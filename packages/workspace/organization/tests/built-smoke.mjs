/** Plain-Node smoke of the published organization entry; no application listener. */
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID, generateKeyPairSync, sign, createHash } from 'node:crypto'
import { Context } from '@deepseek-ai/cordis'
import { deviceChallengeText } from '@deepseek-ai/dsh-organization/assignment'
import { deliveryCommandSchema } from '@deepseek-ai/dsh-organization/delivery'
import Organization, { createOrganizationToken } from '../lib/index.js'

const root = await mkdtemp(join(tmpdir(), 'organization-built-'))
const path = join(root, 'organization.sqlite')
let ctx = new Context()
try {
  await ctx.plugin(Organization, { path })
  const request = { operationId: randomUUID(), username: 'owner', password: 'built smoke password',
    organizationName: 'Built organization', recoveryToken: createOrganizationToken() }
  const first = await ctx.organization.initialize(request)
  const login = await ctx.organization.login({ username: request.username, password: request.password })
  assert.equal(login.principal.accountId, first.accountId)
  const project = await ctx.organization.projectCommand(login.token, { kind: 'create-project', operationId: randomUUID(),
    organizationId: first.organizationId, name: 'Built WorkGraph' })
  await ctx.organization.grant(login.token, { kind: 'set-grant', operationId: randomUUID(), organizationId: first.organizationId,
    projectId: project.projectId, membershipId: first.membershipId, expectedVersion: project.revision, actions: ['read', 'write'] })
  const taskId = randomUUID(), phaseId = randomUUID(), planId = randomUUID()
  const query = { organizationId: first.organizationId, projectId: project.projectId, planId }
  const definition = { taskId, phases: [{ id: phaseId, title: 'Preparation' }], tasks: [{ id: taskId, phaseId,
    parentTaskId: null, goal: 'Built persistence', scope: 'Shared plan', acceptance: ['Reopens'], artifacts: [],
    required: true, dependsOn: [], suggestedMembershipId: null }] }
  const saved = await ctx.organization.savePlan(login.token, { ...query, operationId: randomUUID(), expectedRevision: 0, definition })
  assert.equal(saved.planRevision, 1)
  const approved = await ctx.organization.assignmentCommand(login.token, { ...query, operationId: randomUUID(),
    kind: 'approve-assignment', taskId, planRevision: 1, assigneeId: first.membershipId })
  const selector = { ...query, assignmentId: approved.assignmentId }
  let inbox
  await ctx.organization.readInbox(login.token, { organizationId: first.organizationId }, value => { inbox = value })
  const accepted = await ctx.organization.participantCommand(login.token, { ...selector, operationId: randomUUID(),
    kind: 'answer-assignment', requestId: inbox.items[0].request.id, expectedVersion: approved.revision, answer: 'accepted' })
  const pair = generateKeyPairSync('ed25519')
  const proof = challenge => ({ challengeId: challenge.challengeId,
    signature: sign(null, Buffer.from(deviceChallengeText(challenge)), pair.privateKey).toString('base64url') })
  const deviceCommand = async command => ctx.organization.deviceCommand(login.token, command,
    proof(await ctx.organization.deviceChallenge(login.token, command)))
  const device = await deviceCommand({ kind: 'register-device', operationId: randomUUID(), organizationId: first.organizationId,
    publicKey: pair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64'), keyGeneration: 1, name: 'Built smoke device' })
  const delegated = await ctx.organization.participantCommand(login.token, { ...selector, operationId: randomUUID(),
    kind: 'delegate', expectedVersion: accepted.revision, deviceId: device.deviceId, executorId: 'desktop-builtin',
    capabilities: ['draft'], budget: 2, expiresAt: Date.now() + 60000 })
  const { lease } = await deviceCommand({ ...selector, kind: 'claim', operationId: randomUUID(), deviceId: device.deviceId,
    delegationId: delegated.delegationId })
  const execute = async command => ctx.organization.executionCommand(login.token, command,
    proof(await ctx.organization.executionChallenge(login.token, command)))
  const base = { ...selector, planRevision: 1, deviceId: device.deviceId }
  const grant = await execute({ ...base, kind: 'grant-execution', operationId: randomUUID(), delegationId: delegated.delegationId,
    capabilities: ['model'], budget: 2, expiresAt: Date.now() + 30000, configDigest: 'a'.repeat(64) })
  const owner = { ...base, executionDelegationId: grant.execution.executionDelegationId,
    serverEpoch: lease.serverEpoch, fencingEpoch: lease.fencingEpoch }
  const run = await execute({ ...owner, kind: 'create-run', operationId: randomUUID(), configDigest: 'a'.repeat(64) })
  const runId = run.execution.runId
  await execute({ ...owner, runId, kind: 'transition-run', operationId: randomUUID(), state: 'cancelled' })
  const bytes = Buffer.from('built evidence'), sha256 = createHash('sha256').update(bytes).digest('hex')
  const uploaded = await ctx.organization.deliveryCommand(login.token, deliveryCommandSchema.parse({ ...selector, runId,
    planRevision: 1, kind: 'publish-artifact', operationId: randomUUID(), artifactKind: 'file', path: 'evidence.txt',
    description: 'Explicitly shared', mediaType: 'text/plain', size: bytes.length, sha256, bytes: bytes.toString('base64') }))
  const artifactId = uploaded.delivery.artifactId
  const submitted = await ctx.organization.deliveryCommand(login.token, { ...selector, runId, planRevision: 1,
    kind: 'submit-delivery', operationId: randomUUID(), artifactIds: [artifactId], summary: 'Built evidence', target: 'Manual review', confirmed: true })
  assert.ok(submitted.delivery.submissionId)
  await ctx.fiber.dispose()
  ctx = new Context()
  await ctx.plugin(Organization, { path })
  assert.deepEqual(await ctx.organization.initialize(request), first)
  assert.equal((await ctx.organization.organizations(login.token))[0].name, request.organizationName)
  await ctx.organization.readPlan(login.token, query, value => assert.deepEqual(value.definition, definition))
  await ctx.organization.downloadArtifact(login.token, { ...selector, artifactId }, value => {
    assert.equal(createHash('sha256').update(Buffer.from(value.bytes, 'base64')).digest('hex'), sha256)
  })
  await ctx.organization.readDelivery(login.token, selector, value => assert.equal(value.submissions[0].state, 'submitted'))
  await ctx.organization.logout(login.token)
  await assert.rejects(ctx.organization.authenticate(login.token), { code: 'unauthenticated' })
  console.log('organization built smoke: initialize, login, WorkGraph and delivery save/reopen, receipt and revocation passed')
} finally {
  await ctx.fiber.dispose()
  await rm(root, { recursive: true, force: true })
}
