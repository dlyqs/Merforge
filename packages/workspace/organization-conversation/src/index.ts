/** Private organization project conversations, durable reservations and explicit planning intervals. */
import { randomUUID, createHash } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import { z } from 'zod'
import type { DomainGlobal } from '@deepseek-ai/dsh-storage-domain'
import Jsonl from '@deepseek-ai/dsh-session-persistence-jsonl'
import { SessionId, SessionSeq, SESSION_FORMAT_VERSION, type SessionEvent } from '@deepseek-ai/dsh-session'
import { planningCommandSchema } from '@deepseek-ai/dsh-organization/planning'
import { conversationModelSchema } from './model.ts'
import { runConversation } from './runtime.ts'
import { conversationDomain, conversationStateSchema, conversationInputSchema, conversationBindingSchema,
  conversationAssessmentSchema, conversationOperationSchema, type conversationIntentSchema } from './state.ts'
import { conversationRequestSchema, conversationAuthoritySchema, conversationOwnerSchema, conversationResultSchema,
  type ConversationBridge, type ConversationRequest, type ConversationResult } from './protocol.ts'
export * from './protocol.ts'
export { conversationAdapter, conversationModelSchema } from './model.ts'
/** Validated deployment bounds; personal settings never resolve these values. */
export const conversationConfigSchema = z.object({ root: z.string().min(1), models: z.array(conversationModelSchema).max(100),
  maxSteps: z.number().int().positive().max(1000), recheckMs: z.number().int().min(10).max(60000),
  maxDurationMs: z.number().int().positive().max(3600000), maxReportBytes: z.number().int().min(256).max(10485760),
  defaultSettings: z.object({ enabled: z.boolean(), granularity: z.enum(['balanced', 'fine']) }).strict(),
}).strict()
/** Private Host deployment configuration. */
export type Config = z.input<typeof conversationConfigSchema>
declare module '@deepseek-ai/cordis' { interface Context { organizationConversation: OrganizationConversation } }
declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Immutable original account/project/conversation owner in an independent namespace. */
    'organization/conversation-owner': z.output<typeof conversationOwnerSchema>
    /** Exact accepted input, method, settings and online authorization sent to the planning model. */
    'organization/planning-input': z.output<typeof conversationInputSchema>
    /** Private assessment of one stable goal; never an approved task definition. */
    'organization/planning-assessment': z.output<typeof conversationAssessmentSchema>
    /** Native permission intent and historical receipt, separate from model-visible user input. */
    'organization/planning-operation': z.output<typeof conversationOperationSchema>
  }
}
type State = z.output<typeof conversationStateSchema>
type Binding = z.output<typeof conversationBindingSchema>
const ownerKey = (owner: z.output<typeof conversationOwnerSchema>) => JSON.stringify(owner)
const preferenceKey = (owner: z.output<typeof conversationOwnerSchema>) => JSON.stringify([owner.serverId,
  owner.accountId, owner.organizationId])
