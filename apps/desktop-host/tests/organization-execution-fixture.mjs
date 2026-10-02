/** Deterministic model input; all authority, native transport, tools and persistence remain real. */
import assert from 'node:assert/strict'
import { randomUUID, randomBytes, createHash } from 'node:crypto'
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { setTimeout as delay } from 'node:timers/promises'

const limits = { maxActions: 30, maxSteps: 15, maxDurationMs: 60000, maxBytes: 1000000, recheckMs: 1000 }
const password = 'correct horse battery staple'
const vault = { isEncryptionAvailable: () => true, getSelectedStorageBackend: () => 'test-vault',
  encryptString: text => Buffer.from(text), decryptString: bytes => bytes.toString() }
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const tool = (name, args) => ({ name, args })
export const nativeLimits = { startupTimeoutMs: 5000, rpcTimeoutMs: 5000, turnTimeoutMs: 60000, humanTimeoutMs: 5000,
  interruptTimeoutMs: 1000, disposeGraceMs: 100, maxFrameBytes: 1000000, maxEarlyEvents: 100, maxTurnBytes: 1000000,
  modelCacheMs: 1000, modelPageSize: 100, maxModelPages: 10 }
export const nativeBackend = { kind: 'codex', dispatch: 'device-native', runtimeVersion: '0.153.4', model: 'scripted-csv',
  effort: 'medium', maxTurns: 30, maxDurationMs: 60000 }
const csv = 'name,note\nAlice,"hello,world"\nBob,"say ""hi"""\n'

export async function until(predicate) {
  const deadline = Date.now() + 15000
  while (!await predicate()) { assert.ok(Date.now() < deadline, 'state transition deadline'); await delay(20) }
}

/** Source and published lanes share the exact Loader configuration and deterministic model seam. */
export async function localExecution(kit, root) {
  const ctx = new kit.Context()
  ctx.baseUrl = pathToFileURL(root).href + '/'
  class ScriptedAdapter extends kit.LlmAdapter {
    constructor(script) { super(); this.script = script }
    async resolveModel(provider, model) { return { provider, id: model, name: model } }
    async *stream(options) {
      options.signal?.throwIfAborted()
      const entry = this.script.shift()
      assert.ok(entry, 'model script exhausted')
      if (entry.name) {
        const id = randomUUID(), args = JSON.stringify(entry.args)
        yield { type: 'block-start', index: 0, blockType: 'tool-call' }
        yield { type: 'tool-call-delta', index: 0, id, name: entry.name, argumentsDelta: args }
        yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: entry.name, arguments: args } }
        yield { type: 'finish', reason: { kind: 'tool-calls' } }
      } else {
        yield { type: 'block-start', index: 0, blockType: 'text' }
        yield { type: 'text-delta', index: 0, text: entry }
        yield { type: 'block-end', index: 0, block: { type: 'text', text: entry } }
        yield { type: 'finish', reason: { kind: 'stop' } }
      }
    }
  }
  class ScriptedExecution extends kit.OrganizationExecution {
    async executeConfigured(request, authorize, signal) {
      const script = JSON.parse(await readFile(join(root, 'script.json'), 'utf8'))
      return this.execute(request, authorize, { adapter: new ScriptedAdapter(script), directory: request.inputs.execution.directory }, signal)
    }
  }
  const modules = new Map([...kit.modules, ['execution', kit.liveRoute || kit.native ? kit.OrganizationExecution : ScriptedExecution]])
  const config = [{ name: 'storage' }, { name: 'json', config: { root: join(root, 'data') } },
    { name: 'domain', config: { backend: 'json' } }, { name: 'sessions' }, { name: 'agents' },
    { name: 'jsonl', config: { root: join(root, 'personal'), compression: 'none' } },
    { name: 'context', config: { root: join(root, 'contexts') } },
    { name: 'execution', config: { root: join(root, 'execution'), executionLimits: limits, ...(kit.liveRoute ? { models: [kit.liveRoute] } : {}) } }]
  if (kit.liveRoute) {
    modules.set('credentials', kit.Credentials)
    config.unshift({ name: 'credentials', config: { path: join(root, 'credentials.yml'), watch: false } })
  }
  if (kit.native) {
    class NativeSubprocess extends kit.Subprocess {
      spawn(spec) {
        assert.equal(spec.argv.at(-2), 'app-server'); assert.equal(spec.argv.at(-1), '--stdio')
        return super.spawn({ ...spec, argv: [process.execPath, new URL('../../../packages/workspace/organization-execution/tests/fixtures/codex-app-server.mjs', import.meta.url).pathname],
          env: { ...spec.env, MERFORGE_CODEX_FIXTURE: root } })
      }
    }
    modules.set('subprocess', NativeSubprocess); config.unshift({ name: 'subprocess' })
    config.find(entry => entry.name === 'execution').config.codex = nativeLimits
  }
  const configPath = join(root, 'execution.yml')
  await writeFile(configPath, JSON.stringify(config))
  try {
    await ctx.plugin(kit.Loader); ctx.loader.builtins.include = kit.Include
    ctx.loader.internal = { version: 'v2', async import(name) { assert.ok(modules.has(name)); return modules.get(name) } }
    await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
    await ctx.loader.await()
    assert.deepEqual([...ctx.loader.entries()].filter(entry => !entry.fiber && !entry.disabled), [])
  } catch (error) { await ctx.fiber.dispose(); throw error }
  return {
    ctx,
    openOrganizationContext: (request, authorize, _timeout, signal) => ctx.organizationContext.open(request, authorize, signal),
    async openOrganizationExecution(request, authorize, _timeout, signal) {
      const result = request.reconcile ? await ctx.organizationExecution.reconcile(request, authorize, signal)
        : await ctx.organizationExecution.open(request, authorize, signal)
      if (request.start) { await ctx.organizationExecution.executeConfigured(request, authorize, signal); result.mode = 'finished' }
      return result
    },
    readOrganizationExecution: (request, authorize, _timeout, signal) => ctx.organizationExecution.report(request, authorize, signal),
    async close() {
      try {
        await ctx.organizationExecution.verifyBindings()
        assert.deepEqual(ctx.sessions.list(), [])
        assert.deepEqual(await ctx.sessionPersistence.list(), [])
      } finally { await ctx.fiber.dispose() }
    },
  }
}

