/** Isolated pre-execution Session bindings; no Agent, Remote or personal corpus registration. */
import { randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import { z } from 'zod'
import { defineDomain, type DomainGlobal } from '@deepseek-ai/dsh-storage-domain'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { SESSION_FORMAT_VERSION, SessionId, SessionSeq, type SessionEvent } from '@deepseek-ai/dsh-session'
import { assertContextSnapshotAccess, contextRequestSchema, contextAuthoritySchema, contextOwnerSchema, contextResultSchema,
  type ContextRequest, type ContextAuthority, type ContextResult } from './protocol.ts'
export * from './protocol.ts'

declare module '@deepseek-ai/cordis' {
  interface Context { organizationContext: OrganizationContext }
}
declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Immutable organization identity; never transferable to a personal Session. */
    'organization/context': z.output<typeof contextOwnerSchema>
    /** Exact authorized pre-execution task facts, with their definition revision. */
    'organization/task-snapshot': ContextResult['snapshot']
  }
}
const bindingSchema = contextResultSchema.extend({ state: z.enum(['reserved', 'ready']), operationId: contextRequestSchema.shape.operationId, createdAt: z.number().int().nonnegative() }).strict()
const stateSchema = z.object({ bindings: z.array(bindingSchema), operations: z.array(z.object({
  operationId: z.uuid(), key: z.string(),
}).strict()) }).strict()
type State = z.output<typeof stateSchema>
const domainSpec = defineDomain({ name: 'organization_context', version: 1, tables: {},
  global: { schema: stateSchema, initial: { bindings: [], operations: [] } } })

/** Deployment-owned isolated Session directory. */
export interface Config {
  /** Dedicated JSONL directory, outside personal Session roots. */
  root: string
}

