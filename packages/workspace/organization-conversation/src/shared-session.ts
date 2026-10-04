/** Organization ownership and task facts on the ordinary Desktop Session runtime. */
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-personal-workflow'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { conversationProjectId, conversationInputSchema, conversationAssessmentSchema, conversationGoalSchema } from './protocol.ts'
import type { ConversationAuthority, ConversationBridge, ConversationResult, conversationBotSchema } from './protocol.ts'
import type { conversationBindingSchema } from './state.ts'
import type { z } from 'zod'
import { installProposal, planningProjection } from './proposal.ts'

type Binding = z.output<typeof conversationBindingSchema>
type Settings = ConversationResult['settings']
interface Attachment {
  binding: Binding
  bridge: ConversationBridge
  cancel: AbortController
  done: Promise<void>
  token: Extract<import('./protocol.ts').ConversationRequest, { kind: 'detach' }>['attachmentId']
  stopTools: Map<SessionId, (() => void | Promise<void>)[]>
}

/** Native authority contributes account data; Agent composition and transport remain shared. */
export class SharedConversationSessions {
  private readonly attached = new Map<SessionId, Attachment>()
  private readonly requests = new Map<SessionId, number>()
  private readonly parents = new Map<SessionId, SessionId>()
  /**
   * @param ctx - Ordinary Desktop Host, including its standard Session Controller and presets.
   * @param bindings - Durable account reservations, including deliberately deleted conversations.
   * @param settings - Current account planning preference.
   * @param bot - Current Bot instructions from the account partition.
   * @param recheckMs - Deployment interval for authority-loss cancellation.
   */
  constructor(private readonly ctx: Context, private readonly bindings: () => readonly Binding[],
    private readonly settings: (binding: Binding) => Settings,
    private readonly bot: (binding: Binding) => z.output<typeof conversationBotSchema> | undefined, private readonly recheckMs: number) {
    ctx.on('session/created', (session) => { if (session.header.parentSession) this.parents.set(session.id, session.header.parentSession) })
    const initialized = (async () => {
      for (const row of await ctx.sessionPersistence.list()) {
        if (row.header.parentSession) this.parents.set(row.header.id, row.header.parentSession)
      }
      for (const binding of this.bindings()) {
        if (!binding.deleted && binding.activeSessionId
          && (this.root(binding.activeSessionId) !== binding.sharedSessionId
            || !await ctx.sessionPersistence.stat(binding.activeSessionId)))
          throw new Error('organization-conversation: common-successor-mismatch')
        if (!binding.sharedSessionId || binding.deleted || !await ctx.sessionPersistence.stat(binding.sharedSessionId)) continue
        await using reader = await ctx.sessionPersistence.open(binding.sharedSessionId, 'read')
        const events = (await reader.read()).events
        const owners = events.filter(event => event.type === 'organization/conversation-owner')
        if (owners.length !== 1 || JSON.stringify(owners[0]?.data) !== JSON.stringify(binding.owner))
          throw new Error('organization-conversation: common-owner-mismatch')
      }
    })()
    void initialized.catch((error: unknown) => { ctx.logger.error('organization-conversation: account initialization failed', error) })
    ctx.effect(() => ctx.sessionQuery.registerAccessPolicy({
      prepare: () => initialized,
      visible: id => !this.owns(id),
      authorize: async (id) => { if (this.owns(id)) await this.authorize(id) },
    }), 'organization-conversation.account-access')
    ctx.effect(() => ctx.sessionProjections.register(planningProjection), 'organization-conversation.shared-projection')
    ctx.effect(() => ctx.personalWorkflow.registerSessionAdapter({
      owns: id => this.owns(id),
      allowsTool: (session, tool) => tool === 'workflow_complete' ? false
        : tool === 'workflow_assess' || tool === 'workflow_propose'
          ? !!this.require(session.id).binding.owner.projectId && this.settings(this.require(session.id).binding).enabled : true,
      prepare: (agent, decision, signal) => this.prepare(agent, decision, signal),
    }), 'organization-conversation.task-method')
    ctx.on('agent/created', async ({ agent }) => { if (this.owns(agent.id)) await this.installTools(agent) })
    ctx.on('tools/pre-execute', async (request, next) => {
      if (request.agent && this.owns(request.agent.id)) await this.authorize(request.agent.id)
      return next()
    })
    ctx.effect(() => async () => {
      await this.close()
    }, 'organization-conversation.shared-close')
  }
  /**
   * Close native account lifetimes and drain their ordinary Agents.
   * @returns Settlement after all account attachments close.
   */
  async close(): Promise<void> {
    const attachments = [...this.attached.values()]
    for (const attachment of attachments) attachment.cancel.abort()
    await Promise.all(attachments.map(attachment => attachment.done))
  }
  /**
   * Enumerate a conversation's persisted and live successors for deletion.
   * @param id - Durable root alias.
   * @returns Root and all known derived identities.
   */
  identities(id: SessionId): readonly SessionId[] {
    return [id, ...this.parents.keys()].filter((candidate, index, rows) => rows.indexOf(candidate) === index && this.root(candidate) === id)
  }
  private root(id: SessionId): SessionId | undefined {
    const seen = new Set<SessionId>()
    let candidate: SessionId | undefined = id
    while (candidate && !seen.has(candidate)) {
      seen.add(candidate)
      if (this.bindings().some(binding => binding.sharedSessionId === candidate)) return candidate
      candidate = this.ctx.sessions.get(candidate)?.header.parentSession ?? this.parents.get(candidate)
    }
    return undefined
  }
  private owns(id: SessionId): boolean { return this.root(id) !== undefined }
  private require(id: SessionId): Attachment {
    const root = this.root(id), attachment = root ? this.attached.get(root) : undefined
    if (!attachment || attachment.cancel.signal.aborted || this.bindings().find(binding => binding.sharedSessionId === root)?.deleted)
      throw new Error('organization-conversation: account-not-active')
    return attachment
  }
  private async authorize(id: SessionId): Promise<ConversationAuthority> {
    const attachment = this.require(id), authority = await attachment.bridge()
    if (this.require(id) !== attachment) throw new Error('organization-conversation: superseded')
    const owner = attachment.binding.owner
    if (authority.accountId !== owner.accountId || authority.serverId !== owner.serverId
      || authority.view.project?.id !== owner.projectId
      || authority.view.project && authority.view.project.organizationId !== owner.organizationId)
      throw new Error('organization-conversation: owner-mismatch')
    attachment.cancel.signal.throwIfAborted()
    const session = this.ctx.sessions.get(id)
    {
      // oxlint-disable-next-line typescript/no-deprecated -- Authorization inspects the live account task references.
      const events = session ? session.snapshotEvents() : await this.history(id)
      const targets = new Map<string, { planId: NonNullable<ConversationResult['execution']>['target']['planId']; taskId: NonNullable<ConversationResult['execution']>['target']['taskId'] }>()
      for (const event of events) {
        if (event.type === 'organization/task-selection') targets.set(event.data.target.taskId, event.data.target)
        if (event.type === 'organization/assignment-context') targets.set(event.data.assignment.taskId,
          { planId: event.data.assignment.planId, taskId: event.data.assignment.taskId })
        if (event.type === 'organization/planning-input' && event.data.authority.plan) {
          const plan = event.data.authority.plan.version
          targets.set(plan.definition.taskId, { planId: plan.planId, taskId: plan.definition.taskId })
        }
      }
      for (const target of targets.values()) await attachment.bridge({ kind: 'read-planning-plan',
        organizationId: owner.organizationId, projectId: conversationProjectId(owner), conversationId: owner.conversationId, ...target })
      attachment.cancel.signal.throwIfAborted()
    }
    return authority
  }
  private async history(id: SessionId): Promise<readonly SessionEvent[]> {
    if (!await this.ctx.sessionPersistence.stat(id)) return []
    await using reader = await this.ctx.sessionPersistence.open(id, 'read')
    return (await reader.read()).events
  }
  /**
   * Keep native account authorization alive while ordinary Session APIs serve the conversation.
   * @param binding - Durably reserved common Session identity.
   * @param events - Validated historical account events, imported once.
   * @param bridge - Native, current-account online authorization.
   * @param token - Exact native attachment identity; stale detaches cannot close its replacement.
   * @param signal - Native account/window lifetime.
   * @param ready - Publishes completion of ordinary Agent adoption without submitting input.
   * @returns Settlement after the account lifetime stops and the ordinary Agent drains.
   */
  async attach(binding: Binding, events: readonly SessionEvent[], bridge: ConversationBridge,
    token: Attachment['token'], signal: AbortSignal, ready: () => Promise<void>): Promise<void> {
    const id = binding.sharedSessionId, activeId = binding.activeSessionId ?? id
    if (!id || !activeId) throw new Error('organization-conversation: shared-session-required')
    const revision = (this.requests.get(id) ?? 0) + 1
    this.requests.set(id, revision)
    await this.detach(id)
    signal.throwIfAborted()
    if (this.requests.get(id) !== revision) throw new Error('organization-conversation: superseded')
    const cancel = new AbortController(), stop = () => { cancel.abort(signal.reason) }
    signal.addEventListener('abort', stop, { once: true })
    const settled = Promise.withResolvers<void>()
    const attachment: Attachment = { binding, bridge, cancel, done: settled.promise, token, stopTools: new Map() }
    this.attached.set(id, attachment)
    let agent: Agent | undefined, timer: ReturnType<typeof setTimeout> | undefined
    let checking: Promise<void> = Promise.resolve()
    const check = () => {
      checking = this.authorize(id).then(() => {}).catch((error: unknown) => { cancel.abort(error) }).then(() => {
        if (!cancel.signal.aborted) timer = setTimeout(check, this.recheckMs)
      })
    }
    try {
      await this.authorize(id)
      agent = await this.ctx.sessionController.importSession(activeId, process.cwd(), events)
      const ordinary = agent
      const stopAgent = () => { ordinary.cancel({ kind: 'user' }) }
      cancel.signal.addEventListener('abort', stopAgent, { once: true })
      const stopRequest = ordinary.ctx.on('agent/request', async (_request, next) => { await this.authorize(activeId); return next() })
      try {
        cancel.signal.throwIfAborted()
        // oxlint-disable-next-line typescript/no-deprecated -- A persisted explicit choice takes precedence over Bot and account defaults.
        const hasSelection = ordinary.session.snapshotEvents().some(event => event.type === 'model/selection')
        if (ordinary.options.backend === undefined && !hasSelection
          && (!ordinary.session.requestHeader() || ordinary.session.requestHeader()?.config.provider === 'organization-planning')) {
          const botSelection = this.bot(binding)?.selection
          const selection = botSelection && 'provider' in botSelection ? botSelection : this.ctx.agentDefaultModel.currentSelection()
          await this.ctx.sessionController.selectModel({ sessionId: activeId, provider: selection.provider, model: selection.model,
            ...('backend' in selection && selection.backend !== undefined ? { backend: selection.backend } : {}),
            ...(selection.reasoningEffort === undefined ? {} : { reasoningEffort: selection.reasoningEffort }) })
        }
        await ready()
        timer = setTimeout(check, this.recheckMs)
        await new Promise<void>((resolve) => {
          if (cancel.signal.aborted) resolve()
          else cancel.signal.addEventListener('abort', () => { resolve() }, { once: true })
        })
      } finally { stopRequest(); cancel.signal.removeEventListener('abort', stopAgent) }
    } finally {
      cancel.abort(); clearTimeout(timer)
      signal.removeEventListener('abort', stop)
      try {
        const agents = this.ctx.agents.list().filter(candidate => this.root(candidate.id) === id)
        for (const ordinary of agents) ordinary.cancel({ kind: 'user' })
        await Promise.all(agents.map(ordinary => ordinary.whenIdle())); await checking
        for (const disposers of attachment.stopTools.values()) for (const dispose of disposers) await dispose()
        for (const ordinary of agents) await this.ctx.sessionController.releaseSession(ordinary.id)
      } finally {
        if (this.attached.get(id) === attachment) this.attached.delete(id)
        settled.resolve()
      }
    }
  }
  /**
   * Retire the matching native account attachment.
   * @param id - Common Session identity.
   * @param token - Exact attachment to retire; omission retires the current owner.
   * @returns Settlement after the matching attachment drains.
   */
  async detach(id: SessionId, token?: Attachment['token']): Promise<void> {
    const attachment = this.attached.get(id)
    if (!attachment || token !== undefined && attachment.token !== token) return
    attachment.cancel.abort()
    await attachment.done
  }
  private input(agent: Agent) {
    // oxlint-disable-next-line typescript/no-deprecated -- Scoped tools use the current durable account input.
    const input = agent.session.snapshotEvents().findLast(event => event.type === 'organization/planning-input')
    if (input?.type !== 'organization/planning-input') throw new Error('organization-conversation: input-required')
    if (input.data.settings.revision !== this.settings(this.require(agent.id).binding).revision)
      throw new Error('organization-conversation: settings-conflict')
    return input.data
  }
  private async installTools(agent: Agent): Promise<void> {
    const attachment = this.require(agent.id), scoped = agent.ctx
    if (!attachment.binding.owner.projectId) return
    const disposers: (() => void | Promise<void>)[] = []
    attachment.stopTools.set(agent.id, disposers)
    disposers.push(scoped.tools.register(defineTool({ name: 'workflow_assess',
      description: 'Assess the current goal as simple, clarify, infeasible or complex before proposing organization tasks.',
      parameters: { classification: { type: 'string', enum: ['simple', 'clarify', 'infeasible', 'complex'], required: true },
        rationale: { type: 'string', required: true } },
      output: { schema: { type: 'string' }, render: (_args, text) => [{ type: 'text', text }] },
      execute: async (args) => {
        await this.authorize(agent.id)
        const input = this.input(agent)
        if (!input.settings.enabled) throw new Error('organization-conversation: planning-disabled')
        const assessment = conversationAssessmentSchema.parse({ ...args, goalId: input.goalId, operationId: input.request.operationId })
        agent.session.append('organization/planning-assessment', assessment)
        if (!await this.ctx.sessions.flush(agent.session)) throw new Error('organization-conversation: log-not-durable')
        return JSON.stringify(assessment)
      },
    })))
    const bridge: ConversationBridge = async (command) => { await this.authorize(agent.id); return this.require(agent.id).bridge(command) }
    const fork = scoped.plugin((child: Context) => {
      installProposal(child, agent, () => this.input(agent), bridge, attachment.cancel.signal)
    })
    await fork
    disposers.push(() => fork.dispose())
    disposers.push(scoped.tools.register(defineTool({ name: 'planning_members',
      description: 'Search currently visible project members. Membership alone grants no task permission or assignment.',
      parameters: { search: { type: 'string', required: true }, offset: { type: 'integer', required: true } },
      output: { schema: { type: 'string' }, render: (_args, text) => [{ type: 'text', text }] },
      execute: async args => JSON.stringify((await bridge({ kind: 'read-planning-members',
        organizationId: attachment.binding.owner.organizationId, projectId: conversationProjectId(attachment.binding.owner),
        conversationId: attachment.binding.owner.conversationId, search: args.search, offset: args.offset })).candidates),
    })))
  }
  private async prepare(agent: Agent, decision: PreStepDecision, signal: AbortSignal): Promise<PreStepDecision> {
    const authority = await this.authorize(agent.id), attachment = this.require(agent.id)
    if (decision.kind === 'reject' || !attachment.binding.owner.projectId) return decision
    const user = decision.messages.find(message => message.source.kind === 'user')
    if (!user) return decision
    const { binding, bridge } = attachment, owner = binding.owner
    // oxlint-disable-next-line typescript/no-deprecated -- Account routing reads the ordinary live Session prefix.
    const events = agent.session.snapshotEvents()
    const selected = events.findLast(event => event.type === 'organization/task-selection')
    const target = authority.assignment ? { planId: authority.assignment.planId, taskId: authority.assignment.taskId }
      : selected?.type === 'organization/task-selection' ? { planId: selected.data.target.planId, taskId: selected.data.target.taskId } : undefined
    const plan = target ? (await bridge({ kind: 'read-planning-plan', organizationId: owner.organizationId,
      projectId: conversationProjectId(owner), conversationId: owner.conversationId, ...target })).plan : undefined
    signal.throwIfAborted()
    if (target && !plan) throw new Error('organization-conversation: task-unavailable')
    const prior = events.findLast(event => event.type === 'organization/planning-input')
    const goalId = conversationGoalSchema.parse(authority.assignment?.id ?? target?.taskId
      ?? (prior?.type === 'organization/planning-input' ? prior.data.goalId : randomUUID()))
    const settings = this.settings(binding), bot = this.bot(binding)
    const input = conversationInputSchema.parse({ goalId, settings, ...(bot ? { bot } : {}),
      authority: { ...authority, ...(plan ? { plan } : {}) },
      methodVersion: 'organization-planning/v2', request: { kind: 'send', organizationId: owner.organizationId,
        projectId: conversationProjectId(owner), conversationId: owner.conversationId, operationId: randomUUID(),
        ...(owner.assignment ? { assignment: owner.assignment } : {}), ...(target || prior ? { goalId } : {}),
        route: target ? 'query' : prior ? 'modify' : 'new_goal',
        ...(target ? { target } : {}), selection: { endpoint: authority.view.policy.models[0]?.endpoint,
          model: authority.view.policy.models[0]?.model },
        text: user.content.filter(part => part.type === 'text').map(part => part.text).join('\n') || '[attachment input]' } })
    agent.session.append('organization/planning-input', input)
    if (!await this.ctx.sessions.flush(agent.session)) throw new Error('organization-conversation: log-not-durable')
    const method = target
      ? 'The user selected this organization task for execution. Work on its stated goal, scope and acceptance criteria using the ordinary available capabilities and user permissions. Task selection does not authorize unrelated organization changes, assignment or delivery acceptance. Shared task reads and changes require current organization permissions.'
      : settings.enabled ? 'Discuss this goal with the user. Assess complexity with workflow_assess; clarify missing requirements and propose an unapproved organization plan with workflow_propose when the goal is complex. Shared task definitions contain task summaries and authorized facts, never private conversation transcripts.'
        : 'Provide ordinary assistance. Automatic task planning is disabled.'
    return { ...decision, messages: [...decision.messages, createUserMessage({ source: { kind: 'organization-task-context' },
      content: [{ type: 'text', text: JSON.stringify({ method, settings, goalId, ...(bot ? { bot: { name: bot.name, instructions: bot.instructions } } : {}),
        project: authority.view.project, ...(plan ? { task: plan } : {}) }) }] })] }
  }
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** Account-owned task facts supplied through the ordinary Agent pre-step pipeline. */
    'organization-task-context': { kind: 'organization-task-context' }
  }
}
