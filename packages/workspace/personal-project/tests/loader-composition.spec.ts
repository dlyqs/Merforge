import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime, { createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import { createScope, scopeTarget } from '@deepseek-ai/dsh-scope'
import SessionStore, { Session, SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import PersonalProjectRegistry from '../src/index.ts'
import * as Runtime from '../src/runtime.ts'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

let context: Context | undefined
let directory: string | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (directory !== undefined) await rm(directory, { recursive: true, force: true })
  directory = undefined
})

describe('personal Project product composition', () => {
  it('loads storage and runtime rows and applies current Bot text and tool denial', async () => {
    directory = await mkdtemp(join(tmpdir(), 'dsh-personal-loader-'))
    const configPath = join(directory, 'cordis.yml')
    await writeFile(configPath, [
      "- name: '@deepseek-ai/dsh-personal-project'",
      "- name: '@deepseek-ai/dsh-personal-project/runtime'",
      '',
    ].join('\n'))
    const ctx = new Context()
    context = ctx
    ctx.baseUrl = pathToFileURL(directory).href + '/'
    await ctx.plugin(Storage)
    ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
    const domains = new DomainFacility(ctx, { backend: 'memory', routes: {} })
    ctx.storage.mount('domain', domains)
    ctx.provide('storageDomain', domains)
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    ctx.provide('workspaceRegistry', { get: () => undefined } as never)
    ctx.provide('sessionQuery', { listSessions: async () => [] } as never)
    ctx.provide('agents', { get: () => undefined } as never)
    await ctx.plugin(Loader)
    ctx.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['@deepseek-ai/dsh-personal-project', PersonalProjectRegistry],
      ['@deepseek-ai/dsh-personal-project/runtime', Runtime],
    ])
    ctx.loader.internal = {
      version: 'v2',
      async import(specifier: string) { return modules.get(specifier) },
    } as never
    await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
    await ctx.loader.await()
    expect([...ctx.loader.entries()].filter(entry => entry.fiber === undefined && !entry.disabled)).toEqual([])

    const project = await ctx.personalProjects.createProject({ name: 'Alpha', description: 'Ship the app' })
    const bot = await ctx.personalProjects.createBot({
      name: 'Reviewer', identity: 'Review the requested code', allowedTools: ['read'],
    })
    const session = ctx.sessions.create(SessionId('composed'))
    ctx.personalProjects.move(session, { projectId: project.id, botId: bot.id }, 'create')
    const agent = { id: session.id, session } as Agent
    const scope = createScope(ctx, agent)
    Object.assign(agent, { ctx: scope.ctx })
    await ctx.serial(scopeTarget(agent, agent), 'agent/created', { agent, source: 'startup' })
    const prompt = renderPrompt(await ctx.systemPrompt.assemble({ scope: agent }))
    expect(prompt).toContain('Ship the app')
    expect(prompt).toContain('Review the requested code')
    await ctx.personalProjects.updateBot(bot.id, { identity: 'Review the tests' })
    const editedPrompt = renderPrompt(await ctx.systemPrompt.assemble({ scope: agent }))
    expect(editedPrompt).toContain('Review the tests')
    expect(prompt).toContain('Review the requested code')
    ctx.tools.register(defineContentToolFixture({ name: 'write', description: '', parameters: {}, async execute() { return [] } }))
    ctx.tools.register(defineContentToolFixture({ name: 'read', description: '', parameters: {}, async execute() { return [] } }))
    scope.ctx.inject(['tools'], (scoped) => {
      scoped.tools.register(defineContentToolFixture({ name: 'local', description: '', parameters: {}, async execute() { return [] } }))
    })
    expect(ctx.tools.schemas(agent).map(tool => tool.name)).toEqual(['read'])
    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('denied'), name: 'write', arguments: {}, agent,
    })
    expect(result.isError).toBe(true)
    expect(result.content).toEqual([{ type: 'text', text: 'Error: Bot "Reviewer" does not allow tool "write"' }])
    await ctx.personalProjects.updateBot(bot.id, { allowedTools: ['read', 'write'] })
    expect(ctx.tools.schemas(agent).map(tool => tool.name)).toEqual(['write', 'read'])
    ctx.personalProjects.move(session, { projectId: project.id })
    const permitted = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('permitted'), name: 'write', arguments: {}, agent,
    })
    expect(permitted.isError).toBe(false)
    ctx.personalProjects.move(session, { botId: bot.id })
    ctx.personalProjects.move(session, { projectId: project.id, botId: bot.id })
    const movedPrompt = renderPrompt(await ctx.systemPrompt.assemble({ scope: agent }))
    expect(movedPrompt).toContain('Project Alpha; Bot none → Project none; Bot Reviewer')
    expect(movedPrompt).toContain('Project none; Bot Reviewer → Project Alpha; Bot Reviewer')
    await scope.dispose()
  })

  it('logs each live request with the current personal context and preserves older requests', async () => {
    const ctx = new Context()
    context = ctx
    await ctx.plugin(Storage)
    ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
    const domains = new DomainFacility(ctx, { backend: 'memory', routes: {} })
    ctx.storage.mount('domain', domains)
    ctx.provide('storageDomain', domains)
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(AgentLoop, { agents: [] })
    ctx.provide('workspaceRegistry', { get: () => undefined } as never)
    ctx.provide('sessionQuery', { listSessions: async () => [] } as never)
    await ctx.plugin(PersonalProjectRegistry)
    await ctx.plugin(Runtime)
    const adapter = new MockAdapter([textResponse('first'), textResponse('second')])
    ctx.llm.registerAdapter(['mock'], adapter)
    const project = await ctx.personalProjects.createProject({ name: 'Alpha', description: 'Build Alpha' })
    const bot = await ctx.personalProjects.createBot({ name: 'Reviewer', identity: 'Review Alpha' })
    const agent = await ctx.agentLoop.create(SessionId('personal-requests'), { provider: 'mock', model: 'model' })
    ctx.personalProjects.move(agent.session, { projectId: project.id, botId: bot.id }, 'create')
    ctx.on('llm/stream', (request, next) => {
      const replay = Session.create(agent.id, agent.session.snapshotEvents())
      expect(request.messages).toEqual(replay.deriveMessages())
      return next()
    })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'first task' }], source: { kind: 'user' } }))
    await agent.whenIdle()
    const first = adapter.requests[0]
    expect(first).toBeDefined()
    expect(JSON.stringify(first?.messages)).toContain('Review Alpha')
    const firstSystem = agent.session.snapshotEvents().filter(event => event.type === 'system/message').at(-1)
    expect(JSON.stringify(firstSystem)).toContain('Build Alpha')

    await ctx.personalProjects.updateBot(bot.id, { identity: 'Review Beta' })
    ctx.personalProjects.move(agent.session, { botId: bot.id })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'second task' }], source: { kind: 'user' } }))
    await agent.whenIdle()
    const second = adapter.requests[1]
    expect(second).toBeDefined()
    expect(JSON.stringify(second?.messages)).toContain('Review Beta')
    const systems = agent.session.snapshotEvents().filter(event => event.type === 'system/message')
    expect(JSON.stringify(systems.at(-1))).toContain('Project Alpha; Bot Reviewer → Project none; Bot Reviewer')
    expect(JSON.stringify(firstSystem)).toContain('Review Alpha')
    expect(JSON.stringify(first?.messages)).not.toContain('Review Beta')
  })
})
