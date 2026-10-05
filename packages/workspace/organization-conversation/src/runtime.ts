import { installProposal, planningProjection } from './proposal.ts'
import { planningInstructions } from './planning-instructions.ts'
/** One explicit planning interval in a fresh isolated standard Agent/Session composition. */
import { Context } from '@deepseek-ai/cordis'
import Sessions from '@deepseek-ai/dsh-session'
import Agents from '@deepseek-ai/dsh-agent'
import Loop from '@deepseek-ai/dsh-agent-loop'
import * as Retry from '@deepseek-ai/dsh-llm-retry'
import Projections from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Tools, { defineTool } from '@deepseek-ai/dsh-tools'
import Llm, { createUserMessage } from '@deepseek-ai/dsh-llm'
import Jsonl from '@deepseek-ai/dsh-session-persistence-jsonl'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { conversationAdapter, type conversationModelSchema } from './model.ts'
import type { z } from 'zod'
import type { ConversationAuthority, ConversationBridge, ConversationRequest } from './protocol.ts'
import { conversationInputSchema, conversationAssessmentSchema, conversationOperationSchema } from './state.ts'
function assertId(id: string): void {
  if (!/^organization-conversation:[0-9a-f-]{36}$/.test(id)) throw new Error('organization-conversation: isolated-access-required')
}
class ConversationSessions extends Sessions { protected override assertSessionId(id: string): void { assertId(id) } }
class ConversationAgents extends Agents { protected override assertSessionId(id: string): void { assertId(id) } }
/**
 * Run a single explicit user interval, logging all model-visible inputs and draining cancellation.
 * @param owner - Private Host credential owner.
 * @param root - Dedicated conversation JSONL directory.
 * @param sessionId - Reserved organization-only Session identity.
 * @param request - Exact durable user input.
 * @param input - Goal, effective settings and exact authorized model context.
 * @param bridge - Private online authority channel.
 * @param routes - Local model/credential destination policy.
 * @param limits - Deployment step and revocation polling ceilings.
 * @param signal - Native window and identity lifetime.
 */
