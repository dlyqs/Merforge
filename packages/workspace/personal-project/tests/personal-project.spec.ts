import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import SessionStore, { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import PersonalProjectRegistry, { PersonalProjectRegistry as Registry, ProjectId } from '../src/index.ts'

async function harness(
  pool = new MemoryMediaPool(), knownWorkspaceId?: ReturnType<typeof WorkspaceId>, legacySessionId?: ReturnType<typeof SessionId>,
  legacyMode: 'live' | 'cold' = 'live', legacyPath = '/project-directory',
) {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(pool))
  const domains = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', domains)
  ctx.provide('storageDomain', domains)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  if (legacySessionId !== undefined && legacyMode === 'live') ctx.sessions.create(legacySessionId)
  let workspaceAvailable = true
  const legacyWorkspace = knownWorkspaceId === undefined ? undefined : {
    id: knownWorkspaceId, path: legacyPath, title: 'Linked',
    sessionIds: legacySessionId === undefined ? [] : [legacySessionId],
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  }
  ctx.provide('workspaceRegistry', {
    get: (id: ReturnType<typeof WorkspaceId>) => workspaceAvailable && id === knownWorkspaceId
      ? legacyWorkspace
      : undefined,
    list: () => workspaceAvailable && legacyWorkspace !== undefined ? [legacyWorkspace] : [],
    delete: async () => { workspaceAvailable = false; return true },
  } as never)
  const migratedEvents: SessionEvent[] = []
  ctx.provide('sessionPersistence', {
    open: async () => ({
      read: async () => ({ events: migratedEvents }),
      append: async (events: readonly SessionEvent[]) => { migratedEvents.push(...events) },
      flush: async () => {},
      [Symbol.asyncDispose]: async () => {},
    }),
  } as never)
  ctx.provide('sessionQuery', {
    listSessions: async () => ctx.sessions.list().map(session => ({ header: session.header })),
    observeSession: async (id: ReturnType<typeof SessionId>) => {
      const session = ctx.sessions.get(id)
      if (session === undefined) throw new Error(`missing Session ${id}`)
      return { header: session.header, events: session.snapshotEvents(), [Symbol.dispose]: () => {} }
    },
  } as never)
  await ctx.plugin(PersonalProjectRegistry)
  return { ctx, pool, registry: ctx.personalProjects, migratedEvents, forgetWorkspace: () => { workspaceAvailable = false } }
}

