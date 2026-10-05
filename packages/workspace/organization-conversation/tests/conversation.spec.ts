/** Real Loader/HTTPS/native IPC/JSONL planning composition; only model HTTP is deterministic. */
import { randomUUID } from 'node:crypto'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { afterEach, expect, it, vi } from 'vitest'
import { OrganizationConnection } from '@deepseek-ai/dsh-organization-connection'
import { SessionId } from '@deepseek-ai/dsh-session'
import { workgraphHarness, password } from '../../../api/organization-api/tests/workgraph-harness.ts'
import { organizationConversation } from '../../../../apps/desktop/src/organization-conversation.ts'
import { conversationRequestSchema } from '../src/protocol.ts'
import { conversationStateSchema } from '../src/state.ts'
import { boot, reply, selection } from './harness.ts'
const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => { vi.restoreAllMocks(); for (const close of cleanup.splice(0).reverse()) await close() })
async function setup() {
  const remote = await workgraphHarness(); cleanup.push(remote.close)
  const connection = new OrganizationConnection({ trustPath: join(remote.root, 'connection.json'), timeoutMs: 5000 })
  cleanup.push(() => connection.close())
  await connection.perform({ kind: 'probe', origin: remote.trust.origin })
  await connection.perform({ kind: 'trust', fingerprint: remote.trust.fingerprint })
  await connection.perform({ kind: 'login', username: 'reader', password })
  await connection.perform({ kind: 'select', organizationId: remote.owner.organizationId })
  const local = await boot(remote.root); cleanup.push(local.close)
  const request = conversationRequestSchema.parse({ kind: 'open', organizationId: remote.query.organizationId,
    projectId: remote.query.projectId, conversationId: randomUUID(), operationId: randomUUID() })
  const perform = (input = request, lifetime = new AbortController().signal) =>
    organizationConversation(connection, local.host, input, () => {}, lifetime)
  return { remote, connection, local, request, perform }
}
it('opens once without a model, partitions identities and denies personal registry, persistence, query and fork admission', async () => {
  const h = await setup(), fetch = vi.spyOn(globalThis, 'fetch')
  const [one, two] = await Promise.all([h.perform(), h.perform()])
  expect(two.result.sessionId).toBe(one.result.sessionId); expect(fetch).not.toHaveBeenCalled()
  expect(await h.local.ctx.sessionPersistence.list()).toEqual([])
  expect(() => h.local.ctx.sessions.create(one.result.sessionId)).toThrow('forbidden')
  await expect(h.local.ctx.sessionPersistence.open(one.result.sessionId, 'read')).rejects.toThrow('forbidden')
  expect(() => h.local.ctx.sessionQuery.observeSession(one.result.sessionId)).toThrow('forbidden')
  expect(() => h.local.ctx.sessions.create(SessionId('personal'), { meta: { parentSession: one.result.sessionId } })).toThrow('forbidden')
  await h.connection.perform({ kind: 'login', username: 'owner', password })
  await h.connection.perform({ kind: 'select', organizationId: h.request.organizationId })
  const other = await h.perform(); expect(other.result.sessionId).not.toBe(one.result.sessionId)
  await h.local.service.verifyBindings()
}, 20000)
it('logs method/settings/exact authority and model input, keeps clarification on one goal, and never replays a received send', async () => {
  const h = await setup(); const opened = await h.perform()
  const wire: string[] = []
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
    if (typeof init?.body !== 'string') throw new Error('serialized payload required')
    wire.push(init.body); return reply(wire.length === 1 ? 'clarify' : undefined)
  })
  const send = conversationRequestSchema.parse({ ...h.request, kind: 'send', operationId: randomUUID(),
    text: 'Create a CSV report with analysis and chart', selection, route: 'new_goal' })
  const first = await h.perform(send), duplicate = await h.perform(send)
  expect(first.result.state).toBe('completed'); expect(duplicate).toEqual(first)
  expect(fetch).toHaveBeenCalledTimes(2)
  expect(first.result.goals).toHaveLength(1); expect(first.result.goals[0]?.classification).toBe('clarify')
  const clarified = await h.perform(conversationRequestSchema.parse({ ...send, operationId: randomUUID(),
    text: 'Use revenue by month', route: 'clarification', goalId: first.result.goals[0]?.id }))
  expect(clarified.result.goals).toHaveLength(1); expect(clarified.result.sessionId).toBe(opened.result.sessionId)
  expect(wire[0]).toContain('organization-planning/v2'); expect(wire[0]).toContain('balanced')
  expect(wire[0]).toContain('Use that name as the root task’s goal')
  expect(wire[0]).toContain('Normally every node has at most 5 direct children.')
  expect(wire.join('')).not.toMatch(/HIDDEN_TASK|HIDDEN_ROOT|local-only-test-key/)
  const tools = z.object({ tools: z.array(z.object({ name: z.string() })) }).parse(JSON.parse(wire[0]!)).tools.map(t => t.name)
  expect(tools.sort()).toEqual(['planning_authorization', 'planning_members', 'workflow_assess', 'workflow_propose'])
  const reads = await h.connection.perform({ kind: 'planning-read', request: { organizationId: h.request.organizationId,
    projectId: h.request.projectId, conversationId: h.request.conversationId } })
  expect(reads.planning?.grant?.usedRequests).toBe(3)
  const logs = (await readdir(join(h.remote.root, 'conversations'), { recursive: true })).filter(p => p.endsWith('.jsonl'))
  expect(logs).toHaveLength(1)
  const log = await readFile(join(h.remote.root, 'conversations', logs[0]!), 'utf8')
  expect(log).toContain('organization/planning-input'); expect(log).toContain('user/message'); expect(log).toContain('request/header')
  expect(log).toContain('Normally every node has at most 5 direct children.')
  expect(log).not.toContain('local-only-test-key')
  await expect(h.perform(conversationRequestSchema.parse({ ...send, text: 'Changed request' }))).rejects.toThrow()
  await h.local.service.verifyBindings()
}, 20000)
it('persists organization preferences, reopens without running and retains goal/session after Host restart', async () => {
  const h = await setup(), opened = await h.perform()
  const settings = conversationRequestSchema.parse({ ...h.request, kind: 'settings', operationId: randomUUID(), expectedRevision: 0,
    settings: { enabled: false, granularity: 'fine' } })
  await h.perform(settings); expect((await h.perform(settings)).result.settings.revision).toBe(1)
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(reply())
  const send = conversationRequestSchema.parse({ ...h.request, kind: 'send', operationId: randomUUID(),
    text: 'A simple question', selection, route: 'new_goal' })
  const first = await h.perform(send)
  expect(first.result.settings).toEqual({ enabled: false, granularity: 'fine', revision: 1 })
  expect(fetch.mock.calls[0]?.[1]?.body).not.toContain('"name":"workflow_assess"')
  await h.local.close()
  const reopened = await boot(h.remote.root); cleanup.push(reopened.close)
  const read = await organizationConversation(h.connection, reopened.host, { ...h.request, kind: 'read' },
    () => {}, new AbortController().signal)
  expect(read.result.sessionId).toBe(opened.result.sessionId); expect(read.result.entries).toEqual(first.result.entries)
  expect(fetch).toHaveBeenCalledTimes(1); expect(read.result.settings).toEqual(first.result.settings)
  const repeated = await organizationConversation(h.connection, reopened.host, send, () => {}, new AbortController().signal)
  expect(repeated.result).toEqual(read.result); expect(fetch).toHaveBeenCalledTimes(1)
  await reopened.service.verifyBindings()
  await reopened.close(); expect(reopened.bus.listenerCount('message')).toBe(0)
}, 20000)
it('drains a cancelled model request and does not restart it when the same send is retried', async () => {
  const h = await setup(); await h.perform()
  let arrived!: () => void
  const ready = new Promise<void>((resolve) => { arrived = resolve })
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
    arrived()
    return await new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => { reject(new DOMException('Cancelled', 'AbortError')) }, { once: true })
    })
  })
  const send = conversationRequestSchema.parse({ ...h.request, kind: 'send', operationId: randomUUID(), selection,
    route: 'new_goal', text: 'Wait for model' })
  const cancel = new AbortController(), running = h.perform(send, cancel.signal), rejection = expect(running).rejects.toThrow()
  await ready; cancel.abort(); await rejection
  const result = await h.perform(send)
  expect(result.result.state).toBe('stopped'); expect(fetch).toHaveBeenCalledTimes(1)
  await h.local.service.verifyBindings()
}, 20000)
it.each(['suspend', 'identity', 'dispose'] as const)('drains pending authorization on %s and ignores the late reply', async (kind) => {
  const h = await setup(); await h.perform()
  let entered!: () => void, release!: () => void
  const ready = new Promise<void>((resolve) => { entered = resolve })
  const late = new Promise<void>((resolve) => { release = resolve })
  const command = h.connection.planningCommand.bind(h.connection)
  vi.spyOn(h.connection, 'planningCommand').mockImplementation(async (...args) => {
    entered(); await late; return command(...args)
  })
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(reply())
  const send = conversationRequestSchema.parse({ ...h.request, kind: 'send', operationId: randomUUID(), selection,
    route: 'new_goal', text: 'Stop while authorizing' })
  const running = h.perform(send), rejection = expect(running).rejects.toThrow()
  await ready
  if (kind === 'suspend') h.connection.suspend()
  else if (kind === 'identity') await h.connection.perform({ kind: 'login', username: 'owner', password })
  else await h.local.close()
  await rejection; release(); await late
  expect(fetch).not.toHaveBeenCalled()
  if (kind === 'dispose') expect(h.local.bus.listenerCount('message')).toBe(0)
}, 20000)
it('rejects changed control operations and detects accepted input corruption in the JSONL', async () => {
  const h = await setup(); await h.perform()
  await expect(h.perform(conversationRequestSchema.parse({ ...h.request, conversationId: randomUUID() }))).rejects.toThrow()
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(reply())
  await h.perform(conversationRequestSchema.parse({ ...h.request, kind: 'send', operationId: randomUUID(), selection,
    route: 'new_goal', text: 'Durable input evidence' }))
  await h.local.service.verifyBindings()
  const logs = (await readdir(join(h.remote.root, 'conversations'), { recursive: true })).filter(p => p.endsWith('.jsonl'))
  const path = join(h.remote.root, 'conversations', logs[0]!)
  const log = await readFile(path, 'utf8')
  await writeFile(path, log.replace('Durable input evidence', 'Altered input evidence'))
  await expect(h.local.service.verifyBindings()).rejects.toThrow('input-log-mismatch')
}, 20000)
it('refuses revoked project read immediately before final consumption and never sends model HTTP', async () => {
  const h = await setup(); await h.perform()
  let grantVersion = 0
  await h.remote.app.authority.readGrants(h.remote.owner.token, { organizationId: h.request.organizationId,
    projectId: h.request.projectId }, (values) => {
    grantVersion = values.find(v => v.membershipId === h.remote.member.membershipId)?.version ?? 0
  })
  const command = h.connection.planningCommand.bind(h.connection)
  vi.spyOn(h.connection, 'planningCommand').mockImplementation(async (input, generation) => {
    if (input.kind === 'consume-planning-request') await h.remote.app.authority.grant(h.remote.owner.token, { kind: 'set-grant',
      operationId: randomUUID(), organizationId: h.request.organizationId, projectId: h.request.projectId,
      membershipId: h.remote.member.membershipId, expectedVersion: grantVersion, actions: [] })
    return await command(input, generation)
  })
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(reply())
  await expect(h.perform(conversationRequestSchema.parse({ ...h.request, kind: 'send', operationId: randomUUID(), selection,
    route: 'new_goal', text: 'Revoked before HTTP' }))).rejects.toThrow()
  expect(fetch).not.toHaveBeenCalled()
}, 20000)
it('recovers a half-written reservation and detects ownership corruption in its independent JSONL', async () => {
  const h = await setup()
  const domain = h.local.ctx.storageDomain.get('organization_conversation')!
  const unit = Reflect.get(domain, 'unit') as import('@deepseek-ai/dsh-storage').KvUnit
  const original = unit.setGlobal.bind(unit); let writes = 0
  const failing = vi.spyOn(unit, 'setGlobal').mockImplementation(async (...args) => {
    if (++writes === 2) throw new Error('ready write failed')
    return original(...args)
  })
  await expect(h.perform()).rejects.toThrow(); failing.mockRestore()
  const opened = await h.perform(); await h.local.service.verifyBindings()
  const logs = (await readdir(join(h.remote.root, 'conversations'), { recursive: true })).filter(p => p.endsWith('.jsonl'))
  expect(logs).toHaveLength(1)
  const path = join(h.remote.root, 'conversations', logs[0]!)
  const log = await readFile(path, 'utf8'); expect(log).toContain(opened.result.sessionId)
  await writeFile(path, log.replace(h.remote.member.accountId!, randomUUID()))
  await expect(h.local.service.verifyBindings()).rejects.toThrow('binding-log-mismatch')
}, 20000)
it('charges each actual provider retry with a distinct consumed permit', async () => {
  const h = await setup(); await h.perform()
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('temporary outage', { status: 503 }))
    .mockResolvedValue(reply())
  const send = conversationRequestSchema.parse({ ...h.request, kind: 'send', operationId: randomUUID(), selection,
    route: 'new_goal', text: 'Provider retry' })
  const result = await h.perform(send)
  expect(result.result.state).toBe('completed'); expect(fetch).toHaveBeenCalledTimes(2)
  const view = await h.connection.perform({ kind: 'planning-read', request: { organizationId: h.request.organizationId,
    projectId: h.request.projectId, conversationId: h.request.conversationId } })
  expect(view.planning?.grant?.usedRequests).toBe(2)
  await h.local.service.verifyBindings()
}, 20000)

