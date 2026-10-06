/** Private organization project conversations, durable reservations and explicit planning intervals. */
import { createAssistantMessage, createSystemMessage } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-api-session-controller/types'
import { randomUUID, createHash } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import { z } from 'zod'
import type { DomainGlobal } from '@deepseek-ai/dsh-storage-domain'
import Jsonl from '@deepseek-ai/dsh-session-persistence-jsonl'
import { SessionId, SessionSeq, SESSION_FORMAT_VERSION, type SessionEvent } from '@deepseek-ai/dsh-session'
import { planningCommandSchema, planningDraftSchema } from '@deepseek-ai/dsh-organization/planning'
import { conversationModelSchema } from './model.ts'
import { checkPlanningMembers } from './proposal.ts'
import { runConversation } from './runtime.ts'
import { SharedConversationSessions } from './shared-session.ts'
import { conversationDomain, conversationStateSchema, conversationInputSchema, conversationBindingSchema,
  navigationDomain, navigationStateSchema, conversationAssessmentSchema, conversationOperationSchema, conversationProposalSchema, type conversationIntentSchema } from './state.ts'
import { conversationRequestSchema, conversationProjectId, conversationAuthoritySchema, conversationOwnerSchema, conversationResultSchema,
  conversationGoalSchema, type ConversationBridge, type ConversationRequest, type ConversationResult } from './protocol.ts'
