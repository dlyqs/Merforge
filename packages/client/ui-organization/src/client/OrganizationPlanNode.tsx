/** Shared Chat node presentation with fresh organization task authority. */
import { useEffect, useState } from 'react'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import type { ChatNodeViewProps } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { ConversationResult, ConversationRequest } from '@deepseek-ai/dsh-organization-conversation/protocol'
import type { OrganizationProps } from './contract.ts'
import { ConversationPlan } from './ConversationPlan.tsx'
/** @param props - Normal Chat node seat and fixed native task operations. @returns Authorized inline task tree. */
export function OrganizationPlanNode(props: OrganizationProps & Pick<ChatNodeViewProps<'organization-plan'>, 'node'>) {
  const c = props.useOrganization(s => s.connection)
  const [report, setReport] = useState<{ generation: number; result: ConversationResult }>()
  const [notice, setNotice] = useState(''), [busy, setBusy] = useState(false)
  const query = props.node.data
  useEffect(() => {
    let active = true; setReport(undefined)
    if (c.phase === 'ready' && c.mode === 'organization' && props.conversation) void props.conversation({
      organizationId: query.organizationId, projectId: query.projectId, conversationId: query.conversationId,
      ...(query.assignment ? { assignment: query.assignment } : {}), kind: 'read', operationId: randomUUID() as ConversationRequest['operationId'],
    }).then((value) => { if (active) setReport(value) }, () => { if (active) setNotice(props.t('conversationUnavailable')) })
    return () => { active = false }
  }, [c.generation, c.phase, c.mode, props.node])
  const goal = report?.generation === c.generation ? report.result.goals.find(goal => goal.id === query.goalId) : undefined
  if (!goal || c.phase !== 'ready' || c.mode !== 'organization') return notice ? <p role="status">{notice}</p> : null
  return <ConversationPlan {...props} query={query} goal={goal} generation={c.generation} busy={busy}
    {...(report?.result.assignment ? { assignmentId: report.result.assignment.id, assignmentTaskId: report.result.assignment.taskId } : {})}
    suggest={(taskId, membershipId) => {
      if (busy || !props.conversation) return
      setBusy(true)
      void props.conversation({ organizationId: query.organizationId, projectId: query.projectId, conversationId: query.conversationId,
        ...(query.assignment ? { assignment: query.assignment } : {}), kind: 'suggest', goalId: goal.id, taskId, membershipId,
        expectedRevision: goal.proposal?.revision ?? 0, operationId: randomUUID() as ConversationRequest['operationId'],
      }).then(setReport, () => { setNotice(props.t('conversationFailure')) }).finally(() => { setBusy(false) })
    }} />
}
