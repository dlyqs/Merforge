/** Loader-owned ordinary Agent execution with native account authority; no UI is launched. */
import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import Agents from '@deepseek-ai/dsh-agent'
import Tools, { defineTool } from '@deepseek-ai/dsh-tools'
import Skills from '@deepseek-ai/dsh-skill'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Llm, { createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import DefaultModel from '@deepseek-ai/dsh-agent-default-model'
import Commands from '@deepseek-ai/dsh-commands'
import { SessionId } from '@deepseek-ai/dsh-session'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionRequestId } from '@deepseek-ai/dsh-api-session-controller/types'
import * as Method from '@deepseek-ai/dsh-skill-dev-workflow'
import Conversation, { conversationAuthoritySchema, conversationRequestSchema } from '../src/index.ts'
import { planningPlanViewSchema } from '@deepseek-ai/dsh-organization/planning'
import { conversationNativeMessageSchema } from '../src/protocol.ts'
import { installOrganizationConversationControl } from '../../../../apps/desktop-host/src/organization-conversation.ts'
import type { ConversationResult, ConversationBridge, ConversationRequest, ConversationAuthority } from '../src/protocol.ts'
import { config } from './harness.ts'
import { createWorkflowHarness } from '../../personal-workflow/tests/harness.ts'
import { createSessionTestController } from '../../../api/session-controller/tests/test-remote.ts'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import * as Codex from '../../../core/agent-codex/src/index.ts'
import Subprocess from '@deepseek-ai/dsh-subprocess-local'
import { fixture as nativeFixture } from '../../../core/agent-codex/tests/harness.ts'
import { OrganizationConnection } from '@deepseek-ai/dsh-organization-connection'
import { workgraphHarness, password } from '../../../api/organization-api/tests/workgraph-harness.ts'
import { organizationConversation } from '../../../../apps/desktop/src/organization-conversation.ts'
import { conversationAuthorizationError } from '../src/protocol.ts'

