/** Explicit original-issuer decisions on the displayed immutable evidence. */
import { useRef, useState } from 'react'
import { Button, Checkbox, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import type { ConnectionResult } from '@deepseek-ai/dsh-organization-connection/types'
import type { OrganizationProps } from './contract.ts'
import { workgraphError } from './workgraph-view.ts'

type Page = NonNullable<ConnectionResult['delivery']>
/**
 * @param props - Current authorized submission, complete metadata and fixed human transport.
 * @returns Review history or an explicit confirmation form for the original issuer.
 */
export function AcceptanceReview(props: OrganizationProps & { submission: Page['submissions'][number]; artifacts: Page['artifacts']; refresh: () => Promise<void> }) {
  const { submission: s, artifacts, t } = props
  const c = props.useOrganization(v => v.connection)
  const [reason, setReason] = useState(''), [requirements, setRequirements] = useState('')
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
  return <div aria-busy={busy}>
    <p>{t(`review-${s.reviewState}`)}</p>
    {notice && <p role="status">{notice}</p>}
    {s.acceptance && <>
      {s.acceptance.reason && <p>{t('reviewReason')}: {s.acceptance.reason}</p>}
      {s.acceptance.requirements && <p>{t('reviewRequirements')}: {s.acceptance.requirements}</p>}
      {s.acceptance.reworkRevision !== null && <p>{t('reviewRework', { revision: s.acceptance.reworkRevision })}</p>}
    </>}
    {issuer && s.reviewState === 'pending' && <>
      <p>{t('reviewHint')}</p>
      <label>{t('reviewReason')}<Input value={reason} disabled={busy} onChange={(e) => { setReason(e.target.value); setConfirmed(false) }} /></label>
      <label>{t('reviewRequirements')}<Input value={requirements} disabled={busy} onChange={(e) => { setRequirements(e.target.value); setConfirmed(false) }} /></label>
      <Checkbox label={t('reviewConfirm')} checked={confirmed} disabled={busy} onChange={setConfirmed} />
      <Button disabled={busy || !!c.pendingOperation || !confirmed} onClick={() => { void decide('accept-delivery') }}>{t('reviewAccept')}</Button>
      <Button disabled={busy || !!c.pendingOperation || !confirmed || !reason.trim() || !requirements.trim()}
        onClick={() => { void decide('reject-delivery') }}>{t('reviewReject')}</Button>
    </>}
  </div>
}
