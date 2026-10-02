/** Incremental personal-plan Chat node from existing durable snapshots. */
import type { ConversationNodeDefinition } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { WorkflowSnapshot } from '@deepseek-ai/dsh-personal-workflow/types'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
declare module '@deepseek-ai/dsh-client-ui-chat/client' {
  interface ChatNodeDataMap { 'personal-plan': WorkflowSnapshot }
}
/** Snapshot updates share the root task identity and never scan the conversation window. */
export const personalPlanDefinition: ConversationNodeDefinition<WorkflowSnapshot> = {
  kind: 'personal-plan', target: 'chat',
  match: event => event.type === 'personal-workflow/snapshot' ? { id: event.data.taskId, role: 'start' } : null,
  start: (_context, match) => {
    if (match.event.type !== 'personal-workflow/snapshot') throw new Error('personal-plan: snapshot-required')
    return match.event.data
  },
  update: (context, match) => match.event.type === 'personal-workflow/snapshot' ? match.event.data : context.state,
  buildViewNode: context => context.state === undefined ? null : {
    key: context.key, kind: 'personal-plan', id: context.id, target: 'chat',
    anchorSeq: context.start?.event.seq ?? context.matches[0]?.event.seq ?? 0,
    location: context.start?.location ?? context.matches[0]?.location ?? { kind: 'unresolved' },
    visibility: 'visible', data: context.state,
  },
}
