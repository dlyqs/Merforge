/** Shared viewing selection for the organization sidebar and main conversation entry. */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import type { PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { Principal } from '@deepseek-ai/dsh-organization/types'
import type { ConversationRequest } from '@deepseek-ai/dsh-organization-conversation/protocol'
import type { OrganizationAssignment } from '@deepseek-ai/dsh-organization'
/** Account-scoped navigation identifiers; business facts remain in the native authority. */
export type ConversationSelection = Principal & { organizationId: OrganizationAssignment['organizationId']
  projectId?: OrganizationAssignment['projectId']
  planId?: OrganizationAssignment['planId']
  assignmentId?: OrganizationAssignment['id']
  conversationId?: ConversationRequest['conversationId']
  botId?: ConversationRequest['botId'] }
type State = { selected: ConversationSelection | null; revision: number }
type Actions = { select: (state: State, selected: ConversationSelection | null) => void; refresh: (state: State) => void }
/** Create the per-plugin task navigation selection.
 * @returns Shared viewing state for sidebar/main registrations.
 */
export function createConversationStore(): EngineStoreHandle<State, Actions> {
  return defineStore({ init: (): State => ({ selected: null, revision: 0 }), actions: {
    select: (state, selected: ConversationSelection | null) => { state.selected = selected },
    refresh: (state) => { state.revision++ },
  } })
}
/** Framework-derived selection seats, supplied only to the two navigation entries. */
export type ConversationSelectionProps = PropsStore<ReturnType<typeof createConversationStore>>
