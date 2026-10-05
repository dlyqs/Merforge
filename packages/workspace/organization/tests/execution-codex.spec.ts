/** Real Loader/SQLite native scheduling qualifications, independent of API model permits. */
import { randomUUID } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import { setupExecution } from './execution-harness.ts'
import { operationId, openHarness } from './harness.ts'
import { openOrganizationDatabase } from '../src/database.ts'
import { configSchema } from '../src/schema.ts'
import { executionCodexBackendSchema } from '../src/execution-schema.ts'
const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => { vi.restoreAllMocks(); for (const close of cleanup.splice(0).reverse()) await close() })
const backend = { kind: 'codex', dispatch: 'local', model: 'native-test', effort: 'medium', runtimeVersion: '0.153.4',
  maxTurns: 2, maxDurationMs: 10000 } as const
const policy = [{ model: backend.model, runtimeVersion: backend.runtimeVersion, efforts: [backend.effort],
  maxTurns: 2, maxDurationMs: 10000 }]
const setup = (budget = 2) => setupExecution(cleanup, budget, 'a'.repeat(64), ['codex-turn'], undefined, { backend, policy })

it('grants explicit native scheduling, charges turns once and rejects API capabilities or overlapping native dispatches', async () => {
  const h = await setup()
  expect(await h.execute(h.create)).toEqual(h.created)
  expect((await h.read()).run.backend).toEqual(backend)
  await h.transition('running')
  const action = { ...h.action(), capability: 'codex-turn' }
  const results = await Promise.allSettled([h.execute(action), h.execute({ ...h.action(), capability: 'codex-turn' })])
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
  await h.execute({ ...action, operationId: operationId() })
  await expect(h.execute(h.action())).rejects.toMatchObject({ code: 'version-conflict' })
  const view = await h.read()
  expect(view.delegation.used).toBe(1)
  expect(view.modelPolicy.every(entry => !('runtimeVersion' in entry))).toBe(true)
  await h.execute({ ...h.run, kind: 'settle-action', operationId: operationId(), actionId: action.actionId,
    outcome: 'succeeded', evidenceDigest: 'c'.repeat(64) })
  const last = { ...h.action(), capability: 'codex-turn' }; await h.execute(last)
  expect((await h.read())).toMatchObject({ eligible: false, delegation: { used: 2 }, run: { state: 'running', stopReason: 'turn-limit' } })
  await expect(h.execute({ ...h.action(), capability: 'codex-turn' })).rejects.toMatchObject({ code: 'version-conflict' })
  await h.execute({ ...h.run, kind: 'settle-action', operationId: operationId(), actionId: last.actionId,
    outcome: 'succeeded', evidenceDigest: 'c'.repeat(64) })
  await h.transition('succeeded')
  expect((await h.read()).run).toMatchObject({ state: 'succeeded', stopReason: 'native-terminal' })
  const reopened = openOrganizationDatabase(h.path, 100); reopened.close()
})

it('defaults native policy to disabled and rejects undeclared native selection or local credential fields', async () => {
  expect(configSchema.parse({ path: '/tmp/example.sqlite' }).executionCodex).toEqual([])
  expect(() => executionCodexBackendSchema.parse({ ...backend, codexHome: '/secret' })).toThrow()
  await expect(setupExecution(cleanup, 2, 'a'.repeat(64), ['codex-turn'], undefined, { backend, policy: [] }))
    .rejects.toMatchObject({ code: 'forbidden' })
  await expect(setupExecution(cleanup, 2, 'a'.repeat(64), ['model'], undefined, { backend, policy }))
    .rejects.toMatchObject({ code: 'invalid-input' })
}, 15000)

it('starts the cumulative native deadline when a stopped prepared Run first resumes', async () => {
  const h = await setup()
  expect((await h.read()).run.startedAt).toBeNull()
  await h.execute({ ...h.run, kind: 'transition-run', state: 'paused', stopReason: 'employee-stop', operationId: operationId() })
  expect((await h.read()).run.startedAt).toBeNull()
  await h.execute({ ...h.run, kind: 'resume-run', operationId: operationId() })
  const resumed = (await h.read()).run
  expect(resumed.state).toBe('running')
  expect(resumed.startedAt).toBeGreaterThan(0)
  await h.close()
  const reopened = openOrganizationDatabase(h.path, 100); reopened.close()
})

it('bounds total time across pauses and refuses explicit resume without resetting the native budget', async () => {
  const h = await setup()
  await h.transition('running')
  const started = (await h.read()).run.startedAt!
  const action = { ...h.action(), capability: 'codex-turn' }; await h.execute(action)
  await h.execute({ ...h.run, kind: 'transition-run', state: 'paused', stopReason: 'employee-stop', operationId: operationId() })
  expect((await h.read()).actions[0]?.state).toBe('unknown')
  await expect(h.execute({ ...h.run, kind: 'resume-run', operationId: operationId() })).rejects.toMatchObject({ code: 'version-conflict' })
  await h.execute({ ...h.run, kind: 'settle-action', operationId: operationId(), actionId: action.actionId,
    outcome: 'not-issued', evidenceDigest: 'c'.repeat(64) })
  await h.execute({ ...h.run, kind: 'resume-run', operationId: operationId() })
  expect((await h.read()).run.startedAt).toBe(started)
  vi.spyOn(Date, 'now').mockReturnValue(started + backend.maxDurationMs + 1)
  expect((await h.read())).toMatchObject({ eligible: false, run: { state: 'paused', stopReason: 'duration-limit' } })
  await expect(h.execute({ ...h.run, kind: 'resume-run', operationId: operationId() })).rejects.toMatchObject({ code: 'version-conflict' })
})

