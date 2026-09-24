/** Apply current Project and Bot configuration at Agent request and tool entry points. */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tools'
import type { BotProfile, AffiliationProjection } from './types.ts'

/** Cordis plugin name. */
export const name = 'personal-project-runtime'
/** Existing services providing affiliation, Agent lifecycle, and execution gates. */
export const inject = ['personalProjects', 'agents', 'systemPrompt', 'tools']

function activeBot(ctx: Context, agent: Agent): BotProfile | undefined {
  const botId = ctx.personalProjects.affiliation(agent.session).current.botId
  if (botId === undefined) return undefined
  const bot = ctx.personalProjects.getBot(botId)
  if (bot === undefined) throw new Error(`Bot "${botId}" was deleted before its Session affiliation was cleared`)
  return bot
}

function transitionText(state: AffiliationProjection): string {
  const changes = state.history.filter(change => change.source !== 'create')
  const first = changes[0]
  if (first === undefined) return ''
  const describe = (value: typeof changes[number]['from']): string =>
    `Project ${value.project?.name ?? 'none'}; Bot ${value.bot?.name ?? 'none'}`
  const recent = changes.slice(-8)
  const summary = changes.length > recent.length
    ? `Affiliation changed ${changes.length} times since creation, starting from ${describe(first.from)}. `
    : ''
  return `${summary}Affiliation changes: ${recent.map(change => `${describe(change.from)} → ${describe(change.to)}`).join(' | ')}.`
}

/** Render current metadata from one Session and current personal records.
 * @param ctx - Host services holding personal records.
 * @param agent - Agent whose Session supplies current affiliation.
 * @returns current user-authored context and a compact transition history.
 */
export function personalContextText(ctx: Context, agent: Agent): string {
  const state = ctx.personalProjects.affiliation(agent.session)
  const project = state.current.projectId === undefined ? undefined : ctx.personalProjects.getProject(state.current.projectId)
  const bot = activeBot(ctx, agent)
  if (state.current.projectId !== undefined && project === undefined) {
    throw new Error(`Project "${state.current.projectId}" was deleted before its Session affiliation was cleared`)
  }
  if (project === undefined && bot === undefined && state.history.length === 0) return ''
  const sections = [
    project === undefined ? '' : `Current project: ${project.name}\nProject description: ${project.description}`,
    bot === undefined ? '' : `Current Bot: ${bot.name}\nUser-specified identity: ${bot.identity}\nWork direction: ${bot.direction}`,
    transitionText(state),
  ].filter(Boolean)
  return sections.join('\n\n')
}

/** Register prompt and monotonic execution policy for ordinary Agents. */
export function apply(ctx: Context): void {
  ctx.on('agent/created', ({ agent }) => {
    agent.ctx.inject(['systemPrompt', 'tools'], (scoped) => {
      scoped.systemPrompt.section({
        name: 'personal:current-context',
        order: ctx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_PREFIX') + 1,
        interpolate: false,
        text: () => personalContextText(ctx, agent),
      })
      scoped.tools.filterVisible((name) => {
        const bot = activeBot(ctx, agent)
        return bot?.allowedTools === undefined || bot.allowedTools.includes(name)
      })
    })
  })
  ctx.tools.guard((exec) => {
    if (exec.agent === undefined) return undefined
    const bot = activeBot(ctx, exec.agent)
    if (bot === undefined) return undefined
    if (bot.allowedTools !== undefined && exec.name !== 'run_code' && !bot.allowedTools.includes(exec.name)) {
      return `Bot "${bot.name}" does not allow tool "${exec.name}"`
    }
    if (exec.name === 'skill' && bot.allowedSkills !== undefined) {
      const args = exec.arguments
      if (typeof args === 'object' && args !== null && 'name' in args
        && typeof args.name === 'string' && !bot.allowedSkills.includes(args.name)) {
        return `Bot "${bot.name}" does not allow skill "${args.name}"`
      }
    }
    return undefined
  })
}
