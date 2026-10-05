/** Conversation task controls read current authority and reuse the explicit human action consumers. */
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { OrganizationTaskView, OrganizationPlanId, OrganizationTaskId, OrganizationAssignmentId } from '@deepseek-ai/dsh-organization'
import type { OrganizationProjectId } from '@deepseek-ai/dsh-organization/types'
import type { OrganizationProps } from './contract.ts'
import { TaskInspector } from './TaskInspector.tsx'
import css from './TaskInspector.module.css'

/**
 * @param props - Selected authorized task and optional immutable assignment.
 * @returns Human controls for the task already summarized in the shared detail panel.
 */
export function ConversationTask(props: OrganizationProps & { projectId: OrganizationProjectId
  planId: OrganizationPlanId
  taskId: OrganizationTaskId
  assignmentId?: OrganizationAssignmentId
  overview?: ReactNode
  assignmentTools?: ReactNode
  onClose: () => void }) {
  const c = props.useOrganization(s => s.connection)
  const [detail, setDetail] = useState<{ generation: number; task: OrganizationTaskView }>()
  useEffect(() => {
    let active = true
    if (c.phase === 'ready' && c.mode === 'organization') void props.connection({ kind: 'workgraph-tasks', request: {
      organizationId: c.organizationId, projectId: props.projectId, planId: props.planId, taskId: props.taskId,
    } }).then((r) => {
      if (active && r.workgraph?.result.kind === 'tasks') {
        const task = r.workgraph.result.value.items.find(t => t.id === props.taskId)
        if (task) setDetail({ generation: r.workgraph.generation, task })
      }
    }, () => { if (active) setDetail(undefined) })
    return () => { active = false }
  }, [c.generation, c.phase, props.taskId, props.planId])
  const current = c.phase === 'ready' && c.mode === 'organization' && detail?.generation === c.generation
  return detail ? <div className={css.container} hidden={!current}>
    <TaskInspector {...props} task={detail.task} current={current} overview={props.overview} onClose={props.onClose} />
  </div> : null
}