it('refuses new dispatch after assignment revocation and accepts historical action evidence', async () => {
  const h = await setup(); await h.transition('running')
  const action = { ...h.action(), capability: 'codex-turn' }; await h.execute(action)
  const assignment = h.db.prepare('SELECT version FROM task_assignments WHERE id=?').get(h.selector.assignmentId!)
  await h.service.assignmentCommand(h.owner.token, { ...h.selector, kind: 'revoke-assignment',
    operationId: operationId(), expectedVersion: assignment?.version })
  expect((await h.read())).toMatchObject({ eligible: false, run: { state: 'paused', stopReason: 'authority-lost' }, actions: [{ state: 'unknown' }] })
  await expect(h.execute({ ...h.action(), capability: 'codex-turn' })).rejects.toMatchObject({ code: 'version-conflict' })
  const settle = { ...h.run, kind: 'settle-action', operationId: operationId(), actionId: action.actionId, outcome: 'succeeded', evidenceDigest: 'c'.repeat(64) }
  await expect(h.execute({ ...settle, deviceId: randomUUID() })).rejects.toMatchObject({ code: 'invalid-input' })
  await h.execute(settle)
  expect((await h.read()).actions[0]?.state).toBe('succeeded')
  const reopened = openOrganizationDatabase(h.path, 100); reopened.close()
})

it('withdraws pending native human answers when the assignment is revoked', async () => {
  const h = await setup(); await h.transition('running')
  const requestId = randomUUID()
  await h.execute({ ...h.run, kind: 'request-execution-human', operationId: operationId(), requestId,
    handlerId: (await h.read()).assigneeId, requestKind: 'work-question', prompt: 'Proceed?',
    expiresAt: Date.now() + 20000, actionId: null, requestDigest: null })
  const assignment = h.db.prepare('SELECT version FROM task_assignments WHERE id=?').get(h.selector.assignmentId!)
  await h.service.assignmentCommand(h.owner.token, { ...h.selector, kind: 'revoke-assignment',
    operationId: operationId(), expectedVersion: assignment?.version })
  expect(await h.read()).toMatchObject({ eligible: false, run: { state: 'paused', stopReason: 'authority-lost' },
    humanRequests: [{ id: requestId, state: 'cancelled' }] })
  await expect(h.service.participantCommand(h.other.token, { ...h.selector, kind: 'answer-execution-question',
    runId: h.run.runId, planRevision: 1, requestId, operationId: operationId(), answer: 'Late answer' }))
    .rejects.toMatchObject({ code: 'version-conflict' })
})

it('rejects a persisted native running state without its original start time', async () => {
  const h = await setup(); await h.transition('running'); await h.close()
  h.db.prepare("UPDATE execution_runs SET data=json_set(data,'$.startedAt',NULL) WHERE id=?").run(h.run.runId)
  expect(() => openOrganizationDatabase(h.path, 100)).toThrow('incompatible-store')
})

it('rechecks current native policy after restart while retaining original native results and byte-identical API Run data in v11 migration', async () => {
  const api = await setupExecution(cleanup)
  await api.close()
  const before = api.db.prepare('SELECT data FROM execution_runs WHERE id=?').get(api.run.runId)?.data
  api.db.exec('DROP TABLE organization_hierarchy; DROP TABLE planning_goals; DROP TABLE planning_reapprovals; DROP TABLE planning_events; DROP TABLE planning_permits; DROP TABLE planning_grants; DROP TABLE tree_requests; DROP TABLE plan_contexts; PRAGMA user_version=11')
  const upgraded = openOrganizationDatabase(api.path, 100)
  expect(upgraded.prepare('PRAGMA user_version').get()?.user_version).toBe(21)
  expect(upgraded.prepare('SELECT data FROM execution_runs WHERE id=?').get(api.run.runId)?.data).toBe(before)
  upgraded.close()
  const h = await setup(); await h.transition('running')
  await h.close()
  const next = await openHarness(h.root, { executionCodex: [] }); cleanup.push(next.close)
  let eligible = true
  await next.service.readExecution(h.other.token, { ...h.selector, runId: h.run.runId }, (view) => { eligible = view.eligible })
  expect(eligible).toBe(false)
  const resume = { ...h.run, kind: 'resume-run', operationId: operationId() }
  await expect(next.service.executionCommand(h.other.token, resume))
    .rejects.toMatchObject({ code: 'forbidden' })
})