it.each(['shared', 'private', 'conflict', 'lost'] as const)('saves a %s proposal through the model pipeline and keeps one goal on replay', async (status) => {
  const h = await setup()
  if (status === 'private') {
    let version = 0
    await h.remote.app.authority.readGrants(h.remote.owner.token, {
      organizationId: h.request.organizationId, projectId: h.request.projectId },
    (rows) => {
      version = rows.find(r => r.membershipId === h.remote.member.membershipId)!.version
    })
    await h.remote.app.authority.grant(h.remote.owner.token, { kind: 'set-grant', organizationId: h.request.organizationId,
      projectId: h.request.projectId, membershipId: h.remote.member.membershipId, expectedVersion: version, actions: ['read'],
      operationId: randomUUID() })
    await h.connection.perform({ kind: 'reconnect' })
  }
  await h.perform()
  const native = h.connection.planningCommand.bind(h.connection)
  const writes = vi.spyOn(h.connection, 'planningCommand').mockImplementation(async (command, generation) => {
    if (command.kind === 'save-planning-draft' && status === 'conflict') throw new Error('version-conflict')
    const receipt = await native(command, generation)
    if (command.kind === 'save-planning-draft' && status === 'lost') throw new Error('lost-reply')
    return receipt
  })
  const phase = randomUUID(), root = randomUUID(), child = randomUUID()
  const task = (id: string, parentTaskId: string | null) => ({ id, parentTaskId, phaseId: phase, goal: 'Revenue CSV', scope: 'Monthly values',
    acceptance: ['Totals checked'], artifacts: ['report.csv'], required: true, dependsOn: [], suggestedMembershipId: null })
  const definition = { taskId: root, phases: [{ id: phase, title: 'Report' }], tasks: [task(root, null), task(child, root)] }
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(reply('complex'))
    .mockResolvedValueOnce(reply(undefined, '', { name: 'workflow_propose', args: { sharedContext: 'Creator discussion: task goals and constraints', operationId: randomUUID(), expectedRevision: 0, definition } }))
    .mockResolvedValue(reply())
  const send = conversationRequestSchema.parse({ ...h.request, kind: 'send', operationId: randomUUID(), selection,
    route: 'new_goal', text: 'Create a validated monthly revenue CSV' })
  await h.perform(send)
  const result = await h.perform(send)
  expect(result.result.goals).toHaveLength(1)
  expect(result.result.goals[0]?.proposal?.status).toBe(status === 'lost' ? 'shared' : status)
  expect(result.result.goals[0]?.proposal?.definition).toEqual(definition)
  expect(fetch.mock.calls.length).toBeGreaterThanOrEqual(2)
  expect(fetch.mock.calls.length).toBeLessThanOrEqual(3)
  const proposal = result.result.goals[0]!.proposal!
  const shared = await h.remote.call('/workgraph/read', { organizationId: h.request.organizationId, projectId: h.request.projectId,
    planId: proposal.planId }, h.remote.member.token)
  expect(shared.status).toBe(status === 'shared' || status === 'lost' ? 200 : 403)
  expect(writes.mock.calls.filter(([c]) => c.kind === 'save-planning-draft')).toHaveLength(status === 'private' ? 0 : 1)
  if (status === 'private') {
    const suggestion = { ...h.request, kind: 'suggest', goalId: result.result.goals[0]!.id, taskId: root,
      expectedRevision: 0, operationId: randomUUID(), membershipId: randomUUID() }
    await expect(h.perform(conversationRequestSchema.parse(suggestion))).rejects.toThrow()
    const updated = await h.perform(conversationRequestSchema.parse({ ...suggestion,
      operationId: randomUUID(), membershipId: h.remote.member.membershipId }))
    expect(updated.result.goals[0]?.proposal?.status).toBe('private')
    expect(updated.result.goals[0]?.proposal?.definition?.tasks[0]?.suggestedMembershipId).toBe(h.remote.member.membershipId)
    expect(writes.mock.calls.some(([c]) => c.kind === 'save-planning-draft')).toBe(false)
  }
  await h.local.service.verifyBindings()
}, 20000)

