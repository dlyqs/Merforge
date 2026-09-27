/** Current Project/Bot membership projected from one Session catalog. */
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { BotId, ProjectId } from '@deepseek-ai/dsh-personal-project/types'

/** One of the two navigation indexes over the same Session identity. */
export type Entrance = { kind: 'project'; id: ProjectId } | { kind: 'bot'; id: BotId }

/** Select current members without copying Session rows.
 * @param list - one shared Session catalog.
 * @param entrance - current Project or Bot.
 * @returns Session IDs in catalog order.
 */
export function memberIds(list: SessionListState, entrance: Entrance): SessionId[] {
  return list.ids.filter((id) => {
    if (list.byId[id]?.origin === 'subagent') return false
    const current = list.byId[id]?.projectionValues?.personalAffiliation?.current
    return entrance.kind === 'project' ? current?.projectId === entrance.id : current?.botId === entrance.id
  })
}

/** Keep conversations without a Project or Bot discoverable.
 * @param list - one shared Session catalog.
 * @returns nonempty unclassified Session IDs, newest activity first.
 */
export function unassignedIds(list: SessionListState): SessionId[] {
  return list.ids.filter((id) => {
    const summary = list.byId[id]
    if (summary === undefined || summary.origin === 'subagent' || summary.blank) return false
    const affiliation = summary.projectionValues?.personalAffiliation
    return affiliation !== undefined && affiliation.current.projectId === undefined
      && affiliation.current.botId === undefined
  }).sort((a, b) => (list.byId[b]?.updatedAt ?? 0) - (list.byId[a]?.updatedAt ?? 0))
}
