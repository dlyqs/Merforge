/** Published private process plus two native clients, in Node and Electron Node mode; never creates a window. */
import { spawn } from 'node:child_process'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, mkdir, symlink, rm, writeFile, readFile, rename } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { randomBytes, randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { request } from 'node:https'
import { DesktopOrganizationManager } from '../../desktop/lib/types/organization-manager.js'
import { DesktopOrganizationProcess } from '../../desktop/lib/types/organization-process.js'
import { OrganizationConnection } from '../../../packages/host/organization-connection/lib/index.js'
import { backupOrganization, restoreOrganization } from '../../../packages/workspace/organization/lib/types/maintenance.js'
import { organizationRequest } from '../../../packages/api/organization-api/lib/types/transport.js'

const root = await mkdtemp(join(tmpdir(), 'organization-integration-'))
const controllers = []
const clients = []
const children = []
const password = 'correct horse battery staple'
const secret = () => randomBytes(32).toString('base64url')
async function until(predicate) {
  const deadline = Date.now() + 15000
  while (!predicate()) { assert.ok(Date.now() < deadline, 'state transition deadline'); await delay(25) }
}
try {
  await mkdir(join(root, 'node_modules', '@deepseek-ai'), { recursive: true })
  await symlink(resolve(import.meta.dirname, '..'), join(root, 'node_modules', '@deepseek-ai', 'dsh-desktop-host'), 'junction')
  const require = createRequire(new URL('../../desktop/package.json', import.meta.url))
  for (const executable of [process.execPath, require('electron')]) {
    const home = join(root, randomUUID())
    await mkdir(home)
    const directory = join(home, 'organization-server')
    const controller = new DesktopOrganizationProcess(executable, root, 20000)
    controllers.push(controller)
    const config = { api: { directory, host: '127.0.0.1', port: 0, names: ['127.0.0.1'], eventPollMs: 20 } }
    const ready = await controller.start(config)
    assert.equal(ready.phase, 'ready')
    config.api.port = ready.port
    const second = new DesktopOrganizationProcess(executable, root, 20000)
    controllers.push(second)
    await assert.rejects(second.start(config))
    const initialized = await controller.control('initialize', { operationId: randomUUID(), username: 'owner', password, organizationName: 'Company', recoveryToken: secret() })
    const origin = `https://127.0.0.1:${ready.port}`
    const trust = { ...ready, origin, timeoutMs: 5000, maxResponseBytes: 1048576 }
    async function native(username) {
      const personal = join(root, `personal-${username}-${randomUUID()}`)
      await mkdir(personal)
      await writeFile(join(personal, 'private.txt'), `private-${username}-session-api-key-sentinel`)
      const client = new OrganizationConnection({ trustPath: join(personal, 'organization-trust.json'), reconnectMs: 100 })
      clients.push(client)
      await client.perform({ kind: 'probe', origin })
      await client.perform({ kind: 'trust', fingerprint: ready.fingerprint })
      return { client, personal }
    }
    const leader = await native('leader')
    const employee = await native('employee')
    const owner = leader.client
    const member = employee.client
    await owner.perform({ kind: 'login', username: 'owner', password })
    await owner.perform({ kind: 'select', organizationId: initialized.organizationId })
    const invite = await owner.perform({ kind: 'invite', role: 'member' })
    const registered = await member.perform({ kind: 'register', username: 'employee', password, invitationToken: invite.invitationToken })
    await assert.rejects(member.perform({ kind: 'register', username: 'other', password, invitationToken: invite.invitationToken }))
    await member.perform({ kind: 'login', username: 'employee', password })
    await member.perform({ kind: 'select', organizationId: initialized.organizationId })
    const command = async body => {
      await until(() => owner.snapshot().phase === 'ready')
      return owner.perform({ kind: 'command', command: { ...body, operationId: randomUUID(), organizationId: initialized.organizationId } })
    }
    await command({ kind: 'create-project', name: 'Hidden salary project' })
    const project = (await command({ kind: 'create-project', name: 'Shared design project' })).receipt
    const granted = (await command({ kind: 'set-grant', projectId: project.projectId, membershipId: registered.receipt.membershipId, expectedVersion: 0, actions: ['read'] })).receipt
    await until(() => member.snapshot().projects?.total === 1)
    assert.equal(owner.snapshot().projects.total, 0)
    await member.perform({ kind: 'search', query: 'salary', offset: 0 })
    assert.equal(member.snapshot().projects.total, 0)
    await member.perform({ kind: 'reconnect' })
    await command({ kind: 'set-grant', projectId: project.projectId, membershipId: initialized.membershipId,
      expectedVersion: 0, actions: ['read', 'write'] })
    const rootTask = randomUUID(), publicTask = randomUUID(), phaseId = randomUUID()
    const taskQuery = { organizationId: initialized.organizationId, projectId: project.projectId, planId: randomUUID() }
    const task = (id, parentTaskId, goal) => ({ id, parentTaskId, goal, phaseId, scope: 'Shared preparation',
      acceptance: ['Reviewed'], artifacts: [], required: true, dependsOn: [], suggestedMembershipId: null })
    const definition = { taskId: rootTask, phases: [{ id: phaseId, title: 'Preparation' }], tasks: [
      task(rootTask, null, 'HIDDEN_TASK_ROOT'), task(publicTask, rootTask, 'Employee preparation'),
    ] }
    const saved = await owner.perform({ kind: 'workgraph-save', request: { ...taskQuery, definition, expectedRevision: 0, operationId: randomUUID() } })
    assert.equal(saved.receipt.planRevision, 1)
    await owner.perform({ kind: 'workgraph-grant', request: { ...taskQuery, taskId: publicTask, scope: 'subtree',
      membershipId: registered.receipt.membershipId, actions: ['read'], expectedVersion: 0, operationId: randomUUID() } })
    await until(() => member.snapshot().phase === 'ready')
    const projected = await member.perform({ kind: 'workgraph-tasks', request: taskQuery })
    assert.equal(projected.workgraph.result.value.total, 1)
    assert.equal(projected.workgraph.result.value.items[0].parentTaskId, null)
    assert.equal(JSON.stringify(projected).includes('HIDDEN_TASK_ROOT'), false)
    assert.equal(JSON.stringify(member.snapshot()).includes('Employee preparation'), false)
    const login = (await organizationRequest(trust, 'POST', '/organization/v1/login', { username: 'employee', password })).body
    for (const path of ['/api/session', '/api/attachments/private-employee', '/files/private.txt', '/download/private-leader', '/organization/v1/initialize', '/organization/v1/recover']) {
      const status = await new Promise((yes, no) => {
        const req = request(new URL(path, origin), { ca: ready.certificate, agent: false, headers: { authorization: `Bearer ${login.token}` } }, response => { response.resume(); response.once('end', () => yes(response.statusCode)) })
        req.once('error', no); req.end()
      })
      assert.equal(status, 404)
    }
    await command({ kind: 'set-grant', projectId: project.projectId, membershipId: registered.receipt.membershipId, expectedVersion: granted.revision, actions: [] })
    await until(() => member.snapshot().projects?.total === 0)
    await member.perform({ kind: 'personal' })
    assert.equal(member.snapshot().projects, undefined)
    await member.perform({ kind: 'select', organizationId: initialized.organizationId })
    await controller.stop()
    await until(() => member.snapshot().phase === 'offline')
    assert.equal(member.snapshot().projects, undefined)
    const backup = backupOrganization(directory, join(root, `backup-${randomUUID()}`), 5000)
    const database = await readFile(join(backup, 'organization.sqlite'))
    assert.equal(database.includes(Buffer.from('private-leader-session-api-key-sentinel')), false)
    assert.equal(database.includes(Buffer.from('private-employee-session-api-key-sentinel')), false)
    assert.equal(await readFile(join(leader.personal, 'private.txt'), 'utf8'), 'private-leader-session-api-key-sentinel')
    assert.equal(await readFile(join(employee.personal, 'private.txt'), 'utf8'), 'private-employee-session-api-key-sentinel')
    const restored = restoreOrganization(backup, directory, 5000)
    assert.ok(restored.recoveryToken)
    await controller.start(config)
    assert.equal((await organizationRequest(trust, 'GET', '/organization/v1/organizations', undefined, login.token)).status, 401)
    await until(() => member.snapshot().phase === 'signed-out')
    await member.perform({ kind: 'login', username: 'employee', password })
    await member.perform({ kind: 'select', organizationId: initialized.organizationId })
    assert.equal(member.snapshot().projects.total, 0)
    await owner.perform({ kind: 'login', username: 'owner', password })
    await owner.perform({ kind: 'select', organizationId: initialized.organizationId })
    const restoredPlan = await owner.perform({ kind: 'workgraph-read', request: taskQuery })
    assert.deepEqual(restoredPlan.workgraph.result.value.definition, definition)
    await until(() => member.snapshot().phase === 'ready')
    await assert.rejects(member.perform({ kind: 'workgraph-tasks', request: taskQuery }), /forbidden/)
    await member.perform({ kind: 'select', organizationId: initialized.organizationId })
    await controller.stop()
    await rename(join(directory, 'tls-identity.json'), join(directory, 'old-tls.json'))
    await controller.start(config)
    await until(() => member.snapshot().error === 'certificate-changed')
    assert.equal(member.snapshot().principal, undefined)
    await controller.stop()
    const manager = new DesktopOrganizationManager(controller, home, async () => undefined)
    await manager.perform({ kind: 'configure', settings: { host: '127.0.0.1', port: ready.port, names: ['127.0.0.1'], restoreOnLaunch: true } })
    await manager.close()
    const reopenedManager = new DesktopOrganizationManager(controller, home, async () => undefined)
    await reopenedManager.restoreOnLaunch()
    assert.equal(reopenedManager.snapshot().server.phase, 'ready')
    await reopenedManager.close()
  }
  const crashConfig = { api: { directory: join(root, 'crash-service'), host: '127.0.0.1', port: 0, names: ['127.0.0.1'] } }
  const child = spawn(process.execPath, [resolve(import.meta.dirname, '../lib/organization.js')], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] })
  const exited = new Promise(resolve => child.once('close', resolve))
  children.push({ child, exited })
  const reply = type => new Promise((resolve, reject) => {
    const deadline = setTimeout(() => { child.off('message', receive); reject(new Error('child response timeout')) }, 20000)
    const receive = message => { if (message.type === type) { clearTimeout(deadline); child.off('message', receive); resolve(message) } }
    child.on('message', receive)
  })
  const crashedReady = reply('ready')
  child.send({ type: 'boot', config: crashConfig })
  await crashedReady
  const created = reply('receipt')
  child.send({ type: 'initialize', requestId: 1, input: { operationId: randomUUID(), username: 'crashowner', password, organizationName: 'Durable crash', recoveryToken: secret() } })
  assert.ok((await created).receipt.organizationId)
  child.kill('SIGKILL'); await exited
  const replacement = new DesktopOrganizationProcess(process.execPath, root, 20000)
  controllers.push(replacement)
  const recovered = await replacement.start(crashConfig)
  const recoveredTrust = { ...recovered, origin: `https://127.0.0.1:${recovered.port}`, timeoutMs: 5000, maxResponseBytes: 1048576 }
  assert.equal((await organizationRequest(recoveredTrust, 'POST', '/organization/v1/login', { username: 'crashowner', password })).status, 200)
  await replacement.stop()
  console.log('organization integration built smoke passed: Node + Electron, two native clients, WorkGraph save/grant/projection/restore, grants, revocation, private-route isolation, backup/restore and certificate rotation')
} finally {
  for (const { child, exited } of children) { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); await exited }
  await Promise.allSettled(clients.map(client => client.close()))
  await Promise.allSettled(controllers.map(controller => controller.stop()))
  await rm(root, { recursive: true, force: true })
}