it('hides previously authorized task text after task revocation and refuses history replay to the model', async () => {
  const h = await setup(); await h.perform()
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(reply())
  const send = conversationRequestSchema.parse({ ...h.request, kind: 'send', operationId: randomUUID(), selection,
    route: 'new_goal', text: 'Review this authorized task', target: { planId: h.remote.save.planId, taskId: h.remote.grant.taskId } })
  const first = await h.perform(send)
  expect(first.result.entries.length).toBeGreaterThan(0)
  expect((await h.remote.call('/workgraph/grant', { ...h.remote.grant, operationId: randomUUID(),
    expectedVersion: h.remote.receipt.revision, actions: [] })).status).toBe(200)
  await h.connection.perform({ kind: 'reconnect' })
  await expect(h.perform({ ...h.request, kind: 'read',
    operationId: randomUUID() as typeof h.request.operationId })).rejects.toThrow()
  await h.connection.perform({ kind: 'reconnect' })
  const calls = fetch.mock.calls.length
  await expect(h.perform(conversationRequestSchema.parse({ ...send, operationId: randomUUID(), target: undefined,
    route: 'new_goal', text: 'Continue with the prior task context' }))).rejects.toThrow()
  expect(fetch).toHaveBeenCalledTimes(calls)
}, 20000)

