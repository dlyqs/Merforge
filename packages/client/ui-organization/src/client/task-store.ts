/** Shared organization task selection; task facts remain in the native authority. */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import type { PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { OrganizationId, OrganizationProjectId, Principal } from '@deepseek-ai/dsh-organization/types'
import type { OrganizationTaskView } from '@deepseek-ai/dsh-organization'
type Selection = Principal & Pick<OrganizationTaskView, 'planId'> & { organizationId: OrganizationId; projectId: OrganizationProjectId; taskId: OrganizationTaskView['id'] }
type State = { selected: Selection | null }
type Actions = { selectTask: (state: State, selected: Selection | null) => void }
/** Create the organization task viewing store.
 * @returns A registration-owned task selection store.
 */
export function createOrganizationTaskStore(): EngineStoreHandle<State, Actions> {
  return defineStore({ init: (): { selected: Selection | null } => ({ selected: null }), actions: {
    selectTask: (state, selected: Selection | null) => { state.selected = selected },
  } })
}
/** Framework-created task selection hook and callbacks. */
export type OrganizationTaskSelectionProps = PropsStore<ReturnType<typeof createOrganizationTaskStore>>