export async function runConversation(owner: Context, root: string, sessionId: SessionId,
  request: Extract<ConversationRequest, { kind: 'send' }>, input: z.output<typeof conversationInputSchema>, bridge: ConversationBridge,
  routes: z.output<typeof conversationModelSchema>[], limits: { maxSteps: number; recheckMs: number }, signal: AbortSignal): Promise<void> {
  const ctx = new Context(), cancel = new AbortController(), combined = AbortSignal.any([signal, cancel.signal])
  let poll: ReturnType<typeof setTimeout> | undefined, pending: Promise<void> = Promise.resolve()
  try {
    combined.throwIfAborted()
    await ctx.plugin(ConversationSessions); await ctx.plugin(ConversationAgents)
    await ctx.plugin(Projections); await ctx.plugin(SystemPrompt); await ctx.plugin(Tools, { mode: 'native' }); await ctx.plugin(Llm)
    await ctx.plugin(Jsonl, { root, compression: 'none', namespace: 'organization-conversation' })
    await ctx.plugin(Retry)
    await ctx.plugin(Loop, { agents: [], maxParallelToolCalls: 1 })
    const record = async (command: Parameters<ConversationBridge>[0], authority?: ConversationAuthority) => {
      if (!command || command.kind === 'read-planning-plan' || command.kind === 'read-planning-members') throw new Error('organization-conversation: command-required')
      agent.session.append('organization/planning-operation', conversationOperationSchema.parse({ command,
        ...(authority?.receipt ? { receipt: authority.receipt } : {}) }))
      if (!await ctx.sessions.flush(agent.session)) throw new Error('organization-conversation: log-not-durable')
    }
    ctx.llm.registerAdapter(['organization-planning'], conversationAdapter(owner, request, routes, bridge, record, combined))
    ctx.effect(() => ctx.sessionProjections.register(planningProjection), 'organization-conversation.projection')
    const handle = await ctx.agents.resume({ resumeSessionId: sessionId,
      agentOptions: { provider: 'organization-planning', model: request.selection.model }, signal: combined })
    const agent = handle.agent
    try {
      agent.cancel({ kind: 'user' }); await agent.whenIdle()
      combined.throwIfAborted()
      agent.session.append('organization/planning-input', input)
      if (!await ctx.sessions.flush(agent.session)) throw new Error('organization-conversation: log-not-durable')
      if (input.settings.enabled) ctx.tools.register(defineTool({ name: 'workflow_assess',
        description: 'Assess this goal as simple, clarify, infeasible or complex. Clarify missing requirements before planning. This saves only your private assessment; it does not create or assign tasks.',
        parameters: { classification: { type: 'string', enum: ['simple', 'clarify', 'infeasible', 'complex'], required: true },
          rationale: { type: 'string', required: true } },
        output: { schema: { type: 'string' }, render: (_args, text) => [{ type: 'text', text }] },
        execute: async (args) => {
          combined.throwIfAborted(); await bridge(); combined.throwIfAborted()
          const assessment = conversationAssessmentSchema.parse({ goalId: input.goalId, operationId: request.operationId, ...args })
          const previous = ctx.sessionProjections.stateOf(agent.session, 'organizationPlanning')?.assessments
            .find(a => a.goalId === input.goalId && a.operationId === request.operationId)
          if (previous) {
            if (JSON.stringify(previous) !== JSON.stringify(assessment)) throw new Error('organization-conversation: assessment-conflict')
            return JSON.stringify(previous)
          }
          agent.session.append('organization/planning-assessment', assessment)
          if (!await ctx.sessions.flush(agent.session)) throw new Error('organization-conversation: log-not-durable')
          return JSON.stringify(assessment)
        },
      }))
      installProposal(ctx, agent, input, bridge, combined)
      ctx.effect(() => ctx.tools.register(defineTool({ name: 'planning_members',
        description: 'Search currently visible human project members. Present all matching identities when ambiguous; never infer assignment or task read permission from membership visibility.',
        parameters: { search: { type: 'string', required: true }, offset: { type: 'integer', required: true } },
        output: { schema: { type: 'string' }, render: (_args, text) => [{ type: 'text', text }] },
        execute: async args => JSON.stringify((await bridge({ kind: 'read-planning-members',
          organizationId: request.organizationId, projectId: request.projectId, conversationId: request.conversationId,
          search: args.search, offset: args.offset })).candidates),
      })), 'organization-conversation.members')
      ctx.tools.register(defineTool({ name: 'planning_authorization',
        description: 'Read current project planning permission. Project read does not grant task editing, assignment or execution.',
        parameters: {}, output: { schema: { type: 'string' }, render: (_args, text) => [{ type: 'text', text }] },
        execute: async () => {
          const authority = await bridge(); combined.throwIfAborted()
          return JSON.stringify({ project: authority.view.project, planning: authority.view.eligible })
        },
      }))
      let steps = 0
      const outcome = { completed: false }
      ctx.on('session/event', (session, event) => {
        if (session.id === sessionId && event.type === 'turn/end') outcome.completed = event.data.reason.kind === 'completed'
      })
      ctx.on('llm/stream', (_options, next) => (async function* () {
        if (++steps > limits.maxSteps) throw new Error('organization-conversation: step-limit')
        combined.throwIfAborted()
        let bytes = 2
        for await (const chunk of next()) {
          bytes += Buffer.byteLength(JSON.stringify(chunk)) + 1
          if (bytes > input.authority.view.policy.maxOutputBytes) throw new Error('organization-conversation: output-limit')
          yield chunk
        }
      })())
      const stop = () => { agent.cancel({ kind: 'user' }) }
      combined.addEventListener('abort', stop, { once: true })
      const check = () => {
        pending = bridge().then((authority) => {
          if (!authority.view.eligible) throw new Error('organization-conversation: permission-lost')
        }).catch((error: unknown) => { cancel.abort(error) }).then(() => {
          if (!combined.aborted) poll = setTimeout(check, limits.recheckMs)
        })
      }
      poll = setTimeout(check, limits.recheckMs)
      try {
        await bridge(); combined.throwIfAborted()
        agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: JSON.stringify({
          method: { version: 'organization-planning/v2', text: input.settings.enabled
            ? `Discuss the current organization project goal. Assess complexity with workflow_assess. Ask specific missing requirements when clarification is needed. Use only this private conversation and the authorized project facts. For a clarified complex goal, call workflow_propose to save an unapproved plan. For modifications preserve task identities and exact version; progress queries only read the current plan. Shared plan changes invalidate approvals, grants on structure changes, Runs and delivery eligibility. Subtree edits preserve the original root scope, acceptance and resources. Name suggestions require current visible membership IDs; never guess identities. Shared definitions contain task summaries and authorized project facts only; never copy chat transcripts, credentials or private context. Never claim assignment, approval or execution. Respect the requested granularity. ${planningInstructions}`
            : 'Answer within the current organization project. Automatic goal assessment is disabled. Shared plan saving, assignment and execution are unavailable.' },
          input,
        }) }] }))
        await agent.whenIdle(); combined.throwIfAborted()
        if (!outcome.completed) throw new Error('organization-conversation: turn-not-completed')
        if (!await ctx.sessions.flush(agent.session)) throw new Error('organization-conversation: log-not-durable')
      } finally { combined.removeEventListener('abort', stop) }
    } finally { await handle.dispose() }
  } finally {
    cancel.abort(); clearTimeout(poll); await pending; await ctx.fiber.dispose()
  }
}
