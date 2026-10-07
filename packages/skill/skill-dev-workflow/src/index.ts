/** Bundled managed method and mode-gated model adapters. */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-personal-workflow'
import type {} from '@deepseek-ai/dsh-personal-project'
import type {} from '@deepseek-ai/dsh-session-persistence'
import { BUNDLED_SKILL_RANK, type SkillCandidate, renderSkillContent } from '@deepseek-ai/dsh-skill'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { createUserMessage } from '@deepseek-ai/dsh-llm'

const bodyURL = new URL('../assets/SKILL.md', import.meta.url)
const candidate: SkillCandidate = {
  name: 'dev-workflow', description: 'Managed task enhancement, automatically assesses new goals under the user’s planning preferences.',
  invocation: { modelInvocable: false, userInvocable: false }, provider: 'dev-workflow', source: 'bundled',
  rank: BUNDLED_SKILL_RANK, locator: bodyURL,
  resourceBase: { kind: 'directory', path: fileURLToPath(new URL('../assets/', import.meta.url)) },
}

/** Cordis plugin identity. */
export const name = 'skill-dev-workflow'
/** Services used by managed mode and model operations. */
export const inject = ['skills', 'agents', 'tools', 'personalWorkflow', 'personalProjects', 'sessionPersistence']

/** Register the bundled method, logged context and guarded proposal tools.
 * @param ctx - Agent-preset plugin context.
 */