it('keeps simple, clarification and query sends on their goals and isolates preferences after account switches', async () => {
  const h = await setup()
  await h.perform()
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(reply('simple')).mockImplementation(async () => reply())
  const send = { ...h.request, kind: 'send', operationId: randomUUID(), route: 'new_goal', selection, text: 'Explain CSV quoting' }
  const simple = await h.perform(conversationRequestSchema.parse(send))
  expect(simple.result.goals[0]).toMatchObject({ classification: 'simple' })
  expect(simple.result.goals[0]?.proposal).toBeUndefined()
  fetch.mockResolvedValueOnce(reply('clarify')).mockResolvedValueOnce(reply(undefined, 'Which columns?'))
  const vague = await h.perform(conversationRequestSchema.parse({ ...send, operationId: randomUUID(), text: 'Prepare a report' }))
  const goalId = vague.result.goals.at(-1)!.id
  expect(vague.result.goals.at(-1)?.classification).toBe('clarify')
  fetch.mockResolvedValueOnce(reply('simple')).mockResolvedValueOnce(reply())
  const clarified = await h.perform(conversationRequestSchema.parse({ ...send, operationId: randomUUID(), route: 'clarification', goalId,
    text: 'Only explain the two column names; no deliverables needed' }))
  expect(clarified.result.goals).toHaveLength(2)
  expect(clarified.result.goals.at(-1)?.id).toBe(goalId)
  const queried = await h.perform(conversationRequestSchema.parse({ ...send, operationId: randomUUID(), route: 'query', goalId, text: 'What is the status?' }))
  expect(queried.result.goals).toEqual(clarified.result.goals)
  const settings = { ...h.request, kind: 'settings', operationId: randomUUID(), expectedRevision: 0, settings: { enabled: false, granularity: 'fine' } }
  await h.perform(conversationRequestSchema.parse(settings))
  await h.connection.perform({ kind: 'login', username: 'owner', password })
  await h.connection.perform({ kind: 'select', organizationId: h.request.organizationId })
  const other = await h.perform()
  expect(other.result.settings).toEqual({ enabled: true, granularity: 'balanced', revision: 0 })
  expect(other.result.entries).toEqual([])
  await h.connection.perform({ kind: 'login', username: 'reader', password })
  await h.connection.perform({ kind: 'select', organizationId: h.request.organizationId })
  const back = await h.perform({ ...h.request, kind: 'read' })
  expect(back.result.settings).toEqual({ enabled: false, granularity: 'fine', revision: 1 })
  expect(back.result.sessionId).toBe(simple.result.sessionId)
  await h.perform(conversationRequestSchema.parse({ ...settings, operationId: randomUUID(), expectedRevision: 1,
    settings: { enabled: true, granularity: 'balanced' } }))
  const resumed = await h.perform(conversationRequestSchema.parse({ ...send, operationId: randomUUID() }))
  expect(resumed.result.goals).toHaveLength(3)
  expect(fetch.mock.lastCall?.[1]?.body).toContain('workflow_assess')
  const authority = await h.connection.perform({ kind: 'planning-read', request: { organizationId: h.request.organizationId,
    projectId: h.request.projectId, conversationId: h.request.conversationId } })
  expect(authority.planning?.plans).toEqual([])
}, 20000)

