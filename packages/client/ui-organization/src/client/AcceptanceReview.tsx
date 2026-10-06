/** Explicit original-issuer decisions on the displayed immutable evidence. */
import { useRef, useState } from 'react'
import { Button, Checkbox } from '@deepseek-ai/dsh-client-ui-primitives'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import type { ConnectionResult } from '@deepseek-ai/dsh-organization-connection/types'
import type { OrganizationProps } from './contract.ts'
import { workgraphError } from './workgraph-view.ts'
import css from './TaskInspector.module.css'

type Page = NonNullable<ConnectionResult['delivery']>
/**
 * @param props - Current authorized submission, complete metadata and fixed human transport.
 * @returns Review history or an explicit confirmation form for the original issuer.
 */
export function AcceptanceReview(props: OrganizationProps & { submission: Page['submissions'][number]; artifacts: Page['artifacts']; refresh: () => Promise<void> }) {
  const { submission: s, artifacts, t } = props
  const c = props.useOrganization(v => v.connection)
  const [reason, setReason] = useState(''), [requirements, setRequirements] = useState('')
  const [rejecting, setRejecting] = useState(false)
  const [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false), [notice, setNotice] = useState('')
  const intent = useRef<{ fingerprint: string; operationId: string }>()
  const issuer = c.organizations.find(o => o.id === c.organizationId)?.membershipId === s.handlerId
  const decide = async (kind: 'accept-delivery' | 'reject-delivery') => {
    if (!confirmed) return
    setBusy(true); setNotice('')
    try {
      const evidence = s.artifactIds.map((artifactId) => {
        const artifact = artifacts.find(a => a.id === artifactId)
        if (!artifact) throw new Error('unavailable')
        return { artifactId, sha256: artifact.sha256 }
      })
      const command = { kind, organizationId: s.organizationId, projectId: s.projectId, planId: s.planId,
        assignmentId: s.assignmentId, runId: s.runId, planRevision: s.planRevision, submissionId: s.id,
        artifacts: evidence, confirmed: true, ...(kind === 'reject-delivery' ? { reason, requirements } : {}) }
      const fingerprint = JSON.stringify(command)
      if (intent.current?.fingerprint !== fingerprint) intent.current = { fingerprint, operationId: randomUUID() }
      await props.connection({ kind: 'delivery-command', request: { ...command, operationId: intent.current.operationId } })
      await props.refresh()
    } catch (error) { setNotice(t(workgraphError(error))) }
    finally { setBusy(false); setConfirmed(false) }
  }
  return <div className={css.panel} aria-busy={busy}>
    {notice && <p className={css.notice} role="status">{notice}</p>}
    {s.acceptance && <>
      {s.acceptance.reason && <p>{t('reviewReason')}: {s.acceptance.reason}</p>}
      {s.acceptance.requirements && <p>{t('reviewRequirements')}: {s.acceptance.requirements}</p>}
      {s.acceptance.reworkRevision !== null && <p>{t('reviewRework', { revision: s.acceptance.reworkRevision })}</p>}
    </>}
    {issuer && s.reviewState === 'pending' && <>
      <h5>{t('taskReviewStep')}</h5>
      <div className={css.form}>
        {rejecting && <>
          <p className={css.notice} data-tone="warn">{t('reviewHint')}</p>
          <label>{t('reviewReason')}<textarea required value={reason} disabled={busy} onChange={(event) => { setReason(event.target.value); setConfirmed(false) }} /></label>
          <label>{t('reviewRequirements')}<textarea required value={requirements} disabled={busy} onChange={(event) => { setRequirements(event.target.value); setConfirmed(false) }} /></label>
        </>}
        <Checkbox label={t('reviewConfirm')} checked={confirmed} disabled={busy} onChange={setConfirmed} />
        <div className={css.footer}>{rejecting ? <>
          <Button disabled={busy} onClick={() => { setRejecting(false); setConfirmed(false) }}>{t('taskRejectCancel')}</Button>
          <Button variant="outline" className={css.danger} disabled={busy || !!c.pendingOperation || !confirmed || !reason.trim() || !requirements.trim()}
            onClick={() => { void decide('reject-delivery') }}>{t('reviewReject')}</Button>
        </> : <>
          <Button disabled={busy || !!c.pendingOperation} onClick={() => { setRejecting(true); setConfirmed(false) }}>{t('taskRejectToggle')}</Button>
          <Button variant="primary" disabled={busy || !!c.pendingOperation || !confirmed} onClick={() => { void decide('accept-delivery') }}>{t('reviewAccept')}</Button>
        </>}</div>
      </div>
    </>}
  </div>
}
