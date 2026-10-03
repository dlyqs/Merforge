/** Organization task nodes participate in the standard Chat assembly. */
import type { ConversationNodeDefinition } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { ConversationResult, ConversationRequest } from '@deepseek-ai/dsh-organization-conversation/protocol'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
type PlanNode = Pick<ConversationRequest, 'organizationId' | 'projectId' | 'conversationId' | 'assignment'>
  & { goalId: ConversationResult['goals'][number]['id']; revision: number }
declare module '@deepseek-ai/dsh-client-ui-chat/client' {
  interface ChatNodeDataMap { 'organization-plan': PlanNode }
}
/** Durable plan identity; rendering rechecks current task permissions through native reads. */
export const organizationPlanDefinition: ConversationNodeDefinition<PlanNode> = {
  kind: 'organization-plan', target: 'chat',
  match: (event) => {
    switch (event.type) {
      case 'organization/assignment-context': return { id: event.data.assignment.id, role: 'start' }
      case 'organization/planning-proposal': return { id: event.data.command.goalId, role: 'start' }
      case 'organization/planning-input': return event.data.authority.plan ? { id: event.data.goalId, role: 'start' } : null
      default: return null
    }
  },
  start: (_context, match) => {
    switch (match.event.type) {
      case 'organization/assignment-context': return { ...match.event.data.owner,
        goalId: brandString<ConversationResult['goals'][number]['id']>(match.event.data.assignment.id), revision: match.event.seq }
      case 'organization/planning-proposal': return { ...match.event.data.command, goalId: match.event.data.command.goalId, revision: match.event.seq }
      case 'organization/planning-input': return { ...match.event.data.request, goalId: match.event.data.goalId, revision: match.event.seq }
      default: throw new Error('organization-plan: event-required')
    }
  },
  update: (context, match) => ({ ...context.state, revision: match.event.seq }),
  buildViewNode: context => context.state === undefined ? null : {
    key: context.key, kind: 'organization-plan', id: context.id, target: 'chat',
    anchorSeq: context.start?.event.seq ?? context.matches[0]?.event.seq ?? 0,
    location: context.start?.location ?? context.matches[0]?.location ?? { kind: 'unresolved' },
    visibility: 'visible', data: context.state,
  },
}