/** Local binding owner; authorization closures are available only to the private Node IPC consumer. */
export default class OrganizationContext extends Service {
  static inject = ['storageDomain']
  static Config = z.object({ root: z.string().min(1) }).strict()
  private readonly isolated = new Context()
  private state?: DomainGlobal<State>
  private tail: Promise<void> = Promise.resolve()
  private closing = false
  constructor(ctx: Context, private readonly config: Config) { super(ctx, 'organizationContext') }
  protected async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(domainSpec)
    this.state = domain.global
    this.ctx.effect(() => async () => {
      this.closing = true
      await this.tail
      await this.isolated.fiber.dispose()
      await domain.close()
    }, 'organization-context.close')
    await this.isolated.plugin(JsonlSessionPersistence, { root: this.config.root, compression: 'none', namespace: 'organization-context' })
  }
  /**
   * Open the current member's binding, reserving its identity before Session persistence.
   * @param input - Strict task selector and operation identifier.
   * @param authorize - Private native online recheck; never supplied through a public Remote.
   * @param signal - IPC lifetime/deadline cancellation, checked before every delivery.
   * @returns Original task snapshot after durable verification and a final online recheck.
   */
  open(input: ContextRequest, authorize: (revision?: ContextAuthority['task']['revision']) => Promise<ContextAuthority>, signal: AbortSignal): Promise<ContextResult> {
    const request = contextRequestSchema.parse(input)
    const run = this.tail.then(() => this.openCurrent(request, authorize, signal))
    this.tail = run.then(() => {}, () => {})
    return run.catch((error: unknown) => {
      this.ctx.logger.info('component=context operationId=%s result=reconcile-required', request.operationId)
      throw error
    })
  }
  /**
   * Compare ready bindings with their separately durable JSONL ownership and task facts.
   * @returns Completion, or a corruption error without task content.
   */
  async verifyBindings(): Promise<void> {
    await this.tail
    if (!this.state || this.closing) throw new Error('organization-context: unavailable')
    const identities = new Set<string>()
    const sessions = new Set<string>()
    for (const binding of this.state.get().bindings) {
      const key = JSON.stringify(binding.owner)
      if (identities.has(key) || sessions.has(binding.sessionId)) throw new Error('organization-context: duplicate binding')
      identities.add(key); sessions.add(binding.sessionId)
      if (binding.state !== 'ready') continue
      const reader = await this.isolated.sessionPersistence.open(binding.sessionId, 'read')
      try {
        const { events } = await reader.read()
        if (reader.header.createdAt !== binding.createdAt || reader.header.cwd !== undefined || reader.header.parentSession !== undefined
          || reader.header.agentPreset !== undefined || reader.header.origin !== undefined || reader.header.isSeeded
          || events.length !== 2 || events[0]?.type !== 'organization/context' || events[1]?.type !== 'organization/task-snapshot'
          || JSON.stringify(events[0].data) !== JSON.stringify(binding.owner)
          || JSON.stringify(events[1].data) !== JSON.stringify(binding.snapshot)) {
          throw new Error('organization-context: binding/log mismatch')
        }
      } finally { await reader.close() }
    }
  }
  private async openCurrent(request: ContextRequest, authorize: (revision?: ContextAuthority['task']['revision']) => Promise<ContextAuthority>, signal: AbortSignal): Promise<ContextResult> {
    const check = () => { signal.throwIfAborted(); if (this.closing || !this.state) throw new Error('organization-context: unavailable') }
    check()
    const first = contextAuthoritySchema.parse(await authorize())
    check()
    const matches = (authority: ContextAuthority) => {
      if (authority.organizationId !== request.organizationId || authority.task.planId !== request.planId
        || authority.task.id !== request.taskId
        || authority.serverId !== first.serverId || authority.accountId !== first.accountId || authority.generation !== first.generation) {
        throw new Error('organization-context: superseded')
      }
    }
    matches(first)
    const owner = contextOwnerSchema.parse({ serverId: first.serverId, accountId: first.accountId,
      organizationId: first.organizationId, planId: request.planId, taskId: request.taskId, version: 1 })
    const key = JSON.stringify(owner)
    const state = this.state
    if (!state) throw new Error('organization-context: unavailable')
    let saved = state.get()
    const receipt = saved.operations.find(value => value.operationId === request.operationId)
    if (receipt && receipt.key !== key) throw new Error('organization-context: operation-conflict')
    let binding = saved.bindings.find(value => JSON.stringify(value.owner) === key) ?? { owner, snapshot: first.task, sessionId: SessionId(`organization-context:${randomUUID()}`),
      mode: 'pre-execution' as const, state: 'reserved' as const, operationId: request.operationId, createdAt: Date.now() }
    if (!receipt) {
      saved = {
        bindings: saved.bindings.some(value => value.sessionId === binding.sessionId) ? saved.bindings : [...saved.bindings, binding],
        operations: [...saved.operations, { operationId: request.operationId, key }] }
      await state.set(saved)
      this.ctx.logger.info('component=context operationId=%s revision=%s generation=%s result=prepared', request.operationId, binding.snapshot.revision, first.generation)
    }
    check()
    const store = this.isolated.sessionPersistence
    const expected: SessionEvent[] = [
      { type: 'organization/context', seq: SessionSeq(0), time: binding.createdAt, data: binding.owner },
      { type: 'organization/task-snapshot', seq: SessionSeq(1), time: binding.createdAt, data: binding.snapshot },
    ]
    if (binding.state === 'reserved') {
      const existing = await store.stat(binding.sessionId)
      const handle = existing ? await store.open(binding.sessionId, 'write') : await store.create({
        id: binding.sessionId, version: SESSION_FORMAT_VERSION, createdAt: binding.createdAt, isSeeded: false, delegationDepth: 0,
      })
      try {
        const current = await handle.read()
        if (JSON.stringify(current.events) !== JSON.stringify(expected.slice(0, current.events.length))) throw new Error('organization-context: corrupt reservation')
        await handle.append(expected.slice(current.events.length))
        await handle.flush()
      } finally { await handle.close() }
    }
    const cold = await store.open(binding.sessionId, 'read')
    try {
      const read = await cold.read()
      if (JSON.stringify(read.events) !== JSON.stringify(expected) || cold.header.cwd !== undefined || cold.header.isSeeded
        || cold.header.createdAt !== binding.createdAt || cold.header.parentSession !== undefined
        || cold.header.agentPreset !== undefined || cold.header.origin !== undefined) {
        throw new Error('organization-context: corrupt binding')
      }
    } finally { await cold.close() }
    check()
    const historical = contextAuthoritySchema.parse(await authorize(binding.snapshot.revision))
    matches(historical)
    assertContextSnapshotAccess(binding.snapshot, historical.task)
    check()
    if (binding.state !== 'ready') {
      binding = { ...binding, state: 'ready' }
      await state.set({ ...saved, bindings: saved.bindings.map(value => value.sessionId === binding.sessionId ? binding : value) })
    }
    check()
    const final = contextAuthoritySchema.parse(await authorize(binding.snapshot.revision))
    matches(final)
    assertContextSnapshotAccess(binding.snapshot, final.task)
    check()
    this.ctx.logger.info('component=context operationId=%s revision=%s generation=%s result=committed', request.operationId, binding.snapshot.revision, first.generation)
    return contextResultSchema.parse({ sessionId: binding.sessionId, owner, snapshot: binding.snapshot, mode: 'pre-execution' })
  }
}
