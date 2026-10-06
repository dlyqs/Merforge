/** Execution observations from authorized task conversation events. */
import type { ConversationResult } from '@deepseek-ai/dsh-organization-conversation/protocol'
import type { OrganizationTaskView } from '@deepseek-ai/dsh-organization'
/**
 * Derive the latest dispatched turn for the current task revision.
 * @param history - Authorized private conversation events.
 * @param task - Current exact task revision.
 * @param running - Current ordinary Agent running observation.
 * @returns Latest dispatched task turn; selection and generated introductions do not count.
 */
export function taskExecutionState(history: ConversationResult['history'], task: OrganizationTaskView, running: boolean): 'unstarted' | 'running' | 'executed' | 'interrupted' {
  let selected = false, turn: number | undefined
  let state: ReturnType<typeof taskExecutionState> = 'unstarted'
  for (const event of history) {
    if (event.type === 'organization/planning-input') {
      const input = event.data
      selected = input.request.kind === 'send' && input.request.target?.taskId === task.id
        && input.request.target.planId === task.planId && input.authority.plan?.version.revision === task.revision
    }
    if (event.type === 'step/start' && selected) { turn = event.data.turn; state = 'running' }
    if (event.type === 'turn/end') {
      if (event.data.turn === turn) state = event.data.reason.kind === 'completed' ? 'executed' : 'interrupted'
      selected = false
    }
  }
  return state === 'running' && !running ? 'interrupted' : state
}
