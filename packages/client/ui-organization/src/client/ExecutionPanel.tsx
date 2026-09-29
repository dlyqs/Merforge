/** Explicit employee execution controls and authorized Run history. */
import { useEffect, useRef, useState } from 'react'
import { Button, Checkbox, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import type { OrganizationTaskView, OrganizationExecutionView } from '@deepseek-ai/dsh-organization'
import type { OrganizationProjectId } from '@deepseek-ai/dsh-organization/types'
import type { ConnectionResult, OrganizationDesktopBridge } from '@deepseek-ai/dsh-organization-connection/types'
import type { OrganizationProps } from './contract.ts'
import type { OrganizationKey } from './locales.ts'
import { workgraphError } from './workgraph-view.ts'
import css from './Organization.module.css'

type Inputs = Parameters<OrganizationDesktopBridge['execution']>[0]['inputs']
type Preparation = Extract<NonNullable<ConnectionResult['assignment']>['result'], { kind: 'preparation' }>['value']
function executionError(error: unknown): OrganizationKey {
  const code = error instanceof Error ? error.message : ''
  if (/model-policy-denied|model-route-denied/.test(code)) return 'executionPolicyDenied'
  if (/credential-unavailable/.test(code)) return 'executionCredentialMissing'
  if (/action-limit|step-limit|duration-limit|size-limit|explicit-local-authorization-required/.test(code)) return 'executionLimitReached'
  if (/directory-|path-escape|linked-path|invalid-relative-path/.test(code)) return 'executionDirectoryDenied'
  if (/reconciliation-required|permit-unconfirmed/.test(code)) return 'executionUnknown'
  if (/authority-lost|permit-expired|permit-revoked|superseded/.test(code)) return 'qualificationRecheck'
  return workgraphError(error)
}
/** @param props - Current authorized task and native callbacks. @returns Explicit execution form and Run state. */
export function ExecutionPanel(props: OrganizationProps & { task: OrganizationTaskView
  projectId: OrganizationProjectId
  current: boolean }) {
  const { t, task } = props, c = props.useOrganization(s => s.connection)
  const [preparation, setPreparation] = useState<Preparation>()
  const [views, setViews] = useState<{ generation: number; items: OrganizationExecutionView[]; total: number; offset: number }>()
  const [pages, setPages] = useState([0])
  const offset = pages.at(-1) ?? 0
  const [model, setModel] = useState(''), [endpoint, setEndpoint] = useState(''), [directory, setDirectory] = useState('')
  const [actions, setActions] = useState(''), [steps, setSteps] = useState(''), [minutes, setMinutes] = useState('')
  const [message, setMessage] = useState(''), [read, setRead] = useState(false), [write, setWrite] = useState(false)
  const [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false), [stopping, setStopping] = useState(false)
  const [notice, setNotice] = useState('')
  const [report, setReport] = useState<Awaited<ReturnType<OrganizationDesktopBridge['executionReport']>>>()
  const alive = useRef(true), sequence = useRef(0)
  useEffect(() => { alive.current = true; return () => { alive.current = false; sequence.current++ } }, [])
  const isAlive = () => alive.current
  const ready = props.current && c.phase === 'ready' && c.mode === 'organization'
  const memberId = c.organizations.find(org => org.id === c.organizationId)?.membershipId
  const load = async () => {
    const seq = ++sequence.current
    const history = await props.connection({ kind: 'assignment-tasks', request: { organizationId: c.organizationId,
      projectId: props.projectId, planId: task.planId, taskId: task.id } })
    if (!alive.current || seq !== sequence.current || history.assignment?.result.kind !== 'tasks') return
    const assignment = history.assignment.result.value.items.find(a => a.planRevision === task.revision)
    if (!assignment) { setPreparation(undefined); setViews(undefined); return }
    const selector = { organizationId: assignment.organizationId, projectId: props.projectId,
      planId: task.planId, assignmentId: assignment.id }
    const p = await props.connection({ kind: 'assignment-preparation', request: selector })
    const runs = await props.connection({ kind: 'execution-list', request: { ...selector, offset } })
    if (p.assignment?.result.kind !== 'preparation' || !runs.executions || runs.generation === undefined) return
    const items: OrganizationExecutionView[] = []
    for (const run of runs.executions.items) {
      const read = await props.connection({ kind: 'execution-read', request: { ...selector, runId: run.id } })
      if (read.execution) items.push(read.execution)
    }
    if (isAlive() && seq === sequence.current) {
      setPreparation(p.assignment.result.value)
      setViews({ generation: runs.generation, items, total: runs.executions.total, offset: runs.executions.offset })
    }
  }
  useEffect(() => {
    let current = true
    if (ready) void load().catch((error: unknown) => {
      if (current && alive.current) setNotice(t(executionError(error)))
    })
    return () => { current = false; sequence.current++ }
  }, [ready, c.generation, task.revision, offset])
  const mine = preparation?.assignment.assigneeId === memberId
  const start = async () => {
    if (!preparation || !confirmed) return
    setBusy(true); setNotice('')
    const current = () => { if (!alive.current) throw new Error('superseded') }
    try {
      const selector = { organizationId: preparation.assignment.organizationId, projectId: props.projectId,
        planId: task.planId, assignmentId: preparation.assignment.id }
      const fresh = await props.connection({ kind: 'assignment-preparation', request: selector }); current()
      if (fresh.assignment?.result.kind !== 'preparation') throw new Error('unavailable')
      const p = fresh.assignment.result.value, lease = p.lease
      if (!lease || lease.state !== 'held') throw new Error('version-conflict')
      const delegation = p.delegations.find(d => d.deviceId === lease.deviceId && d.state === 'active')
      if (!delegation) throw new Error('forbidden')
      const inputs: Inputs = { model, endpoint, capabilities: ['model', ...(read ? ['fs-read' as const] : []), ...(write ? ['fs-write' as const] : [])],
        execution: { directory, maxActions: Number(actions), maxSteps: Number(steps), maxDurationMs: Number(minutes) * 60000 },
        materials: [], messages: [message] }
      const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(inputs))); current()
      const configDigest = Array.from(new Uint8Array(bytes), n => n.toString(16).padStart(2, '0')).join('')
      const grant = await props.connection({ kind: 'execution-command', request: { ...selector, kind: 'grant-execution',
        operationId: randomUUID(), planRevision: task.revision, delegationId: delegation.id, capabilities: inputs.capabilities,
        budget: Number(actions), expiresAt: p.serverTime + Number(minutes) * 60000, configDigest } }); current()
      const created = await props.connection({ kind: 'execution-command', request: { ...selector, kind: 'create-run',
        operationId: randomUUID(), planRevision: task.revision, executionDelegationId: grant.receipt?.execution?.executionDelegationId,
        serverEpoch: lease.serverEpoch, fencingEpoch: lease.fencingEpoch, configDigest } }); current()
      const runId = created.receipt?.execution?.runId
      if (!runId) throw new Error('unavailable')
      await props.execution({ ...selector, runId, operationId: randomUUID() as Parameters<OrganizationDesktopBridge['execution']>[0]['operationId'], inputs, start: true })
      current(); setNotice(t('executionFinished'))
    } catch (error) { if (alive.current) setNotice(t(executionError(error))) }
    finally {
      if (alive.current) {
        setBusy(false); setConfirmed(false)
        void load().catch((error: unknown) => { if (alive.current) setNotice(t(executionError(error))) })
      }
    }
  }
  const readReport = async (view: OrganizationExecutionView) => {
    try {
      const r = view.run
      const result = await props.executionReport({ organizationId: r.organizationId, projectId: r.projectId,
        planId: r.planId, assignmentId: r.assignmentId, runId: r.id })
      if (alive.current) setReport(result)
    } catch (error) { if (alive.current) setNotice(t(executionError(error))) }
  }
  const stop = async (view: OrganizationExecutionView, state: 'paused' | 'cancelled') => {
    setStopping(true)
    try {
      const { id, state: _state, version: _version, createdRevision: _created,
        configDigest: _digest, deviceId: _device, ...selector } = view.run
      await props.connection({ kind: 'execution-command', request: { ...selector, runId: id, operationId: randomUUID(), kind: 'transition-run', state } })
      if (alive.current) await load()
    } catch (error) { if (alive.current) setNotice(t(executionError(error))) }
    finally { if (alive.current) setStopping(false) }
  }
  if (!ready) return <p role="status">{t('qualificationRecheck')}</p>
  return <section className={css.card} aria-busy={busy}>
    <h4>{t('executionTitle')}</h4><p>{t('executionHint')}</p>
    {notice && <p role="status">{notice}</p>}
    {mine && preparation && preparation.assignment.state === 'accepted' && <form className={css.form} onSubmit={(event) => { event.preventDefault(); void start() }}>
      <label>{t('executionModel')}<Input required value={model} disabled={busy} onChange={(e) => { setModel(e.target.value); setConfirmed(false) }} /></label>
      <label>{t('executionEndpoint')}<Input required type="url" value={endpoint} disabled={busy} onChange={(e) => { setEndpoint(e.target.value); setConfirmed(false) }} /></label>
      <label>{t('executionDirectory')}<Input required value={directory} disabled={busy} onChange={(e) => { setDirectory(e.target.value); setConfirmed(false) }} /></label>
      <label>{t('executionActions')}<Input required type="number" min={1} step={1} value={actions} disabled={busy} onChange={(e) => { setActions(e.target.value); setConfirmed(false) }} /></label>
      <label>{t('executionSteps')}<Input required type="number" min={1} step={1} value={steps} disabled={busy} onChange={(e) => { setSteps(e.target.value); setConfirmed(false) }} /></label>
      <label>{t('executionMinutes')}<Input required type="number" min={1} step={1} value={minutes} disabled={busy} onChange={(e) => { setMinutes(e.target.value); setConfirmed(false) }} /></label>
      <label>{t('executionMessage')}<Input required value={message} disabled={busy} onChange={(e) => { setMessage(e.target.value); setConfirmed(false) }} /></label>
      <Checkbox label={t('executionRead')} checked={read} disabled={busy} onChange={(e) => { setRead(e); setConfirmed(false) }} />
      <Checkbox label={t('executionWrite')} checked={write} disabled={busy} onChange={(e) => { setWrite(e); setConfirmed(false) }} />
      <Checkbox label={t('executionConfirm')} checked={confirmed} disabled={busy} onChange={(e) => { setConfirmed(e) }} />
      <Button type="submit" disabled={!confirmed || busy || !!c.pendingOperation || preparation.lease?.state !== 'held'}>{t('executionStart')}</Button>
    </form>}
    {views?.generation === c.generation && views.items.map(view => <div key={view.run.id}>
      <p>{t('taskVersion', { revision: view.run.planRevision })} · {t(`run-${view.run.state}`)}</p>
      <p>{t('assignee')}: {preparation?.assignment.assigneeId} · {t('deviceId')}: {view.run.deviceId}</p>
      <p>{t('executionRemaining', { count: view.delegation.budget - view.delegation.used })}</p>
      {!view.eligible && <p>{t('qualificationRecheck')}</p>}
      {view.actions.some(a => a.state === 'unknown') && <p role="alert">{t('executionUnknown')}</p>}
      {mine && <Button onClick={() => { void readReport(view) }}>{t('executionTranscript')}</Button>}
      {mine && ['prepared', 'running', 'paused'].includes(view.run.state) && <div className={css.actions}>
        <Button disabled={stopping || !!c.pendingOperation} onClick={() => { void stop(view, 'paused') }}>{t('executionPause')}</Button>
        <Button disabled={stopping || !!c.pendingOperation} onClick={() => { void stop(view, 'cancelled') }}>{t('executionCancel')}</Button>
      </div>}
    </div>)}
    {views?.generation === c.generation && <div className={css.actions}>
      <Button disabled={pages.length === 1} onClick={() => { setPages(value => value.slice(0, -1)) }}>{t('previous')}</Button>
      <Button disabled={!views.items.length || views.offset + views.items.length >= views.total}
        onClick={() => { setPages(value => [...value, views.offset + views.items.length]) }}>{t('next')}</Button>
    </div>}
    {report?.generation === c.generation && <section>
      <h4>{t('executionTranscript')}</h4><p>{t('executionTranscriptPrivate')}</p>
      {report.report.truncated && <p>{t('executionTranscriptTruncated')}</p>}
      {report.report.entries.map((entry, index) => <div key={index}>
        <h5>{t(`executionRole-${entry.role}`)}</h5><pre className={css.transcript}>{entry.text}</pre>
      </div>)}
    </section>}
  </section>
}
