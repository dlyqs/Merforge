/** Explicit sharing, immutable submission history and authenticated artifact downloads. */
import { useEffect, useRef, useState } from 'react'
import { Button, Checkbox, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import type { ConnectionResult } from '@deepseek-ai/dsh-organization-connection/types'
import type { OrganizationAssignment, OrganizationRun } from '@deepseek-ai/dsh-organization'
import type { OrganizationProps } from './contract.ts'
import { AcceptanceReview } from './AcceptanceReview.tsx'
import { workgraphError } from './workgraph-view.ts'
import css from './Organization.module.css'

type Page = NonNullable<ConnectionResult['delivery']>
type Artifact = Page['artifacts'][number]
type Selection = { operationId: string; file: File; kind: Artifact['kind']; description: string }
/**
 * @param props - Authorized assignment, optional employee Run and native fixed actions.
 * @returns Explicit sharing form and durable submissions.
 */
export function DeliveryPanel(props: OrganizationProps & { assignment: OrganizationAssignment; run?: OrganizationRun }) {
  const { t, assignment: a, run } = props
  const c = props.useOrganization(s => s.connection)
  const [page, setPage] = useState<{ generation: number; value: Page }>()
  const [selected, setSelected] = useState<Selection[]>([])
  const [summary, setSummary] = useState(''), [target, setTarget] = useState('')
  const [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false), [notice, setNotice] = useState('')
  const [chosen, setChosen] = useState<Artifact['id'][]>([])
  const [preview, setPreview] = useState<{ generation: number; text: string }>()
  const alive = useRef(true), identity = `${c.principal?.accountId}:${c.organizationId}`
  const currentIdentity = useRef(identity); currentIdentity.current = identity
  const generation = useRef(c.generation); generation.current = c.generation
  const submissionIntent = useRef<{ fingerprint: string; operationId: string }>()
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  useEffect(() => {
    setSelected([]); setChosen([]); setSummary(''); setTarget(''); setConfirmed(false); setPreview(undefined)
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
  const value = page?.generation === c.generation ? page.value : undefined
  const mine = c.organizations.find(o => o.id === c.organizationId)?.membershipId === a.assigneeId
  const share = async () => {
    if (!value || !run || !confirmed) return
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
        await props.connection({ kind: 'delivery-command', request: { ...selector, runId: run.id, planRevision: run.planRevision,
          operationId: selection.operationId, kind: 'publish-artifact', artifactKind: selection.kind, path: selection.file.name,
          description: selection.description, mediaType: selection.file.type || 'application/octet-stream',
          size: buffer.byteLength, sha256, bytes: btoa(raw) } }); current()
        setSelected(items => items.filter(item => item.operationId !== selection.operationId))
      }
      setSelected([]); setNotice(t('deliveryUploaded')); await load()
    } catch (error) { if (alive.current) setNotice(t(workgraphError(error))) }
    finally { if (alive.current) { setBusy(false); setConfirmed(false) } }
  }
  const submit = async () => {
    if (!confirmed || !run || !chosen.length) return
    setBusy(true)
    try {
      const fingerprint = JSON.stringify({ chosen, summary, target, runId: run.id })
      if (submissionIntent.current?.fingerprint !== fingerprint) submissionIntent.current = { fingerprint, operationId: randomUUID() }
      await props.connection({ kind: 'delivery-command', request: { ...selector, runId: run.id, planRevision: run.planRevision,
        operationId: submissionIntent.current.operationId, kind: 'submit-delivery', artifactIds: chosen, summary, target, confirmed: true } }); current()
      setChosen([]); setNotice(t('deliverySubmitted')); await load()
    } catch (error) { if (alive.current) setNotice(t(workgraphError(error))) }
    finally { if (alive.current) { setBusy(false); setConfirmed(false) } }
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
  return <section className={css.card} aria-busy={busy}>
    <h5>{t('deliveryTitle')}</h5><p>{t('deliveryHint')}</p>
    {notice && <p role="status">{notice}</p>}
    {mine && run && a.state === 'accepted' && value && <>
      <p>{t('deliveryLimits', { count: value.limits.artifactMaxFiles, bytes: value.limits.artifactMaxFileBytes, total: value.limits.artifactMaxTotalBytes })}</p>
      <label>{t('deliveryFiles')}<input type="file" multiple disabled={busy} onChange={(e) => {
        setSelected(Array.from(e.target.files ?? [], file => ({ operationId: randomUUID(), file, kind: 'file', description: file.name }))); setConfirmed(false)
      }} /></label>
      {selected.map((s, index) => <div key={`${s.file.name}:${index}`}>
        <p>{s.file.name} · {s.file.size}</p>
        <label>{t('deliveryKind')}<select value={s.kind} disabled={busy} onChange={(e) => {
          const kind = e.target.value as Artifact['kind']; setSelected(items => items.map((v, i) => i === index ? { ...v, operationId: randomUUID(), kind } : v)); setConfirmed(false)
        }}>{(['file', 'test-report', 'git-change'] as const).map(kind => <option key={kind} value={kind}>{t(`delivery-${kind}`)}</option>)}</select></label>
        <label>{t('deliveryDescription')}<Input value={s.description} disabled={busy} onChange={(e) => {
          setSelected(items => items.map((v, i) => i === index
            ? { ...v, operationId: randomUUID(), description: e.target.value } : v)); setConfirmed(false)
        }} /></label>
      </div>)}
      <p>{t('deliveryGitHint')}</p>
      <Button disabled={busy || !!c.pendingOperation || !confirmed || !selected.length} onClick={() => { void share() }}>{t('deliveryUpload')}</Button>
      {value.artifacts.filter(f => f.runId === run.id).map(f => <div key={f.id}>
        <Checkbox label={`${f.path} · ${f.size} · ${f.sha256}`} checked={chosen.includes(f.id)} disabled={busy}
          onChange={(checked) => { setChosen(ids => checked ? [...ids, f.id] : ids.filter(id => id !== f.id)); setConfirmed(false) }} />
        <p>{f.description}</p>
      </div>)}
      <label>{t('deliverySummary')}<Input value={summary} disabled={busy} onChange={(e) => { setSummary(e.target.value); setConfirmed(false) }} /></label>
      <label>{t('deliveryTarget')}<Input value={target} disabled={busy} onChange={(e) => { setTarget(e.target.value); setConfirmed(false) }} /></label>
      <Checkbox label={t('deliveryConfirm')} checked={confirmed} disabled={busy} onChange={setConfirmed} />
      <Button disabled={busy || !!c.pendingOperation || !confirmed || !chosen.length || !summary.trim() || !target.trim()
        || !['paused', 'succeeded', 'failed', 'cancelled'].includes(run.state)} onClick={() => { void submit() }}>{t('deliverySubmit')}</Button>
    </>}
    {value?.submissions.map(s => <div key={s.id}>
      <p>{t('taskVersion', { revision: s.planRevision })}</p><p>{s.summary}</p><p>{s.target}</p>
      {s.artifactIds.map(id => <Button key={id} onClick={() => { void download(id) }}>{value.artifacts.find(f => f.id === id)?.path ?? t('deliveryDownload')}</Button>)}
      <AcceptanceReview key={`${c.generation}:${s.id}`} {...props} submission={s} artifacts={value.artifacts} refresh={load} />
    </div>)}
    {value && <div className={css.actions}>
      <Button disabled={!value.offset} onClick={() => { void load().catch((e: unknown) =>{  setNotice(t(workgraphError(e))) }) }}>{t('firstPage')}</Button>
      <Button disabled={value.offset + value.submissions.length >= value.total} onClick={() => {
        void load(value.offset + value.submissions.length).catch((e: unknown) =>{  setNotice(t(workgraphError(e))) })
      }}>{t('next')}</Button>
    </div>}
    {preview?.generation === c.generation && <pre className={css.transcript}>{preview.text}</pre>}
  </section>
}
