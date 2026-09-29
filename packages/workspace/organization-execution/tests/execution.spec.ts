import { writeFile, readdir, readFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { SessionId } from '@deepseek-ai/dsh-session'
import { readSessionLogText } from '@deepseek-ai/dsh-session-log-export'
import { expect, it, vi } from 'vitest'
import * as ExecutionInvariant from '../src/invariant.ts'
import { executionResultSchema, executionReportSchema, type ExecutionRequest, type ExecutionReportRequest, type ExecutionCommand, type ExecutionAuthority, type ExecutionReadAuthority, type ExecutionResult, type ExecutionReport, executionRequestSchema, executionInputsDigest } from '../src/index.ts'
import { boot, fixture, signal } from './harness.ts'

it('waits for an outstanding report authorization on disposal and never delivers its stale text', async () => {
  const h = await boot(), f = fixture()
  await h.service.open(f.request, async () => f.authority, signal())
  let release!: (value: ExecutionReadAuthority) => void
  const authorization = new Promise<ExecutionReadAuthority>((resolve) => { release = resolve })
  const { organizationId, projectId, planId, assignmentId, runId } = f.request
  const report = h.service.report({ organizationId, projectId, planId, assignmentId, runId },
    () => authorization, signal()).then(() => 'delivered', () => 'cancelled')
  let closed = false
  const disposal = h.ctx.fiber.dispose().then(() => { closed = true })
  await new Promise<void>((resolve) => { setImmediate(resolve) })
  expect(closed).toBe(false)
  const { serverId, accountId, generation, execution } = f.authority
  release({ serverId, accountId, generation, execution })
  expect(await report).toBe('cancelled')
  await disposal
  expect(closed).toBe(true)
})

it('loads the isolated composition and reopens exactly the same durable Run log without Agent activation', async () => {
  const { request, authority } = fixture(), first = await boot()
  const one = await first.service.open(request, async () => authority, signal())
  expect(await first.service.open(request, async () => authority, signal())).toEqual(one)
  expect(first.ctx.sessions.list()).toEqual([])
  expect(await first.ctx.sessionPersistence.list()).toEqual([])
  await first.service.verifyBindings()
  await first.ctx.fiber.dispose()
  const second = await boot(first.root)
  expect(await second.service.open(request, async () => authority, signal())).toEqual(one)
  const logs = (await readdir(join(first.root, 'execution'), { recursive: true })).filter(f => f.endsWith('.jsonl'))
  expect(logs).toHaveLength(1)
  const text = await readFile(join(first.root, 'execution', logs[0]!), 'utf8')
  expect(text).toContain('organization/execution-binding')
  expect(text).toContain('Explicit employee request')
  expect(text).not.toMatch(/turn\/start|tool\/call|assistant\/message/)
})
it('denies personal hot, cold, fork and Agent admission for execution IDs', async () => {
  const { ctx, service } = await boot(); const { request, authority } = fixture()
  const result = await service.open(request, async () => authority, signal())
  expect(() => ctx.sessions.create(result.sessionId)).toThrow('personal access forbidden')
  expect(() => ctx.sessions.create(SessionId(randomUUID()), { meta: { parentSession: result.sessionId } })).toThrow('personal access forbidden')
  await expect(ctx.sessionPersistence.open(result.sessionId, 'read')).rejects.toThrow('persistence access forbidden')
  await expect(ctx.agents.create({ sessionId: result.sessionId })).rejects.toThrow('personal access forbidden')
  expect(await ctx.sessionPersistence.list()).toEqual([])
  expect(() => ctx.sessionQuery.observeSession(result.sessionId)).toThrow('personal access forbidden')
  await expect(readSessionLogText(ctx.sessionPersistence, result.sessionId)).rejects.toThrow('forbidden')
})
it('recovers a reserved log after interruption, rejects generation changes and operation conflicts', async () => {
  const { request, authority } = fixture(), { service } = await boot()
  let checks = 0
  await expect(service.open(request, async () => {
    if (++checks === 2) throw new Error('lost connection')
    return authority
  }, signal())).rejects.toThrow('lost connection')
  const result = await service.open(request, async () => authority, signal())
  expect(result.mode).toBe('prepared')
  await expect(service.open({ ...request, inputs: { ...request.inputs, messages: ['changed'] } }, async () => authority, signal())).rejects.toThrow('superseded')
  let current = 0
  await expect(service.open(request, async () => ({ ...authority, generation: ++current }), signal())).rejects.toThrow('superseded')
  const cancel = new AbortController()
  await expect(service.open(request, async () => { cancel.abort(); return authority }, cancel.signal)).rejects.toThrow()
  await expect(service.open(request, async () => ({ ...authority, execution: { ...authority.execution, eligible: false } }), signal())).rejects.toThrow('superseded')
})
it('rejects independently corrupted logs through its executed invariant and on cold boot', async () => {
  const { request, authority } = fixture(), { ctx, service, root } = await boot()
  await service.open(request, async () => authority, signal())
  const file = (await readdir(join(root, 'execution'), { recursive: true })).find(f => f.endsWith('.jsonl'))!
  const path = join(root, 'execution', file)
  await writeFile(path, (await readFile(path, 'utf8')).replace('Authorized task', 'Tampered task'))
  await expect(service.verifyBindings()).rejects.toThrow('binding/log mismatch')
  await ctx.fiber.dispose()
  const cold = await boot(root)
  expect(cold.ctx.get('organizationExecution')).toBeUndefined()
})
it.each(['prepare', 'execute', 'human'] as const)('uses real HTTPS/native/private Host IPC with execution=%s', async (mode) => {
  const start = mode !== 'prepare'
  const { workgraphHarness, password } = await import('../../../api/organization-api/tests/workgraph-harness.ts')
  const { OrganizationConnection } = await import('../../../host/organization-connection/src/index.ts')
  const { openOrganizationExecution, readOrganizationExecution } = await import('../../../../apps/desktop/src/organization-execution.ts')
  const { installOrganizationExecutionControl } = await import('../../../../apps/desktop-host/src/organization-execution.ts')
  const { executionNativeMessageSchema } = await import('../src/protocol.ts')
  const { EventEmitter } = await import('node:events')
  const route = { model: 'approved-model', endpoint: 'https://model.example/anthropic/v1' }
  const remote = await workgraphHarness({ executionModels: [route] })
  const local = await boot(undefined, { maxActions: 20, maxSteps: 10, maxDurationMs: 10000, maxBytes: 100000, recheckMs: 100 },
    [{ ...route, credential: 'ORGANIZATION_TEST_KEY', maxTokens: 100, contextWindow: 10000, idleTimeoutMs: 5000 }])
  const credentialPath = join(local.root, 'credentials.yml')
  await writeFile(credentialPath, 'ORGANIZATION_TEST_KEY: sk-organization-test-only-key\n', { mode: 0o600 })
  const { LocalCredentialProvider } = await import('@deepseek-ai/dsh-credentials-local')
  await local.ctx.plugin(LocalCredentialProvider, { path: credentialPath, watch: false })
  const { textEvents } = await import('../../../llm/llm-deepseek/tests/mock-server.ts')
  let requests = 0
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, options) => {
    expect(typeof url === 'string' ? url : url instanceof URL ? url.href : url.url).toBe(`${route.endpoint}/messages`)
    expect(options?.redirect).toBe('error')
    const events = mode === 'human' && requests++ === 0 ? [
      JSON.stringify({ type: 'message_start', message: { id: 'question', model: route.model, usage: { input_tokens: 3, output_tokens: 0 } } }),
      JSON.stringify({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'question', name: 'request_human', input: {} } }),
      JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify({ prompt: 'Confirm the total.', recipient: 'employee' }) } }),
      JSON.stringify({ type: 'content_block_stop', index: 0 }),
      JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 1 } }),
      JSON.stringify({ type: 'message_stop' }),
    ] : textEvents
    return new Response(events.map(data => `data: ${data}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } })
  })
  const directory = join(local.root, 'work'); await mkdir(directory)
  const connection = new OrganizationConnection({ reconnectMs: 100 }, { directory: join(local.root, 'device'), vault: {
    isEncryptionAvailable: () => true, getSelectedStorageBackend: () => 'test-vault',
    encryptString: text => Buffer.from(text), decryptString: bytes => bytes.toString(),
  } })
  const bus = new EventEmitter()
  let receive: (input: object) => void = () => { throw new Error('no request') }
  installOrganizationExecutionControl(local.ctx, { on: (event, listener) => bus.on(event, listener),
    off: (event, listener) => bus.off(event, listener), send: (message) =>{  receive(message) } })
  try {
    const approved = await remote.app.authority.assignmentCommand(remote.owner.token, { ...remote.query, kind: 'approve-assignment',
      operationId: randomUUID(), taskId: remote.grant.taskId, planRevision: 1, assigneeId: remote.member.membershipId })
    await connection.perform({ kind: 'probe', origin: remote.trust.origin })
    await connection.perform({ kind: 'trust', fingerprint: remote.trust.fingerprint })
    await connection.perform({ kind: 'login', username: 'reader', password })
    await connection.perform({ kind: 'select', organizationId: remote.owner.organizationId })
    const selector = { ...remote.query, assignmentId: approved.assignmentId! }, item = connection.snapshot().inbox!.items[0]!
    await connection.perform({ kind: 'assignment-participant', request: { ...selector, kind: 'answer-assignment', operationId: randomUUID(),
      requestId: item.request.id, expectedVersion: item.assignment.version, answer: 'accepted' } })
    await connection.perform({ kind: 'device-register', name: 'test desktop' })
    const preparation = await connection.perform({ kind: 'assignment-preparation', request: selector })
    if (preparation.assignment?.result.kind !== 'preparation') throw new Error('missing preparation')
    const delegated = await connection.perform({ kind: 'assignment-delegate', request: { ...selector, kind: 'delegate', operationId: randomUUID(),
      expectedVersion: preparation.assignment.result.value.assignment.version, executorId: 'desktop-builtin', capabilities: ['draft'], budget: 3, durationMs: 60000 } })
    const claimed = await connection.perform({ kind: 'lease-claim', request: { ...selector, delegationId: delegated.receipt!.delegationId } })
    const lease = claimed.receipt!.lease!, inputs = { ...fixture().request.inputs, endpoint: route.endpoint,
      execution: { directory, maxActions: 3, maxSteps: 3, maxDurationMs: 10000 } }
    const grant = await connection.perform({ kind: 'execution-command', request: { ...selector, planRevision: 1, kind: 'grant-execution',
      operationId: randomUUID(), delegationId: delegated.receipt!.delegationId, capabilities: ['model'], budget: 3,
      expiresAt: Date.now() + 30000, configDigest: executionInputsDigest(inputs) } })
    const created = await connection.perform({ kind: 'execution-command', request: { ...selector, planRevision: 1, kind: 'create-run',
      operationId: randomUUID(), executionDelegationId: grant.receipt!.execution!.executionDelegationId,
      serverEpoch: lease.serverEpoch, fencingEpoch: lease.fencingEpoch, configDigest: executionInputsDigest(inputs) } })
    const request = executionRequestSchema.parse({ ...selector, runId: created.receipt!.execution!.runId,
      operationId: randomUUID(), inputs, start })
    const exchange = (r: ExecutionRequest | ExecutionReportRequest,
      authorize: (command?: ExecutionCommand) => Promise<ExecutionAuthority | ExecutionReadAuthority>,
      timeoutMs: number, cancellation: AbortSignal, type: 'organization-execution-open' | 'organization-execution-report') => new Promise<ExecutionResult | ExecutionReport>((resolve, reject) => {
      const requestId = randomUUID(), nonce = randomUUID()
      const cancel = () => bus.emit('message', { type: 'organization-execution-cancel', requestId, nonce })
      cancellation.addEventListener('abort', cancel, { once: true })
      receive = (input) => {
        const message = executionNativeMessageSchema.parse(input)
        expect(message.nonce).toBe(nonce)
        if (message.type === 'organization-execution-result') {
          cancellation.removeEventListener('abort', cancel)
          if (message.result || message.report) resolve((message.result ?? message.report)!); else reject(new Error(message.error))
        } else {
          // A wrong authorization identifier must not unblock the pending read.
          bus.emit('message', { type: 'organization-execution-authorized', requestId, nonce,
            authorizationId: randomUUID(), error: 'wrong correlation' })
          void authorize(message.command).then(authority => bus.emit('message', { type: 'organization-execution-authorized', requestId, nonce,
            authorizationId: message.authorizationId, authority }), () => bus.emit('message', {
            type: 'organization-execution-authorized', requestId, nonce, authorizationId: message.authorizationId, error: 'denied' }))
        }
      }
      bus.emit('message', { type, requestId, nonce, request: r, timeoutMs })
    })
    const host = {
      openOrganizationContext: (r: import('@deepseek-ai/dsh-organization-context/protocol').ContextRequest,
        authorize: () => Promise<import('@deepseek-ai/dsh-organization-context/protocol').ContextAuthority>,
        _timeout: number, cancellation: AbortSignal) => local.ctx.organizationContext.open(r, authorize, cancellation),
      openOrganizationExecution: async (r: ExecutionRequest, authorize: (command?: ExecutionCommand) => Promise<ExecutionAuthority>,
        timeout: number, cancellation: AbortSignal) =>
        executionResultSchema.parse(await exchange(r, authorize, timeout, cancellation, 'organization-execution-open')),
      readOrganizationExecution: async (r: ExecutionReportRequest, authorize: () => Promise<ExecutionReadAuthority>, timeout: number,
        cancellation: AbortSignal) =>
        executionReportSchema.parse(await exchange(r, authorize, timeout, cancellation, 'organization-execution-report')),
    }
    const opened = await openOrganizationExecution(connection, host, request, () => {})
    expect(opened.result.snapshot.goal).toBe('Visible task')
    expect(opened.result.mode).toBe(start ? 'finished' : 'prepared')
    expect(fetch).toHaveBeenCalledTimes(start ? 1 : 0)
    expect(opened.result.inputs.messages).toEqual(inputs.messages)
    expect(local.ctx.sessions.list()).toEqual([])
    await vi.waitFor(() => { expect(connection.snapshot().phase).toBe('ready') })
    const report = await readOrganizationExecution(connection, host, { ...selector, runId: request.runId }, () => {}, signal())
    expect(report.report.entries[0]?.text).toBe(inputs.messages[0])
    if (start && mode !== 'human') expect(report.report.entries).toContainEqual({ role: 'assistant', text: 'hello' })
    if (mode === 'human') {
      const current = await connection.perform({ kind: 'execution-read', request: { ...selector, runId: request.runId } })
      expect(current.execution?.run.state).toBe('waiting-human')
      const human = current.execution!.humanRequests[0]!
      await connection.perform({ kind: 'assignment-participant', request: { ...selector, kind: 'answer-execution-question',
        operationId: randomUUID(), runId: request.runId, requestId: human.id, planRevision: 1, answer: 'Confirmed total 42.' } })
      await vi.waitFor(() => { expect(connection.snapshot().phase).toBe('ready') })
      const resumed = await openOrganizationExecution(connection, host, { ...request, operationId: randomUUID(),
        resume: { baselineDigest: report.report.recovery!.baselineDigest! } }, () => {})
      expect(resumed.result.mode).toBe('finished')
      expect(fetch).toHaveBeenCalledTimes(2)
      expect(fetch.mock.calls[1]?.[1]?.body).toContain('Confirmed total 42.')
    }
    const shared = await connection.perform({ kind: 'execution-read', request: { ...selector, runId: request.runId } })
    expect(JSON.stringify(shared)).not.toContain(inputs.messages[0])
    await connection.perform({ kind: 'personal' })
    await expect(openOrganizationExecution(connection, host, request, () => {})).rejects.toThrow()
    await local.ctx.fiber.dispose()
    expect(bus.listenerCount('message')).toBe(0)
    await connection.close()
    await remote.app.close()
    const { backupOrganization, restoreOrganization } = await import('../../organization/src/maintenance.ts')
    const { openOrganizationDatabase } = await import('../../organization/src/database.ts')
    const backup = backupOrganization(remote.config.api.directory, join(remote.root, 'backup'), 100)
    if (!start) {
      const legacy = new DatabaseSync(join(backup, 'organization.sqlite'))
      legacy.exec('DROP TABLE execution_human_requests; PRAGMA user_version=7')
      legacy.close()
      const hashes = { 'organization.sqlite': createHash('sha256').update(await readFile(join(backup, 'organization.sqlite'))).digest('hex'),
        'tls-identity.json': createHash('sha256').update(await readFile(join(backup, 'tls-identity.json'))).digest('hex') }
      await writeFile(join(backup, 'manifest.json'), JSON.stringify({ format: 1, schema: 7, hashes }))
    }
    restoreOrganization(backup, remote.config.api.directory, 100)
    const db = openOrganizationDatabase(join(remote.config.api.directory, 'organization.sqlite'), 100)
    try {
      expect(db.prepare("SELECT json_extract(data,'$.state') AS state FROM execution_runs").get()?.state).toBe(start ? 'succeeded' : 'paused')
      expect(db.prepare("SELECT json_extract(data,'$.state') AS state FROM execution_delegations").get()?.state).toBe('invalidated')
    } finally { db.close() }
  } finally { await connection.close(); await remote.close() }
}, 20000)

it('times out private authorization and drains pending reads on disposal', async () => {
  const { installOrganizationExecutionControl } = await import('../../../../apps/desktop-host/src/organization-execution.ts')
  const { EventEmitter } = await import('node:events')
  const { ctx } = await boot(), bus = new EventEmitter(), messages: object[] = []
  installOrganizationExecutionControl(ctx, { on: (event, listener) => bus.on(event, listener),
    off: (event, listener) => bus.off(event, listener), send: (message) => { messages.push(message) } })
  const requestId = randomUUID(), nonce = randomUUID(), { request } = fixture()
  bus.emit('message', { type: 'organization-execution-open', requestId, nonce, timeoutMs: 10, request })
  await vi.waitFor(() =>{  expect(messages).toContainEqual({ type: 'organization-execution-result', requestId, nonce, error: 'organization-execution: cancelled' }) })
  bus.emit('message', { type: 'organization-execution-open', requestId: randomUUID(), nonce, timeoutMs: 10000, request })
  await ctx.fiber.dispose()
  expect(bus.listenerCount('message')).toBe(0)
})

it('releases its invariant registration when the contributing Loader fiber is disposed', async () => {
  const { ctx } = await boot()
  const entry = [...ctx.loader.entries()].find(item => item.options.name === 'execution-invariant')
  expect(entry?.fiber).toBeDefined()
  await entry!.fiber!.dispose()
  const again = ctx.plugin(ExecutionInvariant)
  await again
  await again.dispose()
})