it('persists independent organization conversations and Bots, logs Bot instructions and keeps account catalogs isolated', async () => {
  const h = await setup()
  const base = { ...h.request, kind: 'catalog' as const }
  const bot = { id: randomUUID(), name: 'Report Bot', instructions: 'BOT_PRIVATE_REPORT_INSTRUCTIONS', selection, version: 0 }
  const saved = conversationRequestSchema.parse({ ...base, kind: 'bot-save', operationId: randomUUID(), expectedVersion: 0, bot })
  const first = await h.perform(saved)
  expect(first.result.catalog?.bots[0]?.version).toBe(1)
  expect((await h.perform(saved)).result.catalog?.bots).toEqual(first.result.catalog?.bots)
  await expect(h.perform(conversationRequestSchema.parse({ ...saved, kind: 'bot-save', bot: { ...bot, name: 'Changed' } })))
    .rejects.toThrow('organization-conversation-unavailable')
  await expect(h.perform(conversationRequestSchema.parse({ ...base, kind: 'open', operationId: saved.operationId })))
    .rejects.toThrow('organization-conversation-unavailable')
  const a = conversationRequestSchema.parse({ ...base, kind: 'open', conversationId: randomUUID(), operationId: randomUUID(), botId: bot.id })
  const b = conversationRequestSchema.parse({ ...base, kind: 'open', conversationId: randomUUID(), operationId: randomUUID() })
  const opened = await h.perform(a), other = await h.perform(b)
  expect(opened.result.sessionId).not.toBe(other.result.sessionId)
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(reply())
  const sent = await h.perform(conversationRequestSchema.parse({ ...a, kind: 'send', operationId: randomUUID(),
    selection, text: 'Report revenue for this month', route: 'new_goal' }))
  expect(fetch.mock.calls[0]?.[1]?.body).toContain(bot.instructions)
  expect(sent.result.catalog?.conversations.find(c => c.conversationId === a.conversationId)?.title).toBe('Report revenue for this month')
  await h.local.close()
  const reopened = await boot(h.remote.root); cleanup.push(reopened.close)
  const catalog = await organizationConversation(h.connection, reopened.host, base, () => {}, new AbortController().signal)
  expect(catalog.result.catalog?.bots).toEqual(first.result.catalog?.bots)
  expect(catalog.result.catalog?.conversations.some(c => c.conversationId === b.conversationId)).toBe(true)
  await h.connection.perform({ kind: 'login', username: 'owner', password })
  await h.connection.perform({ kind: 'select', organizationId: h.request.organizationId })
  const account = await organizationConversation(h.connection, reopened.host, base, () => {}, new AbortController().signal)
  expect(account.result.catalog?.bots).toEqual([])
  expect(account.result.catalog?.conversations.some(c => c.conversationId === a.conversationId)).toBe(false)
  expect(fetch).toHaveBeenCalledTimes(1)
}, 20000)

