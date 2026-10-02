import { generateKeyPairSync, sign, randomUUID } from 'node:crypto'
import { assignmentHarness } from './assignment-harness.ts'
import { operationId } from './harness.ts'
import { deviceChallengeText } from '../src/device-schema.ts'
import type { Config } from '../src/index.ts'
import type { z } from 'zod'
import type { executionCodexBackendSchema } from '../src/execution-schema.ts'
import type { OrganizationDeviceChallenge, OrganizationExecutionView } from '../src/index.ts'
export async function setupExecution(cleanup: (() => Promise<unknown>)[], budget = 2, configDigest = 'a'.repeat(64), capabilities: ('model' | 'fs-read' | 'fs-write' | 'shell' | 'codex-turn')[] = ['model'], prepare?: (h: Awaited<ReturnType<typeof assignmentHarness>>) => Promise<void>, native?: { backend: z.output<typeof executionCodexBackendSchema>; policy: NonNullable<Config['executionCodex']> }) {
  const h = await assignmentHarness(cleanup, native === undefined ? {} : { executionCodex: native.policy })
  await prepare?.(h)
  const approved = await h.service.assignmentCommand(h.owner.token, h.approve)
  const selector = { ...h.query, assignmentId: approved.assignmentId }
  const accepted = await h.service.participantCommand(h.other.token, { ...selector, kind: 'answer-assignment', operationId: operationId(),
    requestId: h.db.prepare('SELECT id FROM assignment_requests').get()?.id, expectedVersion: approved.revision, answer: 'accepted' })
  const pair = generateKeyPairSync('ed25519')
  const proof = (c: OrganizationDeviceChallenge) => ({ challengeId: c.challengeId, signature: sign(null, Buffer.from(deviceChallengeText(c)), pair.privateKey).toString('base64url') })
  const registration = { kind: 'register-device', operationId: operationId(), organizationId: h.query.organizationId,
    publicKey: pair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64'), keyGeneration: 1, name: 'Employee' }
  const device = await h.service.deviceCommand(h.other.token, registration,
    proof(await h.service.deviceChallenge(h.other.token, registration)))
  const prep = await h.service.participantCommand(h.other.token, { ...selector, kind: 'delegate', operationId: operationId(),
    expectedVersion: accepted.revision, deviceId: device.deviceId, executorId: 'desktop-builtin', capabilities: ['draft'], budget, expiresAt: Date.now() + 60000 })
  const claim = { ...selector, kind: 'claim', operationId: operationId(), deviceId: device.deviceId, delegationId: prep.delegationId }
  const lease = (await h.service.deviceCommand(h.other.token, claim, proof(await h.service.deviceChallenge(h.other.token, claim)))).lease!
  const base = { ...selector, planRevision: h.approve.planRevision, deviceId: device.deviceId }
  const execute = async (command: object) => h.service.executionCommand(h.other.token, command,
    proof(await h.service.executionChallenge(h.other.token, command)))
  const grant = await execute({ ...base, kind: 'grant-execution', operationId: operationId(), delegationId: prep.delegationId,
    ...native === undefined ? {} : { backend: native.backend }, capabilities, budget, expiresAt: Date.now() + 30000, configDigest })
  const owner = { ...base, executionDelegationId: grant.execution!.executionDelegationId, serverEpoch: lease.serverEpoch,
    fencingEpoch: lease.fencingEpoch }
  const create = { ...owner, kind: 'create-run', operationId: operationId(), configDigest, ...native === undefined ? {} : { backend: native.backend } }
  const created = await execute(create)
  const run = { ...owner, runId: created.execution!.runId }
  const read = async () => {
    let view: OrganizationExecutionView | undefined
    await h.service.readExecution(h.other.token, { ...selector, runId: run.runId }, (v) => { view = v })
    return view!
  }
  const transition = (state: string) => execute({ ...run, kind: 'transition-run', state, operationId: operationId() })
  const action = () => ({ ...run, kind: 'reserve-action', operationId: operationId(), actionId: randomUUID(), capability: 'model', requestDigest: 'b'.repeat(64) })
  return { ...h, selector, execute, read, transition, action, run, create, created, proof }
}
