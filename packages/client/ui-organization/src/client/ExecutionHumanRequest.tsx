/** Designated human answers are separate from execution continuation and task acceptance. */
import { useRef, useState } from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import type { OrganizationInboxItem } from '@deepseek-ai/dsh-organization'
import type { OrganizationProps } from './contract.ts'
import { workgraphError } from './workgraph-view.ts'

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
  return <section>
    <p>{t(request.kind === 'work-question' ? 'executionQuestion' : 'executionToolApproval')}</p>
    <p>{t('executionHandler')}: {request.handlerId} · {t(`human-${request.state}`)}</p>
    <p>{request.prompt}</p>
    {request.requestDigest && <>
      <code>{request.requestDigest}</code>
      <Button onClick={() => { void props.executionReport({ organizationId: a.organizationId, projectId: a.projectId,
        planId: a.planId, assignmentId: a.id, runId: request.runId }).then(setPreview).catch((error: unknown) => { setNotice(t(workgraphError(error))) }) }}>{t('executionTranscript')}</Button>
      {preview?.generation === c.generation && preview.report.entries.filter(entry => entry.role === 'tool').map((entry, index) => <pre key={index}>{entry.text}</pre>)}
    </>}
    {request.answer && <p>{request.answer}</p>}
    <p>{t('executionAnswerHint')}</p>
    {notice && <p role="status">{notice}</p>}
    {member === request.handlerId && request.state === 'pending' && c.phase === 'ready' && <>
      {request.kind === 'work-question' ? <form onSubmit={(event) => { event.preventDefault(); void submit() }}>
        <label>{t('executionAnswer')}<Input required value={answer} onChange={(event) => { setAnswer(event.target.value) }} /></label>
        <Button type="submit" disabled={busy || !!c.pendingOperation}>{t('executionSendAnswer')}</Button>
      </form> : <>
        <Button disabled={busy || !!c.pendingOperation || preview?.generation !== c.generation} onClick={() => { void submit(true) }}>{t('executionApproveTool')}</Button>
        <Button disabled={busy || !!c.pendingOperation} onClick={() => { void submit(false) }}>{t('executionDenyTool')}</Button>
      </>}
    </>}
  </section>
}
