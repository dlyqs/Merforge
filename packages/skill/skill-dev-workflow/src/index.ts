/** Bundled managed method and mode-gated model adapters. */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-personal-workflow'
import type {} from '@deepseek-ai/dsh-personal-project'
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
    /** Mode and managed method recorded by the ordinary user-message pipeline. */
    'personal-workflow-method': { kind: 'personal-workflow-method'; modeRevision: number; methodVersion: number }
  }
}

/** Cordis plugin identity. */
export const name = 'skill-dev-workflow'
/** Services used by managed mode and model operations. */
export const inject = ['skills', 'agents', 'tools', 'personalWorkflow', 'personalProjects']

/** Register the bundled method, logged context and guarded proposal tools.
 * @param ctx - Agent-preset plugin context.
 */
export function apply(ctx: Context): void {
  ctx.skills.registerProvider(() => ({
    name: candidate.provider,
    list: () => Promise.resolve([candidate]),
    get: async () => ({ ...candidate, content: await readFile(bodyURL, 'utf8') }),
  }))
  ctx.on('agent/created', ({ agent }) => {
    agent.ctx.inject(['tools'], (scoped) => {
      scoped.tools.filterVisible((tool) => {
        if (tool !== 'workflow_assess' && tool !== 'workflow_propose') return true
        return ctx.personalWorkflow.selectedMode(agent.session).enabled
          && ctx.personalProjects.allowsSkill(agent.session, 'dev-workflow')
      })
    })
  })
  ctx.on('agent/pre-step', async ({ agent, signal }, next) => {
    const decision = await next()
    if (decision.kind === 'reject') return decision
    if (!decision.messages.some(message => message.source.kind === 'user')) return decision
    const mode = await ctx.personalWorkflow.mode(agent.session)
    if (!mode.enabled && mode.revision === 0) return decision
    signal.throwIfAborted()
    let text = 'Task enhancement is now disabled. Ignore earlier enhancement instructions and continue ordinary assistance. Do not submit task assessments or proposals.'
    if (mode.enabled) {
      await ctx.personalWorkflow.requireMode(agent.session, mode.revision)
      if (ctx.tools.get('workflow_assess', agent) === undefined || ctx.tools.get('workflow_propose', agent) === undefined) {
        throw new Error('personal-workflow: workflow tools are unavailable under the current tool permissions')
      }
      const skill = await ctx.skills.get('dev-workflow', { scope: agent, cwd: agent.session.header.cwd, signal })
      if (skill === undefined || skill.provider !== candidate.provider) throw new Error('personal-workflow: bundled dev-workflow Skill unavailable')
      const affiliation = ctx.personalProjects.affiliation(agent.session).current
      text = `Task enhancement is enabled. Mode revision: ${mode.revision}. Conversation affiliation: ${JSON.stringify({ projectId: affiliation.projectId ?? null, botId: affiliation.botId ?? null })}\n${renderSkillContent(skill)}`
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
