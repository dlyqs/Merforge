import { brandString } from '@deepseek-ai/dsh-brand'
import type { CodexSetupOwnerId } from '@deepseek-ai/dsh-agent-codex/setup-types'
import { randomUUID } from 'node:crypto'
import { contextRequestSchema, contextAuthoritySchema } from '@deepseek-ai/dsh-organization-context/protocol'
import { conversationRequestSchema } from '@deepseek-ai/dsh-organization-conversation/protocol'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DesktopHostFatalError, DesktopHostProcess, DesktopHostUncleanExitError } from '../src/host-process.ts'

const roots: string[] = []
const hosts: DesktopHostProcess[] = []

const HTTP_HOST = `
import { createServer } from 'node:http'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
const server = createServer((request, response) => {
  if (request.url === '/fatal') {
    process.send({ type: 'fatal', message: 'plugin unavailable' })
    response.end('reported')
    return
  }
  if (request.url === '/crash') {
    response.end('exiting', () => {
      process.stderr.write('plugin crashed', () => process.exit(7))
    })
    return
  }
  response.setHeader('content-type', 'application/json')
  response.end(JSON.stringify({runtime: process.argv[2], profile: process.argv[3], cwd: process.cwd(), nodePath: process.env.NODE_PATH, registry: process.env.NPM_CONFIG_REGISTRY, nodeOptions: process.env.NODE_OPTIONS, runAsNode: process.env.ELECTRON_RUN_AS_NODE, internals: process.execArgv.includes('--expose-internals')}))
})
server.listen(0, '127.0.0.1', () => {
  process.send({ type: 'ready', url: 'http://127.0.0.1:' + server.address().port + '/?token=fixture' })
})
process.on('message', message => {
  if (message.type === 'update-tasks') {
    process.send({ type: 'update-tasks', requestId: message.requestId, active: message.action === 'lock' })
    return
  }
  if (message.type !== 'shutdown') return
  server.close(() => {
    writeFileSync(join(process.argv[3], 'stopped'), '')
    process.send({ type: 'shutdown-complete' }, () => process.disconnect())
  })
  server.closeAllConnections()
})
`

function projectWithHost(source = HTTP_HOST): string {
  const project = mkdtempSync(join(tmpdir(), 'dsh-desktop-host-test-'))
  roots.push(project)
  const packageRoot = join(project, 'node_modules', '@deepseek-ai', 'dsh-desktop-host')
  mkdirSync(join(packageRoot, 'lib'), { recursive: true })
  writeFileSync(join(packageRoot, 'package.json'), '{"name":"@deepseek-ai/dsh-desktop-host","type":"module"}\n')
  writeFileSync(join(packageRoot, 'lib', 'index.js'), source)
  return project
}

function hostProcess(
  runtime: string, profile = runtime, onFailure?: (error: Error) => void, environment = process.env,
): DesktopHostProcess {
  const host = new DesktopHostProcess(process.execPath, runtime, profile, undefined, environment, onFailure)
  hosts.push(host)
  return host
}