async function setup(script: ConstructorParameters<typeof MockAdapter>[0], saved?: { root: string; request: ConversationRequest; authority: ConversationAuthority }, peer?: Awaited<ReturnType<typeof nativeFixture>>['peer'], projectless = false,
  native?: { connection: OrganizationConnection; request: ConversationRequest }) {
  const root = saved?.root ?? await mkdtemp(join(tmpdir(), 'organization-common-session-'))
  const model = new MockAdapter(script)
  const extras = [
    ...(peer ? [['native', { inject: ['agents', 'tools', 'sessions', 'sessionProjections', 'skills'], async apply(ctx: Context) {
      await ctx.plugin(Subprocess)
      vi.spyOn(ctx.get('subprocess')!, 'spawn').mockImplementation(peer.spawn)
      await ctx.plugin(Codex, Codex.Config({}))
    } }] as const] : []),
    ['agents', Agents], ['tools', Tools], ['systemPrompt', SystemPrompt], ['skills', Skills], ['llm', Llm],
    ['method', Method], ['commands', Commands],
    ['model', { inject: ['llm'], apply(ctx: Context) { ctx.effect(() => ctx.llm.registerAdapter(['ordinary'], model)) } }],
    ['loop', { inject: ['agents', 'tools', 'systemPrompt', 'llm', 'sessionProjections'], async apply(ctx: Context) { await ctx.plugin(AgentLoop, { agents: [] }) } }],
    ['default', { async apply(ctx: Context) { await ctx.plugin(DefaultModel, { provider: 'ordinary', model: 'vision' }) } }],
    ['controller', { inject: ['agents', 'llm', 'sessions', 'sessionProjections', 'sessionQuery', 'personalWorkflow', 'workspaceRegistry', 'agentDefaultModel'], apply(ctx: Context) {
      createSessionTestController(ctx, { cwd: root, defaultModelSelection: () => ({ provider: 'ordinary', model: 'vision' }) })
    } }],
    ['conversation', { inject: ['sessionController', 'personalWorkflow'], async apply(ctx: Context) {
      await ctx.plugin(Conversation, { ...config(root), defaultSettings: { enabled: true, granularity: 'balanced' } })
    } }],
  ] as const
  const { ctx } = await createWorkflowHarness(root, extras)
  if (peer) expect(ctx.get('codexSetup')).toBeDefined()
  expect(ctx.get('organizationConversation')).toBeDefined()
  const errors: unknown[] = []
  ctx.on('agent/error', ({ error }) => { errors.push(error) })
  const request = native?.request ?? saved?.request ?? conversationRequestSchema.parse({ kind: 'attach', organizationId: randomUUID(), ...(projectless ? {} : { projectId: randomUUID() }),
    conversationId: randomUUID(), operationId: randomUUID() })
  const authority = saved?.authority ?? conversationAuthoritySchema.parse({ serverId: randomUUID(), accountId: randomUUID(), generation: 1,
    view: { ...(projectless ? {} : { project: { id: request.projectId, organizationId: request.organizationId, name: 'Team project', version: 1 } }),
      grant: null, eligible: false, canWrite: true, plans: [], serverTime: 0,
      policy: { models: [{ model: 'legacy', endpoint: 'https://example.test/v1' }], ttlMs: 1000, permitTtlMs: 1000,
        maxRequests: 10, maxInputBytes: 100000, maxOutputBytes: 100000, maxTotalBytes: 1000000, maxDurationMs: 10000 } } })
  let readable = true, plan: ConversationAuthority['plan'], nativeBridge: ConversationBridge | undefined
  const bridge: ConversationBridge = async (command) => {
    if (nativeBridge) return nativeBridge(command)
    if (!readable) throw new Error('revoked')
    return command?.kind === 'read-planning-plan' && plan ? { ...authority, plan } : authority
  }
  const lifetimes: Promise<void>[] = [], bus = new EventEmitter(), nonce = randomUUID()
  const pending = new Map<string, {
    ready: PromiseWithResolvers<ConversationResult>
    closed: PromiseWithResolvers<undefined>
    onClosed?: (() => void) | undefined
  }>()
  installOrganizationConversationControl(ctx, { on: (event, listener) => bus.on(event, listener),
    off: (event, listener) => bus.off(event, listener), send: (input) => {
      const message = conversationNativeMessageSchema.parse(input), query = pending.get(message.requestId)
      if (!query || message.nonce !== nonce) return
      if (message.type === 'organization-conversation-result') {
        if (message.result) query.ready.resolve(message.result)
        else query.ready.reject(new Error(message.error))
      } else if (message.type === 'organization-conversation-closed') {
        pending.delete(message.requestId); query.onClosed?.(); query.closed.resolve(undefined)
      } else {
        void bridge(message.command).then(authority => bus.emit('message', { type: 'organization-conversation-authorized',
          requestId: message.requestId, nonce, authorizationId: message.authorizationId, authority }), (error: unknown) => bus.emit('message', {
          type: 'organization-conversation-authorized', requestId: message.requestId, nonce, authorizationId: message.authorizationId,
          error: conversationAuthorizationError(error) }))
      }
    } })
  const attach = async () => {
    const lifetime = new AbortController(), ready = Promise.withResolvers<ConversationResult>()
    const closed = Promise.withResolvers<undefined>()
    const requestId = randomUUID(), selected = { ...request, operationId: brandString<ConversationRequest['operationId']>(randomUUID()) }
    pending.set(requestId, { ready, closed })
    const stop = () => { bus.emit('message', { type: 'organization-conversation-cancel', requestId, nonce }) }
    lifetime.signal.addEventListener('abort', stop, { once: true })
    const done = closed.promise.finally(() => { lifetime.signal.removeEventListener('abort', stop) })
    lifetimes.push(done)
    const dispatch = () => { bus.emit('message', { type: 'organization-conversation-operation', requestId, nonce, timeoutMs: 5000, request: selected }) }
    let report: ConversationResult
    if (native) report = (await organizationConversation(native.connection, {
      organizationConversation: async (_request, authorize, _timeoutMs, nativeSignal, onClosed) => {
        nativeBridge = authorize
        pending.get(requestId)!.onClosed = onClosed
        nativeSignal.addEventListener('abort', stop, { once: true })
        void done.then(() => { nativeSignal.removeEventListener('abort', stop) })
        dispatch()
        return ready.promise
      },
    }, selected, () => {}, lifetime.signal)).result
    else { dispatch(); report = await ready.promise }
    return { report, lifetime, done }
  }
  const signal = new AbortController().signal
  const send = (id: SessionId, text: string) => ctx.sessionController.prompt({ sessionId: id,
    requestId: brandString<SessionRequestId>(randomUUID()), mode: 'queue', content: [{ type: 'text', text }] }, signal)
  return { ctx, root, model, errors, request, authority, bridge, attach, send, signal, setPlan: (next: NonNullable<ConversationAuthority['plan']>) => { plan = next }, revoke: () => { readable = false },
    close: async () => { await ctx.fiber.dispose(); await Promise.all(lifetimes); await rm(root, { recursive: true, force: true }) } }
}