it('persists rename and Bot association, and keeps a deleted conversation absent after restart', async () => {
  const h = await setup(), opened = await h.perform(), botId = randomUUID()
  const request = (fields: object) => conversationRequestSchema.parse({ ...h.request, operationId: randomUUID(), ...fields })
  await h.perform(request({ kind: 'bot-save', expectedVersion: 0, bot: { id: botId, name: 'Reports', instructions: 'Summarize reports', selection, version: 0 } }))
  await h.perform(request({ kind: 'rename', title: 'Quarterly report' }))
  await h.perform(request({ kind: 'affiliation', nextBotId: botId }))
  await expect(h.perform(request({ kind: 'affiliation', nextBotId: randomUUID() }))).rejects.toThrow()
  const catalog = (await h.perform(request({ kind: 'catalog' }))).result.catalog
  expect(catalog?.conversations.find(row => row.conversationId === h.request.conversationId)).toMatchObject({ title: 'Quarterly report', botId })
  await h.local.close()
  const reopened = await boot(h.remote.root); cleanup.push(reopened.close)
  const perform = (input: ReturnType<typeof request>) =>
    organizationConversation(h.connection, reopened.host, input, () => {}, new AbortController().signal)
  expect((await perform(request({ kind: 'read' }))).result.sessionId).toBe(opened.result.sessionId)
  const deleted = request({ kind: 'delete' })
  await perform(deleted); await perform(deleted)
  await expect(perform(request({ kind: 'open' }))).rejects.toThrow()
  const other = request({ kind: 'catalog', conversationId: randomUUID() })
  expect((await perform(other)).result.catalog?.conversations.some(row => row.conversationId === h.request.conversationId)).toBe(false)
  await reopened.service.verifyBindings()
}, 20000)

