/** Conversation task controls read current authority and reuse the explicit human action consumers. */
import { useEffect, useState } from 'react'
import type { OrganizationTaskView, OrganizationPlanId, OrganizationTaskId, OrganizationAssignmentId } from '@deepseek-ai/dsh-organization'
import type { OrganizationProjectId } from '@deepseek-ai/dsh-organization/types'
import type { OrganizationProps } from './contract.ts'
import { AssignmentPanel } from './AssignmentPanel.tsx'
import { ExecutionPanel } from './ExecutionPanel.tsx'
import { IntegrationPanel } from './IntegrationPanel.tsx'

/** @param props - Selected authorized task and optional immutable assignment. @returns Existing human controls with current task facts. */
export function ConversationTask(props: OrganizationProps & { projectId: OrganizationProjectId
  planId: OrganizationPlanId
  taskId: OrganizationTaskId
  assignmentId?: OrganizationAssignmentId }) {
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
  if (!detail) return null
  return <div hidden={!current}>
    <AssignmentPanel key={`${props.taskId}:${props.assignmentId ?? ''}`} {...props} task={detail.task} current={current} />
    <ExecutionPanel key={`${props.taskId}:${props.assignmentId ?? ''}:${detail.task.revision}`} {...props} task={detail.task} current={current} />
    {current && <IntegrationPanel {...props} task={detail.task} />}
  </div>
}