it('streams, queues, runs ordinary tools and slash commands, and resumes the same account Session', async () => {
  const h = await setup(['hang', toolCallResponse('tool', 'local_action', {}), textResponse('ordinary result')])
  try {
    const first = await h.attach(), id = first.report.sharedSessionId!
    expect(h.model.requests).toHaveLength(0)
    expect(h.ctx.agents.get(id)).toBeDefined()
    expect((await h.ctx.sessionQuery.listSessions()).map(row => row.header.id)).not.toContain(id)
    h.ctx.commands.register({ name: 'echo', description: 'Return local input', handler: ({ rawInput }) => ({ kind: 'success', text: rawInput }) })
    const agent = h.ctx.agents.get(id)!
    await h.ctx.commands.execute(agent, '/echo original input', [], h.signal)
    expect(JSON.stringify(agent.session.snapshotEvents())).toContain('original input')
    const followCancel = new AbortController()
    const frames: unknown[] = []
    const follow = (async () => {
      for await (const frame of h.ctx.sessionController.follow({ address: { kind: 'session', sessionId: id }, assistantStream: true }, followCancel.signal)) frames.push(frame)
    })()
    void follow.catch(() => {})
    await h.send(id, 'Use the ordinary Agent')
    await vi.waitFor(() => { expect(JSON.stringify(frames)).toContain('partial') })
    expect(agent.status).toBe('running')
    expect(agent.options.provider).toBe('ordinary')
    expect(JSON.stringify(h.model.requests[0]?.messages)).toContain('Use the ordinary Agent')
    expect(JSON.stringify(h.model.requests[0]?.messages)).toContain('organization-task-context')
    expect(JSON.stringify(h.model.requests[0]?.messages)).toContain('Use that name as the root task’s goal')
    expect(JSON.stringify(h.model.requests[0]?.messages)).toContain('Normally every node has at most 5 direct children.')
    expect(JSON.stringify(h.model.requests[0]?.tools?.find(tool => tool.name === 'workflow_propose'))).toContain('insert meaningful deliverable or workstream groups')
    expect(JSON.stringify(h.model.requests[0]?.tools?.find(tool => tool.name === 'workflow_assess'))).toContain('classification')
    expect(JSON.stringify(h.model.requests[0]?.tools?.find(tool => tool.name === 'workflow_assess'))).not.toContain('modeRevision')
    const pending = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'pending' }] })
    agent.inbox.append('next-turn', pending)
    await h.ctx.sessionController.updateQueue({ sessionId: id, itemId: pending.id, action: { kind: 'edit', content: [{ type: 'text', text: 'edited' }] } })
    expect(JSON.stringify(agent.inbox.nextTurn)).toContain('edited')
    await h.ctx.sessionController.updateQueue({ sessionId: id, itemId: pending.id, action: { kind: 'remove' } })
    first.lifetime.abort(); await first.done
    followCancel.abort(); await follow.catch(() => {})
    expect(h.ctx.agents.get(id)).toBeUndefined()
    await expect(h.ctx.sessionQuery.readSurface(id)).rejects.toThrow('account-not-active')
    await expect(h.ctx.commands.execute(agent, '/echo denied', [], h.signal)).rejects.toThrow('account-not-active')
    const second = await h.attach()
    expect(second.report.sharedSessionId).toBe(id)
    await h.ctx.organizationConversation.perform(conversationRequestSchema.parse({ ...h.request, kind: 'detach',
      attachmentId: first.report.attachmentId, operationId: randomUUID() }), h.bridge, h.signal)
    expect(h.ctx.agents.get(id)).toBeDefined()
    const execute = vi.fn(() => 'local result')
    h.ctx.tools.register(defineTool({ name: 'local_action', description: 'Ordinary local action', parameters: {},
      output: { schema: { type: 'string' }, render: (_args, text) => [{ type: 'text', text }] }, execute }))
    await h.send(id, 'Perform the local action')
    await h.ctx.agents.get(id)!.whenIdle()
    expect(execute).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(h.ctx.agents.get(id)!.session.snapshotEvents())).toContain('ordinary result')
    await expect(h.ctx.organizationConversation.perform(conversationRequestSchema.parse({ ...h.request, kind: 'send',
      route: 'new_goal', selection: { model: 'legacy', endpoint: 'https://example.test/v1' }, text: 'Old path', operationId: randomUUID() }), h.bridge, h.signal)).rejects.toThrow('use-common-session-prompt')
    h.revoke()
    await expect(h.ctx.sessionQuery.readSurface(id)).rejects.toThrow()
    await vi.waitFor(() => { expect(h.ctx.agents.get(id)).toBeUndefined() })
    await second.done
  } finally { await h.close() }
}, 30000)

