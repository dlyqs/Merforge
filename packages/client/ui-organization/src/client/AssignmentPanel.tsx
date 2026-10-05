/** Explicit approval and preparation controls; all authority remains in native fixed actions. */
import { useEffect, useRef, useState } from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import type { OrganizationTaskView, OrganizationDevice } from '@deepseek-ai/dsh-organization'
import type { OrganizationProjectId } from '@deepseek-ai/dsh-organization/types'
import type { ConnectionAction, ConnectionResult } from '@deepseek-ai/dsh-organization-connection/types'
import type { OrganizationProps } from './contract.ts'
import { MemberSelect } from './MemberSelect.tsx'
import { DeliveryPanel } from './DeliveryPanel.tsx'
import { workgraphError } from './workgraph-view.ts'
import css from './Organization.module.css'

type Preparation = Extract<NonNullable<ConnectionResult['assignment']>['result'], { kind: 'preparation' }>['value']
type History = Extract<NonNullable<ConnectionResult['assignment']>['result'], { kind: 'tasks' }>['value']

/** @param props - Current task and native identity partition. @returns Separate approval, answer, delegation and lease controls. */
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
  const [device, setDevice] = useState<OrganizationDevice | null>(null)
  const [assignee, setAssignee] = useState(task.suggestedMembershipId ?? '')
  const [review, setReview] = useState<Extract<NonNullable<ConnectionResult['assignment']>['result'], { kind: 'review' }>['value'] & { generation: number }>()
  const [confirmedRevision, setConfirmedRevision] = useState<number>()
  const [deviceName, setDeviceName] = useState(t('deviceDefaultName'))
  const [duration, setDuration] = useState(''), [budget, setBudget] = useState('')
  const [draftCapability, setDraftCapability] = useState(false)
  const [notice, setNotice] = useState(''), [busy, setBusy] = useState(false)
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
    if (value.assignment.assigneeId === memberId) {
      const local = await props.connection({ kind: 'device-read' })
      if (sequence === readSequence.current && local.assignment?.result.kind === 'device') setDevice(local.assignment.result.value)
    }
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
    setBusy(true); setNotice('')
    try { await props.connection(action); if (alive.current) { setConfirmedRevision(undefined); await load() } }
    catch (error) {
      if (alive.current) {
        setNotice(t(workgraphError(error)))
        if (workgraphError(error) === 'version-conflict') { setConfirmedRevision(undefined); await load().catch((failure: unknown) => { if (alive.current) setNotice(t(workgraphError(failure))) }) }
      }
    } finally { if (alive.current) setBusy(false) }
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
  const localDelegation = current?.delegations.find(item => item.deviceId === device?.id && item.state === 'active')
  if (!ready) return <p role="status">{t('qualificationRecheck')}</p>
  return <section className={css.card} aria-busy={busy}>
    <h4>{t('assignmentTitle')}</h4><p>{t('preparationOnly')}</p>
    {notice && <p role="status">{notice}</p>}
    <Button disabled={!writable} onClick={() => { void load().catch((error: unknown) =>{  setNotice(t(workgraphError(error))) }) }}>{t('refreshAssignment')}</Button>
    {current && <DeliveryPanel key={current.assignment.id} {...props} assignment={current.assignment} />}
    {currentHistory && !currentHistory.items.length && <p>{t('notDispatched')}</p>}
    {currentHistory && currentHistory.total > 1 && <details className={css.advanced}><summary>{t('assignmentHistory')}</summary><div className={css.actions}>
      {currentHistory.items.map(item => <Button key={item.id} disabled={!writable} onClick={() => {
        void loadPreparation(item.id).catch((error: unknown) =>{  setNotice(t(workgraphError(error))) })
      }}>{t('assignmentVersion', { revision: item.planRevision })} · {t(`assignment-${item.state}`)}</Button>)}
      <Button disabled={!writable || currentHistory.offset === 0} onClick={() => { void load().catch((error: unknown) =>{  setNotice(t(workgraphError(error))) }) }}>{t('firstPage')}</Button>
      <Button disabled={!writable || currentHistory.offset + currentHistory.items.length >= currentHistory.total}
        onClick={() => { void load(currentHistory.offset + currentHistory.items.length).catch((error: unknown) =>{  setNotice(t(workgraphError(error))) }) }}>{t('next')}</Button>
    </div></details>}
    {current && <>
      <p>{t('assignmentVersion', { revision: current.assignment.planRevision })} · {t(`assignment-${current.assignment.state}`)}</p>
      <p>{t('dispatcher')}: {memberName(current.assignment.approvedBy)}</p><p>{t('assignee')}: {memberName(current.assignment.assigneeId)}</p>
      {current.assignment.reason && <p>{t(current.assignment.reason)}</p>}
      {!sameVersion && <p role="alert">{t('assignmentOldVersion')}</p>}
      <p>{t(current.assignment.state === 'pending' ? 'waitingEmployee' : current.assignment.state === 'accepted' ? 'waitingPreparation' : 'waitingDispatcher')}</p>
      {active && <Button disabled={!writable} onClick={() => { void run({ kind: 'assignment-command', request: {
        ...selector, operationId: randomUUID(), kind: 'revoke-assignment', expectedVersion: current.assignment.version } }) }}>{t('revokeAssignment')}</Button>}
      {mine && sameVersion && current.request.state === 'pending' && <div className={css.actions}>
        <Button disabled={!writable} onClick={() =>{  participant({ kind: 'answer-assignment', requestId: current.request.id,
          expectedVersion: current.assignment.version, answer: 'accepted' }) }}>{t('acceptAssignment')}</Button>
        <Button disabled={!writable} onClick={() =>{  participant({ kind: 'answer-assignment', requestId: current.request.id,
          expectedVersion: current.assignment.version, answer: 'rejected' }) }}>{t('rejectAssignment')}</Button>
      </div>}
      <h4>{t('delegationTitle')}</h4>
      {!current.delegations.length && <p>{t('noDelegation')}</p>}
      {current.delegations.map(item => <div key={item.id}>
        <p>{t(`delegation-${item.state}`)} · {item.deviceId === device?.id ? device.name : t('otherDevice')} · {t('delegationBudget')}: {item.budget}</p>
        <p>{t('expiresAt')}: {new Date(item.expiresAt).toLocaleString()}</p>
        <p>{item.capabilities.map(capability => t(capability === 'draft' ? 'draftCapability' : 'readCapability')).join(', ')}</p>
        {mine && item.state === 'active' && <Button disabled={!writable} onClick={() =>{  participant({ kind: 'revoke-delegation', delegationId: item.id,
          expectedVersion: item.version }) }}>{t('revokeDelegation')}</Button>}
      </div>)}
      <h4>{t('leaseTitle')}</h4>
      <p>{t(current.lease ? `lease-${current.lease.state}` : 'noLease')}</p>
      {current.lease && <><p>{t('expiresAt')}: {new Date(current.lease.expiresAt).toLocaleString()}</p><details className={css.advanced}><summary>{t('technicalDetails')}</summary><p>{t('deviceId')}: {current.lease.deviceId} · {t('ownershipEpoch')}: {current.lease.fencingEpoch}</p></details></>}
      {mine && <>
        <p>{t(c.renewing === current.assignment.id ? 'renewingLease' : 'qualificationRecheck')}</p>
        {current.lease?.state === 'held' && current.lease.deviceId === device?.id && <div className={css.actions}>
          <Button disabled={!writable} onClick={() => { void run({ kind: 'lease-check', request: selector }) }}>{t('checkLease')}</Button>
          <Button disabled={!writable} onClick={() => { void run({ kind: 'lease-release', request: selector }) }}>{t('releaseLease')}</Button>
        </div>}
        {sameVersion && current.assignment.state === 'accepted' && <>
          <h4>{t('localDevice')}</h4><p>{device?.name ?? t('noDevice')}</p>
          {(!device || device.state === 'revoked') && <form onSubmit={(event) => { event.preventDefault(); void run({ kind: 'device-register', name: deviceName }) }}>
            <label>{t('deviceName')}<Input value={deviceName} onChange={(event) =>{  setDeviceName(event.target.value) }} /></label>
            <Button type="submit" disabled={!writable || !deviceName.trim()}>{t('registerDevice')}</Button>
          </form>}
          {device?.state === 'active' && <details className={css.advanced}><summary>{t('deviceSettings')}</summary><Button disabled={!writable} onClick={() => { void run({ kind: 'device-revoke', expectedVersion: device.version }) }}>{t('revokeDevice')}</Button></details>}
          {device?.state === 'revoked' && <p>{t('deviceRevoked')}</p>}
          {device?.state === 'active' && !localDelegation && <form className={css.form} onSubmit={(event) => {
            event.preventDefault(); void run({ kind: 'assignment-delegate', request: { ...selector, operationId: randomUUID(), kind: 'delegate',
              expectedVersion: current.assignment.version, executorId: 'desktop-builtin', capabilities: draftCapability ? ['task-read', 'draft'] : ['task-read'],
              budget: Number(budget), durationMs: Number(duration) * 60000 } })
          }}>
            <p>{t('delegationLimits', { minutes: current.delegationMaxDurationMs / 60000, budget: current.delegationMaxBudget })}</p>
            <label>{t('delegationMinutes')}<Input type="number" min={1 / 60} max={current.delegationMaxDurationMs / 60000} step="any" value={duration} onChange={(event) =>{  setDuration(event.target.value) }} /></label>
            <label>{t('delegationBudget')}<Input type="number" min={1} max={current.delegationMaxBudget} value={budget} onChange={(event) =>{  setBudget(event.target.value) }} /></label>
            <p>{t('readCapability')}</p><label><input type="checkbox" checked={draftCapability} onChange={(event) =>{  setDraftCapability(event.target.checked) }} />{t('draftCapability')}</label>
            <Button type="submit" disabled={!writable || Number(duration) <= 0 || Number(budget) <= 0}>{t('delegateExplicitly')}</Button>
          </form>}
          {localDelegation && current.lease?.state !== 'held' && <Button disabled={!writable} onClick={() => { void run({ kind: 'lease-claim', request: {
            ...selector, delegationId: localDelegation.id } }) }}>{t('claimExplicitly')}</Button>}
        </>}
      </>}
    </>}
    {currentHistory && !currentHistory.items.some(item => item.state === 'pending' || item.state === 'accepted') && <form className={css.form} onSubmit={(event) => {
      event.preventDefault(); void run({ kind: 'assignment-command', request: { ...query, operationId: randomUUID(), kind: 'approve-assignment',
        planRevision: task.revision, assigneeId: assignee } })
    }}>
      <h4>{t('approveAssignment')}</h4><p>{t('approvalAccessHint')}</p>
      <MemberSelect t={t} connection={c} assignableOnly labelKey="assignee" disabled={!writable} value={assignee} change={(value) => {
        reviewSequence.current++; blockedReview.current = false; setReview(undefined); setAssignee(value); setConfirmedRevision(undefined)
      }} />
      {!reviewCurrent && <Button disabled={!writable || !assignee} onClick={() => { void reviewApproval() }}>{t('reviewApprovalAccess')}</Button>}
      {reviewCurrent && <p role="status">{t(review.canAssign ? 'approvalAccessReady' : 'approvalAccessMissing')}</p>}
      <label><input type="checkbox" disabled={!reviewCurrent || !review.canAssign} checked={confirmedRevision === task.revision} onChange={(event) =>{  setConfirmedRevision(event.target.checked ? task.revision : undefined) }} />{t('confirmApproval', { revision: task.revision })}</label>
      <Button type="submit" disabled={!writable || !reviewCurrent || !review.canAssign || confirmedRevision !== task.revision}>{t('approveAssignment')}</Button>
    </form>}
  </section>
}
