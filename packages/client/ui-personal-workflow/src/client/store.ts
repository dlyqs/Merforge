/** Shared task selection and review state across the list and main workspace. */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import type { TaskId } from '@deepseek-ai/dsh-personal-workflow/types'

type WorkflowState = { selected: TaskId | null; editing: boolean; revision: number }
type WorkflowStoreActions = {
  select: (state: WorkflowState, id: TaskId) => void
  setEditing: (state: WorkflowState, editing: boolean) => void
  refresh: (state: WorkflowState) => void
}

/** Create shared task browsing and editing state.
 * @returns A per-plugin selection store; plan records remain in the Host.
 */
export function createWorkflowStore(): EngineStoreHandle<WorkflowState, WorkflowStoreActions> {
  return defineStore({
    init: (): WorkflowState => ({ selected: null, editing: false, revision: 0 }),
    actions: {
      select: (state, id: TaskId) => { if (!state.editing) state.selected = id },
      setEditing: (state, editing: boolean) => { state.editing = editing },
      refresh: (state) => { state.revision += 1 },
    },
  })
}