it('drains project conversations and removes local logs and Bots under membership authorization without deleting other projects or accounts', async () => {
  const h = await setup(['hang'])
  try {
    await h.ctx.organizationConversation.perform(conversationRequestSchema.parse({ ...h.request, kind: 'bot-save',
      operationId: randomUUID(), expectedVersion: 0, bot: { id: randomUUID(), name: 'Private Bot', instructions: 'Local instructions',
        selection: { provider: 'ordinary', model: 'vision' }, version: 0 } }), h.bridge, h.signal)
    const otherRequest = conversationRequestSchema.parse({ ...h.request, projectId: randomUUID(), conversationId: randomUUID(),
      kind: 'open', operationId: randomUUID() })
    const otherAuthority = conversationAuthoritySchema.parse({ ...h.authority, view: { ...h.authority.view,
      project: { ...h.authority.view.project!, id: otherRequest.projectId } } })
    const other = await h.ctx.organizationConversation.perform(otherRequest, async () => otherAuthority, h.signal)
    const otherAccount = conversationAuthoritySchema.parse({ ...h.authority, accountId: randomUUID() })
    const peer = await h.ctx.organizationConversation.perform(conversationRequestSchema.parse({ ...h.request, kind: 'open', operationId: randomUUID() }),
      async () => otherAccount, h.signal)
    const attached = await h.attach(), id = attached.report.sharedSessionId!
    await h.send(id, 'Private project input')
    await expect.poll(() => h.model.requests.length).toBe(1)
    const membership = conversationAuthoritySchema.parse({ ...h.authority, view: { ...h.authority.view, project: undefined,
      grant: null, canWrite: false, eligible: false, plans: [] } })
    const removal = conversationRequestSchema.parse({ ...h.request, kind: 'project-remove', operationId: randomUUID() })
    await h.ctx.organizationConversation.perform(removal, async () => membership, h.signal)
    await attached.done
    expect(h.ctx.agents.get(id)).toBeUndefined()
    expect(await h.ctx.sessionPersistence.stat(id)).toBeUndefined()
    const catalog = await h.ctx.organizationConversation.perform(conversationRequestSchema.parse({ ...h.request, kind: 'catalog', operationId: randomUUID() }),
      h.bridge, h.signal)
    expect(catalog.catalog).toEqual({ bots: [], conversations: [] })
    await expect(h.ctx.organizationConversation.perform(conversationRequestSchema.parse({ ...h.request, kind: 'open', operationId: randomUUID() }),
      h.bridge, h.signal)).rejects.toThrow('deleted')
    const otherRead = await h.ctx.organizationConversation.perform({ ...otherRequest, kind: 'read' }, async () => otherAuthority, h.signal)
    expect(otherRead.sessionId).toBe(other.sessionId)
    const peerRead = await h.ctx.organizationConversation.perform({ ...h.request, kind: 'read' }, async () => otherAccount, h.signal)
    expect(peerRead.sessionId).toBe(peer.sessionId)
    await h.ctx.organizationConversation.perform(removal, async () => membership, h.signal)
    await h.ctx.organizationConversation.verifyBindings()
    expect(h.model.requests).toHaveLength(1)
  } finally { await h.close() }
}, 30000)

it('keeps backend replacements in the organization partition and reopens their native history', async () => {
  const { peer } = await nativeFixture()
  const h = await setup([textResponse('Private API answer')], undefined, peer)
  let reopened: Awaited<ReturnType<typeof setup>> | undefined
  try {
    const attached = await h.attach(), root = attached.report.sharedSessionId!
    await h.send(root, 'Private API input')
    await h.ctx.agents.get(root)!.whenIdle()
    const chosen = await h.ctx.sessionController.selectModel({ sessionId: root, backend: 'codex', provider: 'codex', model: 'native-test' })
    const id = chosen.sessionId!
    expect(h.ctx.agents.get(id)!.session.header.parentSession).toBe(root)
    expect((await h.ctx.sessionQuery.listSessions()).map(row => row.header.id)).not.toContain(id)
    expect(JSON.stringify(await h.ctx.sessionQuery.readSurface(id))).not.toContain('Private API input')
    await h.send(id, 'Continue in native mode')
    await h.ctx.agents.get(id)!.whenIdle()
    expect(h.errors).toEqual([])
    expect(JSON.stringify(peer.calls.filter(call => call.method === 'turn/start'))).toContain('authorized facts')
    expect(JSON.stringify(await h.ctx.sessionQuery.readSurface(id))).toContain('organization-task-context')
    expect(h.model.requests).toHaveLength(1)
    attached.lifetime.abort(); await attached.done
    expect(h.ctx.agents.get(id)).toBeUndefined()
    await h.ctx.fiber.dispose()
    reopened = await setup([], { root: h.root, request: h.request, authority: h.authority }, peer)
    const again = await reopened.attach()
    expect(again.report.sharedSessionId).toBe(id)
    expect(reopened.ctx.agents.get(id)!.options.backend?.kind).toBe('codex')
    expect(reopened.model.requests).toHaveLength(0)
    const api = await reopened.ctx.sessionController.selectModel({ sessionId: id, provider: 'ordinary', model: 'vision' })
    expect(reopened.ctx.agents.get(api.sessionId!)!.session.header.parentSession).toBe(id)
    expect((await reopened.ctx.sessionQuery.listSessions()).map(row => row.header.id)).not.toContain(api.sessionId)
    again.lifetime.abort(); await again.done
    const final = await reopened.attach()
    expect(final.report.sharedSessionId).toBe(api.sessionId)
    final.lifetime.abort(); await final.done
    await reopened.ctx.organizationConversation.perform(conversationRequestSchema.parse({ ...h.request, kind: 'delete', operationId: randomUUID() }), h.bridge, h.signal)
    expect(await reopened.ctx.sessionPersistence.stat(root)).toBeUndefined()
    expect(await reopened.ctx.sessionPersistence.stat(id)).toBeUndefined()
    expect(await reopened.ctx.sessionPersistence.stat(api.sessionId!)).toBeUndefined()
  } finally { await reopened?.close(); await h.close() }
}, 30000)