it('persists authorized task selection without starting a model or an execution', async () => {
  const h = await setup(); await h.perform()
  const fetch = vi.spyOn(globalThis, 'fetch')
  const target = { planId: h.remote.query.planId, taskId: h.remote.grant.taskId }
  const selected = conversationRequestSchema.parse({ ...h.request, operationId: randomUUID(), kind: 'select-task', target })
  const result = await h.perform(selected); await h.perform(selected)
  expect(result.result.execution?.target).toEqual(target)
  expect(result.result.goals.at(-1)?.id).toBe(target.taskId)
  expect(result.result.history.filter(event => event.type === 'organization/task-selection')).toHaveLength(1)
  expect(fetch).not.toHaveBeenCalled()
  fetch.mockResolvedValue(reply())
  const continued = await h.perform(conversationRequestSchema.parse({ ...h.request, kind: 'send', operationId: randomUUID(),
    selection, route: 'query', goalId: target.taskId, target, text: 'Explain the selected node' }))
  expect(continued.result.goals).toHaveLength(1)
  expect(continued.result.goals[0]?.id).toBe(target.taskId)
  expect(fetch.mock.calls[0]?.[1]?.body).toContain('Visible task')
  expect(fetch.mock.calls[0]?.[1]?.body).not.toMatch(/HIDDEN_ROOT|HIDDEN_TASK/)
  await expect(h.perform(conversationRequestSchema.parse({ ...selected, operationId: randomUUID(),
    target: { ...target, taskId: h.remote.save.definition.tasks[2]!.id } }))).rejects.toThrow()
  await h.local.close()
  const reopened = await boot(h.remote.root); cleanup.push(reopened.close)
  const read = await organizationConversation(h.connection, reopened.host, { ...h.request, kind: 'read' }, () => {}, new AbortController().signal)
  expect(read.result.execution).toEqual(result.result.execution)
  await reopened.service.verifyBindings()
}, 20000)

