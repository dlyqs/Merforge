/** Designated human answers are separate from execution continuation and task acceptance. */
import { useRef, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import type { OrganizationInboxItem } from '@deepseek-ai/dsh-organization'
import type { OrganizationProps } from './contract.ts'
import { workgraphError } from './workgraph-view.ts'
import css from './TaskInspector.module.css'

type Request = Exclude<OrganizationInboxItem['request'], { kind: 'accept-assignment' | 'accept-delivery' }>
/**
 * @param props - Exact request, current native identity and refresh callback.
 * @returns Explicit handler controls without automatic continuation.
 */
export function ExecutionHumanRequest(props: OrganizationProps & { request: Request
  assignment: OrganizationInboxItem['assignment']
  refresh: () => Promise<void> }) {
  const { request, assignment: a, t } = props, c = props.useOrganization(s => s.connection)
  const [answer, setAnswer] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<Awaited<ReturnType<OrganizationProps['executionReport']>>>()
  const operation = useRef<{ body: string; id: string }>()
  const member = c.organizations.find(org => org.id === c.organizationId)?.membershipId
  const submit = async (approved?: boolean) => {
    setBusy(true)
    const body = JSON.stringify({ answer, approved })
    if (operation.current?.body !== body) operation.current = { body, id: randomUUID() }
    try {
      await props.connection({ kind: 'assignment-participant', request: {
        organizationId: a.organizationId, projectId: a.projectId, planId: a.planId, assignmentId: a.id,
        runId: request.runId, planRevision: request.planRevision, requestId: request.id,
        operationId: operation.current.id,
        ...(request.kind === 'work-question' ? { kind: 'answer-execution-question', answer } : { kind: 'approve-execution-tool', approved }),
      } })
      await props.refresh()
    } catch (error) { setNotice(t(workgraphError(error))) }
    finally { setBusy(false) }
  }
  return <section className={css.record} aria-busy={busy}>
    <div className={css.heading}><h5>{t(request.kind === 'work-question' ? 'executionQuestion' : 'executionToolApproval')}</h5>
      <span className={css.status}>{t(`human-${request.state}`)}</span>
    </div>
    <p className={css.hint}>{t('executionHandler')}: {c.members.find(item => item.id === request.handlerId)?.username
      ?? t(member === request.handlerId ? 'me' : 'selectedMember')}</p>
    <p className={css.prose}>{request.prompt}</p>
    {request.requestDigest && <>
      <details className={css.advanced}><summary>{t('technicalDetails')}</summary><code>{request.requestDigest}</code></details>
      <Button onClick={() => { void props.executionReport({ organizationId: a.organizationId, projectId: a.projectId,
        planId: a.planId, assignmentId: a.id, runId: request.runId }).then(setPreview).catch((error: unknown) => { setNotice(t(workgraphError(error))) }) }}>{t('executionTranscript')}</Button>
      {preview?.generation === c.generation && preview.report.native && <p>{t('executionNativeApprovalHint')}</p>}
      {preview?.generation === c.generation && preview.report.entries.filter(entry => entry.role === 'tool')
        .map((entry, index) => <pre className={css.transcript} key={index}>{entry.text}</pre>)}
    </>}
    {request.answer && <p>{request.answer}</p>}
    <p className={css.hint}>{t('executionAnswerHint')}</p>
    {notice && <p className={css.notice} role="status">{notice}</p>}
    {member === request.handlerId && request.state === 'pending' && c.phase === 'ready' && <>
      {request.kind === 'work-question' ? <form className={css.form} onSubmit={(event) => { event.preventDefault(); void submit() }}>
        <label>{t('executionAnswer')}<textarea required disabled={busy} value={answer} onChange={(event) => { setAnswer(event.target.value) }} /></label>
        <div className={css.footer}><Button variant="primary" type="submit" disabled={busy || !!c.pendingOperation || !answer.trim()}>{t('executionSendAnswer')}</Button></div>
      </form> : <div className={css.actions}>
        <Button variant="primary" disabled={busy || !!c.pendingOperation || preview?.generation !== c.generation}
          onClick={() => { void submit(true) }}>{t('executionApproveTool')}</Button>
        <Button variant="outline" className={css.danger} disabled={busy || !!c.pendingOperation}
          onClick={() => { void submit(false) }}>{t('executionDenyTool')}</Button>
      </div>}
    </>}
  </section>
}
