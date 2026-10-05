/** Explicit built-artifact smoke: plain Node and Electron Node mode, without a window. */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp, mkdir, symlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { randomBytes, randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { DesktopOrganizationProcess } from '../../desktop/lib/types/organization-process.js'
import { organizationRequest, probeOrganizationCertificate, followOrganizationEvents } from '../../../packages/api/organization-api/lib/types/transport.js'

const root = await mkdtemp(join(tmpdir(), 'organization-built-'))
const hostRoot = resolve(import.meta.dirname, '..')
const token = () => randomBytes(32).toString('base64url')
const config = directory => ({ api: { directory, host: '127.0.0.1', port: 0, names: ['127.0.0.1'] } })
const controllers = []
try {
  await mkdir(join(root, 'node_modules', '@deepseek-ai'), { recursive: true })
  await symlink(hostRoot, join(root, 'node_modules', '@deepseek-ai', 'dsh-desktop-host'), 'junction')
  const require = createRequire(new URL('../../desktop/package.json', import.meta.url))
  const electron = require('electron')
  for (const executable of [process.execPath, electron]) {
    const controller = new DesktopOrganizationProcess(executable, root, 20000)
    controllers.push(controller)
    assert.equal(controller.status().phase, 'disabled')
    const directory = join(root, randomUUID())
    const ready = await controller.start(config(directory))
    assert.equal(ready.phase, 'ready')
    const origin = `https://127.0.0.1:${ready.port}`
    const offer = await probeOrganizationCertificate(origin, 5000)
    assert.equal(offer.fingerprint, ready.fingerprint)
    const trust = { ...offer, origin, timeoutMs: 5000, maxResponseBytes: 1048576 }
    const receipt = await controller.control('initialize', { operationId: randomUUID(), username: 'owner', password: 'correct horse battery staple', organizationName: 'Smoke', recoveryToken: token() })
    assert.ok(receipt.organizationId)
    const login = await organizationRequest(trust, 'POST', '/organization/v1/login', { username: 'owner', password: 'correct horse battery staple' })
    assert.equal(login.status, 200)
    assert.equal((await organizationRequest(trust, 'GET', '/organization/v1/organizations', undefined, login.body.token)).body[0].name, 'Smoke')
    const call = (method, path, body) => organizationRequest(trust, method, '/organization/v1' + path, body, login.body.token)
    const project = (await call('POST', '/projects', { operationId: randomUUID(), kind: 'create-project', organizationId: receipt.organizationId, name: 'Smoke project' })).body
    const before = await call('GET', `/organizations/${receipt.organizationId}/projects`)
    assert.equal(before.body.total, 1)
    const granted = await call('POST', '/grants', { operationId: randomUUID(), kind: 'set-grant', organizationId: receipt.organizationId,
      projectId: project.projectId, membershipId: receipt.membershipId, expectedVersion: project.revision, actions: ['read', 'write'] })
    assert.equal(granted.status, 200)
    const snapshot = (await call('GET', `/organizations/${receipt.organizationId}/projects`)).body
    assert.equal(snapshot.items[0].name, 'Smoke project')
    const changed = await call('POST', '/projects', { operationId: randomUUID(), kind: 'rename-project', organizationId: receipt.organizationId,
      projectId: project.projectId, expectedVersion: project.revision, name: 'Changed project' })
    assert.equal(changed.status, 200)
    const cancelStream = new AbortController()
    const events = followOrganizationEvents(trust, receipt.organizationId, login.body.token, snapshot, cancelStream.signal)
    assert.equal((await events.next()).value.events[0].projectId, project.projectId)
    const reset = assert.rejects(events.next(), { code: 'snapshot-required' })
    assert.equal((await call('POST', '/grants', { operationId: randomUUID(), kind: 'set-grant', organizationId: receipt.organizationId,
      projectId: project.projectId, membershipId: receipt.membershipId, expectedVersion: granted.body.revision, actions: [] })).status, 200)
    await reset
    cancelStream.abort()
    assert.equal((await call('GET', `/organizations/${receipt.organizationId}/projects`)).body.total, 0)
    const migrationProject = await call('POST', '/projects', { operationId: randomUUID(), kind: 'create-project',
      organizationId: receipt.organizationId, name: 'Migration project' })
    assert.equal(migrationProject.status, 200)
    const taskId = randomUUID(), phaseId = randomUUID()
    const query = { organizationId: receipt.organizationId, projectId: migrationProject.body.projectId, conversationId: randomUUID() }
    const draft = { ...query, kind: 'save-planning-draft', operationId: randomUUID(), goalId: randomUUID(),
      assessmentId: randomUUID(), settingsRevision: 0, planId: randomUUID(), expectedRevision: 0,
      definition: { taskId, phases: [{ id: phaseId, title: 'Migration' }], tasks: [{ id: taskId, phaseId, parentTaskId: null,
        goal: 'Preserved draft', scope: 'Migration smoke', acceptance: ['Draft remains readable'], artifacts: [],
        required: true, dependsOn: [], suggestedMembershipId: null }] } }
    const saved = await call('POST', '/planning/command', draft)
    assert.equal(saved.status, 200)
    await controller.stop()
    assert.equal(controller.status().phase, 'disabled')
    await assert.rejects(organizationRequest(trust, 'GET', '/organization/v1/identity'))
    const old = new DatabaseSync(join(directory, 'organization.sqlite'))
    let history
    try {
      assert.equal(old.prepare('SELECT count(*) AS n FROM planning_grants').get().n, 0)
      history = old.prepare('SELECT * FROM planning_events ORDER BY revision').all()
      old.exec('DROP TABLE organization_project_lifecycle; PRAGMA user_version=16')
    } finally { old.close() }
    const reopened = await controller.start(config(directory))
    assert.equal(reopened.fingerprint, ready.fingerprint)
    const restartedTrust = { ...trust, origin: `https://127.0.0.1:${reopened.port}` }
    const restartCall = (path, body) => organizationRequest(restartedTrust, body === undefined ? 'GET' : 'POST',
      '/organization/v1' + path, body, login.body.token)
    const projects = await restartCall(`/organizations/${receipt.organizationId}/projects`)
    assert.equal(projects.status, 200)
    assert.equal(projects.body.total, 1)
    assert.equal(projects.body.items[0].createdBy, receipt.accountId)
    const preserved = await restartCall('/planning/plan', { ...query, kind: 'read-planning-plan', planId: draft.planId, taskId })
    assert.equal(preserved.status, 200)
    assert.equal(preserved.body.version.definition.tasks[0].goal, 'Preserved draft')
    assert.deepEqual((await restartCall('/planning/command', draft)).body, saved.body)
    const migrated = new DatabaseSync(join(directory, 'organization.sqlite'), { readOnly: true })
    try {
      assert.equal(migrated.prepare('PRAGMA user_version').get().user_version, 17)
      assert.deepEqual(migrated.prepare('SELECT * FROM planning_events ORDER BY revision').all(), history)
    } finally { migrated.close() }
    await controller.stop()
    console.log(`organization built smoke: ${executable === process.execPath ? 'Node' : 'Electron Node'} TLS/login/resources/replay/revocation/v16 grantless-draft upgrade/reopen/stop passed`)
  }
  const cancel = new DesktopOrganizationProcess(process.execPath, root, 20000)
  controllers.push(cancel)
  const pending = assert.rejects(cancel.start(config(join(root, randomUUID()))))
  await cancel.stop()
  await pending
  const invalid = new DesktopOrganizationProcess(process.execPath, root, 20000)
  controllers.push(invalid)
  await assert.rejects(invalid.start({ api: { port: -1 } }))
  assert.deepEqual(invalid.status(), { phase: 'failed', error: 'organization-invalid-configuration' })
  const orphan = spawn(process.execPath, [join(hostRoot, 'lib', 'organization.js')], { stdio: 'ignore' })
  assert.notEqual(await new Promise(resolve => orphan.once('exit', resolve)), 0)
  const disconnected = spawn(process.execPath, [join(hostRoot, 'lib', 'organization.js')], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] })
  const exited = new Promise(resolve => disconnected.once('exit', resolve))
  disconnected.send({ type: 'boot', config: config(join(root, randomUUID())) })
  const facts = await new Promise(resolve => disconnected.on('message', message => { if (message.type === 'ready') resolve(message) }))
  disconnected.disconnect()
  assert.equal(await exited, 0)
  await assert.rejects(probeOrganizationCertificate(`https://127.0.0.1:${facts.port}`, 1000))
  console.log('organization built smoke: cancellation, invalid config, parent disconnect and missing parent IPC passed')
} finally {
  for (const controller of controllers) await controller.stop()
  await rm(root, { recursive: true, force: true })
}
