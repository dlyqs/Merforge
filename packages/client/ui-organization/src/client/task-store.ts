/** Shared organization task selection; task facts remain in the native authority. */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import type { PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { OrganizationId, OrganizationProjectId, OrganizationProjectView, Principal } from '@deepseek-ai/dsh-organization/types'
import type { OrganizationTaskView } from '@deepseek-ai/dsh-organization'
type Selection = Principal & Pick<OrganizationTaskView, 'planId'> & { organizationId: OrganizationId
  projectId: OrganizationProjectId
  taskId: OrganizationTaskView['id']
  assignmentId?: import('@deepseek-ai/dsh-organization').OrganizationAssignmentId }
type ProjectSelection = Principal & { project: OrganizationProjectView }
type State = { selected: Selection | null; project: ProjectSelection | null }
type Actions = {
  removeProject: (state: State, projectId: OrganizationProjectId) => void
  selectTask: (state: State, selected: Selection | null) => void
  selectProject: (state: State, project: ProjectSelection) => void
}
/** Create the organization task viewing store.
 * @returns A registration-owned task selection store.
 */
export function createOrganizationTaskStore(): EngineStoreHandle<State, Actions> {
  return defineStore({ init: (): State => ({ selected: null, project: null }), actions: {
    removeProject: (state, projectId) => {
      if (state.project?.project.id === projectId) state.project = null
      if (state.selected?.projectId === projectId) state.selected = null
    },
    selectProject: (state, project) => { state.project = project; state.selected = null },
    selectTask: (state, selected: Selection | null) => { state.selected = selected; state.project = null },
  } })
}
/** Framework-created task selection hook and callbacks. */
export type OrganizationTaskSelectionProps = PropsStore<ReturnType<typeof createOrganizationTaskStore>>
