/** Private task conversation execution state in the shared task inspector. */
import { useEffect, useState } from 'react'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import { brandString } from '@deepseek-ai/dsh-brand'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { OrganizationAssignmentId, OrganizationTaskView } from '@deepseek-ai/dsh-organization'
import type { OrganizationProjectId } from '@deepseek-ai/dsh-organization/types'
import type { ConversationRequest } from '@deepseek-ai/dsh-organization-conversation/protocol'
import type { OrganizationProps } from './contract.ts'
import { taskExecutionState } from './task-execution-view.ts'
import { workgraphError } from './workgraph-view.ts'
import css from './TaskInspector.module.css'

/**
 * Display current employee execution observations in task detail.
 * @param props - Current task and account-authorized read callback.
 * @returns Observed execution state without opening or running a Session.
 */
export function TaskExecutionStatus(props: OrganizationProps & { task: OrganizationTaskView
  projectId: OrganizationProjectId
  current: boolean
  assignmentId?: OrganizationAssignmentId }) {
  const c = props.useOrganization(s => s.connection)
  const revision = props.useTaskExecutionRevision(value => value)
  const [refresh, setRefresh] = useState(0)
  const [report, setReport] = useState<{ scope: string; state: ReturnType<typeof taskExecutionState> }>()
  const [notice, setNotice] = useState('')
  const scope = `${c.principal?.serverId}:${c.principal?.accountId}:${c.organizationId}:${c.generation}:${props.task.id}:${props.task.revision}:${props.assignmentId ?? ''}`
  useEffect(() => {
    let active = true
    const isActive = () => active
    setNotice('')
    if (props.current && c.phase === 'ready' && c.mode === 'organization' && c.organizationId && props.conversation) {
      const organizationId = c.organizationId, conversation = props.conversation
      const read = async () => {
        const query = { organizationId, projectId: props.projectId, planId: props.task.planId, taskId: props.task.id }
        const reply = await props.connection({ kind: 'assignment-tasks', request: query })
        if (!isActive() || reply.assignment?.generation !== c.generation || reply.assignment.result.kind !== 'tasks') return
        const memberId = c.organizations.find(org => org.id === c.organizationId)?.membershipId
        const assignment = reply.assignment.result.value.items.find(item => item.planRevision === props.task.revision
          && item.assigneeId === memberId && (!props.assignmentId || item.id === props.assignmentId))
        if (!assignment) { setReport({ scope, state: 'unstarted' }); return }
        try {
          const result = await conversation({ kind: 'read', organizationId, projectId: props.projectId,
            conversationId: brandString<ConversationRequest['conversationId']>(assignment.id),
            assignment: { planId: assignment.planId, assignmentId: assignment.id },
            operationId: brandString<ConversationRequest['operationId']>(randomUUID()) })
          if (isActive() && result.generation === c.generation) {
            setReport({ scope, state: taskExecutionState(result.result.history, props.task, result.result.running === true) })
          }
        } catch (error) {
          if (error instanceof Error && error.message.includes('open-required')) {
            if (isActive()) setReport({ scope, state: 'unstarted' })
            return
          }
          throw error
        }
      }
      void read().catch((error: unknown) => { if (isActive()) { setReport(undefined); setNotice(props.t(workgraphError(error))) } })
    }
    return () => { active = false }
  }, [scope, props.current, c.phase, revision, refresh])
  if (!props.current || c.phase !== 'ready' || c.mode !== 'organization') return null
  const state = report?.scope === scope ? report.state : undefined
  return <section className={css.panel}>
    <div className={css.heading}>
      {state && <span role="status" className={css.status} data-ready={state === 'executed'}>{props.t(`taskConversation-${state}`)}</span>}
      <Button size="sm" onClick={() => { setRefresh(value => value + 1) }}>{props.t('refreshAssignment')}</Button>
    </div>
    {notice && <p role="alert">{notice}</p>}
    {state === 'executed' && <p className={css.hint}>{props.t('taskConversationExecutedHint')}</p>}
  </section>
}
