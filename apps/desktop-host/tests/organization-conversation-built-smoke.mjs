/** Published planning path through real HTTPS, native owner, private child IPC and cold JSONL. No window. */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm, readdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { bootOrganization } from '../lib/organization-boot.js'
import { OrganizationConnection } from '../../../packages/host/organization-connection/lib/index.js'
import { createOrganizationToken } from '../../../packages/workspace/organization/lib/index.js'
import { organizationConversation } from '../../desktop/lib/types/organization-conversation.js'
const root = await mkdtemp(join(tmpdir(), 'organization-conversation-built-'))
const children = new Set(), app = await bootOrganization({ api: { directory: join(root, 'service'), host: '127.0.0.1', port: 0, names: ['127.0.0.1'] } })
const connection = new OrganizationConnection({ trustPath: join(root, 'trust.json') })
async function child() {
  const require = createRequire(new URL('../../desktop/package.json', import.meta.url))
  const executable = process.argv.includes('--electron') ? require('electron') : process.execPath
  const processChild = spawn(executable, ['--expose-internals', fileURLToPath(new URL('./organization-conversation-host.mjs', import.meta.url)), root],
    { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: ['ignore', 'inherit', 'inherit', 'ipc'] })
  const nonce = randomUUID(), pending = new Map()
  const exited = new Promise((resolve, reject) => { processChild.once('error', reject); processChild.once('exit', code => code === 0 ? resolve() : reject(new Error(`planning child exited ${code}`))) })
  const ready = new Promise(resolve => processChild.once('message', resolve))
  processChild.on('message', message => {
    if (message.nonce !== nonce) return
    const query = pending.get(message.requestId)
    if (!query) return
    if (message.type === 'organization-conversation-result') {
      if (message.result) query.resolve(message.result); else query.reject(new Error(message.error))
    } else if (message.type === 'organization-conversation-authorize') {
      void query.authorize(message.command).then(authority => {
        if (processChild.connected) processChild.send({ type: 'organization-conversation-authorized', requestId: message.requestId, nonce,
          authorizationId: message.authorizationId, authority })
      }, () => {
        if (processChild.connected) processChild.send({ type: 'organization-conversation-authorized', requestId: message.requestId, nonce,
          authorizationId: message.authorizationId, error: 'denied' })
      })
    }
  })
  const close = async () => { if (processChild.connected) processChild.send({ type: 'shutdown' }); await exited; children.delete(close) }
  children.add(close)
  await Promise.race([ready, exited.then(() => { throw new Error('child exited before readiness') })])
  return { close, organizationConversation: async (request, authorize, timeoutMs, signal) => {
    const requestId = randomUUID(), abort = () => { if (processChild.connected) processChild.send({ type: 'organization-conversation-cancel', requestId, nonce }) }
    signal.addEventListener('abort', abort, { once: true })
    try {
      return await new Promise((resolve, reject) => {
        pending.set(requestId, { authorize, resolve, reject })
        processChild.send({ type: 'organization-conversation-operation', requestId, nonce, request, timeoutMs })
      })
    } finally { pending.delete(requestId); signal.removeEventListener('abort', abort) }
  } }
}
try {
  const password = 'planning smoke password'
  const owner = await app.authority.initialize({ operationId: randomUUID(), username: 'owner', password, organizationName: 'Planning', recoveryToken: createOrganizationToken() })
  const login = await app.authority.login({ username: 'owner', password })
  const project = await app.authority.projectCommand(login.token, { kind: 'create-project', operationId: randomUUID(), organizationId: owner.organizationId, name: 'CSV project' })
  await connection.perform({ kind: 'probe', origin: `https://127.0.0.1:${app.ready.port}` })
  await connection.perform({ kind: 'trust', fingerprint: app.ready.fingerprint })
  await connection.perform({ kind: 'login', username: 'owner', password })
  await connection.perform({ kind: 'select', organizationId: owner.organizationId })
  const request = { kind: 'open', operationId: randomUUID(), organizationId: owner.organizationId, projectId: project.projectId, conversationId: randomUUID() }
  const invoke = (host, value) => organizationConversation(connection, host, value, () => {}, new AbortController().signal)
  const first = await child(), opened = await invoke(first, request)
  const send = { ...request, kind: 'send', operationId: randomUUID(), text: 'Plan a CSV analysis', route: 'new_goal',
    selection: { model: 'deepseek-flash', endpoint: 'https://api.deepseek.com/anthropic/v1' } }
  const result = await invoke(first, send)
  assert.equal(result.result.sessionId, opened.result.sessionId)
  assert.equal(result.result.state, 'completed')
  assert(result.result.entries.some(e => e.text === 'Private project planning smoke'))
  await first.close()
  const second = await child(), restored = await invoke(second, { ...request, kind: 'read' })
  assert.deepEqual(restored.result, result.result)
  assert.deepEqual((await invoke(second, send)).result, restored.result)
  const qualification = await connection.perform({ kind: 'planning-read', request: { organizationId: request.organizationId, projectId: request.projectId, conversationId: request.conversationId } })
  assert.equal(qualification.planning.grant.usedRequests, 1)
  const taskId = randomUUID(), planId = randomUUID(), phaseId = randomUUID()
  const taskQuery = { organizationId: request.organizationId, projectId: request.projectId, planId }
  await app.authority.savePlan(login.token, { ...taskQuery, operationId: randomUUID(), expectedRevision: 0,
    definition: { taskId, phases: [{ id: phaseId, title: 'Smoke' }], tasks: [{ id: taskId, phaseId, parentTaskId: null,
      goal: 'Assigned smoke task', scope: 'Current task only', acceptance: ['Review report'], artifacts: [],
      required: true, dependsOn: [], suggestedMembershipId: null }] } })
  await connection.perform({ kind: 'reconnect' })
  const batch = await connection.perform({ kind: 'assignment-batch', request: { ...taskQuery, planRevision: 1, confirmed: true,
    commands: [{ ...taskQuery, kind: 'approve-assignment', operationId: randomUUID(), taskId,
      planRevision: 1, assigneeId: owner.membershipId }] } })
  assert.equal(batch.assignmentBatch.items[0].state, 'confirmed')
  const assignmentId = batch.assignmentBatch.items[0].receipt.assignmentId
  const taskRequest = { ...request, operationId: randomUUID(), conversationId: assignmentId, assignment: { planId, assignmentId } }
  const taskConversation = await invoke(second, taskRequest)
  assert.notEqual(taskConversation.result.sessionId, opened.result.sessionId)
  assert.deepEqual(taskConversation.result.entries, [{ role: 'assistant',
    text: 'Assigned smoke task\n\nCurrent task only\n\n• Review report' }])
  assert.equal(taskConversation.result.assignment.state, 'pending')
  assert.equal(taskConversation.result.goals[0].proposal.definition.taskId, taskId)
  const preparation = await connection.perform({ kind: 'assignment-preparation', request: { ...taskQuery, assignmentId } })
  assert.deepEqual(preparation.assignment.result.value.delegations, [])
  assert.equal(preparation.assignment.result.value.lease, null)
  await second.close()
  const third = await child()
  assert.equal((await invoke(third, taskRequest)).result.sessionId, taskConversation.result.sessionId)
  await assert.rejects(invoke(third, { ...send, conversationId: assignmentId, assignment: { planId, assignmentId } }))
  await third.close()
  const logs = (await readdir(join(root, 'conversations'), { recursive: true })).filter(p => p.endsWith('.jsonl'))
  assert.equal(logs.length, 2)
  assert(!(await readFile(join(root, 'conversations', logs[0]), 'utf8')).includes('local-only-smoke-key'))
  console.log(`organization conversation built smoke: ${process.argv.includes('--electron') ? 'Electron Node' : 'Node'} private IPC/HTTPS/Agent/JSONL/reopen/duplicate/assignment passed`)
} finally {
  for (const close of [...children]) await close()
  await connection.close(); await app.close(); await rm(root, { recursive: true, force: true })
}
