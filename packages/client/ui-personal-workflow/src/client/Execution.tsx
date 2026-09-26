/** Explicit composer task selection and same-task execution controls. */
import { useRef, useState } from 'react'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import { Button, Modal, IconPlayOutlineRegular, IconRefreshOutlineRegular, IconBranchOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { OperationId, PlanView, TaskRun, ExecutionAuthorization, ClaimTaskRequest, ControlTaskRequest } from '@deepseek-ai/dsh-personal-workflow/types'
import type { ExecutionProps } from './contract.ts'
import css from './Workflow.module.css'

/** Select a ready task, inspect its scope, or explicitly resume/transfer its ownership.
 * @param props - Composer binding and typed execution callbacks.
 * @returns Localized task dropdown and authorization dialog.
 */
export function Execution(props: ExecutionProps) {
  const { t } = props
  const [open, setOpen] = useState(false)
  const [plans, setPlans] = useState<PlanView[]>([])
  const [run, setRun] = useState<TaskRun | null>(null)
  const [selection, setSelection] = useState('')
  const [mode, setMode] = useState<ExecutionAuthorization['mode']>('manual')
  const [maxActions, setMaxActions] = useState(0)
  const [maxTurns, setMaxTurns] = useState(0)
  const [maxDurationMs, setMaxDurationMs] = useState(0)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const lock = useRef(false)
  const retry = useRef<{ fingerprint: string; operationId: OperationId } | null>(null)
  const running = props.useSession(value => value.running)
  const prepared = run?.handoffs.find(handoff => handoff.status === 'prepared' && handoff.sourceSessionId === props.sessionId)
  const plan = plans.find(item => item.ready.some(id => id === selection))
  const task = plan?.snapshot.definition.tasks.find(item => item.id === selection)
  const refresh = async (): Promise<void> => {
    const [candidates, binding] = await Promise.all([props.candidates(props.sessionId), props.readRun(props.sessionId)])
    setPlans(candidates); setRun(binding)
  }
  const perform = async (work: () => Promise<void>): Promise<void> => {
    if (lock.current) return
    lock.current = true; setBusy(true); setError(null)
    try { await work() }
    catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason))
      try { await refresh() } catch (refreshError) { setError(String(reason) + '\n' + String(refreshError)) }
    } finally { lock.current = false; setBusy(false) }
  }
  const operation = (value: object): OperationId => {
    const fingerprint = JSON.stringify(value)
    if (retry.current?.fingerprint !== fingerprint) retry.current = { fingerprint, operationId: randomUUID() as OperationId }
    return retry.current.operationId
  }
  const control = (action: string): ControlTaskRequest => {
    if (run === null) throw new Error('No execution selected')
    const value = { sessionId: props.sessionId, runId: run.id, ownerEpoch: run.ownerEpoch }
    return { ...value, operationId: operation({ ...value, action, note }) }
  }
  return <>
    <Button variant="ghost" size="sm" className={css.composerButton} icon={<IconPlayOutlineRegular />} onClick={() => { setOpen(true); void perform(async () => {
      await refresh()
      const limits = await props.limits()
      setMaxActions(limits.maxActions); setMaxTurns(limits.maxTurns); setMaxDurationMs(limits.maxDurationMs)
    }) }}>{t('selectTask')}</Button>
    {open && <Modal open title={t('selectTask')} closeLabel={t('close')} onClose={() => { if (!busy) setOpen(false) }} className={`${css.dialog} ${css.executionDialog}`} contentClassName={css.dialogContent ?? ''}>
      <div className={css.body}>
        <div className={css.toolbar}><p className={css.muted}>{t('executionHint')}</p>
          <Button variant="ghost" size="sm" icon={<IconRefreshOutlineRegular />} disabled={busy} onClick={() => { void perform(refresh) }}>{t('refresh')}</Button></div>
        {busy && <p className={css.notice} role="status">{t('loadingExecution')}</p>}
        {error !== null && <p className={css.error} role="alert">{t('error', { message: error })}</p>}
        {run === null ? <>
          <label className={css.field}>{t('selectTask')}<select value={selection} disabled={busy || running} onChange={(event) => { setSelection(event.target.value) }}>
            <option value="">{t('chooseReadyTask')}</option>
            {plans.flatMap(view => view.snapshot.definition.tasks.filter(item => view.ready.includes(item.id)).map(item =>
              <option key={item.id} value={item.id}>{item.goal}</option>))}
          </select></label>
          {!busy && task === undefined && <div className={css.empty}><IconBranchOutlineRegular size={28} /><h3>{t(plans.some(item => item.ready.length > 0) ? 'chooseReadyTask' : 'noReadyTasks')}</h3><p>{t('readyTasksHint')}</p></div>}
          {task !== undefined && plan !== undefined && <>
            <section className={css.taskPreview}>
              <span className={css.eyebrow}>{t('revision', { revision: plan.snapshot.revision })}</span><h3>{task.goal}</h3><p className={css.prose}>{task.scope}</p>
              <dl className={css.facts}><dt>{t('cwd')}</dt><dd className={css.path}>{task.cwd ?? t('conversationDirectory')}</dd>
                <dt>{t('acceptanceTitle')}</dt><dd><ul>{task.acceptance.map((value, index) => <li key={index}>{value}</li>)}</ul></dd>
                <dt>{t('artifactsTitle')}</dt><dd>{task.artifacts.length > 0 ? <ul className={css.fileList}>{task.artifacts.map((path, index) => <li key={index}>{path}</li>)}</ul> : t('none')}</dd>
              </dl>
            </section>
            <p className={css.notice}>{t('sharedWorkspace')}</p>
            <fieldset className={css.editor} disabled={busy}>
              <legend className={css.formLegend}>{t('executionSettings')}</legend>
              <label>{t('executionMode')}<select value={mode} disabled={busy} onChange={(event) => { setMode(event.target.value as ExecutionAuthorization['mode']) }}>
                <option value="manual">{t('manual')}</option><option value="auto">{t('auto')}</option><option value="auto_until">{t('auto_until')}</option>
              </select></label>
              <p className={css.hint}>{t('stopAtPhase')}: {plan.snapshot.definition.phases.find(item => item.id === task.phaseId)?.title}</p>
              <div className={css.budgetGrid}><label>{t('maxActions')}<input type="number" min={1} value={maxActions} onChange={(event) => { setMaxActions(Number(event.target.value)) }} /></label>
                <label>{t('maxTurns')}<input type="number" min={1} value={maxTurns} onChange={(event) => { setMaxTurns(Number(event.target.value)) }} /></label>
                <label>{t('durationMs')}<input type="number" min={1} value={maxDurationMs} onChange={(event) => { setMaxDurationMs(Number(event.target.value)) }} /></label>
              </div></fieldset>
            <div className={css.dialogActions}><p className={css.hint}>{t('claimHint')}</p>
              <Button variant="primary" icon={<IconPlayOutlineRegular />} disabled={busy || running} onClick={() => { void perform(async () => {
                const value = { sessionId: props.sessionId, planId: plan.snapshot.definition.taskId, taskId: task.id,
                  expectedRevision: plan.snapshot.revision,
                  authorization: { mode, stopPhaseId: task.phaseId, maxActions, maxTurns, maxDurationMs } }
                const request: ClaimTaskRequest = { ...value, operationId: operation(value) }
                setRun(await props.claim(request)); retry.current = null; await refresh()
              }) }}>{t('claim')}</Button></div>
          </>}
        </> : <>
          <section className={css.taskPreview}>
            <div className={css.sectionHeading}><h3>{t('currentExecution')}</h3><span className={css.status} data-status={run.status}>{t(run.status)}</span></div>
            <dl className={css.facts}><dt>{t('cwd')}</dt><dd className={css.path}>{run.baseline.cwd}</dd>
              <dt>{t('executionMode')}</dt><dd>{t(run.authorization.mode)}</dd></dl>
            <div className={css.runBudgets}>
              <div><span>{t('maxActions')}</span><strong>{run.actions.length}<small> / {run.authorization.maxActions}</small></strong>
                <progress className={css.progress} aria-label={t('maxActions')} value={run.actions.length} max={run.authorization.maxActions} /></div>
              <div><span>{t('maxTurns')}</span><strong>{run.turnsUsed}<small> / {run.authorization.maxTurns}</small></strong>
                <progress className={css.progress} aria-label={t('maxTurns')} value={run.turnsUsed} max={run.authorization.maxTurns} /></div>
            </div>
          </section>
          {run.reason !== null && <p className={css.notice}>{run.reason}</p>}
          {run.actions.some(action => action.status === 'unknown' || action.status === 'pending') && <section className={css.detailSection}><h4>{t('pendingActions')}</h4>
            <ul className={css.fileList}>{run.actions.filter(action => action.status === 'unknown' || action.status === 'pending').map(action => <li key={action.callId}><strong>{action.name}</strong><span className={css.muted}> · {t(action.status === 'unknown' ? 'actionUnknown' : 'actionPending')}</span><div className={css.path}>{action.callId}</div></li>)}</ul></section>}
          {run.handoffs.length > 0 && <section className={css.detailSection}><h4>{t('handoffHistory')}</h4>{run.handoffs.map(handoff => <p className={css.prose} key={handoff.id}>{handoff.context}</p>)}</section>}
          {run.evidence.length > 0 && <section className={css.detailSection}><h4>{t('evidenceTitle')}</h4>{run.evidence.map((evidence, index) => <p className={css.prose} key={index}>{evidence.summary}</p>)}</section>}
          {run.sessionId !== props.sessionId ? <Button onClick={() => { props.openSession(run.sessionId) }}>{t('openOwner')}</Button> : <>
            <label className={css.field}>{t('reconciliationNote')}<textarea value={note} onChange={(event) => { setNote(event.target.value) }} /></label>
            <p className={css.hint}>{t('resumeHint')}</p>
            <div className={css.runActions}><Button variant="primary" disabled={busy || (run.status !== 'paused' && run.status !== 'needs_reconciliation')} onClick={() => { void perform(async () => {
              const value = { ...control('resume'), reconciliation: note }
              setRun(await props.resume(value)); retry.current = null
            }) }}>{t('resume')}</Button>
            <Button variant="outline" disabled={busy || run.status !== 'running'} onClick={() => { void perform(async () => {
              const value = control('pause')
              setRun(await props.stop(value, false)); retry.current = null
            }) }}>{t('pause')}</Button>
            <Button className={css.dangerButton} disabled={busy || run.status === 'completed' || run.status === 'cancelled'} onClick={() => { void perform(async () => {
              const value = control('cancel')
              setRun(await props.stop(value, true)); retry.current = null
            }) }}>{t('cancelTask')}</Button>
            <Button variant="outline" disabled={busy || running || (prepared === undefined && !note.trim()) || (run.status !== 'running' && run.status !== 'paused')} onClick={() => { void perform(async () => {
              const value = prepared === undefined ? { ...control('handoff'), context: note }
                : { sessionId: props.sessionId, runId: run.id, ownerEpoch: prepared.ownerEpoch,
                  operationId: prepared.operationId, context: prepared.context }
              const next = await props.handoff(value); setRun(next); retry.current = null; props.openSession(next.sessionId)
            }) }}>{t('handoff')}</Button></div>
          </>}
        </>}
      </div>
    </Modal>}
  </>
}