it('uses ordinary Bot defaults without overwriting an explicit conversation model after reopen', async () => {
  const { peer } = await nativeFixture()
  const h = await setup([textResponse('Explicit API model')], undefined, peer)
  try {
    const botId = randomUUID()
    await h.ctx.organizationConversation.perform(conversationRequestSchema.parse({ ...h.request, kind: 'bot-save',
      expectedVersion: 0, operationId: randomUUID(), bot: { id: botId, name: 'Native Bot', instructions: 'BOT_COMMON_INSTRUCTIONS',
        selection: { backend: 'codex', provider: 'codex', model: 'native-test', reasoningEffort: 'high' }, version: 0 } }), h.bridge, h.signal)
    h.request.botId = brandString<NonNullable<ConversationRequest['botId']>>(botId)
    const first = await h.attach(), id = first.report.sharedSessionId!
    expect(h.ctx.agents.get(id)!.options.backend).toMatchObject({ kind: 'codex', model: 'native-test', effort: 'high' })
    await h.send(id, 'Use this Bot')
    await h.ctx.agents.get(id)!.whenIdle()
    expect(JSON.stringify(peer.calls.filter(call => call.method === 'turn/start'))).toContain('BOT_COMMON_INSTRUCTIONS')
    const explicit = await h.ctx.sessionController.selectModel({ sessionId: id, provider: 'ordinary', model: 'chosen-api-model' })
    first.lifetime.abort(); await first.done
    const second = await h.attach()
    expect(second.report.sharedSessionId).toBe(explicit.sessionId)
    await h.send(explicit.sessionId!, 'Keep my explicit model')
    await h.ctx.agents.get(explicit.sessionId!)!.whenIdle()
    expect(h.errors).toEqual([])
    expect(h.model.requests[0]?.model).toBe('chosen-api-model')
    expect(JSON.stringify(h.model.requests[0]?.messages)).toContain('BOT_COMMON_INSTRUCTIONS')
    second.lifetime.abort(); await second.done
  } finally { await h.close() }
}, 30000)


it('keeps persisted account fork ancestry out of personal catalogs across Host restart', async () => {
  const h = await setup([textResponse('Saved account history')])
  let reopened: Awaited<ReturnType<typeof setup>> | undefined
  try {
    const attached = await h.attach(), id = attached.report.sharedSessionId!
    await h.send(id, 'Account work')
    await h.ctx.agents.get(id)!.whenIdle()
    const child = await h.ctx.sessionController.fork({ sessionId: id })
    expect((await h.ctx.sessionQuery.listSessions()).map(row => row.header.id)).not.toContain(child.sessionId)
    attached.lifetime.abort(); await attached.done
    expect(h.ctx.agents.get(child.sessionId)).toBeUndefined()
    await h.ctx.fiber.dispose()
    reopened = await setup([], { root: h.root, request: h.request, authority: h.authority })
    expect((await reopened.ctx.sessionQuery.listSessions()).map(row => row.header.id)).not.toContain(child.sessionId)
    await expect(reopened.ctx.sessionQuery.readSurface(child.sessionId)).rejects.toThrow('account-not-active')
    const again = await reopened.attach()
    expect(again.report.sharedSessionId).toBe(id)
    expect(JSON.stringify(await reopened.ctx.sessionQuery.readSurface(child.sessionId))).toContain('Saved account history')
    again.lifetime.abort(); await again.done
  } finally { await reopened?.close(); await h.close() }
}, 30000)


it('executes the selected organization node with ordinary tools and its logged task facts', async () => {
  const h = await setup([toolCallResponse('action', 'local_action', {}), textResponse('Selected node completed')])
  try {
    const attached = await h.attach(), id = attached.report.sharedSessionId!, taskId = randomUUID(), phaseId = randomUUID()
    const plan = planningPlanViewSchema.parse({ version: { planId: randomUUID(), organizationId: h.request.organizationId,
      projectId: h.request.projectId, revision: 1, createdBy: randomUUID(), createdAt: 0, definition: { taskId,
        phases: [{ id: phaseId, title: 'Implementation' }], tasks: [{ id: taskId, parentTaskId: null, phaseId,
          goal: 'Write the selected report', scope: 'Only the selected report', acceptance: ['Report contains totals'],
          artifacts: ['Report file'], dependsOn: [], required: true, suggestedMembershipId: null }] } },
    canEdit: true, structuralEdit: true, invalidatesQualifications: true, requiresOriginalApproval: true })
    h.setPlan(plan)
    await h.ctx.personalWorkflow.setTestingPreferences({ forceDecomposition: true, expectedRevision: 0 })
    await h.ctx.organizationConversation.perform(conversationRequestSchema.parse({ ...h.request, kind: 'select-task',
      operationId: randomUUID(), target: { planId: plan.version.planId, taskId } }), h.bridge, h.signal)
    const execute = vi.fn(() => 'Report file')
    h.ctx.tools.register(defineTool({ name: 'local_action', description: 'Write report', parameters: {},
      output: { schema: { type: 'string' }, render: (_args, text) => [{ type: 'text', text }] }, execute }))
    await h.send(id, 'Execute this node')
    await h.ctx.agents.get(id)!.whenIdle()
    expect(h.errors).toEqual([])
    expect(execute).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(h.model.requests[0]?.messages)).toContain('Report contains totals')
    expect(JSON.stringify(h.model.requests[0]?.messages)).toContain('Only the selected report')
    expect(h.ctx.personalWorkflow.list()).toEqual([])
    attached.lifetime.abort(); await attached.done
  } finally { await h.close() }
}, 30000)

