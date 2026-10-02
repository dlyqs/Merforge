/** Explicit per-leaf review and batch confirmation over the native durable approval journal. */
import { useEffect, useRef, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import type { ConversationResult } from '@deepseek-ai/dsh-organization-conversation/protocol'
import type { ConnectionResult } from '@deepseek-ai/dsh-organization-connection/types'
import type { OrganizationProjectId } from '@deepseek-ai/dsh-organization/types'
import type { OrganizationProps } from './contract.ts'
import { workgraphError } from './workgraph-view.ts'
import css from './Organization.module.css'

type Proposal = NonNullable<ConversationResult['goals'][number]['proposal']>
/**
 * @param props - Current shared definition with explicitly selected human suggestions.
 * @returns Review, separate confirmation and per-item results.
 */
export function AssignmentBatch(props: OrganizationProps & { proposal: Proposal; projectId: OrganizationProjectId }) {
  const c = props.useOrganization(s => s.connection), { t, proposal } = props
  const [selected, setSelected] = useState<string[]>([]), [confirmed, setConfirmed] = useState(false)
  const [reviews, setReviews] = useState<{ generation: number; tasks: string[] }>()
  const [batch, setBatch] = useState<ConnectionResult['assignmentBatch']>()
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState('')
  const alive = useRef(true), lock = useRef(false), epoch = useRef(0)
  const identity = `${c.principal?.serverId}:${c.principal?.accountId}:${c.organizationId}`
  const currentIdentity = useRef(identity); currentIdentity.current = identity
  const tasks = proposal.definition?.tasks ?? [], leaves = tasks.filter(t => !tasks.some(child => child.parentTaskId === t.id))
  const query = { organizationId: c.organizationId, projectId: props.projectId, planId: proposal.planId, planRevision: proposal.revision }
  const ready = c.phase === 'ready' && c.mode === 'organization' && proposal.status === 'shared'
  useEffect(() => { alive.current = true; return () => { alive.current = false; epoch.current++ } }, [])
  useEffect(() => {
    const sequence = ++epoch.current
    setConfirmed(false); setReviews(undefined)
    if (ready && !lock.current) void props.connection({ kind: 'assignment-batch-read', request: query }).then((r) => {
      if (alive.current && sequence === epoch.current) setBatch(r.assignmentBatch)
    }, () => { if (alive.current && sequence === epoch.current) setBatch(undefined) })
  }, [c.generation, ready, proposal.revision])
  const review = async () => {
    if (lock.current) return
    lock.current = true; setBusy(true); setConfirmed(false); setNotice('')
    const sequence = ++epoch.current
    try {
      const reviewed: string[] = []
      for (const task of leaves.filter(t => selected.includes(t.id))) {
        const r = await props.connection({ kind: 'assignment-review', request: { ...query, taskId: task.id, assigneeId: task.suggestedMembershipId } })
        if (!alive.current || sequence !== epoch.current) return
        if (r.assignment?.result.kind !== 'review' || !r.assignment.result.value.assigneeCanRead) throw new Error('forbidden')
        reviewed.push(task.id)
      }
      setReviews({ generation: c.generation, tasks: reviewed })
    } catch (e) { if (alive.current && sequence === epoch.current) { setReviews(undefined); setNotice(t(workgraphError(e))) } }
    finally { lock.current = false; if (alive.current) setBusy(false) }
  }
  const approve = async () => {
    if (lock.current || !confirmed || reviews?.generation !== c.generation) return
    lock.current = true; setBusy(true); setNotice('')
    try {
      const r = await props.connection({ kind: 'assignment-batch', request: { ...query, confirmed: true,
        commands: leaves.filter(t => reviews.tasks.includes(t.id)).map(task => ({ ...query, kind: 'approve-assignment',
          taskId: task.id, assigneeId: task.suggestedMembershipId, operationId: randomUUID() })) } })
      if (alive.current && currentIdentity.current === identity) setBatch(r.assignmentBatch)
    } catch (e) { if (alive.current && currentIdentity.current === identity) setNotice(t(workgraphError(e))) }
    finally { lock.current = false; if (alive.current) { setBusy(false); setConfirmed(false); setReviews(undefined) } }
  }
  return <section className={css.card} aria-busy={busy}>
    <h4>{t('conversationBatchTitle')}</h4><p>{t('conversationBatchHint')}</p>
    {leaves.map((task) => {
      const outcome = batch?.items.find(i => i.command.taskId === task.id)
      return <article key={task.id}>
        <label><input type="checkbox" disabled={!ready || busy || !task.suggestedMembershipId
          || !!outcome && ['confirmed', 'unknown'].includes(outcome.state)} checked={selected.includes(task.id)} onChange={(e) => {
          setSelected(e.target.checked ? [...selected, task.id] : selected.filter(id => id !== task.id))
          setReviews(undefined); setConfirmed(false)
        }} />{task.goal}</label>
        <p>{t('taskVersion', { revision: proposal.revision })} · {t('assignee')}: {task.suggestedMembershipId ?? t('chooseMember')}</p>
        <p>{task.scope}</p><ul>{task.acceptance.map((a, i) => <li key={i}>{a}</li>)}</ul>
        <p>{t('taskArtifacts')}: {task.artifacts.join(', ')}</p><p>{t('conversationBatchNoExecution')}</p>
        {outcome && <p role="status">{t(`conversationBatch-${outcome.state}`)}</p>}
      </article>
    })}
    {notice && <p role="status">{notice}</p>}
    <Button disabled={!ready || busy || !selected.length || !!c.pendingOperation} onClick={() => { void review() }}>{t('reviewApprovalAccess')}</Button>
    <label><input type="checkbox" disabled={!ready || busy || reviews?.generation !== c.generation || !reviews.tasks.length}
      checked={confirmed} onChange={(e) => { setConfirmed(e.target.checked) }} />{t('confirmApproval', { revision: proposal.revision })}</label>
    <Button disabled={!ready || busy || !confirmed || !!c.pendingOperation} onClick={() => { void approve() }}>{t('conversationBatchConfirm')}</Button>
  </section>
}