/** Owns account-private project conversations. Only the private Node IPC consumer supplies online authority. */
export default class OrganizationConversation extends Service {
  static inject = ['storageDomain']
  static Config = conversationConfigSchema
  private readonly isolated = new Context()
  private state?: DomainGlobal<State>
  private tail: Promise<void> = Promise.resolve()
  private closing = false
  private readonly running = new Set<AbortController>()
  private readonly config: z.output<typeof conversationConfigSchema>
  constructor(ctx: Context, config: Config) { super(ctx, 'organizationConversation'); this.config = conversationConfigSchema.parse(config) }
  protected async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(conversationDomain)
    this.state = domain.global
    this.ctx.effect(() => async () => {
      this.closing = true; for (const run of this.running) run.abort()
      await this.tail; await this.isolated.fiber.dispose(); await domain.close()
    }, 'organization-conversation.close')
    await this.isolated.plugin(Jsonl, { root: this.config.root, compression: 'none', namespace: 'organization-conversation' })
    await this.verifyStoredBindings()
  }
  /**
   * Open/read a private project conversation, change its account settings, or send one explicit input.
   * @param input - Strict fixed operation; no caller-selected local Session or personal model context.
   * @param authorize - Correlated native online read and fixed planning-only commands.
   * @param signal - Top-frame, native identity and IPC lifetime.
   * @returns Bounded private transcript after final current authorization.
   */
  perform(input: ConversationRequest, authorize: ConversationBridge, signal: AbortSignal): Promise<ConversationResult> {
    const request = conversationRequestSchema.parse(input), cancel = new AbortController()
    if (this.closing) return Promise.reject(new Error('organization-conversation: unavailable'))
    this.running.add(cancel)
    const combined = AbortSignal.any([signal, cancel.signal])
    const task = this.tail.then(() => this.performCurrent(request, authorize, combined)).finally(() => this.running.delete(cancel))
    this.tail = task.then(() => {}, () => {})
    return task
  }
  private settings(owner: Binding['owner']) {
    return this.state?.get().preferences.find(p => preferenceKey({ ...owner, ...p.owner }) === preferenceKey(owner))?.settings
      ?? { ...this.config.defaultSettings, revision: 0 }
  }
  private async performCurrent(request: ConversationRequest, authorize: ConversationBridge,
    signal: AbortSignal): Promise<ConversationResult> {
    const state = this.state
    const check = () => { signal.throwIfAborted(); if (!state || this.closing) throw new Error('organization-conversation: unavailable') }
    check()
    if (!state) throw new Error('organization-conversation: unavailable')
    const first = conversationAuthoritySchema.parse(await authorize()); check()
    const owner = conversationOwnerSchema.parse({ serverId: first.serverId, accountId: first.accountId,
      organizationId: request.organizationId, projectId: request.projectId, conversationId: request.conversationId })
    const bridge: ConversationBridge = async (command) => {
      check()
      if (command && (command.organizationId !== owner.organizationId || command.projectId !== owner.projectId
        || command.conversationId !== owner.conversationId))
        throw new Error('organization-conversation: forbidden')
      const authority = conversationAuthoritySchema.parse(await authorize(command)); check()
      if (authority.serverId !== owner.serverId || authority.accountId !== owner.accountId || authority.generation !== first.generation
        || authority.view.project.id !== owner.projectId || authority.view.project.organizationId !== owner.organizationId
        || authority.view.grant && (authority.view.grant.accountId !== owner.accountId
          || authority.view.grant.conversationId !== owner.conversationId
          || authority.view.grant.projectId !== owner.projectId || authority.view.grant.organizationId !== owner.organizationId))
        throw new Error('organization-conversation: superseded')
      if (command && (!authority.receipt || authority.receipt.operationId !== command.operationId
        || authority.receipt.organizationId !== command.organizationId || authority.receipt.projectId !== command.projectId
        || authority.receipt.planning.conversationId !== command.conversationId))
        throw new Error('organization-conversation: receipt-mismatch')
      return authority
    }
    await bridge()
    const digest = createHash('sha256').update(JSON.stringify(request)).digest('hex')
    const sameOperation = (record: { owner: Binding['owner']; operationId: string }) => record.operationId === request.operationId
      && record.owner.serverId === owner.serverId && record.owner.accountId === owner.accountId
    const control = state.get().controls.find(sameOperation), acceptedInput = state.get().intents.find(sameOperation)
    if (request.kind !== 'read' && (control && (control.digest !== digest || ownerKey(control.owner) !== ownerKey(owner))
      || acceptedInput && (request.kind !== 'send' || acceptedInput.digest !== digest
        || ownerKey(acceptedInput.owner) !== ownerKey(owner)))) throw new Error('organization-conversation: operation-conflict')
    const controls = () => control ? state.get().controls : [...state.get().controls,
      { owner, operationId: request.operationId, digest }]
    let binding = state.get().bindings.find(b => ownerKey(b.owner) === ownerKey(owner))
    if (!binding) {
      if (request.kind !== 'open') throw new Error('organization-conversation: open-required')
      binding = { owner, sessionId: SessionId(`organization-conversation:${randomUUID()}`), createdAt: Date.now(), ready: false }
      await state.set({ ...state.get(), bindings: [...state.get().bindings, binding], controls: controls() })
    }
    await this.materialize(binding); check()
    if (!binding.ready) {
      binding = { ...binding, ready: true }
      const ready = binding
      await state.set({ ...state.get(), bindings: state.get().bindings.map(b => b.sessionId === ready.sessionId ? ready : b) })
    }
    if (request.kind === 'open' && !state.get().controls.some(sameOperation))
      await state.set({ ...state.get(), controls: controls() })
    if (request.kind === 'settings' && !control) {
      const settings = this.settings(owner)
      if (settings.revision !== request.expectedRevision) throw new Error('organization-conversation: settings-conflict')
      const { serverId, accountId, organizationId } = owner
      await state.set({ ...state.get(), controls: controls(), preferences: [
        ...state.get().preferences.filter(p => preferenceKey({ ...owner, ...p.owner }) !== preferenceKey(owner)),
        { owner: { serverId, accountId, organizationId }, settings: { ...request.settings, revision: settings.revision + 1 } }] })
    }
    if (request.kind === 'send') {
      if (!this.config.models.some(m => m.model === request.selection.model && m.endpoint === request.selection.endpoint))
        throw new Error('organization-conversation: local-model-policy-denied')
      let intent = state.get().intents.find(i => i.operationId === request.operationId
        && i.owner.serverId === owner.serverId && i.owner.accountId === owner.accountId)
      if (intent && (intent.digest !== digest || ownerKey(intent.owner) !== ownerKey(owner))) throw new Error('organization-conversation: operation-conflict')
      if (!intent) {
        const events = await this.events(binding), goals = this.goals(events)
        if (request.route === 'clarification' && !goals.some(g => g.id === request.goalId && g.classification === 'clarify'))
          throw new Error('organization-conversation: clarification-required')
        intent = { owner, operationId: request.operationId, digest, state: 'received', input: conversationInputSchema.parse({ request,
          goalId: request.goalId ?? randomUUID(), settings: this.settings(owner), authority: await bridge(),
          methodVersion: 'organization-planning/v1' }) }
        await state.set({ ...state.get(), intents: [...state.get().intents, intent] })
        this.ctx.logger.info('organization component=planning sessionId=%s goalId=%s operationId=%s result=received',
          binding.sessionId, intent.input.goalId, request.operationId)
      }
      if (intent.state === 'received') {
        const selected = intent
        const setIntent = async (next: z.output<typeof conversationIntentSchema>['state']) => {
          await state.set({ ...state.get(), intents: state.get().intents.map(i => i.operationId === selected.operationId
            && ownerKey(i.owner) === ownerKey(owner) ? { ...i, state: next } : i) })
        }
        await setIntent('sending'); check()
        const interval = new AbortController(), combined = AbortSignal.any([signal, interval.signal])
        const timer = setTimeout(() => { interval.abort() }, this.config.maxDurationMs)
        try {
          let authority = await bridge()
          if (!authority.view.eligible) {
            const command = planningCommandSchema.parse({ kind: 'open-planning', operationId: randomUUID(), selection: request.selection,
              organizationId: owner.organizationId, projectId: owner.projectId, conversationId: owner.conversationId })
            await this.append(binding, 'organization/planning-operation', { command })
            authority = await bridge(command)
            await this.append(binding, 'organization/planning-operation', { command,
              ...(authority.receipt ? { receipt: authority.receipt } : {}) })
          }
          if (!authority.view.eligible || !authority.view.grant || authority.view.grant.selection.model !== request.selection.model
            || authority.view.grant.selection.endpoint !== request.selection.endpoint) throw new Error('organization-conversation: planning-permission-required')
          const input = { ...intent.input, authority }
          await state.set({ ...state.get(), intents: state.get().intents.map(i => i.operationId === selected.operationId
            && ownerKey(i.owner) === ownerKey(owner) ? { ...i, input } : i) })
          combined.throwIfAborted()
          await runConversation(this.ctx, this.config.root, binding.sessionId, request, input, bridge,
            this.config.models, this.config, combined)
          await setIntent('completed')
          this.ctx.logger.info('organization component=planning sessionId=%s goalId=%s operationId=%s result=completed',
            binding.sessionId, intent.input.goalId, request.operationId)
        } catch (error) {
          await setIntent('stopped')
          this.ctx.logger.info('organization component=planning sessionId=%s goalId=%s operationId=%s result=stopped',
            binding.sessionId, intent.input.goalId, request.operationId)
          throw error
        }
        finally { clearTimeout(timer); interval.abort() }
      }
    }
    await bridge(); check()
    return this.report(binding)
  }
  private async append<T extends 'organization/planning-operation'>(binding: Binding, type: T,
    data: import('@deepseek-ai/dsh-session').SessionEventMap[T]): Promise<void> {
    const handle = await this.isolated.sessionPersistence.open(binding.sessionId, 'write')
    try {
      const read = await handle.read()
      await handle.append([{ type, seq: SessionSeq(read.events.length), time: Date.now(), data }]); await handle.flush()
    } finally { await handle.close() }
  }
  private async materialize(binding: Binding): Promise<void> {
    if (binding.ready) { await this.events(binding); return }
    const store = this.isolated.sessionPersistence, exists = await store.stat(binding.sessionId)
    const handle = exists ? await store.open(binding.sessionId, 'write') : await store.create({ id: binding.sessionId,
      version: SESSION_FORMAT_VERSION, createdAt: binding.createdAt, isSeeded: false, delegationDepth: 0 })
    try {
      const events = (await handle.read()).events
      if (events.length === 0) {
        await handle.append([{ type: 'organization/conversation-owner', seq: SessionSeq(0),
          time: binding.createdAt, data: binding.owner }]); await handle.flush()
      }
    } finally { await handle.close() }
    await this.events(binding)
  }
  private async events(binding: Binding): Promise<readonly SessionEvent[]> {
    const reader = await this.isolated.sessionPersistence.open(binding.sessionId, 'read')
    try {
      const events = (await reader.read()).events, first = events[0], header = reader.header
      if (header.createdAt !== binding.createdAt || header.parentSession !== undefined
        || header.agentPreset !== undefined || header.cwd !== undefined
        || header.origin !== undefined || header.isSeeded || first?.type !== 'organization/conversation-owner'
        || ownerKey(conversationOwnerSchema.parse(first.data)) !== ownerKey(binding.owner)) throw new Error('organization-conversation: binding-log-mismatch')
      return events
    } finally { await reader.close() }
  }
  private goals(events: readonly SessionEvent[]): ConversationResult['goals'] {
    const goals = new Map<string, ConversationResult['goals'][number]>()
    for (const e of events) {
      if (e.type === 'organization/planning-input') goals.set(e.data.goalId,
        goals.get(e.data.goalId) ?? { id: e.data.goalId, classification: 'unassessed' })
      if (e.type === 'organization/planning-assessment') goals.set(e.data.goalId, { id: e.data.goalId,
        classification: e.data.classification })
    }
    return [...goals.values()]
  }
  private async report(binding: Binding): Promise<ConversationResult> {
    const events = await this.events(binding), entries: ConversationResult['entries'] = []
    for (const e of events) {
      if (e.type === 'organization/planning-input' && e.data.request.kind === 'send') entries.push({ role: 'user',
        text: e.data.request.text })
      if (e.type === 'assistant/message') entries.push({ role: 'assistant',
        text: e.data.message.content.filter(b => b.type === 'text').map(b => b.text).join('') })
    }
    const intent = this.state?.get().intents.filter(i => ownerKey(i.owner) === ownerKey(binding.owner)).at(-1)
    const result: ConversationResult = { sessionId: binding.sessionId, owner: binding.owner, settings: this.settings(binding.owner),
      entries, goals: this.goals(events), truncated: false,
      state: !intent ? 'ready' : intent.state === 'sending' || intent.state === 'received' ? 'unknown' : intent.state }
    while (entries.length && Buffer.byteLength(JSON.stringify(result)) > this.config.maxReportBytes) {
      entries.shift(); result.truncated = true
    }
    if (Buffer.byteLength(JSON.stringify(result)) > this.config.maxReportBytes) throw new Error('organization-conversation: report-limit')
    return conversationResultSchema.parse(result)
  }
  /**
   * Compare local reservations with independent JSONL owners and accepted input evidence.
   * @returns Completion or a corruption error; this does not activate Agents or models.
   */
  verifyBindings(): Promise<void> {
    const task = this.tail.then(() => this.verifyStoredBindings())
    this.tail = task.then(() => {}, () => {})
    return task
  }
  private async verifyStoredBindings(): Promise<void> {
    if (!this.state || this.closing) throw new Error('organization-conversation: unavailable')
    const owners = new Set<string>(), sessions = new Set<string>(), operations = new Set<string>()
    for (const control of this.state.get().controls) {
      const key = JSON.stringify([control.owner.serverId, control.owner.accountId, control.operationId])
      if (operations.has(key)) throw new Error('organization-conversation: duplicate-operation')
      operations.add(key)
    }
    for (const intent of this.state.get().intents) {
      const key = JSON.stringify([intent.owner.serverId, intent.owner.accountId, intent.operationId]), input = intent.input
      if (operations.has(key) || input.request.kind !== 'send' || input.request.operationId !== intent.operationId
        || createHash('sha256').update(JSON.stringify(input.request)).digest('hex') !== intent.digest
        || ownerKey({ serverId: input.authority.serverId, accountId: input.authority.accountId,
          organizationId: input.request.organizationId, projectId: input.request.projectId,
          conversationId: input.request.conversationId }) !== ownerKey(intent.owner))
        throw new Error('organization-conversation: input-intent-mismatch')
      operations.add(key)
    }
    for (const b of this.state.get().bindings) {
      if (owners.has(ownerKey(b.owner)) || sessions.has(b.sessionId)) throw new Error('organization-conversation: duplicate-binding')
      owners.add(ownerKey(b.owner)); sessions.add(b.sessionId)
      if (b.ready || await this.isolated.sessionPersistence.stat(b.sessionId)) {
        const events = await this.events(b)
        if (events.filter(e => e.type === 'organization/conversation-owner').length !== 1)
          throw new Error('organization-conversation: binding-log-mismatch')
        for (const event of events) {
          if (event.type === 'organization/planning-input') {
            const input = conversationInputSchema.parse(event.data)
            const intent = this.state.get().intents.find(i => ownerKey(i.owner) === ownerKey(b.owner)
              && i.operationId === input.request.operationId)
            if (!intent || JSON.stringify(input) !== JSON.stringify(intent.input)
              || input.authority.serverId !== b.owner.serverId || input.authority.accountId !== b.owner.accountId
              || input.authority.view.project.id !== b.owner.projectId
              || input.authority.view.project.organizationId !== b.owner.organizationId)
              throw new Error('organization-conversation: input-log-mismatch')
          }
          if (event.type === 'organization/planning-assessment') {
            const assessment = conversationAssessmentSchema.parse(event.data)
            if (!events.some(e => e.seq < event.seq && e.type === 'organization/planning-input'
              && e.data.goalId === assessment.goalId && e.data.request.operationId === assessment.operationId))
              throw new Error('organization-conversation: assessment-log-mismatch')
          }
        }
        for (const intent of this.state.get().intents.filter(i => ownerKey(i.owner) === ownerKey(b.owner))) {
          const inputs = events.filter(e => e.type === 'organization/planning-input' && e.data.request.operationId === intent.operationId)
          if (inputs.length > 1 || intent.state === 'completed'
          && inputs.length !== 1) throw new Error('organization-conversation: input-log-mismatch')
        }
      }
    }
    for (const intent of this.state.get().intents) if (!owners.has(ownerKey(intent.owner))) throw new Error('organization-conversation: orphan-input')
    for (const control of this.state.get().controls) if (!owners.has(ownerKey(control.owner))) throw new Error('organization-conversation: orphan-operation')
    const preferences = new Set<string>()
    for (const preference of this.state.get().preferences) {
      const key = JSON.stringify([preference.owner.serverId, preference.owner.accountId, preference.owner.organizationId])
      if (preferences.has(key)) throw new Error('organization-conversation: duplicate-preference')
      preferences.add(key)
    }
    for (const h of await this.isolated.sessionPersistence.list()) if (!sessions.has(h.header.id)) throw new Error('organization-conversation: orphan-log')
  }
}