it('forces organization goals to decompose with planning disabled and refuses direct work and incomplete proposals', async () => {
  const taskId = randomUUID(), phaseId = randomUUID(), child = () => randomUUID()
  const task = (id: string, parentTaskId: string | null) => ({ id, parentTaskId, phaseId,
    goal: 'Copy the requested files', scope: 'Requested files only', acceptance: ['Files match'], artifacts: ['Copied files'],
    dependsOn: [], required: true, suggestedMembershipId: null })
  const definition = { taskId, phases: [{ id: phaseId, title: 'Copy' }], tasks: [task(taskId, null), task(child(), taskId)] }
  const h = await setup([
    toolCallResponse('direct', 'local_action', {}),
    toolCallResponse('simple', 'workflow_assess', { classification: 'simple', rationale: 'One copy' }),
    toolCallResponse('complex', 'workflow_assess', { classification: 'complex', rationale: 'Decompose the copy' }),
    toolCallResponse('single-child', 'workflow_propose', { operationId: randomUUID(), expectedRevision: 0, definition }),
    toolCallResponse('two-children', 'workflow_propose', { operationId: randomUUID(), expectedRevision: 0,
      definition: { ...definition, tasks: [...definition.tasks, task(child(), taskId)] } }),
    textResponse('Review the proposed plan'),
    toolCallResponse('ordinary', 'local_action', {}), textResponse('Ordinary copy'),
  ])
  try {
    h.authority.view.canWrite = false
    const attached = await h.attach(), id = attached.report.sharedSessionId!
    await h.ctx.organizationConversation.perform(conversationRequestSchema.parse({ ...h.request, kind: 'settings',
      operationId: randomUUID(), expectedRevision: 0, settings: { enabled: false, granularity: 'balanced' } }), h.bridge, h.signal)
    await h.ctx.personalWorkflow.setTestingPreferences({ forceDecomposition: true, expectedRevision: 0 })
    const execute = vi.fn(() => 'Copied files')
    h.ctx.tools.register(defineTool({ name: 'local_action', description: 'Copy files', parameters: {},
      output: { schema: { type: 'string' }, render: (_args, text) => [{ type: 'text', text }] }, execute }))
    await h.send(id, 'Copy these files')
    await h.ctx.agents.get(id)!.whenIdle()
    expect(h.errors).toEqual([])
    expect(execute).not.toHaveBeenCalled()
    expect(JSON.stringify(h.model.requests[0]?.messages)).toContain('Temporary testing override is ON')
    expect(JSON.stringify(h.model.requests[0]?.messages)).toContain('Normally every node has at most 5 direct children.')
    expect(JSON.stringify(h.model.requests[0]?.messages)).toContain('aiming for at most 20 Chinese characters or 8 words')
    const surface = JSON.stringify(await h.ctx.sessionQuery.readSurface(id))
    expect(surface).toContain('testing-requires-decomposition')
    expect(surface).toContain('testing-requires-two-subtasks')
    await using reader = await h.ctx.sessionPersistence.open(id, 'read')
    const input = (await reader.read()).events.find(event => event.type === 'organization/planning-input')
    expect(input?.type === 'organization/planning-input' && input.data.testing).toEqual({ forceDecomposition: true, revision: 1 })
    const proposals = h.ctx.sessionProjections.stateOf(h.ctx.agents.get(id)!.session, 'organizationPlanning')!.proposals
    expect(proposals).toHaveLength(1)
    expect(proposals[0]?.status).toBe('private')
    expect(proposals[0]?.command.definition.tasks.filter(task => task.required && task.parentTaskId !== null)).toHaveLength(2)
    await h.ctx.personalWorkflow.setTestingPreferences({ forceDecomposition: true, expectedRevision: 1 })
    const stale = await h.ctx.tools.execute({ name: 'workflow_propose', arguments: { operationId: randomUUID(), expectedRevision: 0,
      definition: { ...definition, tasks: [...definition.tasks, task(child(), taskId)] } }, agent: h.ctx.agents.get(id)!,
    callId: ToolCallId('stale-testing'), signal: h.signal })
    expect(stale.isError).toBe(true)
    expect(JSON.stringify(stale)).toContain('testing-conflict')
    expect(h.ctx.sessionProjections.stateOf(h.ctx.agents.get(id)!.session, 'organizationPlanning')!.proposals).toHaveLength(1)
    await h.ctx.personalWorkflow.setTestingPreferences({ forceDecomposition: false, expectedRevision: 2 })
    await h.send(id, 'Copy normally')
    await h.ctx.agents.get(id)!.whenIdle()
    expect(execute).toHaveBeenCalledTimes(1)
    attached.lifetime.abort(); await attached.done
  } finally { await h.close() }
}, 30000)