afterEach(async () => {
  await Promise.all(hosts.splice(0).map(host => host.stop()))
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

it.each([
  ['forbidden', 'forbidden'], ['operation-pending', 'operation-pending'], ['superseded', 'superseded'],
  ['version-conflict', 'version-conflict'], ['unavailable', 'unavailable'], ['private diagnostic token=fixture-secret', 'unavailable'],
])('returns the safe conversation authorization outcome for %s over child IPC', async (failure, code) => {
  const project = projectWithHost(HTTP_HOST.replace("  if (message.type !== 'shutdown') return", `
  if (message.type === 'organization-conversation-operation') {
    process.send({ type: 'organization-conversation-authorize', requestId: message.requestId, nonce: message.nonce,
      authorizationId: '11111111-1111-4111-8111-111111111111' })
    return
  }
  if (message.type === 'organization-conversation-authorized') {
    process.send({ type: 'organization-conversation-result', requestId: message.requestId, nonce: message.nonce, error: message.error })
    return
  }
  if (message.type !== 'shutdown') return`))
  const host = hostProcess(project)
  await host.start()
  const request = conversationRequestSchema.parse({ kind: 'read', organizationId: randomUUID(), projectId: randomUUID(),
    conversationId: randomUUID(), operationId: randomUUID() })
  await expect(host.organizationConversation(request, async () => { throw new Error(failure) }, 2000,
    new AbortController().signal)).rejects.toThrow(new Error(code))
})

describe('desktop host process', () => {
  it('correlates task inspections and admission changes over private IPC', async () => {
    const host = hostProcess(projectWithHost())
    await expect(host.updateTasks('inspect')).rejects.toThrow('Host is unavailable')
    await host.start()
    expect(await Promise.all([host.updateTasks('inspect'), host.updateTasks('lock'), host.updateTasks('unlock')]))
      .toEqual([false, true, false])
    await host.stop(true)
    await expect(host.updateTasks('inspect')).rejects.toThrow('Host is unavailable')
  })

  it.each([
    'process.exit(17)',
    'process.exit(0)',
  ])('refuses installation when exit lacks successful teardown acknowledgement: %s', async (exit) => {
    const host = hostProcess(projectWithHost(`
      process.send({ type: 'ready', url: 'http://127.0.0.1:3080/' })
      process.on('message', message => {
        if (message.type === 'shutdown') process.stderr.write('token=fixture-secret', () => { ${exit} })
      })
    `))
    await host.start()
    const error = await host.stop(true).then(() => undefined, (error: unknown) => error)
    expect(error).toBeInstanceOf(DesktopHostUncleanExitError)
    expect(String(error)).toContain('shutdown acknowledged false')
    expect(String(error)).toContain('graceful deadline exceeded false')
    expect(String(error)).not.toContain('fixture-secret')
    await expect(host.stop()).resolves.toBeUndefined()
  })

  it('returns the Web authentication URL and waits for graceful shutdown', async () => {
    const runtime = projectWithHost()
    const failure = vi.fn()
    const host = hostProcess(runtime, runtime, failure)
    const ready = await host.start()
    expect(new URL(ready.url).searchParams.get('token')).toBe('fixture')
    expect(await host.start()).toEqual(ready)
    expect((await fetch(ready.url)).status).toBe(200)
    await host.stop()
    expect(existsSync(join(runtime, 'stopped'))).toBe(true)
    await expect(fetch(ready.url)).rejects.toThrow()
    expect(failure).not.toHaveBeenCalled()
  })

  it('passes external dependencies and package-manager paths to the Host', async () => {
    const runtime = projectWithHost(HTTP_HOST.replace('runtime: process.argv[2]',
      'pnpm: process.argv[5], nodeBin: process.argv[6], primaryRuntime: process.argv[4], runtime: process.argv[2]'))
    const primaryRuntime = join(runtime, 'external-primary-runtime')
    const host = new DesktopHostProcess(process.execPath, runtime, runtime, undefined, process.env,
      undefined, primaryRuntime, { pnpm: join(runtime, 'pnpm.mjs'), nodeBin: join(runtime, 'bin') })
    hosts.push(host)
    const { url } = await host.start()
    expect(await (await fetch(url)).json()).toMatchObject({ primaryRuntime, pnpm: join(runtime, 'pnpm.mjs'), nodeBin: join(runtime, 'bin') })
  })

  it('reports a fatal event after readiness once', async () => {
    const runtime = projectWithHost()
    const failure = vi.fn()
    const host = hostProcess(runtime, runtime, failure)
    const { url } = await host.start()
    await fetch(new URL('/fatal', url))
    await expect.poll(() => failure.mock.calls.length).toBe(1)
    await host.stop()
    expect(failure).toHaveBeenCalledTimes(1)
    expect(failure).toHaveBeenCalledWith(new Error('plugin unavailable'))
  })

  it('reports a child crash after readiness with its stderr diagnostic', async () => {
    const runtime = projectWithHost()
    const failure = vi.fn()
    const host = hostProcess(runtime, runtime, failure)
    const { url } = await host.start()
    await fetch(new URL('/crash', url))
    await expect.poll(() => failure.mock.calls.length).toBe(1)
    expect(failure).toHaveBeenCalledWith(new Error('dsh desktop host exited with 7: plugin crashed'))
  })

  it('retains only recent diagnostics from a noisy child', async () => {
    const runtime = projectWithHost('process.stderr.write(\'discarded-prefix\' + \'x\'.repeat(70_000) + \'recent-failure\', () => { process.exitCode = 7; process.disconnect() })')
    const failure = await hostProcess(runtime).start().catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(Error)
    const message = (failure as Error).message
    expect(message).not.toContain('discarded-prefix')
    expect(message.endsWith('recent-failure')).toBe(true)
    expect(message.length).toBeLessThan(66_000)
  })

  it('settles teardown when the executable cannot be spawned', async () => {
    const runtime = projectWithHost()
    const host = new DesktopHostProcess(join(runtime, 'missing-node'), runtime, runtime)
    hosts.push(host)
    await expect(host.start()).rejects.toThrow()
    await host.stop()
  })

  it('loads the resource entry with a separate profile and inherits runtime and package-manager configuration', async () => {
    const runtime = projectWithHost()
    const profile = mkdtempSync(join(tmpdir(), 'desktop-external-profile-'))
    roots.push(profile)
    const host = hostProcess(runtime, profile, undefined, {
      ...process.env, NODE_OPTIONS: '--no-warnings', NODE_PATH: '/custom', NPM_CONFIG_REGISTRY: 'https://registry.example.test/',
    })
    const { url } = await host.start()
    const response = await fetch(url)
    expect(await response.json()).toEqual({ runtime, profile, cwd: realpathSync(profile), nodePath: '/custom', registry: 'https://registry.example.test/', nodeOptions: '--no-warnings', runAsNode: '1', internals: true })
  })

  it.each([
    ["process.send({ type: 'fatal', message: 'startup failed' }); process.disconnect()", 'startup failed'],
    ["process.send({ type: 'ready', url: 4 })", 'invalid IPC event'],
    ["process.send({ type: 'fatal', message: 'startup failed', diagnostic: 42 })", 'invalid IPC event'],
    ['process.exit(0)', 'host stopped'],
  ])('rejects startup when the child fails before readiness: %s', async (source, message) => {
    const host = hostProcess(projectWithHost(source))
    await expect(host.start()).rejects.toThrow(message)
  })

  it('keeps the Host\'s inspected error separate from the message it reports', async () => {
    const diagnostic = "Error: startup failed\\n    at boot (lib/index.js:3:9) {\\n  code: 'ENOENT',\\n  path: '/profile/cordis.yml'\\n}"
    const failures: Error[] = []
    const host = hostProcess(projectWithHost(
      `process.send({ type: 'fatal', message: 'startup failed', diagnostic: ${JSON.stringify(diagnostic)} }); process.disconnect()`,
    ), undefined, (error) => { failures.push(error) })
    await expect(host.start()).rejects.toThrow('startup failed')
    const [failure] = failures
    expect(failure).toBeInstanceOf(DesktopHostFatalError)
    expect((failure as DesktopHostFatalError).diagnostic).toBe(diagnostic)
    expect(Object.keys(failure!)).not.toContain('diagnostic')
  })
})

it('correlates organization authorization with the private Host nonce and rejects cancelled reads', async () => {
  const source = HTTP_HOST + `
process.on('message', message => {
  if (message.type === 'organization-context-open') {
    process.send({ type: 'organization-context-authorize', requestId: message.requestId, nonce: message.nonce, authorizationId: message.requestId });
  }
  if (message.type === 'organization-context-authorized' && message.authority) {
    const authority = message.authority;
    const result = { sessionId: 'organization-context:' + message.requestId,
      owner: { version: 1, serverId: authority.serverId, accountId: authority.accountId, organizationId: authority.organizationId,
        planId: authority.task.planId, taskId: authority.task.id }, snapshot: authority.task, mode: 'pre-execution' };
    process.send({ type: 'organization-context-result', requestId: message.requestId,
      nonce: '00000000-0000-4000-8000-000000000000', error: 'stale nonce' });
    process.send({ type: 'organization-context-result', requestId: message.requestId, nonce: message.nonce, result });
  }
});`
  const host = hostProcess(projectWithHost(source)); await host.start()
  const request = contextRequestSchema.parse({ organizationId: randomUUID(), projectId: randomUUID(),
    planId: randomUUID(), taskId: randomUUID(), operationId: randomUUID() })
  const authority = contextAuthoritySchema.parse({ serverId: randomUUID(), accountId: randomUUID(),
    organizationId: request.organizationId, generation: 1, requestId: randomUUID(), task: {
      id: request.taskId, planId: request.planId, revision: 1, parentTaskId: null, phaseId: randomUUID(), phaseTitle: 'Phase',
      goal: 'Goal', scope: 'Scope', acceptance: ['Accepted'], artifacts: [], required: true, dependsOn: [],
      suggestedMembershipId: null, assignable: false, hasUndisclosedPrerequisite: false,
    } })
  const read = await host.openOrganizationContext(request, async () => authority, 2000, new AbortController().signal)
  expect(read.owner.accountId).toBe(authority.accountId)
  const cancel = new AbortController()
  const waiting = host.openOrganizationContext(request, async () => { cancel.abort(); return authority }, 2000, cancel.signal)
  await expect(waiting).rejects.toThrow('cancelled')
  await host.stop()
})

it('binds setup replies to the Host nonce and invalidates safe state after disconnect', async () => {
  const safe = { revision: 1, runtime: { version: '0.153.4', status: 'ready' }, account: { status: 'unknown' },
    catalog: { status: 'unknown', models: [] }, login: { status: 'waiting' } }
  const project = projectWithHost(HTTP_HOST.replace("  if (message.type !== 'shutdown') return", `
  if (message.type === 'codex-setup') {
    const snapshot = ${JSON.stringify(safe)}
    const device = { attemptId: '11111111-1111-4111-8111-111111111111', userCode: 'current-code' }
    if (message.operation.kind === 'snapshot') {
      process.send({ type: 'codex-setup-result', version: 1, nonce: message.nonce, requestId: message.requestId,
        result: { snapshot: { ...snapshot, revision: 3, login: { status: 'succeeded' } } } })
      return
    }
    process.send({ type: 'codex-setup-result', version: 1, nonce: '22222222-2222-4222-8222-222222222222', requestId: message.requestId,
      result: { snapshot, device: { ...device, userCode: 'stale-code' } } })
    const updated = message.operation.kind === 'detect' ? { ...snapshot, revision: 2, login: { status: 'failed', category: 'closed' } } : snapshot
    process.send({ type: 'codex-setup-changed', version: 1, nonce: message.nonce, snapshot: updated })
    process.send({ type: 'codex-setup-result', version: 1, nonce: message.nonce, requestId: message.requestId, result: { snapshot, device } })
    return
  }
  if (message.type !== 'shutdown') return`))
  const host = hostProcess(project)
  const ready = await host.start(), changed = vi.fn()
  const dispose = host.subscribeCodexSetup(changed)
  const result = await host.codexSetup(brandString<CodexSetupOwnerId>(randomUUID()), { kind: 'start' })
  expect(result.view.device?.userCode).toBe('current-code')
  expect(changed.mock.calls[0]?.[0]).toEqual(safe)
  const stale = await host.codexSetup(brandString<CodexSetupOwnerId>(randomUUID()), { kind: 'detect' })
  expect(stale.view.device).toBeUndefined()
  expect(stale.view.snapshot.revision).toBe(2)
  const latest = await host.codexSetup(brandString<CodexSetupOwnerId>(randomUUID()), { kind: 'snapshot' })
  expect(latest.view.snapshot.revision).toBe(3)
  const late = await host.codexSetup(brandString<CodexSetupOwnerId>(randomUUID()), { kind: 'detect' })
  expect(late.view.device).toBeUndefined()
  expect(late.view.snapshot.revision).toBe(3)
  await fetch(new URL('/fatal', ready.url))
  await vi.waitFor(() => {
    expect(changed.mock.calls.at(-1)?.[0]).toMatchObject({ login: { status: 'failed', category: 'closed' }, catalog: { status: 'unknown' } })
  })
  await expect(host.codexSetup(brandString<CodexSetupOwnerId>(randomUUID()), { kind: 'start' })).rejects.toThrow('closed')
  dispose()
})
