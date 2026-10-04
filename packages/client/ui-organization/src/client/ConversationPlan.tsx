/** Current unapproved tree, minimal member candidates and read-only task lifecycle details. */
import { useEffect, useRef, useState } from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ConversationRequest, ConversationResult } from '@deepseek-ai/dsh-organization-conversation/protocol'
import type { OrganizationAssignmentId, OrganizationTaskId } from '@deepseek-ai/dsh-organization'
import type { ConnectionResult } from '@deepseek-ai/dsh-organization-connection/types'
import type { OrganizationProps } from './contract.ts'
import type { OrganizationKey } from './locales.ts'
import { AssignmentBatch } from './AssignmentBatch.tsx'
import { ConversationTask } from './ConversationTask.tsx'
import css from './Organization.module.css'
import { taskWorkspaceStyles } from '@deepseek-ai/dsh-client-ui-primitives'
import { TaskCanvas } from './TaskCanvas.tsx'

type Query = Pick<ConversationRequest, 'organizationId' | 'projectId' | 'conversationId'>
type Goal = ConversationResult['goals'][number]
type Definition = NonNullable<NonNullable<Goal['proposal']>['definition']>
type Task = Definition['tasks'][number]
/** @param props - Authorized tree and explicit suggestion action. @returns Versioned tree and selected task facts. */
export function ConversationPlan(props: OrganizationProps & {
  goal: Goal
  query: Query
  generation: number
  busy: boolean
  assignmentId?: OrganizationAssignmentId
  assignmentTaskId?: OrganizationTaskId
  suggest(taskId: Task['id'], membershipId: Task['suggestedMembershipId']): void }) {
  const alive = useRef(false), reviewEpoch = useRef(0)
  useEffect(() => { alive.current = true; return () => { alive.current = false; reviewEpoch.current++ } }, [])
  const { t, goal } = props, proposal = goal.proposal
  const [selected, setSelected] = useState(''), [search, setSearch] = useState('')
  const [candidates, setCandidates] = useState<NonNullable<ConnectionResult['candidates']>>()
  const [offset, setOffset] = useState(0), [notice, setNotice] = useState('')
  const [facts, setFacts] = useState<{ history: ConnectionResult['assignment']; executions?: ConnectionResult['executions']; delivery?: ConnectionResult['delivery'] }>()
  const task = proposal?.definition?.tasks.find(item => item.id === selected) ?? proposal?.definition?.tasks[0]
  useEffect(() => {
    let active = true
    setCandidates(undefined); setNotice('')
    void props.connection({ kind: 'planning-candidates', request: { organizationId: props.query.organizationId,
      projectId: props.query.projectId, search, offset } }).then((r) => { if (active) setCandidates(r.candidates) }, () => { if (active) setNotice(t('conversationMemberUnavailable')) })
    return () => { active = false }
  }, [search, offset, props.generation])
  useEffect(() => {
    const lifetime = { active: true }
    reviewEpoch.current++
    setFacts(undefined)
    if (!task || proposal?.status !== 'shared') return
    const query = { organizationId: props.query.organizationId, projectId: props.query.projectId, planId: proposal.planId }
    void (async () => {
      const history = await props.connection({ kind: 'assignment-tasks', request: { ...query, taskId: task.id } })
      if (history.assignment?.result.kind !== 'tasks') return
      const assignment = history.assignment.result.value.items[0]
      if (!assignment) { if (lifetime.active) setFacts({ history: history.assignment }); return }
      const [executions, delivery] = await Promise.all([
        props.connection({ kind: 'execution-list', request: { ...query, assignmentId: assignment.id } }),
        props.connection({ kind: 'delivery-read', request: { ...query, assignmentId: assignment.id } }),
      ])
      if (lifetime.active) setFacts({ history: history.assignment, executions: executions.executions, delivery: delivery.delivery })
    })().catch(() => { if (lifetime.active) setNotice(t('conversationDetailsRestricted')) })
    return () => { lifetime.active = false }
  }, [task?.id, proposal?.revision, proposal?.status, props.generation])
  if (!proposal || !props.query.projectId) return null
  const status: Record<typeof proposal.status, OrganizationKey> = { shared: 'conversationShared', private: 'conversationSuggestion',
    conflict: 'draftConflict', unknown: 'conversationUnknown', unavailable: 'conversationUnavailable' }
  const tasks = proposal.definition?.tasks ?? []
  const assignment = facts?.history?.result.kind === 'tasks' ? facts.history.result.value.items[0] : undefined
  const submission = facts?.delivery?.submissions[0], run = facts?.executions?.items[0]
  const name = (id: string | null | undefined) => candidates?.items.find(m => m.membershipId === id)?.username ?? (id ? t('selectedMember') : t('chooseMember'))
  return <section className={css.card}>
    <h3>{t(status[proposal.status])}</h3><p>{t('taskVersion', { revision: proposal.revision })}</p>
    <p>{t('conversationImpact')}</p>
    <TaskCanvas tasks={tasks.map(item => ({ ...item, phaseTitle: proposal.definition?.phases.find(phase => phase.id === item.phaseId)?.title ?? '' }))}
      selected={task?.id ?? null} t={t} onSelect={setSelected}>
      {task && <article className={taskWorkspaceStyles.detail} aria-label={t('taskDetail')}>
        <h4>{task.goal}</h4><p>{task.scope}</p><ul>{task.acceptance.map((a, i) => <li key={i}>{a}</li>)}</ul>
        <p>{t('taskArtifacts')}: {task.artifacts.join(', ')}</p>
        <p>{t('assignee')}: {name(assignment?.assigneeId ?? task.suggestedMembershipId)}</p>
        <p>{assignment ? t(`assignment-${assignment.state}`) : t('conversationUnassigned')}</p>
        {run && <p>{t(`run-${run.state}`)}</p>}
        <p>{submission?.reviewState === 'pending' ? t('waitingDispatcher') : assignment?.state === 'pending' ? t('waitingEmployee') : t('waitingPreparation')}</p>
        <p>{t('conversationLatestSubmission')}: {submission?.summary ?? t('conversationNoSubmission')}</p>
        <label className={css.field}>{t('conversationFindMember')}<Input value={search} onChange={(e) => { setSearch(e.target.value); setOffset(0) }} /></label>
        {candidates && candidates.total > 1 && search && <p>{t('conversationAmbiguous')}</p>}
        <label className={css.field}>{t('suggestedMember')}<select disabled={props.busy || !candidates || !['shared', 'private'].includes(proposal.status)} value={task.suggestedMembershipId ?? ''} onChange={(e) => {
          const member = candidates?.items.find(m => m.membershipId === e.target.value)
          if (member || e.target.value === '') props.suggest(task.id, member?.membershipId ?? null)
        }}><option value="">{t('chooseMember')}</option>
          {task.suggestedMembershipId && !candidates?.items.some(m => m.membershipId === task.suggestedMembershipId) && <option value={task.suggestedMembershipId}>{t('conversationMemberUnavailable')}</option>}
          {candidates?.items.map(m => <option key={m.membershipId} value={m.membershipId}>{m.username} · {m.membershipId}</option>)}
        </select></label>
        {candidates && <div className={css.actions}><Button disabled={offset === 0} onClick={() => { setOffset(0) }}>{t('refreshAccess')}</Button>
          <Button disabled={offset + candidates.items.length >= candidates.total} onClick={() => { setOffset(offset + candidates.items.length) }}>{t('conversationMoreMembers')}</Button></div>}
        <p>{t('conversationSuggestionOnly')}</p>
        {task.suggestedMembershipId && proposal.status === 'shared' && <Button disabled={props.busy} onClick={() => {
          const epoch = ++reviewEpoch.current
          void props.connection({ kind: 'assignment-review', request: { organizationId: props.query.organizationId, projectId: props.query.projectId,
            planId: proposal.planId, planRevision: proposal.revision, taskId: task.id, assigneeId: task.suggestedMembershipId,
          } }).then((r) => {
            if (!alive.current || epoch !== reviewEpoch.current) return
            if (r.assignment?.result.kind === 'review') setNotice(t(r.assignment.result.value.assigneeCanRead ? 'approvalAccessReady' : 'approvalAccessMissing'))
          }, () => { if (alive.current && epoch === reviewEpoch.current) setNotice(t('conversationDetailsRestricted')) })
        }}>{t('reviewApprovalAccess')}</Button>}
        {proposal.status === 'shared' && !props.assignmentId && <AssignmentBatch key={`${proposal.planId}:${proposal.revision}`} {...props} proposal={proposal} projectId={props.query.projectId} />}
        {proposal.status === 'shared' && (!props.assignmentId || props.assignmentTaskId === task.id) && <ConversationTask key={task.id} {...props} projectId={props.query.projectId}
          planId={proposal.planId} taskId={task.id} />}
      </article>}
    </TaskCanvas>
    {notice && <p role="status">{notice}</p>}
  </section>
}