it('persists and reopens projectless account chats in Recent without creating catalog Sessions or exposing planning tools', async () => {
  const h = await setup([textResponse('Ordinary account answer')], undefined, undefined, true)
  let restarted: Awaited<ReturnType<typeof setup>> | undefined
  try {
    const first = await h.attach(), id = first.report.sharedSessionId!
    expect(first.report.owner).not.toHaveProperty('projectId')
    await h.send(id, 'Independent account discussion')
    await vi.waitFor(() => { expect(h.model.requests).toHaveLength(1); expect(h.ctx.agents.get(id)?.status).toBe('idle') })
    expect(h.errors).toEqual([])
    expect(h.model.requests[0]?.tools?.map(tool => tool.name) ?? []).not.toContain('workflow_propose')
    const catalog = { ...h.request, kind: 'catalog' as const, operationId: brandString<ConversationRequest['operationId']>(randomUUID()) }
    const before = await h.ctx.sessionPersistence.list()
    const report = await h.ctx.organizationConversation.perform(catalog, h.bridge, h.signal)
    expect(report.catalog?.conversations).toEqual([expect.objectContaining({ conversationId: h.request.conversationId,
      title: 'Independent account discussion' })])
    expect(await h.ctx.sessionPersistence.list()).toEqual(before)
    first.lifetime.abort(); await first.done
    await h.ctx.organizationConversation.verifyBindings()
    await h.ctx.fiber.dispose()
    restarted = await setup([], { root: h.root, request: h.request, authority: h.authority })
    const reopened = await restarted.attach()
    expect(reopened.report.sharedSessionId).toBe(id)
    expect(JSON.stringify(reopened.report.history)).toContain('Ordinary account answer')
    restarted.revoke()
    const account = restarted
    await vi.waitFor(() => { expect(account.ctx.agents.get(id)).toBeUndefined() })
    reopened.lifetime.abort(); await reopened.done
  } finally { await restarted?.close(); await h.close() }
})

it('asks for an organization project before executing a forced projectless goal', async () => {
  const h = await setup([toolCallResponse('direct', 'local_action', {}), textResponse('Select a project')], undefined, undefined, true)
  try {
    const attached = await h.attach(), id = attached.report.sharedSessionId!
    await h.ctx.personalWorkflow.setTestingPreferences({ forceDecomposition: true, expectedRevision: 0 })
    const execute = vi.fn(() => 'Copied files')
    h.ctx.tools.register(defineTool({ name: 'local_action', description: 'Copy files', parameters: {},
      output: { schema: { type: 'string' }, render: (_args, text) => [{ type: 'text', text }] }, execute }))
    await h.send(id, 'Copy these files')
    await h.ctx.agents.get(id)!.whenIdle()
    expect(h.errors).toEqual([])
    expect(execute).not.toHaveBeenCalled()
    expect(JSON.stringify(h.model.requests[0]?.messages)).toContain('planning requires an explicit project')
    expect(h.model.requests[0]?.tools?.map(tool => tool.name)).not.toContain('workflow_propose')
    attached.lifetime.abort(); await attached.done
  } finally { await h.close() }
})