export function apply(ctx: Context): void {
  ctx.skills.registerProvider(() => ({
    name: candidate.provider,
    list: () => Promise.resolve([candidate]),
    get: async () => ({ ...candidate, content: await readFile(bodyURL, 'utf8') }),
  }))
  installExecution(ctx)
  ctx.on('agent/created', ({ agent }) => {
    agent.ctx.inject(['tools'], (scoped) => {
      scoped.tools.filterVisible((tool) => {
        const account = ctx.personalWorkflow.sessionAdapter(agent.id)
        if (account) return account.allowsTool(agent.session, tool)
        // Native declarations remain stable across mode/task changes; executors recheck permission.
        if (agent.options.backend?.kind === 'codex' && ['workflow_assess', 'workflow_propose', 'workflow_complete'].includes(tool)) return true
        if (ctx.personalWorkflow.execution.forSession(agent.session.id) !== null
          && ctx.personalWorkflow.execution.limits.blockedTools.includes(tool)) return false
        if (tool === 'workflow_complete') return ctx.personalWorkflow.execution.forSession(agent.session.id)?.sessionId === agent.session.id
        if (tool !== 'workflow_assess' && tool !== 'workflow_propose') return true
        if (ctx.personalWorkflow.execution.forSession(agent.session.id) !== null) return false
        return (ctx.personalWorkflow.selectedMode(agent.session).enabled || ctx.personalWorkflow.testingPreferences().forceDecomposition)
          && ctx.personalProjects.allowsSkill(agent.session, 'dev-workflow')
      })
    })
  })
  ctx.on('agent/pre-step', async ({ agent, signal }, next) => {
    const decision = await next()
    if (decision.kind === 'reject') return decision
    const account = ctx.personalWorkflow.sessionAdapter(agent.id)
    if (account) return account.prepare(agent, decision, signal)
    await ctx.personalWorkflow.execution.checkAccess(agent.session)
    if (!decision.messages.some(message => message.source.kind === 'user' || message.source.kind === 'personal-workflow-continue')) return decision
    const execution = await ctx.personalWorkflow.execution.enterTurn(agent.session)
    if (execution !== null) return { ...decision, messages: [...decision.messages, createUserMessage({ source: { kind: 'personal-workflow-execution' }, content: [{ type: 'text', text: execution }] })] }
    const mode = await ctx.personalWorkflow.mode(agent.session)
    const policy = await ctx.personalWorkflow.resolve(agent.session)
    const forced = policy.forced
    if (!policy.enabled && !forced && mode.revision === 0) {
      await using handle = await ctx.sessionPersistence.open(agent.session.id, 'read')
      const { events } = await handle.read()
      if (!events.some(event => event.type === 'user/message' && event.data.source.kind === 'personal-workflow-method')) return decision
    }
    signal.throwIfAborted()
    let text = 'Task enhancement is now disabled. Ignore earlier enhancement instructions and continue ordinary assistance. Do not submit task assessments or proposals.'
    if (policy.enabled || forced) {
      await ctx.personalWorkflow.requireMode(agent.session, mode.revision)
      if (ctx.tools.get('workflow_assess', agent) === undefined || ctx.tools.get('workflow_propose', agent) === undefined) {
        throw new Error('personal-workflow: workflow tools are unavailable under the current tool permissions')
      }
      const skill = await ctx.skills.get('dev-workflow', { scope: agent, cwd: agent.session.header.cwd, signal })
      if (skill === undefined || skill.provider !== candidate.provider) throw new Error('personal-workflow: bundled dev-workflow Skill unavailable')
      const affiliation = ctx.personalProjects.affiliation(agent.session).current
      text = `Task enhancement is enabled. Mode revision: ${mode.revision}. Effective planning policy: ${JSON.stringify(policy)}. Conversation affiliation: ${JSON.stringify({ projectId: affiliation.projectId ?? null, botId: affiliation.botId ?? null })}. Model configuration: ${JSON.stringify({ backend: agent.options.backend ?? null, provider: agent.options.provider ?? null, model: agent.options.model ?? null })}. Existing goals: ${JSON.stringify(await ctx.personalWorkflow.goals(agent.session))}\n${renderSkillContent(skill)}`
      if (forced) text += '\nTemporary testing override is ON for this device. For every new goal, including simple goals, clarify only if needed, then assess complex and propose a plan with at least two required subtasks. Do not take the simple route or perform the requested work directly. Await user review and explicit task selection; never approve or start tasks yourself. This overrides the ordinary simple-goal routing above.'
      else text += '\nTemporary testing override is OFF. Ignore earlier temporary forced-decomposition instructions; use the managed method’s normal simple/complex routing.'
      ctx.logger.info(`personal-workflow sessionId=${agent.session.id} decisionCode=method-loaded result=ready`)
    }
    return { ...decision, messages: [...decision.messages, createUserMessage({
      source: { kind: 'personal-workflow-method', modeRevision: mode.revision, methodVersion: 4, policy },
      content: [{ type: 'text', text }],
    })] }
  })
  ctx.tools.register(defineTool({
    name: 'workflow_assess',
    description: 'When task enhancement is enabled, classify the current goal before acting: simple continues ordinary assistance; clarify asks questions; infeasible explains conditions and alternatives; complex permits an unapproved structured proposal only.',
    parameters: {
      modeRevision: { type: 'integer', required: true, description: 'Current mode revision provided with the managed method.' },
      decision: { type: 'string', enum: ['simple', 'clarify', 'infeasible', 'complex'], required: true },
      explanation: { type: 'string', required: true, description: 'Concise reasoning about scope, ambiguity and feasibility.' },
      route: { type: 'string', enum: ['new_goal', 'clarification', 'modify', 'query'], description: 'Meaning of the current input. Omit only for a new goal. Queries cannot create plans.' },
      goalId: { type: 'string', description: 'Existing goal UUID required for clarification, modification or query. Omit for a new goal.' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args, exec) {
      if (exec.agent === undefined) throw new Error('workflow_assess requires a conversation')
      if (!args.explanation.trim()) throw new Error('assessment explanation is required')
      const { goalId, ...assessment } = args
      return JSON.stringify(await ctx.personalWorkflow.assess(exec.agent.session, { ...assessment,
        ...(goalId === undefined ? {} : { goalId: goalId as import('@deepseek-ai/dsh-personal-workflow').GoalId }),
      }))
    },
    presentCall(args) { return { card: 'generic', title: 'Assess task goal', kind: 'read', rawInput: args.explanation } },
  }))
  ctx.tools.register(defineTool({
    name: 'workflow_propose',
    description: 'Save a feasible, clarified complex goal as an unapproved plan with a short root task name. balanced uses hierarchical deliverables, normally at most 5 direct children per node. fine uses planningMode phases: one required direct task per ordered phase, consecutive dependencies, and root verification in the final phase; do not group phases to satisfy a child count. This never approves or starts execution. Retry uncertain writes with the identical operationId and proposal.',
    parameters: {
      modeRevision: { type: 'integer', required: true },
      operationId: { type: 'string', required: true, description: 'UUID retry identity.' },
      expectedRevision: { type: 'integer', required: true, description: 'Zero for a new plan, otherwise the current exact version.' },
      definition: {
        type: 'object', required: true, additionalProperties: false,
        properties: {
          planningMode: { type: 'string', enum: ['hierarchical', 'phases'], description: 'Use phases for fine Agent execution preference; hierarchical for balanced task allocation.' },
          taskId: { type: 'string', required: true },
          projectId: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
          botId: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
          phases: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: {
            id: { type: 'string', required: true }, title: { type: 'string', required: true },
          } } },
          tasks: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: {
            id: { type: 'string', required: true }, parentTaskId: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
            phaseId: { type: 'string', required: true }, goal: { type: 'string', required: true, description: 'Concise task name; the root summarizes the overall goal. Keep detailed requirements in scope and acceptance.' }, scope: { type: 'string', required: true },
            acceptance: { type: 'array', items: { type: 'string' }, required: true }, artifacts: { type: 'array', items: { type: 'string' }, required: true },
            cwd: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true }, dependsOn: { type: 'array', items: { type: 'string' }, required: true }, required: { type: 'boolean', required: true },
          } } },
        },
      },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args, exec) {
      if (exec.agent === undefined) throw new Error('workflow_propose requires a conversation')
      const { modeRevision, ...proposal } = args
      return JSON.stringify(await ctx.personalWorkflow.propose(exec.agent.session, modeRevision, proposal))
    },
    presentCall(args) { return { card: 'generic', title: 'Propose task plan', kind: 'edit', rawInput: JSON.stringify(args.definition) } },
  }))
}