it('recovers a committed model selection when the control receipt write fails', async () => {
  const h = await setup(); await h.perform()
  const domain = h.local.ctx.storageDomain.get('organization_conversation')!
  const unit = Reflect.get(domain, 'unit') as import('@deepseek-ai/dsh-storage').KvUnit
  const original = unit.setGlobal.bind(unit)
  const failed = vi.spyOn(unit, 'setGlobal').mockRejectedValueOnce(new Error('receipt-write-failed'))
  const request = conversationRequestSchema.parse({ ...h.request, operationId: randomUUID(), kind: 'select-model', selection })
  await expect(h.perform(request)).rejects.toThrow()
  failed.mockImplementation(original)
  const result = await h.perform(request)
  expect(result.result.selection).toEqual(selection)
  expect(result.result.history.filter(event => event.type === 'model/selection')).toHaveLength(1)
  await expect(h.perform(conversationRequestSchema.parse({ ...request, selection: { ...selection, model: 'different' } }))).rejects.toThrow()
  await h.local.service.verifyBindings()
}, 20000)

it('deletes a running conversation after draining its model and removes retained private inputs', async () => {
  const h = await setup(); await h.perform()
  let arrived!: () => void
  const ready = new Promise<void>((resolve) => { arrived = resolve })
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
    arrived()
    return await new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => { reject(new DOMException('Cancelled', 'AbortError')) }, { once: true })
    })
  })
  const send = conversationRequestSchema.parse({ ...h.request, kind: 'send', operationId: randomUUID(), selection,
    route: 'new_goal', text: 'Private input must be removed' })
  const running = h.perform(send), rejection = expect(running).rejects.toThrow()
  await ready
  const result = await h.perform(conversationRequestSchema.parse({ ...h.request, kind: 'delete', operationId: randomUUID() }))
  await rejection
  expect(result.result.history).toEqual([])
  expect(conversationStateSchema.parse(h.local.ctx.storageDomain.get('organization_conversation')!.global.get()).intents).toEqual([])
  await expect(h.perform(conversationRequestSchema.parse({ ...h.request, operationId: randomUUID() }))).rejects.toThrow()
  await h.local.service.verifyBindings()
}, 20000)