it('saves a forced common-session plan through native IPC without a legacy grant while its project refreshes', async () => {
  const remote = await workgraphHarness()
  const connection = new OrganizationConnection({ trustPath: join(remote.root, 'native.json'), timeoutMs: 5000 })
  let h: Awaited<ReturnType<typeof setup>> | undefined
  const release = Promise.withResolvers<undefined>(), committed = Promise.withResolvers<undefined>()
  try {
    await connection.perform({ kind: 'probe', origin: remote.trust.origin })
    await connection.perform({ kind: 'trust', fingerprint: remote.trust.fingerprint })
    await connection.perform({ kind: 'login', username: 'reader', password })
    await connection.perform({ kind: 'select', organizationId: remote.owner.organizationId })
    const taskId = randomUUID(), phaseId = randomUUID(), operationId = randomUUID()
    const task = (id: string, parentTaskId: string | null) => ({ id, parentTaskId, phaseId, goal: 'Copy the files',
      scope: 'Requested files', acceptance: ['Files match'], artifacts: ['Copied files'], dependsOn: [],
      required: true, suggestedMembershipId: null })
    const definition = { taskId, phases: [{ id: phaseId, title: 'Copy' }],
      tasks: [task(taskId, null), task(randomUUID(), taskId), task(randomUUID(), taskId)] }
    const request = conversationRequestSchema.parse({ kind: 'attach', organizationId: remote.query.organizationId,
      projectId: remote.query.projectId, conversationId: randomUUID(), operationId: randomUUID() })
    const original = remote.app.authority.planningCommand.bind(remote.app.authority)
    const save = vi.spyOn(remote.app.authority, 'planningCommand').mockImplementation(async (token, input) => {
      const receipt = await original(token, input)
      committed.resolve(undefined)
      await release.promise
      return receipt
    })
    h = await setup([toolCallResponse('assessment', 'workflow_assess', { classification: 'complex', rationale: 'Two required tasks' }),
      toolCallResponse('proposal', 'workflow_propose', { operationId, expectedRevision: 0, definition }), textResponse('Review the saved plan')],
    undefined, undefined, false, { connection, request })
    const attached = await h.attach(), id = attached.report.sharedSessionId!
    await h.ctx.personalWorkflow.setTestingPreferences({ forceDecomposition: true, expectedRevision: 0 })
    const project = (await connection.perform({ kind: 'project-page', offset: 0 })).projects!.items[0]!
    const generation = connection.snapshot().generation, identityGeneration = connection.snapshot().identityGeneration
    await h.send(id, 'Copy these files and split the work')
    await committed.promise
    expect((await remote.call('/projects', { kind: 'rename-project', organizationId: project.organizationId,
      projectId: project.id, expectedVersion: project.version, name: 'Updated during save', operationId: randomUUID() })).status).toBe(200)
    await vi.waitFor(() => { expect(connection.snapshot().generation).toBeGreaterThan(generation)
      expect(connection.snapshot().phase).toBe('ready') })
    expect(connection.snapshot().identityGeneration).toBe(identityGeneration)
    release.resolve(undefined)
    await h.ctx.agents.get(id)!.whenIdle()
    expect(h.errors).toEqual([])
    expect(save).toHaveBeenCalledTimes(1)
    expect(connection.snapshot().pendingOperation).toBeUndefined()
    const proposals = h.ctx.sessionProjections.stateOf(h.ctx.agents.get(id)!.session, 'organizationPlanning')!.proposals
    expect(proposals.map(p => p.status)).toEqual(['unknown', 'shared'])
    expect(proposals[1]?.receipt?.planning.planRevision).toBe(1)
    expect(proposals[1]?.command.definition).toEqual(definition)
    const authority = await h.bridge()
    expect(authority.view).toMatchObject({ canWrite: true, grant: null, eligible: false })
    expect(authority.view.plans).toContainEqual(expect.objectContaining({ planId: proposals[1]!.command.planId }))
    attached.lifetime.abort(); await attached.done
  } finally { release.resolve(undefined); await h?.close(); await connection.close(); await remote.close(); vi.restoreAllMocks() }
}, 30000)

it.each(['forbidden', 'operation-pending', 'superseded', 'unavailable'])('reports %s through private IPC without misclassifying the save', async (code) => {
  const remote = await workgraphHarness()
  const connection = new OrganizationConnection({ timeoutMs: 5000 })
  let h: Awaited<ReturnType<typeof setup>> | undefined
  try {
    await connection.perform({ kind: 'probe', origin: remote.trust.origin })
    await connection.perform({ kind: 'trust', fingerprint: remote.trust.fingerprint })
    await connection.perform({ kind: 'login', username: 'reader', password })
    await connection.perform({ kind: 'select', organizationId: remote.owner.organizationId })
    const capture = connection.conversationChannel.bind(connection)
    vi.spyOn(connection, 'conversationChannel').mockImplementation(input => ({ ...capture(input),
      command: async () => { throw new Error(code) } }))
    const taskId = randomUUID(), phaseId = randomUUID()
    const definition = { taskId, phases: [{ id: phaseId, title: 'Draft' }], tasks: [{ id: taskId, parentTaskId: null,
      phaseId, goal: 'Report', scope: 'Report only', acceptance: ['Totals verified'], artifacts: [], dependsOn: [], required: true,
      suggestedMembershipId: null }] }
    const request = conversationRequestSchema.parse({ kind: 'attach', organizationId: remote.query.organizationId,
      projectId: remote.query.projectId, conversationId: randomUUID(), operationId: randomUUID() })
    h = await setup([toolCallResponse('assessment', 'workflow_assess', { classification: 'complex', rationale: 'Prepare a plan' }),
      toolCallResponse('proposal', 'workflow_propose', { operationId: randomUUID(), expectedRevision: 0, definition }), textResponse('Save failed')],
    undefined, undefined, false, { connection, request })
    const attached = await h.attach(), id = attached.report.sharedSessionId!
    await h.send(id, 'Prepare the report plan')
    await h.ctx.agents.get(id)!.whenIdle()
    expect(JSON.stringify(h.ctx.agents.get(id)!.session.snapshotEvents())).toContain(`organization-conversation: ${code}`)
    attached.lifetime.abort(); await attached.done
  } finally { await h?.close(); await connection.close(); await remote.close(); vi.restoreAllMocks() }
}, 30000)
