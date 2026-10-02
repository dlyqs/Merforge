/** Personal Project and Bot records with Session-log-owned affiliation. */
import { randomUUID } from 'node:crypto'
import { stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import { z } from 'zod'
import type {} from '@deepseek-ai/dsh-agent'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import { SessionSeq } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { WorkspaceId, realpathNormalize } from '@deepseek-ai/dsh-workspace'
import type { WorkspaceId as WorkspaceIdType } from '@deepseek-ai/dsh-workspace/types'
import type {} from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-session-projection'
import { personalAffiliationProjection } from './projection.ts'
import type {
  Affiliation, AffiliationProjection, AffiliationSnapshot, BotId, BotProfile,
  Project, ProjectId,
} from './types.ts'

export type * from './types.ts'
export { personalAffiliationProjection } from './projection.ts'

/** Brand a generated or validated Project identifier.
 * @param id - UUID text.
 * @returns branded Project ID.
 */
export function ProjectId(id: string): ProjectId { return id as ProjectId }
/** Brand a generated or validated Bot identifier.
 * @param id - UUID text.
 * @returns branded Bot ID.
 */
export function BotId(id: string): BotId { return id as BotId }

const projectSchema = z.object({
  id: z.uuid().transform(ProjectId),
  name: z.string().trim().min(1).max(120),
  description: z.string().max(8_000),
  path: z.string().min(1).refine(isAbsolute, 'Project directory must be absolute').optional(),
  workspaceId: z.string().min(1).transform(WorkspaceId).optional(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
}).strict()
type StoredProject = Project & { readonly workspaceId?: WorkspaceIdType }
const modelSchema = z.object({
  backend: z.enum(['harness-api', 'codex']).optional(),
  provider: z.string().min(1),
  model: z.string().min(1),
  reasoningEffort: z.string().min(1).optional(),
}).strict().refine(model => model.backend !== 'codex' || model.provider === 'codex', 'Codex requires the native provider')
const botSchema = z.object({
  id: z.uuid().transform(BotId),
  name: z.string().trim().min(1).max(120),
  identity: z.string().max(16_000),
  direction: z.string().max(8_000),
  defaultModel: modelSchema.optional(),
  allowedTools: z.array(z.string().min(1)).max(256).optional(),
  allowedSkills: z.array(z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)).max(256).optional(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
}).strict()

/** Create-time fields for a personal project. */
export const projectInput = projectSchema.omit({ id: true, createdAt: true, updatedAt: true, workspaceId: true })
  .extend({ description: z.string().max(8_000).default('') }).strict()
/** Editable fields; null removes the optional directory. */
export const projectPatch = projectInput.partial().extend({
  path: z.string().min(1).nullable().optional(),
}).strict()
/** Create-time fields for a Bot profile. */
export const botInput = botSchema.omit({ id: true, createdAt: true, updatedAt: true })
  .extend({ identity: z.string().max(16_000).default(''), direction: z.string().max(8_000).default('') }).strict()
/** Editable Bot fields; null removes optional defaults and restrictions. */
export const botPatch = botInput.partial().extend({
  defaultModel: modelSchema.nullable().optional(),
  allowedTools: botSchema.shape.allowedTools.unwrap().nullable().optional(),
  allowedSkills: botSchema.shape.allowedSkills.unwrap().nullable().optional(),
}).strict()

/** Durable personal records. Session affiliation stays in the Session log. */
export const personalDomainSpec = defineDomain({
  name: 'personal_project', version: 1,
  tables: {
    projects: domainTable<ProjectId, StoredProject>(projectSchema as z.ZodType<StoredProject>),
    bots: domainTable<BotId, BotProfile>(botSchema as z.ZodType<BotProfile>),
  },
})

declare module '@deepseek-ai/cordis' {
  interface Context {
    personalProjects: PersonalProjectRegistry
  }
}

/** Persistent records and affiliation transitions for ordinary Sessions. */
export class PersonalProjectRegistry extends Service {
  static inject = ['storageDomain', 'workspaceRegistry', 'sessionPersistence', 'sessionProjections', 'sessionQuery', 'sessions']
  private projects?: KvTable<ProjectId, StoredProject>
  private bots?: KvTable<BotId, BotProfile>
  private tail: Promise<void> = Promise.resolve()
  private readonly deletingProjects = new Set<ProjectId>()
  private readonly deletingBots = new Set<BotId>()

  constructor(ctx: Context) { super(ctx, 'personalProjects') }

  protected async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(personalDomainSpec)
    this.ctx.effect(() => () => domain.close(), 'personal-project.domainClose')
    this.projects = domain.table('projects')
    this.bots = domain.table('bots')
    for (const [, project] of this.projectTable().entries()) {
      if (project.workspaceId === undefined) continue
      const { workspaceId, ...current } = project
      const path = this.ctx.workspaceRegistry.get(workspaceId)?.path
      await this.projectTable().put(project.id, path === undefined ? current : { ...current, path })
    }
    this.ctx.sessionProjections.register(personalAffiliationProjection)
    await this.migrateWorkspaces()
    this.ctx.logger.info(`personal-bot restored projects=${this.projectTable().size} bots=${this.botTable().size}`)
  }

  private async migrateWorkspaces(): Promise<void> {
    for (const workspace of this.ctx.workspaceRegistry.list()) {
      let project = this.getProject(ProjectId(workspace.id))
      if (project === undefined) {
        project = {
          id: ProjectId(workspace.id), name: workspace.title, description: '', path: workspace.path,
          createdAt: workspace.createdAt, updatedAt: workspace.updatedAt,
        }
        await this.projectTable().put(project.id, project)
      }
      let complete = true
      for (const sessionId of workspace.sessionIds) {
        try {
          await this.migrateWorkspaceSession(sessionId, project)
        } catch (error: unknown) {
          complete = false
          this.ctx.logger.warn(`personal-bot project-migration session=${sessionId} result=deferred reason=${String(error)}`)
        }
      }
      if (complete) await this.ctx.workspaceRegistry.delete(workspace.id)
    }
  }

  private async migrateWorkspaceSession(sessionId: SessionId, project: Project): Promise<void> {
    const live = this.ctx.sessions.get(sessionId)
    if (live !== undefined) {
      const current = this.affiliation(live).current
      if (current.projectId !== undefined) return
      this.move(live, { ...current, projectId: project.id })
      await this.ctx.sessions.flush(live)
      return
    }
    await using handle = await this.ctx.sessionPersistence.open(sessionId, 'write')
    const { events } = await handle.read()
    const current = PersonalProjectRegistry.fold(events)
    if (current.current.projectId !== undefined) return
    const from = current.history.at(-1)?.to ?? this.snapshot(current.current)
    const event: SessionEvent = {
      type: 'personal/affiliation', seq: SessionSeq(events.length), time: Date.now(),
      data: { from, to: { ...from, project: { id: project.id, name: project.name } }, source: 'move' },
    }
    await handle.append([event])
    await handle.flush()
  }

  private projectTable(): KvTable<ProjectId, StoredProject> {
    if (this.projects === undefined) throw new Error('personal-project registry is not ready')
    return this.projects
  }
  private botTable(): KvTable<BotId, BotProfile> {
    if (this.bots === undefined) throw new Error('personal-project registry is not ready')
    return this.bots
  }
  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const result = this.tail.then(work)
    this.tail = result.then(() => undefined, () => undefined)
    return result
  }
  private async projectPath(path: string | undefined): Promise<string | undefined> {
    if (path === undefined) return undefined
    const canonical = await realpathNormalize(path)
    if (!(await stat(canonical)).isDirectory()) throw new Error(`Project directory "${path}" is not a directory`)
    return canonical
  }

  private async validateModel(model: { backend?: 'harness-api' | 'codex' | undefined; provider: string; model: string; reasoningEffort?: string | undefined } | undefined): Promise<void> {
    if (model === undefined) return
    if (model.backend === 'codex') {
      const agents = this.ctx.get('agents')
      if (agents === undefined) throw new Error('Codex backend is unavailable')
      await agents.driver('codex').resolve(model.model, model.reasoningEffort)
      return
    }
    const llm = this.ctx.get('llm')
    if (llm === undefined) throw new Error('Bot default model requires an LLM route registry')
    await llm.resolveCallConfig({
      provider: model.provider,
      model: model.model,
      ...(model.reasoningEffort === undefined ? {} : { reasoningEffort: ReasoningEffortId(model.reasoningEffort) }),
    })
  }

  /** Return personal projects in creation order.
   * @returns stored Projects.
   */
  listProjects(): Project[] {
    return [...this.projectTable().entries()].map(([, value]) => this.getProject(value.id) ?? value).sort(byCreation)
  }
  /** Return private Bot profiles in creation order.
   * @returns stored Bot profiles.
   */
  listBots(): BotProfile[] { return [...this.botTable().entries()].map(([, value]) => value).sort(byCreation) }
  /** Resolve one project identity.
   * @param id - Project ID.
   * @returns stored Project.
   */
  getProject(id: ProjectId): Project | undefined {
    return this.projectTable().get(id)
  }
  /** Resolve one Bot identity.
   * @param id - Bot ID.
   * @returns stored Bot profile, if present.
   */
  getBot(id: BotId): BotProfile | undefined { return this.botTable().get(id) }

  /** Whether the current Bot permits a named Skill at its loading entry point.
   * @param session - Session whose current Bot applies.
   * @param name - Skill name.
   * @returns whether the Skill is permitted.
   */
  allowsSkill(session: Session, name: string): boolean {
    const botId = this.affiliation(session).current.botId
    if (botId === undefined) return true
    const bot = this.getBot(botId)
    return bot !== undefined && (bot.allowedSkills === undefined || bot.allowedSkills.includes(name))
  }

  /** Create a Project independently of any local directory.
   * @param input - Project fields.
   * @returns the stored Project.
   */
  createProject(input: z.input<typeof projectInput>): Promise<Project> {
    return this.enqueue(async () => {
      const parsed = projectInput.parse(input)
      const path = await this.projectPath(parsed.path)
      const now = new Date().toISOString()
      const project: Project = {
        id: ProjectId(randomUUID()), name: parsed.name, description: parsed.description,
        ...(path === undefined ? {} : { path }),
        createdAt: now, updatedAt: now,
      }
      await this.projectTable().put(project.id, project)
      this.ctx.logger.info(`personal-bot project-create id=${project.id} result=committed`)
      return project
    })
  }

  /** Edit a Project's current metadata and optional directory.
   * @param id - Project ID.
   * @param input - changed fields.
   * @returns the updated Project.
   */
  updateProject(id: ProjectId, input: z.input<typeof projectPatch>): Promise<Project> {
    return this.enqueue(async () => {
      const patch = projectPatch.parse(input)
      const path = await this.projectPath(patch.path ?? undefined)
      const next = await this.projectTable().update(id, (current) => {
        const { path: _previous, workspaceId: _legacy, ...withoutPath } = current
        const nextPath = patch.path === undefined ? current.path : path
        return {
          ...withoutPath,
          name: patch.name ?? current.name,
          description: patch.description ?? current.description,
          ...(nextPath === undefined ? {} : { path: nextPath }),
          updatedAt: new Date().toISOString(),
        }
      })
      this.ctx.logger.info(`personal-bot project-update id=${id} result=committed`)
      return next
    })
  }

  /** Create a private Bot profile without storing credentials.
   * @param input - Bot fields.
   * @returns the stored Bot profile.
   */
  createBot(input: z.input<typeof botInput>): Promise<BotProfile> {
    return this.enqueue(async () => {
      const parsed = botInput.parse(input)
      await this.validateModel(parsed.defaultModel)
      const now = new Date().toISOString()
      const bot: BotProfile = {
        id: BotId(randomUUID()), name: parsed.name, identity: parsed.identity, direction: parsed.direction,
        ...(parsed.defaultModel === undefined ? {} : { defaultModel: parsed.defaultModel }),
        ...(parsed.allowedTools === undefined ? {} : { allowedTools: parsed.allowedTools }),
        ...(parsed.allowedSkills === undefined ? {} : { allowedSkills: parsed.allowedSkills }),
        createdAt: now, updatedAt: now,
      }
      await this.botTable().put(bot.id, bot)
      this.ctx.logger.info(`personal-bot bot-create id=${bot.id} result=committed`)
      return bot
    })
  }

  /** Edit the current Bot profile; old request logs remain immutable.
   * @param id - Bot ID.
   * @param input - changed fields.
   * @returns the updated Bot profile.
   */
  updateBot(id: BotId, input: z.input<typeof botPatch>): Promise<BotProfile> {
    return this.enqueue(async () => {
      const patch = botPatch.parse(input)
      await this.validateModel(patch.defaultModel ?? undefined)
      const next = await this.botTable().update(id, (current) => {
        const { defaultModel: _model, allowedTools: _tools, allowedSkills: _skills, ...base } = current
        const defaultModel = patch.defaultModel === undefined ? current.defaultModel : patch.defaultModel ?? undefined
        const allowedTools = patch.allowedTools === undefined ? current.allowedTools : patch.allowedTools ?? undefined
        const allowedSkills = patch.allowedSkills === undefined ? current.allowedSkills : patch.allowedSkills ?? undefined
        return {
          ...base,
          name: patch.name ?? current.name,
          identity: patch.identity ?? current.identity,
          direction: patch.direction ?? current.direction,
          ...(defaultModel === undefined ? {} : { defaultModel }),
          ...(allowedTools === undefined ? {} : { allowedTools }),
          ...(allowedSkills === undefined ? {} : { allowedSkills }),
          updatedAt: new Date().toISOString(),
        }
      })
      this.ctx.logger.info(`personal-bot bot-update id=${id} result=committed`)
      return next
    })
  }

  /** Current affiliation projected from the exact Session event prefix.
   * @param session - live or restored Session.
   * @returns current affiliation and transitions.
   */
  affiliation(session: Session): AffiliationProjection {
    const state = this.ctx.sessionProjections.stateOf(session, 'personalAffiliation')
    if (state === undefined) throw new Error('personal affiliation projection is not installed')
    return state
  }

  /** Append a complete affiliation transition to the same Session.
   * @param session - Session to change.
   * @param next - complete new affiliation.
   * @param source - cause of the transition.
   * @returns the projected current affiliation and transitions.
   */
  move(session: Session, next: Affiliation, source: 'create' | 'move' | 'delete' = 'move'): AffiliationProjection {
    const current = this.affiliation(session)
    if (current.current.projectId === next.projectId && current.current.botId === next.botId) return current
    // oxlint-disable-next-line typescript/no-deprecated -- Cold affiliation changes read the immutable durable backend.
    const native = session.snapshotEvents().some(event => event.type === 'agent/backend')
    if (source === 'move' && current.current.botId !== next.botId
      && native) throw new Error('Changing a Codex conversation Bot requires a new conversation')
    if (next.projectId !== undefined && next.projectId !== current.current.projectId && this.deletingProjects.has(next.projectId)) {
      throw new Error(`Project "${next.projectId}" is being deleted`)
    }
    if (next.botId !== undefined && next.botId !== current.current.botId && this.deletingBots.has(next.botId)) {
      throw new Error(`Bot "${next.botId}" is being deleted`)
    }
    const project = next.projectId === undefined ? undefined : this.getProject(next.projectId)
    const bot = next.botId === undefined ? undefined : this.getBot(next.botId)
    if (next.projectId !== undefined && project === undefined) throw new Error(`Project "${next.projectId}" does not exist`)
    if (next.botId !== undefined && bot === undefined) throw new Error(`Bot "${next.botId}" does not exist`)
    if (source === 'move' && project?.path !== undefined && project.path !== session.header.cwd
      && native) throw new Error('Changing a Codex working directory requires a new conversation')
    const previous = current.history.at(-1)?.to ?? this.snapshot(current.current)
    const to: AffiliationSnapshot = {
      ...(project === undefined ? {} : { project: { id: project.id, name: project.name } }),
      ...(bot === undefined ? {} : { bot: { id: bot.id, name: bot.name } }),
    }
    session.append('personal/affiliation', { from: previous, to, source })
    this.ctx.logger.info(`personal-bot affiliation session=${session.id} source=${source} result=committed`)
    return this.affiliation(session)
  }

  private snapshot(current: Affiliation): AffiliationSnapshot {
    const project = current.projectId === undefined ? undefined : this.getProject(current.projectId)
    const bot = current.botId === undefined ? undefined : this.getBot(current.botId)
    return {
      ...(project === undefined ? {} : { project: { id: project.id, name: project.name } }),
      ...(bot === undefined ? {} : { bot: { id: bot.id, name: bot.name } }),
    }
  }

  /** Fold a cold or inherited Session prefix without activating its Agent.
   * @param events - exact Session event prefix.
   * @returns affiliation at the end of the prefix.
   */
  static fold(events: readonly SessionEvent[]): AffiliationProjection {
    let state: AffiliationProjection = { current: {}, history: [] }
    for (const event of events) state = personalAffiliationProjection.apply(state, event)
    return state
  }

  /** Delete a Project after clearing all current Session references.
   * @param id - Project to delete.
   * @param resolveSession - opens one referenced Session for its clear event.
   * @returns whether the Project existed.
   */
  deleteProject(id: ProjectId, resolveSession: (id: SessionId) => Promise<Session>): Promise<boolean> {
    return this.enqueue(async () => {
      if (this.getProject(id) === undefined) return false
      this.deletingProjects.add(id)
      try {
        await this.clearReferences('project', id, resolveSession)
        const deleted = await this.projectTable().delete(id)
        this.ctx.logger.info(`personal-bot project-delete id=${id} result=${deleted ? 'committed' : 'missing'}`)
        return deleted
      } finally {
        this.deletingProjects.delete(id)
      }
    })
  }

  /** Delete a Bot after clearing all current Session references.
   * @param id - Bot to delete.
   * @param resolveSession - opens one referenced Session for its clear event.
   * @returns whether the Bot existed.
   */
  deleteBot(id: BotId, resolveSession: (id: SessionId) => Promise<Session>): Promise<boolean> {
    return this.enqueue(async () => {
      if (this.getBot(id) === undefined) return false
      this.deletingBots.add(id)
      try {
        await this.clearReferences('bot', id, resolveSession)
        const deleted = await this.botTable().delete(id)
        this.ctx.logger.info(`personal-bot bot-delete id=${id} result=${deleted ? 'committed' : 'missing'}`)
        return deleted
      } finally {
        this.deletingBots.delete(id)
      }
    })
  }

  private async clearReferences(kind: 'project' | 'bot', id: ProjectId | BotId, resolve: (id: SessionId) => Promise<Session>): Promise<void> {
    for (const record of await this.ctx.sessionQuery.listSessions()) {
      using observation = await this.ctx.sessionQuery.observeSession(record.header.id)
      const current = PersonalProjectRegistry.fold(observation.events).current
      if (kind === 'project' ? current.projectId !== id : current.botId !== id) continue
      const session = await resolve(record.header.id)
      const latest = this.affiliation(session).current
      if (kind === 'project' && latest.projectId === id) this.move(session, latest.botId === undefined ? {} : { botId: latest.botId }, 'delete')
      if (kind === 'bot' && latest.botId === id) this.move(session, latest.projectId === undefined ? {} : { projectId: latest.projectId }, 'delete')
      await this.ctx.sessions.flush(session)
    }
  }
}

function byCreation(left: { createdAt: string }, right: { createdAt: string }): number {
  return left.createdAt.localeCompare(right.createdAt)
}

export default PersonalProjectRegistry
