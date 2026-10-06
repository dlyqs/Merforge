/** Explicit employee execution controls and authorized Run history. */
import { useEffect, useRef, useState } from 'react'
import { Button, Checkbox, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import type { OrganizationTaskView, OrganizationExecutionView, OrganizationAssignmentId } from '@deepseek-ai/dsh-organization'
import type { OrganizationProjectId } from '@deepseek-ai/dsh-organization/types'
import type { ConnectionResult, OrganizationDesktopBridge } from '@deepseek-ai/dsh-organization-connection/types'
import type { OrganizationProps } from './contract.ts'
import type { OrganizationKey } from './locales.ts'
import { DeliveryPanel } from './DeliveryPanel.tsx'
import { ExecutionHumanRequest } from './ExecutionHumanRequest.tsx'
import { workgraphError } from './workgraph-view.ts'
import css from './TaskInspector.module.css'
import { taskWorkspaceStyles } from '@deepseek-ai/dsh-client-ui-primitives'

import type { ModelCatalog } from '@deepseek-ai/dsh-api-session-controller/types'

type Inputs = Parameters<OrganizationDesktopBridge['execution']>[0]['inputs']
type Preparation = Extract<NonNullable<ConnectionResult['assignment']>['result'], { kind: 'preparation' }>['value']
function executionError(error: unknown): OrganizationKey {
  const code = error instanceof Error ? error.message : ''
  if (/native-selection|model-policy-denied|model-route-denied/.test(code)) return 'executionPolicyDenied'
  if (/native-unavailable|native-execution-disabled/.test(code)) return 'executionNativeUnavailable'
  if (/credential-unavailable/.test(code)) return 'executionCredentialMissing'
  if (/action-limit|step-limit|duration-limit|size-limit|explicit-local-authorization-required/.test(code)) return 'executionLimitReached'
  if (/directory-|path-escape|linked-path|invalid-relative-path/.test(code)) return 'executionDirectoryDenied'
  if (/native-result-unknown|native-thread-unknown|reconciliation-required|permit-unconfirmed/.test(code)) return 'executionUnknown'
  if (/baseline-changed/.test(code)) return 'executionBaselineChanged'
  if (/resume-qualification-required/.test(code)) return 'executionRenewRequired'
  if (/authority-lost|permit-expired|permit-revoked|superseded/.test(code)) return 'qualificationRecheck'
  return workgraphError(error)
}
/** @param props - Current authorized task and native callbacks. @returns Explicit execution form and Run state. */
export function ExecutionPanel(props: OrganizationProps & { task: OrganizationTaskView
  projectId: OrganizationProjectId
  current: boolean
  section?: 'execution' | 'delivery'
  assignmentId?: OrganizationAssignmentId }) {
  const { t, task } = props, c = props.useOrganization(s => s.connection)
  const [selectedRun, setSelectedRun] = useState('')
  const operationLock = useRef(false)
  const [preparation, setPreparation] = useState<Preparation>()
  const [views, setViews] = useState<{ generation: number; items: OrganizationExecutionView[]; total: number; offset: number }>()
  const [pages, setPages] = useState([0])
  const offset = pages.at(-1) ?? 0
  const [backend, setBackend] = useState<'harness-api' | 'codex'>('harness-api')
  const [effort, setEffort] = useState<NonNullable<Inputs['backend']>['effort']>()
  const modelCatalogRevision = props.useModelCatalogRevision(value => value)
  const modelSequence = useRef(0)
  const [catalog, setCatalog] = useState<ModelCatalog>()
  const [model, setModel] = useState(''), [endpoint, setEndpoint] = useState(''), [directory, setDirectory] = useState('')
  const [actions, setActions] = useState(''), [steps, setSteps] = useState(''), [minutes, setMinutes] = useState('')
  const [message, setMessage] = useState(''), [read, setRead] = useState(false), [write, setWrite] = useState(false)
  const [writeApproval, setWriteApproval] = useState(false)
  const [resumeConfirmed, setResumeConfirmed] = useState(false)
  const [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false), [stopping, setStopping] = useState(false)
  const [notice, setNotice] = useState('')
  const [report, setReport] = useState<Awaited<ReturnType<OrganizationDesktopBridge['executionReport']>>>()
  const draft = useRef<{ body: string; grantId: string; createId: string; expiresAt: number; openId: Parameters<OrganizationDesktopBridge['execution']>[0]['operationId'] }>()
  const alive = useRef(true), sequence = useRef(0)
  useEffect(() => { alive.current = true; return () => { alive.current = false; sequence.current++ } }, [])
  const scope = `${c.principal?.serverId}:${c.principal?.accountId}:${c.organizationId}:${task.id}:${task.revision}`
  const currentScope = useRef(scope); currentScope.current = scope
  const isAlive = () => alive.current && currentScope.current === scope
  const ready = props.current && c.phase === 'ready' && c.mode === 'organization'
  const memberId = c.organizations.find(org => org.id === c.organizationId)?.membershipId
  const load = async () => {
    const seq = ++sequence.current
    const history = await props.connection({ kind: 'assignment-tasks', request: { organizationId: c.organizationId,
      projectId: props.projectId, planId: task.planId, taskId: task.id } })
    if (!alive.current || seq !== sequence.current || history.assignment?.result.kind !== 'tasks') return
    const assignment = props.assignmentId ? { id: props.assignmentId, organizationId: c.organizationId }
      : history.assignment.result.value.items.find(a => a.planRevision === task.revision)
        ?? (props.section === 'delivery' ? history.assignment.result.value.items[0] : undefined)
    if (!assignment) { setPreparation(undefined); setViews(undefined); return }
    const selector = { organizationId: assignment.organizationId, projectId: props.projectId,
      planId: task.planId, assignmentId: assignment.id }
    const p = await props.connection({ kind: 'assignment-preparation', request: selector })
    if (!isAlive() || seq !== sequence.current || p.assignment?.result.kind !== 'preparation') return
    if (props.section === 'delivery' && p.assignment.result.value.assignment.assigneeId !== memberId) {
      setPreparation(p.assignment.result.value)
      setViews({ generation: p.assignment.generation, items: [], total: 0, offset: 0 })
      return
    }
    const runs = await props.connection({ kind: 'execution-list', request: { ...selector, offset } })
    if (!runs.executions || runs.generation === undefined) return
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
  const mine = views?.generation === c.generation && preparation?.assignment.assigneeId === memberId
  const loadModels = async () => {
    const seq = ++modelSequence.current
    const value = await props.loadModels?.()
    if (alive.current && seq === modelSequence.current) setCatalog(value)
  }
  useEffect(() => {
    ++modelSequence.current
    setCatalog(undefined)
    if (backend === 'codex') void loadModels().catch((error: unknown) => {
      if (alive.current) setNotice(t(executionError(error)))
    })
    return () => { ++modelSequence.current }
  }, [modelCatalogRevision, backend])
  const start = async () => {
    if (!preparation || !confirmed || operationLock.current) return
    operationLock.current = true
    setBusy(true); setNotice('')
    const current = () => { if (!isAlive()) throw new Error('superseded') }
    try {
      const selector = { organizationId: preparation.assignment.organizationId, projectId: props.projectId,
        planId: task.planId, assignmentId: preparation.assignment.id }
      const fresh = await props.connection({ kind: 'assignment-preparation', request: selector }); current()
      if (fresh.assignment?.result.kind !== 'preparation') throw new Error('unavailable')
      const p = fresh.assignment.result.value
      if (p.assignment.state !== 'accepted' || p.assignment.planRevision !== task.revision) throw new Error('version-conflict')
      if (backend === 'codex' && (!effort || !catalog?.groups.some(g => g.backend === 'codex' && g.models.some(m => m.id === model
        && m.reasoning?.efforts.some(e => e.id === effort))))) throw new Error('native-unavailable')
      const native: Inputs['backend'] = backend === 'codex' && effort ? { kind: 'codex', dispatch: 'local',
        runtimeVersion: '0.153.4', model, effort, maxTurns: Number(actions), maxDurationMs: Number(minutes) * 60000 } : undefined
      const inputs: Inputs = { model, ...(native ? { backend: native } : { endpoint, requireWriteApproval: writeApproval }),
        capabilities: native ? ['codex-turn'] : ['model', ...(read ? ['fs-read' as const] : []), ...(write ? ['fs-write' as const] : [])],
        execution: { directory, maxActions: Number(actions), maxSteps: native ? Number(actions) : Number(steps),
          maxDurationMs: Number(minutes) * 60000 },
        materials: [], messages: [message] }
      const body = JSON.stringify({ inputs, selector, revision: task.revision })
      if (draft.current?.body !== body) draft.current = { body, grantId: randomUUID(), createId: randomUUID(),
        expiresAt: p.serverTime + Number(minutes) * 60000,
        openId: randomUUID() as Parameters<OrganizationDesktopBridge['execution']>[0]['operationId'] }
      const attempt = draft.current
      const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(inputs))); current()
      const configDigest = Array.from(new Uint8Array(bytes), n => n.toString(16).padStart(2, '0')).join('')
      const grant = await props.connection({ kind: 'execution-command', request: { ...selector, kind: 'grant-execution',
        operationId: attempt.grantId, planRevision: task.revision,
        ...(native ? { backend: native } : {}), capabilities: inputs.capabilities,
        budget: Number(actions), expiresAt: attempt.expiresAt, configDigest } }); current()
      const created = await props.connection({ kind: 'execution-command', request: { ...selector, kind: 'create-run',
        operationId: attempt.createId, planRevision: task.revision, ...(native ? { backend: native } : {}),
        executionDelegationId: grant.receipt?.execution?.executionDelegationId,
        configDigest } }); current()
      const runId = created.receipt?.execution?.runId
      if (!runId) throw new Error('unavailable')
      await props.execution({ ...selector, runId, operationId: attempt.openId, inputs, start: true })
      current(); setNotice(t('executionFinished'))
    } catch (error) { if (isAlive()) setNotice(t(executionError(error))) }
    finally {
      operationLock.current = false
      if (isAlive()) {
        setBusy(false); setConfirmed(false)
        void load().catch((error: unknown) => { if (isAlive()) setNotice(t(executionError(error))) })
      }
    }
  }
  const readReport = async (view: OrganizationExecutionView) => {
    try {
      const r = view.run
      const result = await props.executionReport({ organizationId: r.organizationId, projectId: r.projectId,
        planId: r.planId, assignmentId: r.assignmentId, runId: r.id })
      if (isAlive()) { setReport(result); setResumeConfirmed(false) }
    } catch (error) { if (isAlive()) setNotice(t(executionError(error))) }
  }
  const resume = async (view: OrganizationExecutionView, reconcile = false) => {
    const recovery = report?.report.recovery
    if (!resumeConfirmed || !recovery?.baselineDigest || report?.report.runId !== view.run.id) return
    setBusy(true)
    try {
      const r = view.run
      await props.execution({ organizationId: r.organizationId, projectId: r.projectId, planId: r.planId,
        assignmentId: r.assignmentId, runId: r.id, operationId: randomUUID() as Parameters<OrganizationDesktopBridge['execution']>[0]['operationId'],
        inputs: recovery.inputs, start: !reconcile, reconcile, resume: { baselineDigest: recovery.baselineDigest } })
      if (isAlive()) { setReport(undefined); await load() }
    } catch (error) { if (isAlive()) setNotice(t(executionError(error))) }
    finally { if (isAlive()) { setBusy(false); setResumeConfirmed(false) } }
  }
  const stop = async (view: OrganizationExecutionView, state: 'paused' | 'cancelled') => {
    setStopping(true)
    try {
      const { id, state: _state, version: _version, createdRevision: _created,
        configDigest: _digest, backend: _backend, startedAt: _startedAt, stopReason: _stopReason,
        deviceId: _device, serverEpoch: _epoch, fencingEpoch: _fence, ...selector } = view.run
      await props.connection({ kind: 'execution-command', request: { ...selector, runId: id, operationId: randomUUID(), kind: 'transition-run', state } })
      if (isAlive()) await load()
    } catch (error) { if (isAlive()) setNotice(t(executionError(error))) }
    finally { if (isAlive()) setStopping(false) }
  }
  const currentViews = ready && views?.generation === c.generation ? views : undefined
  if (props.section === 'delivery') {
    const selected = views?.items.find(item => item.run.id === selectedRun)
    return <section className={css.panel}>
      <h4>{t('deliveryTitle')}</h4>
      {!ready && <p role="status">{t('qualificationRecheck')}</p>}
      {notice && <p className={css.notice} role="status">{notice}</p>}
      {views && preparation ? <div hidden={!currentViews}>
        {views.items.length > 0 && <label className={css.form}>{t('executionRun')}<select value={selectedRun}
          onChange={(event) => { setSelectedRun(event.target.value) }}>
          <option value="">{t('taskManualDelivery')}</option>{views.items.map(item => <option key={item.run.id} value={item.run.id}>{t(`run-${item.run.state}`)} · {item.run.id.slice(0, 8)}</option>)}
        </select></label>}
        <DeliveryPanel key={selected?.run.id ?? preparation.assignment.id} {...props} assignment={preparation.assignment}
          {...(selected ? { run: selected.run, submissionReady: !selected.actions.some(action => ['reserved', 'unknown'].includes(action.state))
            && !selected.humanRequests.some(request => request.state === 'pending') } : {})} />
        {views.total > views.items.length && <div className={css.actions}>
          <Button disabled={pages.length === 1} onClick={() => { setPages(value => value.slice(0, -1)) }}>{t('previous')}</Button>
          <Button disabled={!views.items.length || views.offset + views.items.length >= views.total}
            onClick={() => { setPages(value => [...value, views.offset + views.items.length]) }}>{t('next')}</Button>
        </div>}
      </div> : ready && <div className={css.empty}><strong>{t('taskDeliveryEmpty')}</strong><p>{t('taskDeliveryEmptyHint')}</p></div>}
    </section>
  }
  return <><p hidden={ready} role="status">{t('qualificationRecheck')}</p>
    <section hidden={!ready} className={css.panel} aria-busy={busy}>
      <h4>{t('executionTitle')}</h4><p>{t(backend === 'codex' ? 'executionCodexHint' : 'executionHint')}</p>
      {notice && <p className={css.notice} role="status">{notice}</p>}
      {mine && preparation && preparation.assignment.state === 'accepted' && <form className={css.form} onSubmit={(event) => { event.preventDefault(); void start() }}>
        <label>{t('executionBackend')}<select value={backend} disabled={busy || !!c.pendingOperation} onChange={(event) => {
          setBackend(event.target.value === 'codex' ? 'codex' : 'harness-api'); setModel(''); setEffort(undefined); setConfirmed(false); setCatalog(undefined)
        }}><option value="harness-api">{t('executionApi')}</option><option value="codex">{t('executionCodex')}</option></select></label>
        {backend === 'codex' ? <>
          {props.openCodexSettings && <Button disabled={busy} onClick={props.openCodexSettings}>{t('openCodexSettings')}</Button>}
          <Button disabled={busy} onClick={() => { void loadModels().then(() => { if (isAlive()) setConfirmed(false) })
            .catch((error: unknown) => { if (isAlive()) setNotice(t(executionError(error))) }) }}>{t('executionRefreshModels')}</Button>
          <label>{t('executionModel')}<select required value={model} disabled={busy} onChange={(event) => {
            const m = catalog?.groups.filter(g => g.backend === 'codex').flatMap(g => g.models).find(m => m.id === event.target.value)
            setModel(event.target.value); setEffort(m?.reasoning?.defaultEffort as NonNullable<Inputs['backend']>['effort']); setConfirmed(false)
          }}><option value="">{t('executionSelectModel')}</option>{catalog?.groups.filter(g => g.backend === 'codex').flatMap(g => g.models)
              .map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
          <label>{t('executionEffort')}<select required value={effort ?? ''} disabled={busy} onChange={(event) => {
            setEffort(event.target.value as NonNullable<Inputs['backend']>['effort']); setConfirmed(false)
          }}><option value="">{t('executionSelectModel')}</option>{catalog?.groups.filter(g => g.backend === 'codex').flatMap(g => g.models)
              .find(m => m.id === model)?.reasoning?.efforts.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
          {catalog?.failures.some(f => f.id === 'codex') && <p role="alert">{t('executionNativeUnavailable')}</p>}
        </> : <label>{t('executionModel')}<Input required value={model} disabled={busy} onChange={(e) => { setModel(e.target.value); setConfirmed(false) }} /></label>}
        {backend === 'harness-api' && <label>{t('executionEndpoint')}<Input required type="url" value={endpoint} disabled={busy} onChange={(e) => { setEndpoint(e.target.value); setConfirmed(false) }} /></label>}
        <label>{t('executionDirectory')}<Input required value={directory} disabled={busy} onChange={(e) => { setDirectory(e.target.value); setConfirmed(false) }} /></label>
        <fieldset className={css.step}><legend>{t('taskRunSettings')}</legend><div className={css.grid}><label>{t(backend === 'codex' ? 'executionTurns' : 'executionActions')}<Input required type="number" min={1} step={1} value={actions} disabled={busy} onChange={(e) => { setActions(e.target.value); setConfirmed(false) }} /></label>
          {backend === 'harness-api' && <label>{t('executionSteps')}<Input required type="number" min={1} step={1} value={steps} disabled={busy} onChange={(e) => { setSteps(e.target.value); setConfirmed(false) }} /></label>}
          <label>{t('executionMinutes')}<Input required type="number" min={1} step={1} value={minutes} disabled={busy} onChange={(e) => { setMinutes(e.target.value); setConfirmed(false) }} /></label>
        </div></fieldset>
        <label>{t('executionMessage')}<textarea required value={message} disabled={busy} onChange={(e) => { setMessage(e.target.value); setConfirmed(false) }} /></label>
        {backend === 'harness-api' && <fieldset className={css.step}><legend>{t('taskRunPermissions')}</legend><Checkbox label={t('executionRead')} checked={read} disabled={busy} onChange={(e) => { setRead(e); setConfirmed(false) }} />
          <Checkbox label={t('executionWrite')} checked={write} disabled={busy} onChange={(e) => { setWrite(e); setConfirmed(false) }} />
          <Checkbox label={t('executionRequireWriteApproval')} checked={writeApproval} disabled={busy} onChange={(value) => { setWriteApproval(value); setConfirmed(false) }} /></fieldset>}
        <Checkbox label={t('executionConfirm')} checked={confirmed} disabled={busy} onChange={(e) => { setConfirmed(e) }} />
        <div className={css.footer}><Button variant="primary" type="submit" disabled={!confirmed || busy || !!c.pendingOperation}>{t('executionStart')}</Button></div>
      </form>}
      {currentViews?.items.length === 0 && <div className={css.empty}><strong>{t('taskRunEmpty')}</strong><p>{t('taskRunEmptyHint')}</p></div>}
      {currentViews && currentViews.items.length > 0 && <h4>{t('taskRunHistory')}</h4>}
      {views?.items.map(view => <div className={css.record} key={view.run.id} hidden={views.generation !== c.generation}>
        <p>{t('taskVersion', { revision: view.run.planRevision })} · {t(`run-${view.run.state}`)}</p>
        <p>{t('assignee')}: {c.members.find(member => member.id === view.assigneeId)?.username ?? t('selectedMember')}</p>
        <p>{t('executionBackend')}: {t(view.run.backend ? 'executionCodex' : 'executionApi')}
          {view.run.backend ? ` · ${view.run.backend.model} ${view.run.backend.effort}`
            : report?.report.runId === view.run.id && report.report.recovery ? ` · ${report.report.recovery.inputs.model}` : ''}</p>
        <details className={css.advanced}><summary>{t('technicalDetails')}</summary><p>{t('executionRun')}: {view.run.id}</p></details>
        {view.run.backend && <p>{t('executionCodexHint')}</p>}
        <p>{t('executionRemaining', { count: view.delegation.budget - view.delegation.used })}</p>
        {!view.eligible && <p>{t('qualificationRecheck')}</p>}
        {view.actions.some(a => a.state === 'unknown') && <p role="alert">{t('executionUnknown')}</p>}
        {preparation && view.humanRequests.map(request => <ExecutionHumanRequest key={`${c.generation}:${request.id}`} {...props} request={request} assignment={preparation.assignment} refresh={load} />)}
        {mine && <Button onClick={() => { void readReport(view) }}>{t('executionTranscript')}</Button>}
        {mine && report?.generation === c.generation && report.report.runId === view.run.id && report.report.recovery && ['running', 'paused', 'waiting-human', 'cancelled'].includes(view.run.state) && <section className={css.step}>
          <h5>{t('executionRecovery')}</h5><p>{t(view.run.backend ? 'executionNativeRecoveryHint' : 'executionRecoveryHint')}</p>
          {report.report.native && <p>{t(`native-${report.report.native.status}`)}</p>}
          {report.report.native?.cleanupFailed && <p role="alert">{t('executionNativeCleanupFailed')}</p>}
          <p>{t('executionDirectory')}: {report.report.recovery.inputs.execution?.directory}</p>
          {!report.report.recovery.baselineDigest && <p role="alert">{t('executionBaselineUnavailable')}</p>}
          <details className={css.advanced}><summary>{t('technicalDetails')}</summary><code>{report.report.recovery.baselineDigest}</code>
            {report.report.recovery.actions.map(action => <p key={action.actionId}>{action.actionId} · {t(`recovery-${action.reason}`)}</p>)}
          </details>
          {!view.eligible && <p role="alert">{t('executionRenewRequired')}</p>}
          <Checkbox label={t('executionResumeConfirm')} checked={resumeConfirmed} onChange={setResumeConfirmed} />
          <div className={css.footer}><Button variant="outline" disabled={busy || !!c.pendingOperation || !resumeConfirmed || !report.report.recovery.baselineDigest}
            onClick={() => { void resume(view, true) }}>{t('executionReconcile')}</Button>
          <Button variant="primary" disabled={busy || !!c.pendingOperation || !resumeConfirmed || !view.eligible || !report.report.recovery.baselineDigest
          || report.report.recovery.actions.some(a => a.status === 'unknown') || view.humanRequests.some(h => !['answered', 'approved', 'denied'].includes(h.state))}
          onClick={() => { void resume(view) }}>{t('executionResume')}</Button></div>
        </section>}
        {mine && ['prepared' , 'running', 'paused', 'waiting-human'].includes(view.run.state) && <div className={css.actions}>
          <Button variant="outline" disabled={stopping || !!c.pendingOperation} onClick={() => { void stop(view, 'paused') }}>{t('executionPause')}</Button>
          <Button className={css.danger} disabled={stopping || !!c.pendingOperation} onClick={() => { void stop(view, 'cancelled') }}>{t('executionCancel')}</Button>
        </div>}
      </div>)}
      {views?.generation === c.generation && views.total > views.items.length && <div className={css.actions}>
        <Button disabled={pages.length === 1} onClick={() => { setPages(value => value.slice(0, -1)) }}>{t('previous')}</Button>
        <Button disabled={!views.items.length || views.offset + views.items.length >= views.total}
          onClick={() => { setPages(value => [...value, views.offset + views.items.length]) }}>{t('next')}</Button>
      </div>}
      {report?.generation === c.generation && <details className={css.advanced} open>
        <summary>{t('executionTranscript')}</summary><p>{t('executionTranscriptPrivate')}</p>
        {report.report.native?.cleanupFailed && <p role="alert">{t('executionNativeCleanupFailed')}</p>}
        {report.report.truncated && <p>{t('executionTranscriptTruncated')}</p>}
        <div className={css.transcriptLog}>{report.report.entries.map((entry, index) => <div key={index}>
          <h5>{t(`executionRole-${entry.role}`)}</h5><pre className={taskWorkspaceStyles.prose}>{entry.text}</pre>
        </div>)}</div>
      </details>}
    </section></>
}