export * from './protocol.ts'
export { conversationAdapter, conversationModelSchema } from './model.ts'
/** Validated deployment bounds; personal settings never resolve these values. */
export const conversationConfigSchema = z.object({ root: z.string().min(1), models: z.array(conversationModelSchema).max(100),
  maxCatalogItems: z.number().int().min(1).max(10000).default(200),
  maxBots: z.number().int().min(1).max(1000).default(100),
  maxSteps: z.number().int().positive().max(1000), recheckMs: z.number().int().min(10).max(60000),
  maxDurationMs: z.number().int().positive().max(3600000), maxReportBytes: z.number().int().min(256).max(10485760),
  defaultSettings: z.object({ enabled: z.boolean(), granularity: z.enum(['balanced', 'fine']) }).strict(),
}).strict()
/** Private Host deployment configuration. */
export type Config = z.input<typeof conversationConfigSchema>
declare module '@deepseek-ai/cordis' { interface Context { organizationConversation: OrganizationConversation } }
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
  private shared: SharedConversationSessions | undefined
  private navigation?: DomainGlobal<z.output<typeof navigationStateSchema>>
  private state?: DomainGlobal<State>
  private tail: Promise<void> = Promise.resolve()
  private closing = false
  private readonly running = new Set<AbortController>()
  private activeOwner: { key: string; owner: Binding['owner']; cancel: AbortController } | undefined
  private readonly config: z.output<typeof conversationConfigSchema>
  constructor(ctx: Context, config: Config) { super(ctx, 'organizationConversation'); this.config = conversationConfigSchema.parse(config) }
  protected async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(conversationDomain)
    this.state = domain.global
    this.ctx.inject(['sessionQuery', 'sessionController', 'personalWorkflow', 'sessionProjections', 'agentDefaultModel', 'sessions', 'sessionPersistence', 'agents', 'tools'], (host) => {
      this.shared = new SharedConversationSessions(host, () => this.state?.get().bindings ?? [],
        binding => this.settings(binding.owner), (binding) => {
          const botId = this.navigation?.get().selections.find(row => ownerKey(row.owner) === ownerKey(binding.owner))?.botId
          return this.navigation?.get().bots.find(row => row.bot.id === botId
            && preferenceKey(row.owner) === preferenceKey(binding.owner) && row.owner.projectId === binding.owner.projectId)?.bot
        }, this.config.recheckMs)
      host.on('api-session/backend-replaced', async (source, replacement) => {
        const operation = this.tail.then(async () => {
          const state = this.state
          if (!state) throw new Error('organization-conversation: unavailable')
          const binding = state.get().bindings.find(row => (row.activeSessionId ?? row.sharedSessionId) === source.id)
          if (!binding) return
          if (binding.deleted) throw new Error('organization-conversation: deleted')
          // oxlint-disable-next-line typescript/no-deprecated -- Backend handoff copies task metadata without conversation messages.
          for (const event of source.snapshotEvents()) {
            if (event.type === 'organization/conversation-owner') replacement.append(event.type, event.data)
            if (event.type === 'organization/assignment-context') replacement.append(event.type, event.data)
            if (event.type === 'organization/task-selection') replacement.append(event.type, event.data)
          }
          if (!await host.sessions.flush(replacement)) throw new Error('organization-conversation: log-not-durable')
          await state.set({ ...state.get(), bindings: state.get().bindings.map(row => row === binding
            ? { ...row, activeSessionId: replacement.id } : row) })
        })
        this.tail = operation.then(() => {}, () => {})
        await operation
      })
    })
    const navigation = await this.ctx.storageDomain.open(navigationDomain).catch(async (error: unknown) => {
      await domain.close(); throw error
    })
    this.navigation = navigation.global
    this.ctx.effect(() => async () => {
      this.closing = true; for (const run of this.running) run.abort()
      await this.tail; await this.shared?.close(); await this.isolated.fiber.dispose(); await navigation.close(); await domain.close()
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
    if (request.kind === 'detach') return this.detach(request, authorize, signal)
    if (request.kind === 'stop' || request.kind === 'delete' || request.kind === 'project-remove') return authorize().then((authority) => {
      const key = ownerKey(conversationOwnerSchema.parse({ serverId: authority.serverId, accountId: authority.accountId,
        organizationId: request.organizationId, ...(request.projectId ? { projectId: request.projectId } : {}),
        conversationId: request.conversationId,
        ...(request.assignment ? { assignment: request.assignment } : {}) }))
      if (this.activeOwner?.key === key) this.activeOwner.cancel.abort()
      const active = this.activeOwner
      if (request.kind === 'project-remove' && active && active.owner.serverId === authority.serverId
        && active.owner.accountId === authority.accountId && active.owner.organizationId === request.organizationId
        && active.owner.projectId === request.projectId) active.cancel.abort()
      return this.enqueue(request.kind === 'stop' ? { ...request, kind: 'read' } : request, authorize, signal, cancel)
    })
    return this.enqueue(request, authorize, signal, cancel)
  }
  /**
   * Attach the common Desktop runtime through a native-owned account lifetime.
   * @param request - Fixed conversation selector.
   * @param authorize - Native account authorization.
   * @param signal - Account and window lifetime.
   * @param ready - Publishes the ordinary Session identity after authorized import.
   * @returns Settlement after the ordinary Agent drains on detachment.
   */
  async attach(request: ConversationRequest, authorize: ConversationBridge, signal: AbortSignal,
    ready: (result: ConversationResult) => void): Promise<void> {
    const shared = this.shared
    if (!shared || request.kind !== 'attach') throw new Error('organization-conversation: common-runtime-required')
    const report = await this.perform({ ...request, kind: 'open' }, authorize, signal)
    const state = this.state
    if (!state) throw new Error('organization-conversation: unavailable')
    const reservation = this.tail.then(async () => {
      signal.throwIfAborted()
      let binding = state.get().bindings.find(row => row.sessionId === report.sessionId)
      if (!binding || binding.deleted) throw new Error('organization-conversation: deleted')
      if (!binding.sharedSessionId) {
        binding = { ...binding, sharedSessionId: SessionId(`session-${randomUUID()}`) }
        const next = binding
        await state.set({ ...state.get(), bindings: state.get().bindings.map(row => row.sessionId === next.sessionId ? next : row) })
      }
      return binding
    })
    this.tail = reservation.then(() => {}, () => {})
    const reserved = await reservation
    const events = await this.events(reserved)
    let inputText = ''
    const commonId = reserved.sharedSessionId
    if (!commonId) throw new Error('organization-conversation: shared-session-required')
    const importing = !await this.commonHost().persistence.stat(commonId)
    const history = events.map((event): SessionEvent => {
      if (event.type === 'organization/planning-input' && event.data.request.kind === 'send') inputText = event.data.request.text
      return importing && event.type === 'user/message' && event.data.source.kind === 'user'
        ? { ...event, data: { ...event.data, content: [{ type: 'text', text: inputText }] } } : event
    })
    await shared.attach(reserved, history, authorize, request.operationId, signal, async () => {
      const currentBinding = state.get().bindings.find(row => row.sessionId === reserved.sessionId)
      if (!currentBinding || currentBinding.deleted) throw new Error('organization-conversation: deleted')
      const current = await this.report(currentBinding, authorize)
      ready({ ...current, attachmentId: request.operationId })
    })
  }
  private async detach(request: ConversationRequest, authorize: ConversationBridge, signal: AbortSignal): Promise<ConversationResult> {
    if (request.kind !== 'detach') throw new Error('organization-conversation: detach-required')
    const authority = await authorize()
    signal.throwIfAborted()
    const binding = this.state?.get().bindings.find(row => row.owner.serverId === authority.serverId
      && row.owner.accountId === authority.accountId && row.owner.organizationId === request.organizationId
      && row.owner.projectId === request.projectId && row.owner.conversationId === request.conversationId)
    if (!binding) throw new Error('organization-conversation: open-required')
    if (binding.sharedSessionId) await this.shared?.detach(binding.sharedSessionId, request.attachmentId)
    return this.report(binding, authorize)
  }
  private commonHost() {
    const sessions = this.ctx.get('sessions'), persistence = this.ctx.get('sessionPersistence'), controller = this.ctx.get('sessionController'), agents = this.ctx.get('agents')
    if (!sessions || !persistence || !controller || !agents) throw new Error('organization-conversation: common-runtime-required')
    return { sessions, persistence, controller, agents }
  }
  private enqueue(request: ConversationRequest, authorize: ConversationBridge, signal: AbortSignal,
    cancel: AbortController): Promise<ConversationResult> {
    this.running.add(cancel)
    const combined = AbortSignal.any([signal, cancel.signal])
    const task = this.tail.then(() => this.performCurrent(request, authorize, combined, cancel)).finally(() => {
      this.running.delete(cancel)
      if (this.activeOwner?.cancel === cancel) this.activeOwner = undefined
    })
    this.tail = task.then(() => {}, () => {})
    return task
  }
  private settings(owner: Binding['owner']) {
    return this.state?.get().preferences.find(p => preferenceKey({ ...owner, ...p.owner }) === preferenceKey(owner))?.settings
      ?? { ...this.config.defaultSettings, revision: 0 }
  }
  private async performCurrent(request: ConversationRequest, authorize: ConversationBridge,
    signal: AbortSignal, cancel: AbortController): Promise<ConversationResult> {
    const state = this.state
    const check = () => { signal.throwIfAborted(); if (!state || this.closing) throw new Error('organization-conversation: unavailable') }
    check()
    if (!state) throw new Error('organization-conversation: unavailable')
    const first = conversationAuthoritySchema.parse(await authorize()); check()
    const owner = conversationOwnerSchema.parse({ serverId: first.serverId, accountId: first.accountId,
      organizationId: request.organizationId, ...(request.projectId ? { projectId: request.projectId } : {}),
      conversationId: request.conversationId,
      ...(request.assignment ? { assignment: request.assignment } : {}) })
    if (request.kind === 'project-remove') {
      if (first.view.project || first.view.grant || first.assignment) throw new Error('organization-conversation: membership-required')
      await this.removeProject(owner)
      const current = conversationAuthoritySchema.parse(await authorize()); check()
      if (current.serverId !== owner.serverId || current.accountId !== owner.accountId || current.generation !== first.generation)
        throw new Error('organization-conversation: superseded')
      return { owner, sessionId: SessionId(`organization-conversation:${randomUUID()}`), settings: this.settings(owner),
        entries: [], history: [], goals: [], truncated: false, state: 'ready' }
    }
    const bridge: ConversationBridge = async (command) => {
      check()
      if (command && (command.organizationId !== owner.organizationId || command.projectId !== owner.projectId
        || command.conversationId !== owner.conversationId))
        throw new Error('organization-conversation: forbidden')
      const authority = conversationAuthoritySchema.parse(await authorize(command)); check()
      if (authority.serverId !== owner.serverId || authority.accountId !== owner.accountId || authority.generation !== first.generation
        || authority.view.project?.id !== owner.projectId
        || authority.view.project && authority.view.project.organizationId !== owner.organizationId
        || authority.view.grant && (authority.view.grant.accountId !== owner.accountId
          || authority.view.grant.conversationId !== owner.conversationId
          || authority.view.grant.projectId !== owner.projectId || authority.view.grant.organizationId !== owner.organizationId))
        throw new Error('organization-conversation: superseded')
      if (command && command.kind !== 'read-planning-plan' && command.kind !== 'read-planning-members' && (!authority.receipt || authority.receipt.operationId !== command.operationId
        || authority.receipt.organizationId !== command.organizationId || authority.receipt.projectId !== command.projectId
        || authority.receipt.planning.conversationId !== command.conversationId))
        throw new Error('organization-conversation: receipt-mismatch')
      if (owner.assignment && (!authority.assignment || authority.assignment.id !== owner.assignment.assignmentId
        || authority.assignment.planId !== owner.assignment.planId || authority.assignment.organizationId !== owner.organizationId
        || authority.assignment.projectId !== owner.projectId)) throw new Error('organization-conversation: assignment-mismatch')
      return authority
    }
    await bridge()
    if (request.kind === 'catalog') return this.report({ owner,
      sessionId: SessionId(`organization-conversation:${randomUUID()}`), createdAt: Date.now(), ready: false }, bridge, true)
    if (owner.assignment && request.kind === 'send' && request.goalId !== conversationGoalSchema.parse(owner.assignment.assignmentId))
      throw new Error('organization-conversation: goal-required')
    this.activeOwner = { key: ownerKey(owner), owner, cancel }
    const digest = createHash('sha256').update(JSON.stringify(request)).digest('hex')
    const sameOperation = (record: { owner: Binding['owner']; operationId: string }) => record.operationId === request.operationId
      && record.owner.serverId === owner.serverId && record.owner.accountId === owner.accountId
    const control = state.get().controls.find(sameOperation), acceptedInput = state.get().intents.find(sameOperation)
    if (request.kind !== 'read' && (control && (control.digest !== digest || ownerKey(control.owner) !== ownerKey(owner))
      || acceptedInput && (request.kind !== 'send' || acceptedInput.digest !== digest
        || ownerKey(acceptedInput.owner) !== ownerKey(owner)))) throw new Error('organization-conversation: operation-conflict')
    const botOperation = this.navigation?.get().operations.find(sameOperation)
    if (botOperation && (request.kind !== 'bot-save' || botOperation.digest !== digest
      || ownerKey(botOperation.owner) !== ownerKey(owner))) throw new Error('organization-conversation: operation-conflict')
    const controls = () => control ? state.get().controls : [...state.get().controls,
      { owner, operationId: request.operationId, digest }]
    let binding = state.get().bindings.find(b => b.owner.serverId === owner.serverId && b.owner.accountId === owner.accountId
      && b.owner.organizationId === owner.organizationId && b.owner.projectId === owner.projectId
      && b.owner.conversationId === owner.conversationId)
    if (binding && ownerKey(binding.owner) !== ownerKey(owner)) throw new Error('organization-conversation: owner-mismatch')
    if (!binding) {
      if (!['open', 'open-review', 'catalog', 'bot-save'].includes(request.kind)) throw new Error('organization-conversation: open-required')
      binding = { owner, sessionId: SessionId(`organization-conversation:${randomUUID()}`), createdAt: Date.now(), ready: false }
      await state.set({ ...state.get(), bindings: [...state.get().bindings, binding], controls: controls() })
    }
    if (!binding.ready) this.ctx.logger.info('organization component=conversation bindingId=%s assignmentId=%s operationId=%s result=pending',
      binding.sessionId, owner.assignment?.assignmentId ?? '', request.operationId)
    if (request.kind === 'delete') {
      const deleted = binding
      await state.set({ ...state.get(),
        bindings: state.get().bindings.map(row => row.sessionId === deleted.sessionId ? { ...row, deleted: true } : row),
        intents: state.get().intents.filter(row => ownerKey(row.owner) !== ownerKey(owner)), controls: controls() })
      if (this.navigation) await this.navigation.set({ ...this.navigation.get(),
        metadata: this.navigation.get().metadata.filter(row => ownerKey(row.owner) !== ownerKey(owner)),
        selections: this.navigation.get().selections.filter(row => ownerKey(row.owner) !== ownerKey(owner)) })
      if (binding.sharedSessionId) {
        await this.shared?.detach(binding.sharedSessionId)
        for (const id of this.shared?.identities(binding.sharedSessionId) ?? [binding.sharedSessionId])
          await this.commonHost().controller.deleteSession(id)
      }
      if (await this.isolated.sessionPersistence.stat(binding.sessionId)) await this.isolated.sessionPersistence.delete(binding.sessionId)
      await bridge(); check()
      return { sessionId: binding.sessionId, owner, settings: this.settings(owner), entries: [], history: [], goals: [],
        truncated: false, state: 'ready' }
    }
    if (binding.deleted) throw new Error('organization-conversation: deleted')
    await this.materialize(binding); check()
    if (!binding.ready) {
      binding = { ...binding, ready: true }
      const ready = binding
      await state.set({ ...state.get(), bindings: state.get().bindings.map(b => b.sessionId === ready.sessionId ? ready : b) })
      this.ctx.logger.info('organization component=conversation bindingId=%s assignmentId=%s result=ready',
        binding.sessionId, owner.assignment?.assignmentId ?? '')
    }
    if ((request.kind === 'open' || request.kind === 'open-review') && !state.get().controls.some(sameOperation))
      await state.set({ ...state.get(), controls: controls() })
    const navigation = this.navigation
    if (!navigation) throw new Error('organization-conversation: unavailable')
    if (request.kind === 'affiliation' && !control) {
      if (owner.assignment) throw new Error('organization-conversation: assignment-mismatch')
      if (request.nextBotId && !navigation.get().bots.some(row => ownerKey({ ...row.owner,
        conversationId: owner.conversationId }) === ownerKey(owner)
        && row.bot.id === request.nextBotId)) throw new Error('organization-conversation: bot-unavailable')
      await navigation.set({ ...navigation.get(), selections: [
        ...navigation.get().selections.filter(row => ownerKey(row.owner) !== ownerKey(owner)),
        ...(request.nextBotId ? [{ owner, botId: request.nextBotId }] : [])] })
      await state.set({ ...state.get(), controls: controls() })
    }
    if (request.kind === 'rename' && !control) {
      if (!request.title) throw new Error('organization-conversation: title-required')
      await navigation.set({ ...navigation.get(), metadata: [
        ...navigation.get().metadata.filter(row => ownerKey(row.owner) !== ownerKey(owner)), { owner, title: request.title }] })
      await state.set({ ...state.get(), controls: controls() })
      const activeId = binding.activeSessionId ?? binding.sharedSessionId
      if (activeId && this.commonHost().sessions.get(activeId))
        await this.commonHost().controller.rename({ sessionId: activeId, title: request.title })
    }
    if (request.kind === 'select-task' && !control) {
      if (first.assignment && (first.assignment.planId !== request.target.planId || first.assignment.taskId !== request.target.taskId))
        throw new Error('organization-conversation: assignment-mismatch')
      const target = { kind: 'read-planning-plan' as const, organizationId: owner.organizationId, projectId: conversationProjectId(owner),
        conversationId: owner.conversationId, ...request.target }
      if (!(await bridge(target)).plan) throw new Error('organization-conversation: task-required')
      const events = await this.events(binding)
      const previous = events.find(event => event.type === 'organization/task-selection' && event.data.operationId === request.operationId)
      if (previous?.type === 'organization/task-selection' && previous.data.digest !== digest) throw new Error('organization-conversation: operation-conflict')
      if (!previous) {
        const data = { owner, target, operationId: request.operationId, digest }
        if (binding.sharedSessionId) {
          const resolved = await this.commonHost().controller.resolveAgent(binding.activeSessionId ?? binding.sharedSessionId)
          if ('error' in resolved) throw resolved.error
          resolved.agent.session.append('organization/task-selection', data)
          await this.commonHost().sessions.flush(resolved.agent.session)
        } else {
          const writer = await this.isolated.sessionPersistence.open(binding.sessionId, 'write')
          try {
            await writer.append([{ type: 'organization/task-selection', seq: SessionSeq(events.length), time: Date.now(), data }]); await writer.flush()
          } finally { await writer.close() }
        }
      }
      await state.set({ ...state.get(), controls: controls() })
    }
    if (request.kind === 'select-model' && !control) {
      if (!first.view.policy.models.some(model => model.model === request.selection.model && model.endpoint === request.selection.endpoint)
        || !this.config.models.some(model => model.model === request.selection.model && model.endpoint === request.selection.endpoint))
        throw new Error('organization-conversation: local-model-policy-denied')
      const handle = await this.isolated.sessionPersistence.open(binding.sessionId, 'write')
      try {
        const rows = (await handle.read()).events
        const previous = rows.find(row => row.type === 'organization/model-selection-operation' && row.data.operationId === request.operationId)
        if (previous?.type === 'organization/model-selection-operation' && previous.data.digest !== digest) throw new Error('organization-conversation: operation-conflict')
        if (!previous) await handle.append([{ type: 'organization/model-selection-operation', seq: SessionSeq(rows.length),
          time: Date.now(), data: { operationId: request.operationId, digest } },
        { type: 'model/selection', seq: SessionSeq(rows.length + 1), time: Date.now(),
          data: { provider: request.selection.endpoint, model: request.selection.model } }]); await handle.flush()
      } finally { await handle.close() }
      await state.set({ ...state.get(), controls: controls() })
    }
    if (owner.assignment && request.kind === 'open') await this.seedAssignment(binding, bridge)
    if (request.kind === 'open-review') await this.seedReview(binding, bridge, request)
    const sameProject = (candidate: Binding['owner']) => preferenceKey(candidate) === preferenceKey(owner)
      && candidate.projectId === owner.projectId
    if (request.kind === 'bot-save') {
      const selection = request.bot.selection
      if ('provider' in selection) {
        if (selection.backend === 'codex') {
          if (selection.provider !== 'codex') throw new Error('organization-conversation: model-route-denied')
          const agents = this.ctx.get('agents')
          if (!agents) throw new Error('organization-conversation: common-runtime-required')
          await agents.driver('codex').resolve(selection.model, selection.reasoningEffort)
        } else {
          const llm = this.ctx.get('llm')
          if (!llm) throw new Error('organization-conversation: common-runtime-required')
          await llm.resolveModelInfo(selection.provider, selection.model)
        }
      } else if (!first.view.policy.models.some(model => model.model === selection.model && model.endpoint === selection.endpoint)
        || !this.config.models.some(model => model.model === selection.model && model.endpoint === selection.endpoint))
        throw new Error('organization-conversation: local-model-policy-denied')
      const data = navigation.get(), previous = data.operations.find(record => sameOperation(record))
      if (previous && (previous.digest !== digest || ownerKey(previous.owner) !== ownerKey(owner)))
        throw new Error('organization-conversation: operation-conflict')
      if (!previous) {
        const existing = data.bots.find(record => sameProject(record.owner) && record.bot.id === request.bot.id)
        if ((existing?.bot.version ?? 0) !== request.expectedVersion) throw new Error('organization-conversation: version-conflict')
        if (!existing && data.bots.filter(record => sameProject(record.owner)).length >= this.config.maxBots)
          throw new Error('organization-conversation: bot-limit')
        await navigation.set({ ...data, bots: [...data.bots.filter(record => record !== existing),
          { owner, bot: { ...request.bot, version: request.expectedVersion + 1 } }],
        operations: [...data.operations, { owner, operationId: request.operationId, digest }] })
      }
    }
    if (request.kind === 'open' && request.botId) {
      if (!navigation.get().bots.some(record => sameProject(record.owner) && record.bot.id === request.botId))
        throw new Error('organization-conversation: bot-unavailable')
      const previous = navigation.get().selections.find(record => ownerKey(record.owner) === ownerKey(owner))
      if (previous && previous.botId !== request.botId) throw new Error('organization-conversation: owner-mismatch')
      if (!previous) await navigation.set({ ...navigation.get(),
        selections: [...navigation.get().selections, { owner, botId: request.botId }] })
    }
    if (request.kind === 'settings' && !control) {
      const settings = this.settings(owner)
      if (settings.revision !== request.expectedRevision) throw new Error('organization-conversation: settings-conflict')
      const { serverId, accountId, organizationId } = owner
      await state.set({ ...state.get(), controls: controls(), preferences: [
        ...state.get().preferences.filter(p => preferenceKey({ ...owner, ...p.owner }) !== preferenceKey(owner)),
        { owner: { serverId, accountId, organizationId }, settings: { ...request.settings, revision: settings.revision + 1 } }] })
    }
    if (request.kind === 'suggest' && !control) {
      await this.checkHistory(binding, bridge)
      const events = await this.events(binding)
      const prior = events.filter(e => e.type === 'organization/planning-proposal').filter(e => e.data.command.goalId === request.goalId).at(-1)
      const inputEvent = events.filter(e => e.type === 'organization/planning-input').findLast(e => e.data.goalId === request.goalId)
      const plan = inputEvent?.data.authority.plan
      if (!prior && !plan) throw new Error('organization-conversation: goal-required')
      if (!events.some(e => e.type === 'organization/planning-proposal' && e.data.command.operationId === request.operationId)) {
        const source = prior?.data.command ?? planningDraftSchema.parse({ kind: 'save-planning-draft',
          organizationId: owner.organizationId, projectId: conversationProjectId(owner), conversationId: owner.conversationId,
          goalId: request.goalId, assessmentId: inputEvent?.data.request.operationId, settingsRevision: this.settings(owner).revision,
          planId: plan?.version.planId, definition: plan?.version.definition, expectedRevision: request.expectedRevision,
          operationId: request.operationId })
        const current = prior?.data.status === 'private' ? undefined : (await bridge({ kind: 'read-planning-plan',
          organizationId: owner.organizationId, projectId: conversationProjectId(owner), conversationId: owner.conversationId,
          planId: source.planId, taskId: source.definition.taskId })).plan
        const definition = current?.version.definition ?? source.definition
        if ((current?.version.revision ?? source.expectedRevision) !== request.expectedRevision) throw new Error('version-conflict')
        if (!definition.tasks.some(t => t.id === request.taskId)) throw new Error('organization-conversation: task-required')
        const command = planningDraftSchema.parse({ ...source, operationId: request.operationId, expectedRevision: request.expectedRevision,
          definition: { ...definition, tasks: definition.tasks.map(t => t.id === request.taskId
            ? { ...t, suggestedMembershipId: request.membershipId } : t) } })
        await checkPlanningMembers(command, bridge, definition)
        const status = current?.canEdit ? 'unknown' : 'private'
        await state.set({ ...state.get(), controls: controls() })
        await this.append(binding, 'organization/planning-proposal', { command, status })
        if (status === 'unknown') {
          try {
            const result = await bridge(command)
            await this.append(binding, 'organization/planning-proposal', { command, status: 'shared', receipt: result.receipt })
          } catch (error) {
            if (error instanceof Error && error.message.includes('version-conflict'))
              await this.append(binding, 'organization/planning-proposal', { command, status: 'conflict' })
            else throw error
          }
        }
      }
      if (!state.get().controls.some(sameOperation)) await state.set({ ...state.get(), controls: controls() })
    }
    if (request.kind === 'send') {
      if (binding.sharedSessionId) throw new Error('organization-conversation: use-common-session-prompt')
      if (!this.config.models.some(m => m.model === request.selection.model && m.endpoint === request.selection.endpoint))
        throw new Error('organization-conversation: local-model-policy-denied')
      let intent = state.get().intents.find(i => i.operationId === request.operationId
        && i.owner.serverId === owner.serverId && i.owner.accountId === owner.accountId)
      if (intent && (intent.digest !== digest || ownerKey(intent.owner) !== ownerKey(owner))) throw new Error('organization-conversation: operation-conflict')
      if (!intent) {
        const events = await this.events(binding), goals = this.goals(events)
        if (owner.assignment) goals.push({ id: conversationGoalSchema.parse(owner.assignment.assignmentId), classification: 'unassessed' })
        if (request.route === 'clarification' && !goals.some(g => g.id === request.goalId && g.classification === 'clarify'))
          throw new Error('organization-conversation: clarification-required')
        if (request.route !== 'new_goal' && !goals.some(g => g.id === request.goalId)) throw new Error('organization-conversation: goal-required')
        const selectedBot = navigation.get().selections.find(link => ownerKey(link.owner) === ownerKey(owner))?.botId
        const bot = navigation.get().bots.find(record => sameProject(record.owner) && record.bot.id === selectedBot)?.bot
        intent = { owner, operationId: request.operationId, digest, state: 'received', input: conversationInputSchema.parse({ request,
          goalId: request.goalId ?? randomUUID(), settings: this.settings(owner), authority: await bridge(),
          methodVersion: 'organization-planning/v2',
          ...(bot ? { bot } : {}) }) }
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
          if (!authority.view.eligible || authority.view.grant?.selection.model !== request.selection.model
            || authority.view.grant.selection.endpoint !== request.selection.endpoint) {
            const command = planningCommandSchema.parse({ kind: 'open-planning', operationId: randomUUID(), selection: request.selection,
              organizationId: owner.organizationId, projectId: conversationProjectId(owner), conversationId: owner.conversationId })
            await this.append(binding, 'organization/planning-operation', { command })
            authority = await bridge(command)
            await this.append(binding, 'organization/planning-operation', { command,
              ...(authority.receipt ? { receipt: authority.receipt } : {}) })
          }
          if (!authority.view.eligible || !authority.view.grant || authority.view.grant.selection.model !== request.selection.model
            || authority.view.grant.selection.endpoint !== request.selection.endpoint) throw new Error('organization-conversation: planning-permission-required')
          const link = authority.view.plans.find(p => p.goalId === intent.input.goalId)
          const previousInput = (await this.events(binding)).filter(e => e.type === 'organization/planning-input').findLast(e => e.data.goalId === intent.input.goalId)
          const target = authority.assignment ? { planId: authority.assignment.planId, taskId: authority.assignment.taskId } : request.target ?? (link ? { planId: link.planId, taskId: link.taskId } : previousInput?.data.request.kind === 'send' ? previousInput.data.request.target : undefined)
          if (target) authority = await bridge({ organizationId: owner.organizationId, projectId: conversationProjectId(owner), conversationId: owner.conversationId, ...target, kind: 'read-planning-plan' })
          const input = { ...intent.input, authority }
          await state.set({ ...state.get(), intents: state.get().intents.map(i => i.operationId === selected.operationId
            && ownerKey(i.owner) === ownerKey(owner) ? { ...i, input } : i) })
          combined.throwIfAborted()
          await this.checkHistory(binding, bridge)
          const runtimeBridge: ConversationBridge = async (command) => {
            const result = await bridge(command)
            await this.checkHistory(binding, bridge)
            return result
          }
          await runConversation(this.ctx, this.config.root, binding.sessionId, request, input, runtimeBridge,
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
    return this.report(binding, bridge, request.kind === 'bot-save')
  }
  private async removeProject(owner: Binding['owner']): Promise<void> {
    const state = this.state, navigation = this.navigation
    if (!state || !navigation) throw new Error('organization-conversation: unavailable')
    const matches = (candidate: Binding['owner']) => preferenceKey(candidate) === preferenceKey(owner)
      && candidate.projectId === owner.projectId
    const bindings = state.get().bindings.filter(row => matches(row.owner))
    await state.set({ ...state.get(), bindings: state.get().bindings.map(row => matches(row.owner) ? { ...row, deleted: true } : row),
      intents: state.get().intents.filter(row => !matches(row.owner)), controls: state.get().controls.filter(row => !matches(row.owner)) })
    await navigation.set({ ...navigation.get(), bots: navigation.get().bots.filter(row => !matches(row.owner)),
      metadata: navigation.get().metadata.filter(row => !matches(row.owner)),
      selections: navigation.get().selections.filter(row => !matches(row.owner)),
      operations: navigation.get().operations.filter(row => !matches(row.owner)) })
    for (const binding of bindings) await this.deleteBindingFiles(binding)
  }
  private async deleteBindingFiles(binding: Binding): Promise<void> {
    if (binding.sharedSessionId) {
      await this.shared?.detach(binding.sharedSessionId)
      const ids = new Set([binding.sharedSessionId, ...(binding.activeSessionId ? [binding.activeSessionId] : []),
        ...(this.shared?.identities(binding.sharedSessionId) ?? [])])
      for (const id of ids) await this.commonHost().controller.deleteSession(id)
    }
    if (await this.isolated.sessionPersistence.stat(binding.sessionId)) await this.isolated.sessionPersistence.delete(binding.sessionId)
  }
  private async append<T extends 'organization/planning-operation' | 'organization/planning-proposal'>(binding: Binding, type: T,
    data: import('@deepseek-ai/dsh-session').SessionEventMap[T]): Promise<void> {
    const activeId = binding.activeSessionId ?? binding.sharedSessionId
    const live = activeId ? this.commonHost().sessions.get(activeId) : undefined
    if (live) {
      if (type === 'organization/planning-proposal') live.append('organization/planning-proposal', conversationProposalSchema.parse(data))
      else live.append('organization/planning-operation', conversationOperationSchema.parse(data))
      if (!await this.commonHost().sessions.flush(live)) throw new Error('organization-conversation: log-not-durable')
      return
    }
    const persistence = binding.sharedSessionId ? this.commonHost().persistence : this.isolated.sessionPersistence
    const handle = await persistence.open(activeId ?? binding.sessionId, 'write')
    try {
      const read = await handle.read()
      const event = type === 'organization/planning-proposal'
        ? { type: 'organization/planning-proposal' as const, seq: SessionSeq(read.events.length), time: Date.now(), data: conversationProposalSchema.parse(data) }
        : { type: 'organization/planning-operation' as const, seq: SessionSeq(read.events.length), time: Date.now(), data: conversationOperationSchema.parse(data) }
      await handle.append([event]); await handle.flush()
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
  private async seedReview(binding: Binding, bridge: ConversationBridge,
    request: Extract<ConversationRequest, { kind: 'open-review' }>): Promise<void> {
    const delivery = (await bridge()).delivery
    if (!delivery || delivery.submission.id !== request.review.submissionId
      || delivery.assignment.id !== request.review.assignmentId) throw new Error('organization-conversation: submission-required')
    const { assignment, submission, artifacts } = delivery
    const target = { kind: 'read-planning-plan' as const, organizationId: binding.owner.organizationId,
      projectId: conversationProjectId(binding.owner), conversationId: binding.owner.conversationId,
      planId: assignment.planId, taskId: assignment.taskId }
    const plan = (await bridge(target)).plan
    const task = plan?.version.definition.tasks.find(item => item.id === assignment.taskId)
    if (!task) throw new Error('organization-conversation: task-required')
    const text = [task.goal, submission.summary, submission.target,
      ...artifacts.map(item => `${item.path} · ${item.description}`)].filter(Boolean).join('\n\n')
    const navigation = this.navigation
    if (!navigation) throw new Error('organization-conversation: unavailable')
    if (!navigation.get().metadata.some(item => ownerKey(item.owner) === ownerKey(binding.owner)))
      await navigation.set({ ...navigation.get(), metadata: [...navigation.get().metadata,
        { owner: binding.owner, title: `${task.goal} · ${submission.summary}`.slice(0, 120) }] })
    if ((await this.events(binding)).some(event => event.type === 'assistant/message'
      && event.data.message.source.provider === 'organization-delivery')) return
    const digest = createHash('sha256').update(JSON.stringify(target)).digest('hex')
    const handle = await this.isolated.sessionPersistence.open(binding.sessionId, 'write')
    try {
      const events = (await handle.read()).events
      await handle.append([{ type: 'organization/task-selection', seq: SessionSeq(events.length), time: Date.now(),
        data: { owner: binding.owner, target, operationId: request.operationId, digest } },
      { type: 'turn/start', seq: SessionSeq(events.length + 1), time: Date.now(), data: { turn: 1 } },
      { type: 'step/start', seq: SessionSeq(events.length + 2), time: Date.now(), data: { turn: 1, step: 1 } },
      { type: 'system/message', seq: SessionSeq(events.length + 3), time: Date.now(), surfaceOp: 'append',
        data: { turn: 1, step: 1, message: createSystemMessage('') } },
      { type: 'assistant/message', seq: SessionSeq(events.length + 4), time: Date.now(), surfaceOp: 'append',
        data: { turn: 1, step: 1, stream: [], message: createAssistantMessage({ content: [{ type: 'text', text }],
          source: { provider: 'organization-delivery', model: 'Agent' } }) } },
      { type: 'step/end', seq: SessionSeq(events.length + 5), time: Date.now(), data: { turn: 1, step: 1 } },
      { type: 'turn/end', seq: SessionSeq(events.length + 6), time: Date.now(), data: { turn: 1, reason: { kind: 'completed' } } }])
      await handle.flush()
    } finally { await handle.close() }

  }
  private async seedAssignment(binding: Binding, bridge: ConversationBridge): Promise<void> {
    if (!binding.owner.assignment) return
    const authority = await bridge()
    if (!authority.assignment) throw new Error('organization-conversation: assignment-required')
    const plan = (await bridge({ kind: 'read-planning-plan', organizationId: binding.owner.organizationId,
      projectId: conversationProjectId(binding.owner), conversationId: binding.owner.conversationId,
      planId: authority.assignment.planId, taskId: authority.assignment.taskId })).plan
    const task = plan?.version.definition.tasks.find(task => task.id === authority.assignment?.taskId)
    if (!task || !plan) throw new Error('organization-conversation: task-required')
    const handle = await this.isolated.sessionPersistence.open(binding.sessionId, 'write')
    try {
      const events = (await handle.read()).events
      if (events.some(event => event.type === 'assistant/message' && event.data.message.source.provider === 'organization-assignment')) return
      const text = [task.goal, task.scope, ...task.acceptance.map(item => `• ${item}`),
        ...task.artifacts.map(item => `• ${item}`)].filter(Boolean).join('\n\n')
      await handle.append([{ type: 'organization/assignment-context', seq: SessionSeq(events.length), time: Date.now(),
        data: { owner: binding.owner, assignment: authority.assignment, plan } },
      { type: 'turn/start', seq: SessionSeq(events.length + 1), time: Date.now(), data: { turn: 1 } },
      { type: 'step/start', seq: SessionSeq(events.length + 2), time: Date.now(), data: { turn: 1, step: 1 } },
      { type: 'system/message', seq: SessionSeq(events.length + 3), time: Date.now(), surfaceOp: 'append',
        data: { turn: 1, step: 1, message: createSystemMessage('') } },
      { type: 'assistant/message', seq: SessionSeq(events.length + 4), time: Date.now(), surfaceOp: 'append',
        data: { turn: 1, step: 1, stream: [], message: createAssistantMessage({ content: [{ type: 'text', text }],
          source: { provider: 'organization-assignment', model: 'Agent' } }) } },
      { type: 'step/end', seq: SessionSeq(events.length + 5), time: Date.now(), data: { turn: 1, step: 1 } },
      { type: 'turn/end', seq: SessionSeq(events.length + 6), time: Date.now(), data: { turn: 1, reason: { kind: 'completed' } } }])
      await handle.flush()
    } finally { await handle.close() }
  }
  private async events(binding: Binding): Promise<readonly SessionEvent[]> {
    if (binding.sharedSessionId) {
      const activeId = binding.activeSessionId ?? binding.sharedSessionId
      const live = this.commonHost().sessions.get(activeId)
      // oxlint-disable-next-line typescript/no-deprecated -- Native account reports borrow the ordinary live Session prefix.
      if (live) return live.snapshotEvents()
      if (await this.commonHost().persistence.stat(activeId)) {
        const reader = await this.commonHost().persistence.open(activeId, 'read')
        try { return (await reader.read()).events } finally { await reader.close() }
      }
    }
    return this.legacyEvents(binding)
  }
  private async legacyEvents(binding: Binding): Promise<readonly SessionEvent[]> {
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
  private async checkHistory(binding: Binding, bridge: ConversationBridge): Promise<void> {
    const targets = new Map<string, { planId: import('@deepseek-ai/dsh-organization').OrganizationPlanId
      taskId: import('@deepseek-ai/dsh-organization').OrganizationTaskId }>()
    for (const event of await this.events(binding)) {
      if (event.type === 'organization/task-selection') targets.set(event.data.target.taskId, event.data.target)
      if (event.type === 'organization/assignment-context') targets.set(event.data.assignment.id,
        { planId: event.data.assignment.planId, taskId: event.data.assignment.taskId })
      if (event.type === 'organization/planning-input' && event.data.authority.plan) {
        const v = event.data.authority.plan.version
        targets.set(`${v.planId}:${v.definition.taskId}`, { planId: v.planId, taskId: v.definition.taskId })
      }
      if (event.type === 'organization/planning-proposal' && event.data.status === 'shared') {
        const p = event.data.command
        targets.set(`${p.planId}:${p.definition.taskId}`, { planId: p.planId, taskId: p.definition.taskId })
      }
    }
    for (const target of targets.values()) await bridge({ kind: 'read-planning-plan',
      organizationId: binding.owner.organizationId, projectId: conversationProjectId(binding.owner),
      conversationId: binding.owner.conversationId, ...target })
  }
  private goals(events: readonly SessionEvent[]): ConversationResult['goals'] {
    const goals = new Map<string, ConversationResult['goals'][number]>()
    for (const e of events) {
      if (e.type === 'organization/task-selection') {
        const id = conversationGoalSchema.parse(e.data.target.taskId)
        const goal = goals.get(id) ?? { id, classification: 'unassessed' as const }
        goals.delete(id); goals.set(id, goal)
      }
      if (e.type === 'organization/assignment-context') goals.set(conversationGoalSchema.parse(e.data.assignment.id), {
        id: conversationGoalSchema.parse(e.data.assignment.id), classification: 'unassessed', proposal: { status: 'shared',
          planId: e.data.plan.version.planId, revision: e.data.plan.version.revision, definition: e.data.plan.version.definition } })
      if (e.type === 'organization/planning-input') {
        const plan = e.data.authority.plan
        goals.set(e.data.goalId, goals.get(e.data.goalId) ?? { id: e.data.goalId, classification: 'unassessed',
          ...(plan ? { proposal: { status: 'shared', planId: plan.version.planId, revision: plan.version.revision, definition: plan.version.definition } } : {}) })
      }
      if (e.type === 'organization/planning-assessment') goals.set(e.data.goalId, { ...goals.get(e.data.goalId), id: e.data.goalId,
        classification: e.data.classification })
    }
    for (const e of events) if (e.type === 'organization/planning-proposal') {
      const p = e.data, goal = goals.get(p.command.goalId)
      if (goal) goal.proposal = { status: p.status, definition: p.command.definition, planId: p.command.planId,
        revision: p.receipt?.planning.planRevision ?? p.command.expectedRevision }
    }
    return [...goals.values()]
  }
  private async report(binding: Binding, bridge: ConversationBridge, navigationOnly = false): Promise<ConversationResult> {
    const events = navigationOnly ? [] : await this.events(binding), entries: ConversationResult['entries'] = []
    for (const e of events) {
      if (!binding.sharedSessionId && e.type === 'organization/planning-input' && e.data.request.kind === 'send') entries.push({ role: 'user',
        text: e.data.request.text })
      if (binding.sharedSessionId && e.type === 'user/message' && e.data.source.kind === 'user') entries.push({ role: 'user',
        text: e.data.content.filter(part => part.type === 'text').map(part => part.text).join('\n') })
      if (e.type === 'assistant/message') entries.push({ role: 'assistant',
        text: e.data.message.content.filter(b => b.type === 'text').map(b => b.text).join('') })
    }
    const intent = this.state?.get().intents.filter(i => ownerKey(i.owner) === ownerKey(binding.owner)).at(-1)
    let inputText = ''
    const history = events.map((event): SessionEvent => {
      if (event.type === 'organization/planning-input' && event.data.request.kind === 'send') inputText = event.data.request.text
      if (!binding.sharedSessionId && event.type === 'user/message') return { ...event, data: { ...event.data, content: [{ type: 'text', text: inputText }] } }
      return event
    })
    const selection = events.findLast(event => event.type === 'model/selection')
    const title = this.navigation?.get().metadata.find(row => ownerKey(row.owner) === ownerKey(binding.owner))?.title
    const result: ConversationResult = { history,
      ...(binding.sharedSessionId ? { running: this.commonHost().agents.get(binding.activeSessionId ?? binding.sharedSessionId)?.status === 'running' } : {}),
      ...(binding.sharedSessionId ? { sharedSessionId: binding.activeSessionId ?? binding.sharedSessionId } : {}),
      ...(title ? { title } : {}),
      ...(!binding.sharedSessionId && selection?.type === 'model/selection' ? { selection: { endpoint: selection.data.provider,
        model: selection.data.model } } : {}), sessionId: binding.sessionId, owner: binding.owner, settings: this.settings(binding.owner),
      entries, goals: this.goals(events), truncated: false,
      state: !intent ? 'ready' : intent.state === 'sending' || intent.state === 'received' ? 'unknown' : intent.state }
    if (navigationOnly) { result.entries = []; result.history = []; result.goals = []; await bridge() }
    else {
      try { await this.checkHistory(binding, bridge) }
      catch (_error) {
        await bridge()
        result.entries = []; result.history = []
        for (const goal of result.goals) if (goal.proposal) goal.proposal = { status: 'unavailable', planId: goal.proposal.planId, revision: 0 }
        return conversationResultSchema.parse(result)
      }
      const authority = await bridge()
      if (authority.assignment) {
        result.assignment = authority.assignment
        const id = conversationGoalSchema.parse(authority.assignment.id)
        if (!result.goals.some(g => g.id === id)) result.goals.push({ id, classification: 'unassessed' })
      }
      const selected = events.findLast(event => event.type === 'organization/task-selection')
      const target = authority.assignment ? { planId: authority.assignment.planId, taskId: authority.assignment.taskId }
        : selected?.type === 'organization/task-selection' ? selected.data.target : undefined
      if (target) {
        const plan = (await bridge({ kind: 'read-planning-plan', organizationId: binding.owner.organizationId,
          projectId: conversationProjectId(binding.owner), conversationId: binding.owner.conversationId, ...target })).plan
        const task = plan?.version.definition.tasks.find(task => task.id === target.taskId)
        if (task) result.execution = { target: { planId: target.planId, taskId: target.taskId }, title: task.goal }
      }
      for (const goal of result.goals) {
        const proposal = goal.proposal, link = authority.assignment
          ? { planId: authority.assignment.planId, taskId: authority.assignment.taskId }
          : authority.view.plans.find(p => p.goalId === goal.id)
        ?? (proposal?.status === 'shared' && proposal.definition ? { planId: proposal.planId, taskId: proposal.definition.taskId } : undefined)
        if (!link) continue
        try {
          const current = await bridge({ organizationId: binding.owner.organizationId, projectId: conversationProjectId(binding.owner), conversationId: binding.owner.conversationId, planId: link.planId, taskId: link.taskId, kind: 'read-planning-plan' })
          if (!current.plan) throw new Error('organization-conversation: missing-plan')
          // Conflicting personal changes remain private and never replace the current shared version.
          if (proposal?.status !== 'conflict' && proposal?.status !== 'private') goal.proposal = { status: 'shared', planId: link.planId,
            revision: current.plan.version.revision, definition: current.plan.version.definition }
        } catch (_error) {
          await bridge()
          result.entries = []; result.history = []
          goal.proposal = { status: 'unavailable', planId: link.planId, revision: 0 }
        }
      }
    }
    if (!binding.owner.assignment && this.navigation && this.state) {
      const owner = binding.owner, sameProject = (candidate: Binding['owner']) => preferenceKey(candidate) === preferenceKey(owner)
        && candidate.projectId === owner.projectId
      const conversations: NonNullable<ConversationResult['catalog']>['conversations'] = []
      for (const row of this.state.get().bindings.filter(row => row.ready && !row.deleted && sameProject(row.owner))
        .sort((a, b) => b.createdAt - a.createdAt).slice(0, this.config.maxCatalogItems)) {
        const rowEvents = await this.events(row)
        if (row.owner.assignment) {
          const context = rowEvents.find(event => event.type === 'organization/assignment-context')
          if (context?.type !== 'organization/assignment-context') continue
          try {
            await bridge({ kind: 'read-planning-plan', organizationId: owner.organizationId, projectId: conversationProjectId(owner),
              conversationId: owner.conversationId, planId: context.data.assignment.planId, taskId: context.data.assignment.taskId })
          } catch (_error: unknown) { await bridge(); continue }
        }
        const input = rowEvents.find(e => e.type === 'organization/planning-input' && e.data.request.kind === 'send')
        const storedTitle = this.navigation.get().metadata.find(meta => ownerKey(meta.owner) === ownerKey(row.owner))?.title
        const sessionTitle = rowEvents.findLast(event => event.type === 'session/title')
        const firstMessage = rowEvents.find(event => event.type === 'user/message' && event.data.source.kind === 'user')
        const ordinaryTitle = !row.sharedSessionId ? undefined : sessionTitle?.type === 'session/title' ? sessionTitle.data.title
          : firstMessage?.type === 'user/message' ? firstMessage.data.content.filter(part => part.type === 'text').map(part => part.text).join('').slice(0, 120) : undefined
        const title = storedTitle ?? ordinaryTitle?.slice(0, 120) ?? (input?.type === 'organization/planning-input' && input.data.request.kind === 'send'
          ? input.data.request.text.slice(0,
            120) : row.owner.assignment ? (await this.events(row)).find(e => e.type === 'assistant/message')?.data.message.content.filter(b => b.type === 'text').map(b => b.text).join('').slice(0, 120) ?? '' : '')
        if (!title && String(row.owner.conversationId) === String(row.owner.projectId ?? row.owner.organizationId)) continue
        const botId = this.navigation.get().selections.find(link => ownerKey(link.owner) === ownerKey(row.owner))?.botId
        conversations.push({ conversationId: row.owner.conversationId, title, createdAt: row.createdAt,
          ...(botId ? { botId } : {}), ...(row.owner.assignment ? { assignment: row.owner.assignment } : {}) })
      }
      result.catalog = { conversations, bots: this.navigation.get().bots.filter(row => sameProject(row.owner)).map(row => row.bot) }
    }
    while (result.history.length && Buffer.byteLength(JSON.stringify(result)) > this.config.maxReportBytes) {
      result.history.shift(); result.truncated = true
    }
    while (entries.length && Buffer.byteLength(JSON.stringify(result)) > this.config.maxReportBytes) {
      entries.shift(); result.truncated = true
    }
    while (result.catalog?.conversations.length && Buffer.byteLength(JSON.stringify(result)) > this.config.maxReportBytes)
      result.catalog.conversations.pop()
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
          conversationId: input.request.conversationId,
          ...(input.request.assignment ? { assignment: input.request.assignment } : {}) }) !== ownerKey(intent.owner))
        throw new Error('organization-conversation: input-intent-mismatch')
      operations.add(key)
    }
    for (const b of this.state.get().bindings) {
      if (owners.has(ownerKey(b.owner)) || sessions.has(b.sessionId)) throw new Error('organization-conversation: duplicate-binding')
      owners.add(ownerKey(b.owner)); sessions.add(b.sessionId)
      if (!b.deleted && (b.ready || await this.isolated.sessionPersistence.stat(b.sessionId))) {
        const events = await this.legacyEvents(b)
        if (events.filter(e => e.type === 'organization/conversation-owner').length !== 1)
          throw new Error('organization-conversation: binding-log-mismatch')
        for (const event of events) {
          if (event.type === 'organization/planning-input') {
            const input = conversationInputSchema.parse(event.data)
            const intent = this.state.get().intents.find(i => ownerKey(i.owner) === ownerKey(b.owner)
              && i.operationId === input.request.operationId)
            if (!intent || JSON.stringify(input) !== JSON.stringify(intent.input)
              || input.authority.serverId !== b.owner.serverId || input.authority.accountId !== b.owner.accountId
              || input.authority.view.project?.id !== b.owner.projectId
              || input.authority.view.project?.organizationId !== b.owner.organizationId)
              throw new Error('organization-conversation: input-log-mismatch')
          }
          if (event.type === 'organization/planning-proposal') {
            const p = conversationProposalSchema.parse(event.data), command = p.command
            if (command.organizationId !== b.owner.organizationId || command.projectId !== b.owner.projectId
              || command.conversationId !== b.owner.conversationId
              || !events.some(e => e.seq < event.seq && e.type === 'organization/planning-input' && e.data.goalId === command.goalId)
              || p.receipt && (p.receipt.operationId !== command.operationId || p.receipt.planning.planId !== command.planId
                || p.receipt.planning.taskId !== command.definition.taskId
                || p.receipt.planning.planRevision !== command.expectedRevision + 1))
              throw new Error('organization-conversation: proposal-log-mismatch')
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
    if (!this.navigation) throw new Error('organization-conversation: navigation-unavailable')
    const bots = new Set<string>(), links = new Set<string>(), mutations = new Set<string>()
    const botKey = (owner: Binding['owner'], id: string) => JSON.stringify([preferenceKey(owner), owner.projectId, id])
    for (const record of this.navigation.get().bots) {
      const key = botKey(record.owner, record.bot.id)
      if (bots.has(key) || !owners.has(ownerKey(record.owner)) || record.owner.assignment || record.bot.version < 1)
        throw new Error('organization-conversation: bot-record-mismatch')
      bots.add(key)
    }
    for (const record of this.navigation.get().selections) {
      const key = ownerKey(record.owner)
      if (links.has(key) || !owners.has(key) || record.owner.assignment || !bots.has(botKey(record.owner, record.botId)))
        throw new Error('organization-conversation: bot-binding-mismatch')
      links.add(key)
    }
    for (const record of this.navigation.get().operations) {
      const key = JSON.stringify([record.owner.serverId, record.owner.accountId, record.operationId])
      if (mutations.has(key) || !owners.has(ownerKey(record.owner))) throw new Error('organization-conversation: bot-operation-mismatch')
      mutations.add(key)
    }
    const preferences = new Set<string>()
    for (const preference of this.state.get().preferences) {
      const key = JSON.stringify([preference.owner.serverId, preference.owner.accountId, preference.owner.organizationId])
      if (preferences.has(key)) throw new Error('organization-conversation: duplicate-preference')
      preferences.add(key)
    }
    for (const h of await this.isolated.sessionPersistence.list()) if (!sessions.has(h.header.id)) throw new Error('organization-conversation: orphan-log')
  }
}
