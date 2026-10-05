/** Task assignment and employee responses; native fixed actions enforce current authority. */
import { useEffect, useRef, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import type { OrganizationTaskView } from '@deepseek-ai/dsh-organization'
import type { OrganizationProjectId } from '@deepseek-ai/dsh-organization/types'
import type { ConnectionAction, ConnectionResult } from '@deepseek-ai/dsh-organization-connection/types'
import type { OrganizationProps } from './contract.ts'
import { MemberSelect } from './MemberSelect.tsx'
import { workgraphError } from './workgraph-view.ts'
import css from './TaskInspector.module.css'

type Preparation = Extract<NonNullable<ConnectionResult['assignment']>['result'], { kind: 'preparation' }>['value']
type History = Extract<NonNullable<ConnectionResult['assignment']>['result'], { kind: 'tasks' }>['value']

/** @param props - Current task and native identity partition. @returns Assignment, employee response and history controls. */
export function AssignmentPanel(props: OrganizationProps & {
  task: OrganizationTaskView
  projectId: OrganizationProjectId
  current: boolean
  assignmentId?: string
  onAssignmentRevision?: (revision: number | undefined) => void
}) {
  const c = props.useOrganization(s => s.connection), { t, task } = props
  const [history, setHistory] = useState<{ generation: number; value: History }>()
  const [preparation, setPreparation] = useState<{ generation: number; value: Preparation }>()
  const [assignee, setAssignee] = useState(task.suggestedMembershipId ?? '')
  const [review, setReview] = useState<Extract<NonNullable<ConnectionResult['assignment']>['result'], { kind: 'review' }>['value'] & { generation: number }>()
  const [confirmedRevision, setConfirmedRevision] = useState<number>()
  const [notice, setNotice] = useState(''), [busy, setBusy] = useState(false)
  const operationLock = useRef(false)
  const readSequence = useRef(0)
  const reviewSequence = useRef(0)
  const [reviewBusy, setReviewBusy] = useState(false)
  const blockedReview = useRef(false)
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false; reviewSequence.current++ } }, [])
  const ready = props.current && c.phase === 'ready' && c.mode === 'organization'
  const query = { organizationId: c.organizationId, projectId: props.projectId, planId: task.planId, taskId: task.id }
  const currentHistory = ready && history?.generation === c.generation ? history.value : undefined
  const current = ready && preparation?.generation === c.generation ? preparation.value : undefined
  const memberId = c.organizations.find(org => org.id === c.organizationId)?.membershipId
  const mine = current?.assignment.assigneeId === memberId
  const reviewCurrent = review?.generation === c.generation && review.assigneeId === assignee && review.planRevision === task.revision
  const writable = ready && !busy && !c.pendingOperation
  const selector = current && { organizationId: current.assignment.organizationId, projectId: props.projectId,
    planId: task.planId, assignmentId: current.assignment.id }
  const loadPreparation = async (assignmentId: string) => {
    const sequence = ++readSequence.current
    const result = await props.connection({ kind: 'assignment-preparation', request: {
      organizationId: c.organizationId, projectId: props.projectId, planId: task.planId, assignmentId } })
    if (!alive.current || sequence !== readSequence.current || result.assignment?.result.kind !== 'preparation') return
    const value = result.assignment.result.value
    setPreparation({ generation: result.assignment.generation, value })
    props.onAssignmentRevision?.(value.assignment.planRevision)
  }
  const load = async (offset = 0) => {
    const result = await props.connection({ kind: 'assignment-tasks', request: { ...query, offset,
      ...(offset && currentHistory ? { cursor: currentHistory.cursor } : {}) } })
    if (!alive.current || result.assignment?.result.kind !== 'tasks') return
    setHistory({ generation: result.assignment.generation, value: result.assignment.result.value })
    const first = result.assignment.result.value.items[0]
    const assignmentId = props.assignmentId ?? first?.id
    if (assignmentId) await loadPreparation(assignmentId)
    else { setPreparation(undefined); props.onAssignmentRevision?.(undefined) }
  }
  useEffect(() => {
    if (ready) void load().catch((error: unknown) => { if (alive.current) setNotice(t(workgraphError(error))) })
  }, [ready, c.generation, task.revision])
  const run = async (action: ConnectionAction) => {
    if (operationLock.current) return
    operationLock.current = true
    setBusy(true); setNotice('')
    try { await props.connection(action); if (alive.current) { setConfirmedRevision(undefined); await load() } }
    catch (error) {
      if (alive.current) {
        setNotice(t(workgraphError(error)))
        if (workgraphError(error) === 'version-conflict') { setConfirmedRevision(undefined); await load().catch((failure: unknown) => { if (alive.current) setNotice(t(workgraphError(failure))) }) }
      }
    } finally { operationLock.current = false; if (alive.current) setBusy(false) }
  }
  const reviewApproval = async () => {
    if (reviewBusy) return
    const sequence = ++reviewSequence.current
    setReviewBusy(true); blockedReview.current = false
    setNotice(''); setReview(undefined); setConfirmedRevision(undefined)
    try {
      const result = await props.connection({ kind: 'assignment-review', request: { ...query, planRevision: task.revision, assigneeId: assignee } })
      if (result.assignment?.result.kind !== 'review') throw new Error('unavailable')
      if (alive.current && sequence === reviewSequence.current) {
        setReview({ ...result.assignment.result.value, generation: result.assignment.generation })
      }
    } catch (error) {
      if (sequence === reviewSequence.current) blockedReview.current = true
      if (alive.current && sequence === reviewSequence.current) setNotice(t(workgraphError(error)))
    } finally { if (alive.current) setReviewBusy(false) }
  }
  const canReview = !!currentHistory && !currentHistory.items.some(item => item.state === 'pending' || item.state === 'accepted')
  useEffect(() => {
    if (ready && canReview && !busy && !reviewBusy && !reviewCurrent && !blockedReview.current
      && /^[0-9a-f-]{36}$/i.test(assignee)) void reviewApproval()
  }, [ready, canReview, assignee, task.revision, c.generation, reviewBusy, reviewCurrent, busy])
  const memberName = (id: string) => c.members.find(member => member.id === id)?.username ?? (id === memberId ? c.username ?? t('me') : t('selectedMember'))
  const participant = (fields: Record<string, unknown>) => { void run({ kind: 'assignment-participant', request: {
    ...selector, operationId: randomUUID(), ...fields } }) }
  const active = current?.assignment.state === 'pending' || current?.assignment.state === 'accepted'
  const sameVersion = current?.assignment.planRevision === task.revision
  if (!ready) return <p role="status">{t('qualificationRecheck')}</p>
  return <section className={css.panel} aria-busy={busy || reviewBusy}>
    <div className={css.heading}><h4>{t('assignmentTitle')}</h4>
      <Button size="sm" disabled={!writable} onClick={() => { void load().catch((error: unknown) => { setNotice(t(workgraphError(error))) }) }}>{t('refreshAssignment')}</Button>
    </div>
    <p className={css.hint}>{t('preparationOnly')}</p>
    {notice && <p className={css.notice} role="status">{notice}</p>}
    <section className={css.step}>
      <div className={css.stepHeading}><span aria-hidden="true">1</span><h4>{t('taskAssignmentStep')}</h4>
        {current && <span className={css.status} data-ready={current.assignment.state === 'accepted'}>{t(`assignment-${current.assignment.state}`)}</span>}
      </div>
      {currentHistory && !currentHistory.items.length && <p className={css.notice}>{t('notDispatched')}</p>}
      {current && <>
        <dl className={css.facts}><div><dt>{t('dispatcher')}</dt><dd>{memberName(current.assignment.approvedBy)}</dd></div>
          <div><dt>{t('assignee')}</dt><dd>{memberName(current.assignment.assigneeId)}</dd></div>
          <div><dt>{t('assignmentVersion', { revision: current.assignment.planRevision })}</dt><dd>{t(`assignment-${current.assignment.state}`)}</dd></div>
        </dl>
        {current.assignment.reason && <p className={css.notice}>{t(current.assignment.reason)}</p>}
        {!sameVersion && <p className={css.notice} data-tone="warn" role="alert">{t('assignmentOldVersion')}</p>}
        <p className={css.hint}>{t(current.assignment.state === 'pending' ? 'waitingEmployee' : current.assignment.state === 'accepted' ? 'waitingExecution' : 'waitingDispatcher')}</p>
        {mine && sameVersion && current.request.state === 'pending' && <div className={css.actions}>
          <Button variant="primary" disabled={!writable} onClick={() => { participant({ kind: 'answer-assignment', requestId: current.request.id,
            expectedVersion: current.assignment.version, answer: 'accepted' }) }}>{t('acceptAssignment')}</Button>
          <Button variant="outline" disabled={!writable} onClick={() => { participant({ kind: 'answer-assignment', requestId: current.request.id,
            expectedVersion: current.assignment.version, answer: 'rejected' }) }}>{t('rejectAssignment')}</Button>
        </div>}
      </>}
      {canReview && <form className={css.form} onSubmit={(event) => {
        event.preventDefault()
        if (!writable || !reviewCurrent || !review.canAssign || confirmedRevision !== task.revision) return
        void run({ kind: 'assignment-command', request: { ...query, operationId: randomUUID(), kind: 'approve-assignment',
          planRevision: task.revision, assigneeId: assignee } })
      }}>
        <p className={css.hint}>{t('approvalAccessHint')}</p>
        <MemberSelect t={t} connection={c} assignableOnly labelKey="assignee" disabled={!writable} value={assignee} change={(value) => {
          reviewSequence.current++; blockedReview.current = false; setReview(undefined); setAssignee(value); setConfirmedRevision(undefined)
        }} />
        {!reviewCurrent && <Button disabled={!writable || !assignee || reviewBusy} onClick={() => { void reviewApproval() }}>{t(reviewBusy ? 'working' : 'reviewApprovalAccess')}</Button>}
        {reviewCurrent && <p className={css.notice} role="status">{t(review.canAssign ? 'approvalAccessReady' : 'approvalAccessMissing')}</p>}
        <label><input type="checkbox" disabled={!writable || !reviewCurrent || !review.canAssign} checked={confirmedRevision === task.revision}
          onChange={(event) => { setConfirmedRevision(event.target.checked ? task.revision : undefined) }} />{t('confirmApproval', { revision: task.revision })}</label>
        <div className={css.footer}><Button variant="primary" type="submit" disabled={!writable || !reviewCurrent || !review.canAssign || confirmedRevision !== task.revision}>{t('approveAssignment')}</Button></div>
      </form>}
    </section>
    {current?.assignment.state === 'accepted' && sameVersion && <section className={css.step}>
      <div className={css.stepHeading}><span aria-hidden="true">2</span><h4>{t('taskExecutionReady')}</h4></div>
      <p className={css.hint}>{t('taskAcceptedNext')}</p>
    </section>}
    {current && active && current.assignment.approvedBy === memberId && <details className={css.advanced}>
      <summary>{t('taskManageAuthority')}</summary><div className={css.panel}>
        <p className={css.hint}>{t('taskRevokeHint')}</p>
        <div className={css.actions}><Button className={css.danger} disabled={!writable} onClick={() => {
          void run({ kind: 'assignment-command', request: { ...selector, operationId: randomUUID(),
            kind: 'revoke-assignment', expectedVersion: current.assignment.version } })
        }}>{t('revokeAssignment')}</Button></div>
      </div>
    </details>}
    {currentHistory && currentHistory.total > 1 && <details className={css.advanced}><summary>{t('assignmentHistory')}</summary><div className={css.actions}>
      {currentHistory.items.map(item => <Button key={item.id} disabled={!writable} onClick={() => {
        void loadPreparation(item.id).catch((error: unknown) => { setNotice(t(workgraphError(error))) })
      }}>{t('assignmentVersion', { revision: item.planRevision })} · {t(`assignment-${item.state}`)}</Button>)}
      <Button disabled={!writable || currentHistory.offset === 0} onClick={() => { void load().catch((error: unknown) => { setNotice(t(workgraphError(error))) }) }}>{t('firstPage')}</Button>
      <Button disabled={!writable || currentHistory.offset + currentHistory.items.length >= currentHistory.total} onClick={() => {
        void load(currentHistory.offset + currentHistory.items.length).catch((error: unknown) => { setNotice(t(workgraphError(error))) })
      }}>{t('next')}</Button>
    </div></details>}
  </section>
}