/** Complete CSV revision/review/join using the same real native operations used by Desktop. */
export async function executionScenario(kit, createHost = root => localExecution(kit, root), fault) {
  const root = await mkdtemp(join(tmpdir(), 'desktop-execution-'))
  const clients = [], hosts = []
  let app
  let localRoot = join(root, 'employee-host'), work = join(root, 'employee-git')
  const target = join(root, 'issuer-git'), localRoots = [localRoot], workRoots = [work]
  const git = (directory, ...args) => execFileSync('git', ['-C', directory, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  async function active(client, action) { await until(() => client.snapshot().phase === 'ready'); return client.perform(action) }
  try {
    for (const directory of [localRoot, work, target]) await mkdir(directory)
    for (const directory of [work, target]) {
      git(directory, 'init'); git(directory, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '--allow-empty', '-m', 'baseline')
      await writeFile(join(directory, 'untouched.txt'), 'PRIVATE_UNSELECTED_SENTINEL')
    }
    const server = join(root, 'server')
    const config = { authority: { deviceChallengeMaxPerAccount: 1000, ...(kit.native ? { executionCodex: [{ runtimeVersion: '0.153.4', model: nativeBackend.model, efforts: ['medium'], maxTurns: 30, maxDurationMs: 60000 }] } : {}), ...(kit.liveRoute ? { executionModels: [{ model: kit.liveRoute.model, endpoint: kit.liveRoute.endpoint }] } : {}) }, api: { directory: server, host: '127.0.0.1', port: 0, names: ['127.0.0.1'], eventPollMs: 20 } }
    app = await kit.bootOrganization(config)
    const init = await app.authority.initialize({ operationId: randomUUID(), username: 'owner', password,
      organizationName: 'CSV team', recoveryToken: randomBytes(32).toString('base64url') })
    async function connect(username, machine) {
      const client = new kit.OrganizationConnection({ trustPath: join(root, `${machine}.json`), reconnectMs: 100 }, { directory: join(root, machine), vault })
      clients.push(client)
      await client.perform({ kind: 'probe', origin: `https://127.0.0.1:${app.ready.port}` })
      await client.perform({ kind: 'trust', fingerprint: app.ready.fingerprint })
      if (username) {
        await client.perform({ kind: 'login', username, password })
        await client.perform({ kind: 'select', organizationId: init.organizationId })
      }
      return client
    }
    const owner = await connect('owner', 'owner')
    let member = await connect(null, 'employee')
    const invite = await active(owner, { kind: 'invite', role: 'member' })
    let employee = (await member.perform({ kind: 'register', username: 'employee', password, invitationToken: invite.invitationToken })).receipt
    const firstMember = member, firstEmployee = employee
    await member.perform({ kind: 'login', username: 'employee', password })
    await member.perform({ kind: 'select', organizationId: init.organizationId })
    const command = body => active(owner, { kind: 'command', command: { ...body, organizationId: init.organizationId, operationId: randomUUID() } })
    const project = (await command({ kind: 'create-project', name: 'CSV delivery' })).receipt
    await command({ kind: 'set-grant', projectId: project.projectId, membershipId: employee.membershipId, expectedVersion: 0, actions: ['read'] })
    await command({ kind: 'set-grant', projectId: project.projectId, membershipId: init.membershipId, expectedVersion: project.revision, actions: ['read', 'write'] })
    const query = { organizationId: init.organizationId, projectId: project.projectId, planId: randomUUID() }
    const parent = randomUUID(), left = randomUUID(), right = randomUUID(), phaseId = randomUUID()
    const definition = { taskId: parent, phases: [{ id: phaseId, title: 'CSV' }], tasks: [parent, left, right].map(id => ({
      id, parentTaskId: id === parent ? null : parent, phaseId, goal: id === parent ? 'Deliver CSV and contract' : 'Prepare selected CSV evidence',
      scope: 'Selected files only', acceptance: ['Independent byte comparison'], artifacts: [], required: true, dependsOn: [], suggestedMembershipId: null,
    })) }
    await active(owner, { kind: 'workgraph-save', request: { ...query, expectedRevision: 0, operationId: randomUUID(), definition } })
    const grant = (await active(owner, { kind: 'workgraph-grant', request: { ...query, taskId: parent, scope: 'subtree', membershipId: employee.membershipId,
      actions: ['read'], expectedVersion: 0, operationId: randomUUID() } })).receipt
    await active(member, { kind: 'device-register', name: 'CSV employee device' })
    let host = await createHost(localRoot); hosts.push(host)
    const inputs = { model: kit.liveRoute?.model ?? 'scripted-csv', ...(kit.liveRoute ? { endpoint: kit.liveRoute.endpoint } : {}), capabilities: ['model', 'fs-read', 'fs-write'], materials: ['CSV columns name,note'],
      messages: [kit.liveRoute ? `Write result.csv using write_file with EXACT UTF-8 content ${JSON.stringify(csv)}. Then read it using read_file and finish. Do not touch other files or request human input.` : 'PRIVATE_EXECUTION_SENTINEL: prepare CSV evidence'], execution: { directory: work, maxActions: 30, maxSteps: 15, maxDurationMs: 60000 } }
    if (kit.native) { inputs.backend = nativeBackend; inputs.capabilities = ['codex-turn']; inputs.execution.maxSteps = 30 }
    let configDigest = kit.executionInputsDigest(inputs)
    async function prepare(taskId, planRevision, budget = 30) {
      const approved = await active(owner, { kind: 'assignment-command', request: { ...query, taskId, planRevision,
        kind: 'approve-assignment', assigneeId: employee.membershipId, operationId: randomUUID() } })
      const selector = { ...query, assignmentId: approved.receipt.assignmentId }
      await until(() => member.snapshot().inbox?.items.some(i => i.assignment.id === selector.assignmentId && i.request.kind === 'accept-assignment'))
      const item = member.snapshot().inbox.items.find(i => i.assignment.id === selector.assignmentId && i.request.kind === 'accept-assignment')
      await active(member, { kind: 'assignment-participant', request: { ...selector, kind: 'answer-assignment', operationId: randomUUID(),
        requestId: item.request.id, expectedVersion: item.assignment.version, answer: 'accepted' } })
      const current = (await active(member, { kind: 'assignment-preparation', request: selector })).assignment.result.value
      const delegated = await active(member, { kind: 'assignment-delegate', request: { ...selector, kind: 'delegate', operationId: randomUUID(),
        expectedVersion: current.assignment.version, executorId: 'desktop-builtin', capabilities: ['task-read'], budget: 30, durationMs: 300000 } })
      const delegationId = delegated.receipt.delegationId
      const lease = (await active(member, { kind: 'lease-claim', request: { ...selector, delegationId } })).receipt.lease
      const granted = await active(member, { kind: 'execution-command', request: { ...selector, planRevision, kind: 'grant-execution',
        operationId: randomUUID(), delegationId, ...(kit.native ? { backend: nativeBackend } : {}), capabilities: inputs.capabilities, budget, expiresAt: Date.now() + 240000, configDigest } })
      const ownerFields = { ...selector, planRevision, executionDelegationId: granted.receipt.execution.executionDelegationId,
        serverEpoch: lease.serverEpoch, fencingEpoch: lease.fencingEpoch }
      const runId = (await active(member, { kind: 'execution-command', request: { ...ownerFields, kind: 'create-run', operationId: randomUUID(), configDigest, ...(kit.native ? { backend: nativeBackend } : {}) } })).receipt.execution.runId
      return { selector, ownerFields, lease, request: kit.executionRequestSchema.parse({ ...selector, runId, operationId: randomUUID(), inputs, start: true }) }
    }
    const runView = async run => (await active(member, { kind: 'execution-read', request: { ...run.selector, runId: run.request.runId } })).execution
    async function execute(run, script, resume) {
      await writeFile(join(localRoot, 'script.json'), JSON.stringify(script))
      await until(() => member.snapshot().phase === 'ready')
      return kit.openOrganizationExecution(member, host, { ...run.request, ...(resume ? { resume, operationId: randomUUID() } : {}) }, () => {})
    }
    async function submit(run, path) {
      const bytes = await readFile(join(work, path)), sha256 = sha(bytes)
      const base = { ...run.selector, runId: run.request.runId, planRevision: run.ownerFields.planRevision }
      const artifactId = (await active(member, { kind: 'delivery-command', request: { ...base, kind: 'publish-artifact', operationId: randomUUID(),
        artifactKind: 'file', path, description: 'Selected CSV evidence', mediaType: 'text/plain', size: bytes.length, sha256, bytes: bytes.toString('base64') } })).receipt.delivery.artifactId
      const submissionId = (await active(member, { kind: 'delivery-command', request: { ...base, kind: 'submit-delivery', operationId: randomUUID(),
        artifactIds: [artifactId], summary: 'CSV evidence ready', target: 'Issuer Git directory', confirmed: true } })).receipt.delivery.submissionId
      return { base, artifactId, sha256, submissionId, bytes, path }
    }
    async function review(file, reject = false) {
      return active(owner, { kind: 'delivery-command', request: { ...file.base, kind: reject ? 'reject-delivery' : 'accept-delivery', operationId: randomUUID(),
        submissionId: file.submissionId, artifacts: [{ artifactId: file.artifactId, sha256: file.sha256 }], confirmed: true,
        ...(reject ? { reason: 'Missing quoted rows', requirements: 'Include Alice and Bob with CSV escaping.' } : {}) } })
    }
    const first = await prepare(left, 1, fault === 'budget' ? 1 : 30)
    if (kit.liveRoute) {
      await execute(first, [])
      assert.equal(await readFile(join(work, 'result.csv'), 'utf8'), csv)
      assert.equal(await readFile(join(work, 'untouched.txt'), 'utf8'), 'PRIVATE_UNSELECTED_SENTINEL')
      const view = await runView(first)
      assert.equal(view.run.state, 'succeeded')
      assert.ok(view.actions.some(a => a.capability === 'fs-write' && a.state === 'succeeded'))
      assert.equal(view.delegation.used, view.actions.length)
      return
    }
    if (fault) {
      const originalHost = host
      let triggered = fault === 'budget'
      host = { ...originalHost, openOrganizationExecution(request, authorize, timeout, signal) {
        return originalHost.openOrganizationExecution(request, async command => {
          const value = await authorize(command)
          const reservedWrite = command?.kind === 'reserve-action' && command.capability === 'fs-write'
          const settledWrite = command?.kind === 'settle-action'
            && value.execution.actions.find(a => a.actionId === command.actionId)?.capability === 'fs-write'
          if (!triggered && (fault === 'lost-response' ? settledWrite : reservedWrite)) {
            triggered = true
            if (fault === 'revoked') await active(owner, { kind: 'workgraph-grant', request: { ...query, taskId: parent,
              scope: 'subtree', membershipId: employee.membershipId, actions: [], expectedVersion: grant.revision, operationId: randomUUID() } })
            if (fault === 'sleep') member.suspend()
            if (fault === 'identity') await member.perform({ kind: 'personal' })
            if (fault === 'server-restart') {
              const port = app.ready.port
              await app.close()
              app = await kit.bootOrganization({ ...config, api: { ...config.api, port } })
            }
            if (fault === 'lost-response') throw new Error('fixture: committed response lost')
          }
          return value
        }, timeout, signal)
      } }
      await assert.rejects(execute(first, [tool('write_file', { path: 'denied.csv', content: csv }), 'Must not continue']))
      assert.equal(triggered, true)
      const files = await readdir(work)
      if (fault === 'lost-response') assert.equal(await readFile(join(work, 'denied.csv'), 'utf8'), csv)
      else assert.equal(files.includes('denied.csv'), false)
      assert.equal(await readFile(join(work, 'untouched.txt'), 'utf8'), 'PRIVATE_UNSELECTED_SENTINEL')
      await originalHost.close(); hosts.splice(hosts.indexOf(originalHost), 1)
      const cold = await createHost(localRoot); hosts.push(cold)
      assert.deepEqual(await readdir(work), files)
      const db = new DatabaseSync(join(server, 'organization.sqlite'), { readOnly: true })
      try {
        const actions = db.prepare('SELECT data FROM execution_actions WHERE runId=?').all(first.request.runId).map(r => JSON.parse(r.data))
        assert.equal(actions.filter(a => a.capability === 'model').length, 1)
        assert.equal(actions.filter(a => a.capability === 'fs-write').length, fault === 'budget' ? 0 : 1)
        if (fault === 'lost-response') assert.equal(actions.find(a => a.capability === 'fs-write').state, 'succeeded')
        if (fault === 'server-restart') assert.equal(actions.find(a => a.capability === 'fs-write').state, 'unknown')
        assert.equal(db.prepare('SELECT count(*) AS n FROM integration_confirmations').get().n, 0)
      } finally { db.close() }
      return
    }
    await execute(first, [tool('request_human', { prompt: 'Confirm columns name,note?', recipient: 'employee' })])
    const waiting = await runView(first)
    assert.equal(waiting.run.state, 'waiting-human')
    const answer = { ...first.selector, runId: first.request.runId, planRevision: 1, kind: 'answer-execution-question',
      requestId: waiting.humanRequests[0].id, answer: 'Use name,note and preserve CSV quotes.', operationId: randomUUID() }
    await active(member, { kind: 'assignment-participant', request: answer })
    assert.equal((await runView(first)).run.state, 'waiting-human')
    await host.close(); hosts.splice(hosts.indexOf(host), 1)
    host = await createHost(localRoot); hosts.push(host)
    const report = await kit.readOrganizationExecution(member, host, { ...first.selector, runId: first.request.runId }, () => {}, new AbortController().signal)
    assert.ok(report.report.recovery.baselineDigest)
    await execute(first, [tool('write_file', { path: 'result.csv', content: 'name,note\n' }), 'Draft ready'], { baselineDigest: report.report.recovery.baselineDigest })
    const rejectedFile = await submit(first, 'result.csv')
    await review(rejectedFile, true)
    await assert.rejects(execute(first, ['Must not run']))
    const second = await prepare(left, 2)
    await execute(second, [tool('write_file', { path: 'result.csv', content: csv }), tool('read_file', { path: 'result.csv' }), 'Revised CSV ready'])
    const leftFile = await submit(second, 'result.csv'); await review(leftFile)
    const integrationQuery = { ...query, taskId: parent, planRevision: 2 }
    assert.equal((await active(owner, { kind: 'integration-read', request: integrationQuery })).integration.inputsReady, false)
    await active(member, { kind: 'lease-release', request: second.selector })
    let secondGrant
    if (kit.twoMembers) {
      const secondMember = await connect(null, 'second-employee')
      const invite = await active(owner, { kind: 'invite', role: 'member' })
      employee = (await secondMember.perform({ kind: 'register', username: 'second-employee', password, invitationToken: invite.invitationToken })).receipt
      await secondMember.perform({ kind: 'login', username: 'second-employee', password })
      await secondMember.perform({ kind: 'select', organizationId: init.organizationId })
      await command({ kind: 'set-grant', projectId: project.projectId, membershipId: employee.membershipId, expectedVersion: 0, actions: ['read'] })
      secondGrant = (await active(owner, { kind: 'workgraph-grant', request: { ...query, taskId: right, scope: 'node', membershipId: employee.membershipId,
        actions: ['read'], expectedVersion: 0, operationId: randomUUID() } })).receipt
      await active(secondMember, { kind: 'device-register', name: 'Independent CSV contract device' })
      await assert.rejects(kit.readOrganizationExecution(secondMember, host, { ...second.selector, runId: second.request.runId }, () => {}, new AbortController().signal))
      member = secondMember
      localRoot = join(root, 'second-employee-host'); work = join(root, 'second-employee-git')
      localRoots.push(localRoot); workRoots.push(work)
      await mkdir(localRoot); await mkdir(work)
      git(work, 'init'); git(work, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '--allow-empty', '-m', 'baseline')
      await writeFile(join(work, 'untouched.txt'), 'PRIVATE_UNSELECTED_SENTINEL')
      host = await createHost(localRoot); hosts.push(host)
      inputs.execution.directory = work
      inputs.messages = ['SECOND_PRIVATE_EXECUTION_SENTINEL: prepare independent contract']
      configDigest = kit.executionInputsDigest(inputs)
    }
    const third = await prepare(right, 2)
    await execute(third, [tool('write_file', { path: 'contract.json', content: '{"columns":["name","note"],"encoding":"UTF-8"}\n' }), 'Contract ready'])
    const rightFile = await submit(third, 'contract.json'); await review(rightFile)
    if (kit.twoMembers) {
      await assert.rejects(kit.readOrganizationExecution(firstMember, host, { ...third.selector, runId: third.request.runId }, () => {}, new AbortController().signal))
      const firstPrivate = await kit.readOrganizationExecution(firstMember, hosts[0], { ...second.selector, runId: second.request.runId }, () => {}, new AbortController().signal)
      assert.equal(JSON.stringify(firstPrivate).includes('SECOND_PRIVATE_EXECUTION_SENTINEL'), false)
      const secondPrivate = await kit.readOrganizationExecution(member, host, { ...third.selector, runId: third.request.runId }, () => {}, new AbortController().signal)
      assert.equal(JSON.stringify(secondPrivate).includes('PRIVATE_EXECUTION_SENTINEL: prepare CSV evidence'), false)
    }
    const integration = new kit.OrganizationIntegration()
    assert.equal((await active(owner, { kind: 'integration-read', request: integrationQuery })).integration.delivered, false)
    for (const file of [rightFile, leftFile]) {
      const download = await active(owner, { kind: 'delivery-download', request: { ...query, assignmentId: file.base.assignmentId, artifactId: file.artifactId } })
      await writeFile(join(target, file.path), Buffer.from(download.artifact.bytes, 'base64'))
    }
    await until(() => owner.snapshot().phase === 'ready')
    const observed = await integration.perform(owner, { kind: 'integration-verify', request: integrationQuery }, async () => target, () => {})
    await until(() => owner.snapshot().phase === 'ready')
    assert.equal((await active(owner, { kind: 'integration-read', request: integrationQuery })).integration.delivered, false)
    await until(() => owner.snapshot().phase === 'ready')
    const confirm = await integration.perform(owner, { kind: 'integration-confirm', request: { ...integrationQuery,
      integrationId: observed.receipt.integration.integrationId, confirmed: true } }, async () => { throw new Error('unexpected picker') }, () => {})
    assert.equal(confirm.receipt.integration.delivered, true)
    assert.equal(execFileSync(process.execPath, ['-e', 'process.stdout.write(require("node:fs").readFileSync(process.argv[1]))', join(target, 'result.csv')]).toString(), csv)
    for (const directory of [...workRoots, target]) assert.equal(await readFile(join(directory, 'untouched.txt'), 'utf8'), 'PRIVATE_UNSELECTED_SENTINEL')
    const shared = JSON.stringify(await active(owner, { kind: 'delivery-read', request: third.selector }))
    assert.equal(shared.includes('PRIVATE_EXECUTION_SENTINEL'), false)
    assert.equal(shared.includes(work), false)
    await until(() => owner.snapshot().phase === 'ready')
    await assert.rejects(kit.readOrganizationExecution(owner, host, { ...third.selector, runId: third.request.runId }, () => {}, new AbortController().signal))
    await active(owner, { kind: 'workgraph-grant', request: { ...query, taskId: parent, scope: 'subtree', membershipId: firstEmployee.membershipId,
      actions: [], expectedVersion: grant.revision, operationId: randomUUID() } })
    if (secondGrant) await active(owner, { kind: 'workgraph-grant', request: { ...query, taskId: right, scope: 'node', membershipId: employee.membershipId,
      actions: [], expectedVersion: secondGrant.revision, operationId: randomUUID() } })
    await member.perform({ kind: 'reconnect' })
    await assert.rejects(active(member, { kind: 'delivery-download', request: { ...third.selector, artifactId: rightFile.artifactId } }))
    await until(() => member.snapshot().phase === 'ready')
    await assert.rejects(kit.readOrganizationExecution(member, host, { ...third.selector, runId: third.request.runId }, () => {}, new AbortController().signal))
    await host.close(); hosts.splice(hosts.indexOf(host), 1)
    const paths = (await Promise.all(localRoots.map(async directory => (await readdir(join(directory, 'execution'), { recursive: true }))
      .filter(p => p.endsWith('.jsonl')).map(p => join(directory, 'execution', p))))).flat()
    assert.equal(paths.length, 3)
    const logs = (await Promise.all(paths.map(p => readFile(p, 'utf8')))).join('')
    assert.ok(logs.includes('organization/execution-action'))
    assert.ok(logs.includes('Use name,note and preserve CSV quotes.'))
    assert.ok(logs.includes('PRIVATE_EXECUTION_SENTINEL'))
    const records = logs.split('\n').filter(Boolean).map(line => JSON.parse(line))
    const boundRuns = records.filter(event => event.type === 'organization/execution-binding').map(event => event.data.run.id)
    assert.deepEqual(new Set(boundRuns), new Set([first.request.runId, second.request.runId, third.request.runId]))
    const loggedActions = new Set(records.filter(event => event.type === 'organization/execution-action').map(event => event.data.action.actionId))
    for (const client of clients) await client.close()
    await app.close()
    const db = new DatabaseSync(join(server, 'organization.sqlite'), { readOnly: true })
    try {
      const runs = db.prepare('SELECT data FROM execution_runs').all().map(r => JSON.parse(r.data))
      assert.equal(runs.length, 3); assert.ok(runs.every(r => r.state === 'succeeded'))
      for (const row of db.prepare('SELECT id,data FROM execution_delegations').all()) {
        const count = db.prepare('SELECT count(*) AS n FROM execution_actions a JOIN execution_runs r ON r.id=a.runId WHERE r.delegationId=?').get(row.id).n
        assert.equal(JSON.parse(row.data).used, count)
      }
      const actions = db.prepare('SELECT id FROM execution_actions').all()
      assert.deepEqual(new Set(actions.map(action => action.id)), loggedActions)
      assert.equal(db.prepare('SELECT count(*) AS n FROM integration_confirmations').get().n, 1)
      assert.equal(db.prepare('SELECT count(*) AS n FROM plan_revisions WHERE planId=?').get(query.planId).n, 2)
    } finally { db.close() }
    const sharedDatabase = await readFile(join(server, 'organization.sqlite'))
    assert.equal(sharedDatabase.includes(Buffer.from('PRIVATE_EXECUTION_SENTINEL')), false)
    assert.equal(sharedDatabase.includes(Buffer.from('PRIVATE_UNSELECTED_SENTINEL')), false)
    assert.equal(sharedDatabase.includes(Buffer.from('SECOND_PRIVATE_EXECUTION_SENTINEL')), false)
    app = await kit.bootOrganization(config)
    const login = await app.authority.login({ username: 'owner', password })
    await app.authority.readIntegration(login.token, integrationQuery, view => assert.equal(view.delivered, true))
    await app.authority.downloadArtifact(login.token, { ...third.selector, artifactId: rightFile.artifactId }, value => assert.equal(value.bytes, rightFile.bytes.toString('base64')))
  } finally {
    const results = await Promise.allSettled(hosts.map(h => h.close()))
    const nativeResults = await Promise.allSettled(clients.map(c => c.close()))
    try { await app?.close() } finally { await rm(root, { recursive: true, force: true }) }
    for (const result of [...results, ...nativeResults]) if (result.status === 'rejected') throw result.reason
  }
}
