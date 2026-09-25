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
  name: 'dev-workflow', description: 'Managed task enhancement, available only when the user explicitly enables the conversation mode.',
  invocation: { modelInvocable: false, userInvocable: false }, provider: 'dev-workflow', source: 'bundled',
  rank: BUNDLED_SKILL_RANK, locator: bodyURL,
  resourceBase: { kind: 'directory', path: fileURLToPath(new URL('../assets/', import.meta.url)) },
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** Exact selected-task definition, owner, evidence and authorization in model history. */
    'personal-workflow-execution': { kind: 'personal-workflow-execution' }
    /** Authorized continuation of the same selected task. */
    'personal-workflow-continue': { kind: 'personal-workflow-continue' }
    /** Mode and managed method recorded by the ordinary user-message pipeline. */
    'personal-workflow-method': { kind: 'personal-workflow-method'; modeRevision: number; methodVersion: number }
  }
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
        if (ctx.personalWorkflow.execution.forSession(agent.session.id) !== null
          && ctx.personalWorkflow.execution.limits.blockedTools.includes(tool)) return false
        if (tool === 'workflow_complete') return ctx.personalWorkflow.execution.forSession(agent.session.id)?.sessionId === agent.session.id
        if (tool !== 'workflow_assess' && tool !== 'workflow_propose') return true
        return (ctx.personalWorkflow.selectedMode(agent.session).enabled || ctx.personalWorkflow.testingPreferences().forceDecomposition)
          && ctx.personalProjects.allowsSkill(agent.session, 'dev-workflow')
      })
    })
  })
  ctx.on('agent/pre-step', async ({ agent, signal }, next) => {
    const decision = await next()
    if (decision.kind === 'reject') return decision
    await ctx.personalWorkflow.execution.checkAccess(agent.session)
    if (!decision.messages.some(message => message.source.kind === 'user' || message.source.kind === 'personal-workflow-continue')) return decision
    const execution = await ctx.personalWorkflow.execution.enterTurn(agent.session)
    if (execution !== null) return { ...decision, messages: [...decision.messages, createUserMessage({ source: { kind: 'personal-workflow-execution' }, content: [{ type: 'text', text: execution }] })] }
    const mode = await ctx.personalWorkflow.mode(agent.session)
    const forced = ctx.personalWorkflow.testingPreferences().forceDecomposition
    if (!mode.enabled && !forced && mode.revision === 0) {
      await using handle = await ctx.sessionPersistence.open(agent.session.id, 'read')
      const { events } = await handle.read()
      if (!events.some(event => event.type === 'user/message' && event.data.source.kind === 'personal-workflow-method')) return decision
    }
    signal.throwIfAborted()
    let text = 'Task enhancement is now disabled. Ignore earlier enhancement instructions and continue ordinary assistance. Do not submit task assessments or proposals.'
    if (mode.enabled || forced) {
      await ctx.personalWorkflow.requireMode(agent.session, mode.revision)
      if (ctx.tools.get('workflow_assess', agent) === undefined || ctx.tools.get('workflow_propose', agent) === undefined) {
        throw new Error('personal-workflow: workflow tools are unavailable under the current tool permissions')
      }
      const skill = await ctx.skills.get('dev-workflow', { scope: agent, cwd: agent.session.header.cwd, signal })
      if (skill === undefined || skill.provider !== candidate.provider) throw new Error('personal-workflow: bundled dev-workflow Skill unavailable')
      const affiliation = ctx.personalProjects.affiliation(agent.session).current
      text = `Task enhancement is enabled. Mode revision: ${mode.revision}. Conversation affiliation: ${JSON.stringify({ projectId: affiliation.projectId ?? null, botId: affiliation.botId ?? null })}\n${renderSkillContent(skill)}`
      if (forced) text += '\nTemporary testing override is ON for this device. For every new goal, including simple goals, clarify only if needed, then assess complex and propose a plan with at least two required subtasks. Do not take the simple route or perform the requested work directly. Await user review and explicit task selection; never approve or start tasks yourself. This overrides the ordinary simple-goal routing above.'
      else text += '\nTemporary testing override is OFF. Ignore earlier temporary forced-decomposition instructions; use the managed method’s normal simple/complex routing.'
      ctx.logger.info(`personal-workflow sessionId=${agent.session.id} decisionCode=method-loaded result=ready`)
    }
    return { ...decision, messages: [...decision.messages, createUserMessage({
      source: { kind: 'personal-workflow-method', modeRevision: mode.revision, methodVersion: 1 },
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
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args, exec) {
      if (exec.agent === undefined) throw new Error('workflow_assess requires a conversation')
      if (!args.explanation.trim()) throw new Error('assessment explanation is required')
      return JSON.stringify(await ctx.personalWorkflow.assess(exec.agent.session, args))
    },
    presentCall(args) { return { card: 'generic', title: 'Assess task goal', kind: 'read', rawInput: args.explanation } },
  }))
  ctx.tools.register(defineTool({
    name: 'workflow_propose',
    description: 'Save a feasible, clarified complex goal as an unapproved plan. Parent-child relationships and prerequisites are independent. This never approves or starts tasks. Retry uncertain writes with the identical operationId and proposal.',
    parameters: {
      modeRevision: { type: 'integer', required: true },
      operationId: { type: 'string', required: true, description: 'UUID retry identity.' },
      expectedRevision: { type: 'integer', required: true, description: 'Zero for a new plan, otherwise the current exact version.' },
      definition: {
        type: 'object', required: true, additionalProperties: false,
        properties: {
          taskId: { type: 'string', required: true },
          projectId: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
          botId: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
          phases: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: {
            id: { type: 'string', required: true }, title: { type: 'string', required: true },
          } } },
          tasks: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: {
            id: { type: 'string', required: true }, parentTaskId: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
            phaseId: { type: 'string', required: true }, goal: { type: 'string', required: true }, scope: { type: 'string', required: true },
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
  ctx.on('agent/status', ({ agent, status }) => {
    if (status !== 'idle') return
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
    if (await ctx.personalWorkflow.execution.endTurn(agent.session)) {
      signal.throwIfAborted()
      agent.steer(createUserMessage({ source: { kind: 'personal-workflow-continue' }, content: [{ type: 'text', text: 'Continue only the selected task within its remaining authorization. Verify acceptance and record evidence with workflow_complete; do not select or start another task.' }] }))
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
