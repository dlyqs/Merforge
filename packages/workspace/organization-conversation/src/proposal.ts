/** Proposal tool admits only the current assessed goal and persists intent before authority writes. */
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { planningDraftSchema } from '@deepseek-ai/dsh-organization/planning'
import { z } from 'zod'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { ConversationBridge } from './protocol.ts'
import { conversationProposalSchema, conversationAssessmentSchema, type conversationInputSchema } from './state.ts'

const projectionSchema = z.object({ assessments: z.array(conversationAssessmentSchema), proposals: z.array(conversationProposalSchema) })
type Projection = z.output<typeof projectionSchema>
declare module '@deepseek-ai/dsh-session-projection' {
  interface SessionProjectionStateMap { organizationPlanning: Projection }
}
/** Private proposal admission reads the committed Session projection. */
export const planningProjection = {
  key: 'organizationPlanning', stateVersion: 1, stateSchema: projectionSchema,
  init: () => ({ assessments: [], proposals: [] }),
  apply: (state, event) => event.type === 'organization/planning-assessment'
    ? { ...state, assessments: [...state.assessments, event.data] }
    : event.type === 'organization/planning-proposal' ? { ...state, proposals: [...state.proposals, event.data] } : state,
} satisfies ProjectionDefinition<'organizationPlanning', Projection>

/**
 * Register the isolated proposal consumer; no approval, file or execution capabilities are installed.
 * @param ctx - Isolated runtime with owned tool registry.
 * @param agent - Current private conversation Agent.
 * @param input - Persisted accepted input and exact settings.
 * @param bridge - Current native authority, scoped to this conversation.
 * @param signal - Interval cancellation.
 */
export function installProposal(ctx: Context, agent: Agent, input: z.output<typeof conversationInputSchema>,
  bridge: ConversationBridge, signal: AbortSignal): void {
  const request = input.request
  if (request.kind !== 'send' || !input.settings.enabled) return
  const state = () => {
    const value = ctx.sessionProjections.stateOf(agent.session, 'organizationPlanning')
    if (!value) throw new Error('organization-conversation: projection-required')
    return value
  }
  const prior = state().proposals.filter(e => e.command.goalId === input.goalId).at(-1)
  const planId = input.authority.plan?.version.planId ?? prior?.command.planId ?? randomUUID()
  ctx.effect(() => ctx.tools.register(defineTool({ name: 'workflow_propose',
    description: 'Save the current clarified complex goal as an unapproved plan. Use UUID task and phase IDs. Keep existing IDs and the exact current revision when modifying. A subtree replacement keeps its root goal, scope, acceptance and resources unchanged. Saving invalidates previous approvals and execution qualifications; original approvers must approve new leaves. No task is assigned or started. Without edit access this saves a private suggestion only.',
    parameters: {
      operationId: { type: 'string', required: true }, expectedRevision: { type: 'integer', required: true },
      definition: { type: 'object', required: true, additionalProperties: false, properties: {
        taskId: { type: 'string', required: true },
        phases: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: {
          id: { type: 'string', required: true }, title: { type: 'string', required: true },
        } } },
        tasks: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: {
          id: { type: 'string', required: true }, parentTaskId: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
          phaseId: { type: 'string', required: true }, goal: { type: 'string', required: true }, scope: { type: 'string', required: true },
          acceptance: { type: 'array', items: { type: 'string' }, required: true }, artifacts: { type: 'array', items: { type: 'string' }, required: true },
          dependsOn: { type: 'array', items: { type: 'string' }, required: true }, required: { type: 'boolean', required: true },
          suggestedMembershipId: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
        } } },
      } },
    },
    output: { schema: { type: 'string' }, render: (_args, text) => [{ type: 'text', text }] },
    execute: async (args) => {
      signal.throwIfAborted()
      const assessment = state().assessments.filter(e => e.goalId === input.goalId && e.operationId === request.operationId).at(-1)
      if (request.route === 'query' || assessment?.classification !== 'complex') throw new Error('organization-conversation: complex-assessment-required')
      const command = planningDraftSchema.parse({ ...args, kind: 'save-planning-draft', planId,
        organizationId: request.organizationId, projectId: request.projectId, conversationId: request.conversationId,
        goalId: input.goalId, assessmentId: request.operationId, settingsRevision: input.settings.revision })
      if (input.authority.plan && (command.expectedRevision !== input.authority.plan.version.revision
        || command.definition.taskId !== input.authority.plan.version.definition.taskId)) throw new Error('organization-conversation: version-conflict')
      const previous = state().proposals.filter(e => e.command.operationId === command.operationId).at(-1)
      if (previous) {
        if (JSON.stringify(previous.command) !== JSON.stringify(command)) throw new Error('organization-conversation: operation-conflict')
        return JSON.stringify(previous)
      }
      const authority = await bridge(); signal.throwIfAborted()
      const target = input.authority.plan
      const current = target ? (await bridge({ kind: 'read-planning-plan', organizationId: request.organizationId,
        projectId: request.projectId, conversationId: request.conversationId, planId: target.version.planId,
        taskId: target.version.definition.taskId })).plan : undefined
      await checkPlanningMembers(command, bridge, target?.version.definition)
      signal.throwIfAborted()
      const writable = target ? current?.canEdit === true : authority.view.canWrite
      const record = async (value: z.input<typeof conversationProposalSchema>) => {
        const parsed = conversationProposalSchema.parse(value)
        agent.session.append('organization/planning-proposal', parsed)
        if (!await ctx.sessions.flush(agent.session)) throw new Error('organization-conversation: log-not-durable')
        return JSON.stringify(parsed)
      }
      if (!writable) return record({ command, status: 'private' })
      await record({ command, status: 'unknown' })
      try {
        signal.throwIfAborted()
        const result = await bridge(command)
        if (!result.receipt?.planning.planRevision) throw new Error('organization-conversation: receipt-mismatch')
        return await record({ command, status: 'shared', receipt: result.receipt })
      } catch (error) {
        if (error instanceof Error && error.message.includes('version-conflict')) return record({ command, status: 'conflict' })
        throw error
      }
    },
  })), 'organization-conversation.proposal')
}

/**
 * Reject newly suggested identities that are no longer visible in this project.
 * @param command - Parsed private or shared proposal.
 * @param bridge - Current project-scoped member reader.
 * @param previous - Authorized definition whose unchanged suggestions may be retained.
 */
export async function checkPlanningMembers(command: z.output<typeof planningDraftSchema>, bridge: ConversationBridge,
  previous?: z.output<typeof planningDraftSchema>['definition']): Promise<void> {
  const pending = new Set(command.definition.tasks.filter(t => t.suggestedMembershipId
    && previous?.tasks.find(old => old.id === t.id)?.suggestedMembershipId !== t.suggestedMembershipId)
    .map(t => t.suggestedMembershipId))
  let offset = 0
  while (pending.size) {
    const page = (await bridge({ kind: 'read-planning-members', organizationId: command.organizationId,
      projectId: command.projectId, conversationId: command.conversationId, search: '', offset })).candidates
    if (!page || !page.items.length) throw new Error('organization-conversation: member-unavailable')
    for (const member of page.items) pending.delete(member.membershipId)
    offset += page.items.length
    if (pending.size && offset >= page.total) throw new Error('organization-conversation: member-unavailable')
  }
}