function installExecution(ctx: Context): void {
  const deadlines = new Map<import('@deepseek-ai/dsh-session').SessionId, ReturnType<typeof setTimeout>>()
  const clear = (id: import('@deepseek-ai/dsh-session').SessionId) => { clearTimeout(deadlines.get(id)); deadlines.delete(id) }
  ctx.on('agent/pre-step', async ({ agent, signal }, next) => {
    const decision = await next()
    if (agent.options.backend?.kind === 'codex') {
      clear(agent.id)
      const run = ctx.personalWorkflow.execution.forSession(agent.id)
      if (run !== null && run.status === 'running') {
        signal.throwIfAborted()
        deadlines.set(agent.id, setTimeout(() => {
          agent.cancel({ kind: 'user' })
        }, Math.max(1, run.startedAt + run.authorization.maxDurationMs - Date.now())))
      }
    }
    return decision
  })
  ctx.effect(() => () => { for (const id of deadlines.keys()) clear(id) }, 'workflow.native-deadlines')
  ctx.on('agent/status', ({ agent, status }) => {
    if (status !== 'idle') return
    clear(agent.id)
    void ctx.personalWorkflow.execution.interrupt(agent.session).catch(() => {
      ctx.logger.warn(`personal-workflow sessionId=${agent.session.id} decisionCode=idle-reconciliation result=failed`)
    })
  })
  ctx.on('tools/pre-execute', async (exec, next) => {
    const decision = await next()
    if (exec.agent !== undefined) await ctx.personalWorkflow.execution.checkAccess(exec.agent.session)
    return decision
  })
  ctx.tools.guard((exec) => {
    if (exec.agent === undefined) return undefined
    if (ctx.personalWorkflow.sessionAdapter(exec.agent.id)) return undefined
    if (ctx.personalWorkflow.testingPreferences().forceDecomposition
      && ctx.personalWorkflow.execution.forSession(exec.agent.session.id) === null
      && !['workflow_assess', 'workflow_propose', 'ask_user_question'].includes(exec.name)) {
      return 'Temporary workflow testing requires a decomposed plan, user review and explicit task selection before executing work.'
    }
    return ctx.personalWorkflow.execution.denial(exec.agent.session, exec.name)
  })
  ctx.on('tools/execute', async (exec, next) => {
    if (exec.agent === undefined || exec.name === 'workflow_complete') return next()
    const runId = await ctx.personalWorkflow.execution.beginAction(exec.agent.session, exec.callId, exec.name)
    if (runId === null) return next()
    let succeeded = false
    try {
      const denial = ctx.personalWorkflow.execution.denial(exec.agent.session, exec.name)
      if (denial !== undefined) throw new Error(denial)
      const result = await next()
      succeeded = !result.isError
      return result
    } finally { await ctx.personalWorkflow.execution.settleAction(runId, exec.callId, succeeded) }
  })
  ctx.on('agent/turn-stopping', async ({ agent, signal }) => {
    clear(agent.id)
    if (await ctx.personalWorkflow.execution.endTurn(agent.session)) {
      signal.throwIfAborted()
      const message = createUserMessage({ source: { kind: 'personal-workflow-continue' }, content: [{ type: 'text', text: 'Continue the currently selected task within the recorded remaining authorization. The application may have advanced to the next authorized phase. Verify its acceptance and record evidence with workflow_complete; never choose a task or phase outside the recorded sequence.' }] })
      if (agent.options.backend?.kind === 'codex') agent.followup(message)
      else agent.steer(message)
    }
  })
  ctx.tools.register(defineTool({
    name: 'workflow_complete',
    description: 'Finish only the selected task after checking every acceptance criterion. Supply actual successful tool call IDs and one verification result per criterion. The host independently reads declared artifacts and refuses missing files or unresolved actions.',
    parameters: {
      summary: { type: 'string', required: true },
      acceptance: { type: 'array', items: { type: 'string' }, required: true },
      callIds: { type: 'array', items: { type: 'string' }, required: true },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args, exec) {
      if (exec.agent === undefined) throw new Error('workflow_complete requires an execution conversation')
      const result = await ctx.personalWorkflow.execution.complete(exec.agent.session, args)
      exec.concludeTurn()
      return JSON.stringify(result)
    },
    presentCall(args) { return { card: 'generic', title: 'Verify task completion', kind: 'read', rawInput: args.summary } },
  }))
}
