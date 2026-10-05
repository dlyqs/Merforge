/** Explicit sharing, immutable submission history and authenticated artifact downloads. */
import { useEffect, useRef, useState } from 'react'
import { Button, Checkbox, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import type { ConnectionResult } from '@deepseek-ai/dsh-organization-connection/types'
import type { OrganizationAssignment, OrganizationRun } from '@deepseek-ai/dsh-organization'
import type { OrganizationProps } from './contract.ts'
import { AcceptanceReview } from './AcceptanceReview.tsx'
import { workgraphError } from './workgraph-view.ts'
import css from './TaskInspector.module.css'
import { taskWorkspaceStyles } from '@deepseek-ai/dsh-client-ui-primitives'

type Page = NonNullable<ConnectionResult['delivery']>
type Artifact = Page['artifacts'][number]
type Selection = { operationId: string; file: File; kind: Artifact['kind']; description: string }
/**
 * @param props - Authorized assignment, optional employee Run and native fixed actions.
 * @returns Explicit sharing form and durable submissions.
 */
export function DeliveryPanel(props: OrganizationProps & {
  assignment: OrganizationAssignment
  run?: OrganizationRun
  submissionReady?: boolean
}) {
  const { t, assignment: a, run } = props
  const c = props.useOrganization(s => s.connection)
  const [page, setPage] = useState<{ generation: number; value: Page }>()
  const [selected, setSelected] = useState<Selection[]>([])
  const [summary, setSummary] = useState(''), [target, setTarget] = useState('')
  const [uploadConfirmed, setUploadConfirmed] = useState(false)
  const operationLock = useRef(false)
  const [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false), [notice, setNotice] = useState('')
  const [chosen, setChosen] = useState<Artifact['id'][]>([])
  const [preview, setPreview] = useState<{ generation: number; text: string }>()
  const alive = useRef(true), identity = `${c.principal?.serverId}:${c.principal?.accountId}:${c.organizationId}`
  const currentIdentity = useRef(identity); currentIdentity.current = identity
  const generation = useRef(c.generation); generation.current = c.generation
  const submissionIntent = useRef<{ fingerprint: string; operationId: string }>()
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  useEffect(() => {
    setSelected([]); setChosen([]); setSummary(''); setTarget(''); setConfirmed(false); setUploadConfirmed(false); setPreview(undefined)
    submissionIntent.current = undefined
  }, [identity])
  const current = () => { if (!alive.current || currentIdentity.current !== identity) throw new Error('superseded') }
  const selector = { organizationId: a.organizationId, projectId: a.projectId, planId: a.planId, assignmentId: a.id }
  const load = async (offset = 0) => {
    const result = await props.connection({ kind: 'delivery-read', request: { ...selector, ...(run ? { runId: run.id } : {}), offset } }); current()
    if (result.delivery && result.generation !== undefined) setPage({ generation: result.generation, value: result.delivery })
  }
  useEffect(() => {
    if (c.phase === 'ready') void load().catch((error: unknown) => { if (alive.current) setNotice(t(workgraphError(error))) })
  }, [c.generation, c.phase])
  const value = c.phase === 'ready' && c.mode === 'organization' && page?.generation === c.generation ? page.value : undefined
  const mine = c.organizations.find(o => o.id === c.organizationId)?.membershipId === a.assigneeId
  const share = async () => {
    if (!value || !uploadConfirmed || operationLock.current) return
    operationLock.current = true
    setBusy(true); setNotice('')
    try {
      const limits = value.limits
      if (!selected.length || selected.length > limits.artifactMaxFiles
        || selected.some(s => s.file.size > limits.artifactMaxFileBytes || !s.description.trim())
        || selected.reduce((n, s) => n + s.file.size, 0) > limits.artifactMaxTotalBytes) throw new Error('invalid-input')
      for (const selection of selected) {
        const buffer = await selection.file.arrayBuffer(); current()
        const digest = await crypto.subtle.digest('SHA-256', buffer); current()
        const sha256 = Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('')
        let raw = ''
        for (const byte of new Uint8Array(buffer)) raw += String.fromCharCode(byte)
        await props.connection({ kind: 'delivery-command', request: { ...selector, runId: run?.id ?? null, planRevision: a.planRevision,
          operationId: selection.operationId, kind: 'publish-artifact', artifactKind: selection.kind, path: selection.file.name,
          description: selection.description, mediaType: selection.file.type || 'application/octet-stream',
          size: buffer.byteLength, sha256, bytes: btoa(raw) } }); current()
        setSelected(items => items.filter(item => item.operationId !== selection.operationId))
      }
      setSelected([]); setNotice(t('deliveryUploaded')); await load()
    } catch (error) { if (alive.current) setNotice(t(workgraphError(error))) }
    finally { operationLock.current = false; if (alive.current) { setBusy(false); setUploadConfirmed(false) } }
  }
  const submit = async () => {
    if (!confirmed || !chosen.length || operationLock.current) return
    operationLock.current = true
    setNotice('')
    setBusy(true)
    try {
      const fingerprint = JSON.stringify({ chosen, summary, target, runId: run?.id ?? null })
      if (submissionIntent.current?.fingerprint !== fingerprint) submissionIntent.current = { fingerprint, operationId: randomUUID() }
      await props.connection({ kind: 'delivery-command', request: { ...selector, runId: run?.id ?? null, planRevision: a.planRevision,
        operationId: submissionIntent.current.operationId, kind: 'submit-delivery', artifactIds: chosen, summary, target, confirmed: true } }); current()
      setChosen([]); setNotice(t('deliverySubmitted')); await load()
    } catch (error) { if (alive.current) setNotice(t(workgraphError(error))) }
    finally { operationLock.current = false; if (alive.current) { setBusy(false); setConfirmed(false) } }
  }
  const download = async (artifactId: Artifact['id']) => {
    try {
      const result = await props.connection({ kind: 'delivery-download', request: { ...selector, artifactId } }); current()
      if (!result.artifact) throw new Error('unavailable')
      const { artifact, bytes } = result.artifact
      const raw = atob(bytes), data = Uint8Array.from(raw, c => c.charCodeAt(0))
      const digest = await crypto.subtle.digest('SHA-256', data); current()
      if (result.generation !== generation.current) throw new Error('superseded')
      if (data.length !== artifact.size || Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('') !== artifact.sha256) throw new Error('invalid-input')
      if (artifact.kind === 'test-report') setPreview({ generation: result.generation, text: new TextDecoder().decode(data) })
      const url = URL.createObjectURL(new Blob([data], { type: 'application/octet-stream' }))
      const link = document.createElement('a'); link.href = url; link.download = artifact.path.slice(artifact.path.lastIndexOf('/') + 1)
      link.click(); URL.revokeObjectURL(url)
    } catch (error) { if (alive.current) setNotice(t(workgraphError(error))) }
  }
  const stopped = !run || ['paused', 'succeeded', 'failed', 'cancelled'].includes(run.state) && props.submissionReady !== false
  const runArtifacts = value?.artifacts.filter(file => file.runId === (run?.id ?? null)) ?? []
  const submissions = value?.submissions.filter(submission => !run || submission.runId === run.id) ?? []
  const uploadValid = !!value && selected.length > 0 && selected.length <= value.limits.artifactMaxFiles
    && selected.every(item => item.file.size <= value.limits.artifactMaxFileBytes && item.description.trim())
    && selected.reduce((total, item) => total + item.file.size, 0) <= value.limits.artifactMaxTotalBytes
  return <section className={css.panel} aria-busy={busy}>
    <p className={css.hint}>{t('deliveryHint')}</p>
    {notice && <p className={css.notice} role="status">{notice}</p>}
    {mine && a.state === 'accepted' && value && <>
      <section className={css.step}>
        <div className={css.stepHeading}><span aria-hidden="true">1</span><h5>{t('taskUploadStep')}</h5></div>
        <p className={css.hint}>{t('deliveryLimits', { count: value.limits.artifactMaxFiles, bytes: value.limits.artifactMaxFileBytes, total: value.limits.artifactMaxTotalBytes })}</p>
        <div className={css.form}>
          <label>{t('deliveryFiles')}<input type="file" multiple disabled={busy || !!c.pendingOperation} onChange={(event) => {
            setSelected(Array.from(event.target.files ?? [], file => ({ operationId: randomUUID(), file, kind: 'file', description: file.name })))
            setUploadConfirmed(false)
          }} /></label>
          {selected.map((selection, index) => <div className={css.record} key={`${selection.file.name}:${index}`}>
            <div className={css.heading}><strong>{selection.file.name}</strong>
              <Button size="sm" disabled={busy} aria-label={t('taskRemoveFile')} onClick={() => {
                setSelected(items => items.filter((_, i) => i !== index)); setUploadConfirmed(false)
              }}>{t('taskRemoveFile')}</Button>
            </div>
            <p className={css.hint}>{t('taskFileSize', { bytes: selection.file.size })}</p>
            <div className={css.grid}>
              <label>{t('deliveryKind')}<select value={selection.kind} disabled={busy} onChange={(event) => {
                const kind = event.target.value as Artifact['kind']
                setSelected(items => items.map((item, i) => i === index ? { ...item, operationId: randomUUID(), kind } : item))
                setUploadConfirmed(false)
              }}>{(['file', 'test-report', 'git-change'] as const).map(kind => <option key={kind} value={kind}>{t(`delivery-${kind}`)}</option>)}</select></label>
              <label>{t('deliveryDescription')}<Input value={selection.description} disabled={busy} onChange={(event) => {
                setSelected(items => items.map((item, i) => i === index
                  ? { ...item, operationId: randomUUID(), description: event.target.value } : item))
                setUploadConfirmed(false)
              }} /></label>
            </div>
          </div>)}
          {selected.some(item => item.kind === 'git-change') && <p className={css.notice}>{t('deliveryGitHint')}</p>}
          {selected.length > 0 && <>
            <Checkbox label={t('taskUploadConfirm')} checked={uploadConfirmed} disabled={busy || !uploadValid} onChange={setUploadConfirmed} />
            <div className={css.footer}><Button variant="primary" disabled={busy || !!c.pendingOperation || !uploadConfirmed || !uploadValid} onClick={() => { void share() }}>{t(busy ? 'working' : 'deliveryUpload')}</Button></div>
          </>}
        </div>
      </section>
      <section className={css.step}>
        <div className={css.stepHeading}><span aria-hidden="true">2</span><h5>{t('taskSubmitStep')}</h5></div>
        <p className={css.notice} data-tone={stopped ? undefined : 'warn'}>{t(stopped ? 'taskSubmissionReady' : 'taskSubmissionBlocked')}</p>
        <div className={css.form}>
          {runArtifacts.length === 0 && <p className={css.hint}>{t('taskDeliveryEmptyHint')}</p>}
          {runArtifacts.map(file => <div className={css.record} key={file.id}>
            <Checkbox label={file.path} checked={chosen.includes(file.id)} disabled={busy}
              onChange={(checked) => {
                setChosen(ids => checked ? [...ids, file.id] : ids.filter(id => id !== file.id)); setConfirmed(false)
              }} />
            <p className={css.hint}>{file.description} · {t('taskFileSize', { bytes: file.size })}</p>
            <details className={css.advanced}><summary>{t('taskEvidenceDetails')}</summary><code>{file.sha256}</code></details>
          </div>)}
          <label>{t('deliverySummary')}<textarea value={summary} disabled={busy} onChange={(event) => { setSummary(event.target.value); setConfirmed(false) }} /></label>
          <label>{t('deliveryTarget')}<textarea value={target} disabled={busy} onChange={(event) => { setTarget(event.target.value); setConfirmed(false) }} /></label>
          <Checkbox label={t('taskSubmitConfirm')} checked={confirmed} disabled={busy || !stopped || !chosen.length || !summary.trim() || !target.trim()} onChange={setConfirmed} />
          <div className={css.footer}><Button variant="primary" disabled={busy || !!c.pendingOperation || !confirmed || !chosen.length || !summary.trim() || !target.trim() || !stopped}
            onClick={() => { void submit() }}>{t('deliverySubmit')}</Button></div>
        </div>
      </section>
    </>}
    <section className={css.step}>
      <h5>{t('taskSubmissionHistory')}</h5>
      {value && !submissions.length && <div className={css.empty}><strong>{t('taskDeliveryEmpty')}</strong><p>{t('taskDeliveryEmptyHint')}</p></div>}
      {submissions.map(submission => <article className={css.record} key={submission.id}>
        <div className={css.heading}><span className={css.status}>{t(`review-${submission.reviewState}`)}</span><span className={css.hint}>{t('taskVersion', { revision: submission.planRevision })}</span></div>
        <dl><dt>{t('deliverySummary')}</dt><dd>{submission.summary}</dd><dt>{t('deliveryTarget')}</dt><dd>{submission.target}</dd></dl>
        <div className={css.actions}>{submission.artifactIds.map(artifactId => <Button key={artifactId} variant="outline" disabled={busy || !!c.pendingOperation}
          onClick={() => { void download(artifactId) }}>{value?.artifacts.find(file => file.id === artifactId)?.path ?? t('deliveryDownload')}</Button>)}</div>
        <AcceptanceReview key={`${c.generation}:${submission.id}`} {...props} submission={submission} artifacts={value?.artifacts ?? []} refresh={load} />
      </article>)}
    </section>
    {value && value.total > value.submissions.length && <div className={css.actions}>
      <Button disabled={busy || !value.offset} onClick={() => { void load().catch((error: unknown) => { setNotice(t(workgraphError(error))) }) }}>{t('firstPage')}</Button>
      <Button disabled={busy || value.offset + value.submissions.length >= value.total} onClick={() => {
        void load(value.offset + value.submissions.length).catch((error: unknown) => { setNotice(t(workgraphError(error))) })
      }}>{t('next')}</Button>
    </div>}
    {preview?.generation === c.generation && <details className={css.advanced} open><summary>{t('delivery-test-report')}</summary><pre className={taskWorkspaceStyles.prose}>{preview.text}</pre></details>}
  </section>
}