describe('personal Project and Bot storage', () => {
  it('keeps independent Project/Bot records after storage reopen', async () => {
    const first = await harness()
    const project = await first.registry.createProject({ name: 'Alpha' })
    const bot = await first.registry.createBot({
      name: 'Builder', identity: 'Review changes', direction: 'Code quality',
      allowedTools: ['read'], allowedSkills: ['review'],
    })
    expect(project.path).toBeUndefined()
    expect(project.id).not.toBe(bot.id)
    await expect(first.registry.createBot({ name: 'Invalid', apiKey: 'secret' } as never)).rejects.toThrow()
    await first.ctx.fiber.dispose()

    const reopened = await harness(first.pool)
    expect(reopened.registry.listProjects()).toEqual([project])
    expect(reopened.registry.listBots()).toEqual([bot])
    await reopened.ctx.fiber.dispose()
  })

  it('converts an existing Workspace into a Project with the same identity and directory', async () => {
    const workspaceId = WorkspaceId('b983b726-056b-4209-83a4-48213b4ee20a')
    const first = await harness(new MemoryMediaPool(), workspaceId)
    const project = first.registry.getProject(ProjectId(workspaceId))
    expect(project?.path).toBe('/project-directory')
    expect(project?.name).toBe('Linked')
    first.forgetWorkspace()
    expect(first.registry.getProject(ProjectId(workspaceId))?.path).toBe('/project-directory')
    await first.ctx.fiber.dispose()
    const reopened = await harness(first.pool)
    expect(reopened.registry.getProject(ProjectId(workspaceId))?.path).toBe('/project-directory')
    await reopened.ctx.fiber.dispose()
  })

  it('keeps the migrated Workspace identity when an independent Project uses the same directory', async () => {
    const pool = new MemoryMediaPool()
    const first = await harness(pool)
    const existing = await first.registry.createProject({ name: 'Existing', path: process.cwd() })
    await first.ctx.fiber.dispose()

    const workspaceId = WorkspaceId('b983b726-056b-4209-83a4-48213b4ee20a')
    const migrated = await harness(pool, workspaceId, undefined, 'live', process.cwd())
    expect(migrated.registry.getProject(existing.id)?.name).toBe('Existing')
    expect(migrated.registry.getProject(ProjectId(workspaceId))?.name).toBe('Linked')
    expect(migrated.registry.listProjects()).toHaveLength(2)
    await migrated.ctx.fiber.dispose()
  })

  it('moves a live legacy Workspace conversation into its converted Project', async () => {
    const workspaceId = WorkspaceId('b983b726-056b-4209-83a4-48213b4ee20a')
    const sessionId = SessionId('legacy-conversation')
    const { ctx, registry } = await harness(new MemoryMediaPool(), workspaceId, sessionId)
    const session = ctx.sessions.get(sessionId)
    expect(session).toBeDefined()
    expect(registry.affiliation(session!).current).toEqual({ projectId: ProjectId(workspaceId) })
    await ctx.fiber.dispose()
  })

  it('appends a durable affiliation for a cold legacy conversation', async () => {
    const workspaceId = WorkspaceId('b983b726-056b-4209-83a4-48213b4ee20a')
    const { ctx, migratedEvents } = await harness(
      new MemoryMediaPool(), workspaceId, SessionId('cold-legacy'), 'cold',
    )
    expect(migratedEvents).toMatchObject([{
      type: 'personal/affiliation', seq: 0,
      data: { from: {}, to: { project: { id: ProjectId(workspaceId), name: 'Linked' } }, source: 'move' },
    }])
    await ctx.fiber.dispose()
  })

  it('moves one Session in its own event log and preserves the snapshots after deletion', async () => {
    const { ctx, registry } = await harness()
    const project = await registry.createProject({ name: 'Alpha' })
    const bot = await registry.createBot({ name: 'Builder', identity: 'Inspect code' })
    const session = ctx.sessions.create(SessionId('single-session'))
    registry.move(session, { projectId: project.id }, 'create')
    registry.move(session, { projectId: project.id, botId: bot.id })
    await registry.updateBot(bot.id, { identity: 'Inspect tests' })
    expect(registry.affiliation(session).history).toHaveLength(2)
    expect(registry.allowsSkill(session, 'review')).toBe(true)

    await registry.deleteBot(bot.id, async () => session)
    const state = registry.affiliation(session)
    expect(state.current).toEqual({ projectId: project.id })
    expect(state.history.at(-1)?.from.bot).toEqual({ id: bot.id, name: bot.name })
    expect(Registry.fold(session.snapshotEvents())).toEqual(state)
    const reopened = Session.create(session.id, session.snapshotEvents(), session.header)
    expect(registry.affiliation(reopened)).toEqual(state)
    expect(ctx.sessions.list()).toHaveLength(1)
    await ctx.fiber.dispose()
  })

  it('keeps ordinary, combined, and independent Bot conversations as single Sessions across moves', async () => {
    const first = await harness()
    const projectA = await first.registry.createProject({ name: 'Alpha' })
    const projectB = await first.registry.createProject({ name: 'Beta' })
    const botA = await first.registry.createBot({ name: 'Reviewer', identity: 'Review' })
    const botB = await first.registry.createBot({ name: 'Builder', identity: 'Build' })
    const ordinary = first.ctx.sessions.create(SessionId('ordinary-project'))
    const combined = first.ctx.sessions.create(SessionId('combined-project-bot'))
    const independent = first.ctx.sessions.create(SessionId('independent-bot'))
    first.registry.move(ordinary, { projectId: projectA.id }, 'create')
    first.registry.move(combined, { projectId: projectA.id, botId: botA.id }, 'create')
    first.registry.move(independent, { botId: botA.id }, 'create')
    first.registry.move(independent, { projectId: projectA.id, botId: botA.id })
    first.registry.move(independent, { projectId: projectB.id, botId: botA.id })
    first.registry.move(independent, { projectId: projectB.id, botId: botB.id })
    expect(first.registry.affiliation(ordinary).current).toEqual({ projectId: projectA.id })
    expect(first.registry.affiliation(combined).current).toEqual({ projectId: projectA.id, botId: botA.id })
    expect(first.registry.affiliation(independent).current).toEqual({ projectId: projectB.id, botId: botB.id })
    expect(first.registry.affiliation(independent).history).toHaveLength(4)
    expect(first.ctx.sessions.list()).toHaveLength(3)
    const events = independent.snapshotEvents()
    await first.ctx.fiber.dispose()

    const reopened = await harness(first.pool)
    const restored = Session.create(independent.id, events, independent.header)
    expect(reopened.registry.affiliation(restored).current).toEqual({ projectId: projectB.id, botId: botB.id })
    expect(reopened.registry.affiliation(restored).history).toHaveLength(4)
    expect(reopened.registry.getProject(projectA.id)?.path).toBeUndefined()
    await reopened.ctx.fiber.dispose()
  })

  it('accepts only resolvable Bot model routes when a profile is saved', async () => {
    const { ctx, registry } = await harness()
    ctx.provide('llm', {
      async resolveCallConfig(route: { provider: string; model: string }) {
        if (route.provider !== 'configured' || route.model !== 'available') throw new Error('route unavailable')
        return route
      },
    } as never)
    await expect(registry.createBot({ name: 'Unavailable', defaultModel: { provider: 'missing', model: 'model' } }))
      .rejects.toThrow('route unavailable')
    const bot = await registry.createBot({ name: 'Available', defaultModel: { provider: 'configured', model: 'available' } })
    await expect(registry.updateBot(bot.id, { defaultModel: { provider: 'missing', model: 'model' } }))
      .rejects.toThrow('route unavailable')
    expect(registry.getBot(bot.id)?.defaultModel).toEqual({ provider: 'configured', model: 'available' })
    await ctx.fiber.dispose()
  })

  it('rejects new references while deleting a Bot with existing Sessions', async () => {
    const { ctx, registry } = await harness()
    const bot = await registry.createBot({ name: 'Retiring' })
    const existing = ctx.sessions.create(SessionId('bot-existing'))
    const newcomer = ctx.sessions.create(SessionId('bot-newcomer'))
    registry.move(existing, { botId: bot.id }, 'create')
    let release!: () => void
    let entered!: () => void
    const hold = new Promise<void>((resolve) => { release = resolve })
    const ready = new Promise<void>((resolve) => { entered = resolve })
    const deletion = registry.deleteBot(bot.id, async () => {
      entered()
      await hold
      return existing
    })
    await ready
    expect(() => registry.move(newcomer, { botId: bot.id })).toThrow('being deleted')
    release()
    await expect(deletion).resolves.toBe(true)
    expect(registry.affiliation(existing).current).toEqual({})
    await ctx.fiber.dispose()
  })
})
