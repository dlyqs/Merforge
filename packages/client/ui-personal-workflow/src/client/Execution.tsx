/** Explicit composer task selection and same-task execution controls. */
import { useRef, useState } from 'react'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
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
    <Button variant="ghost" onClick={() => { setOpen(true); void perform(async () => {
      await refresh()
      const limits = await props.limits()
      setMaxActions(limits.maxActions); setMaxTurns(limits.maxTurns); setMaxDurationMs(limits.maxDurationMs)
    }) }}>{t('selectTask')}</Button>
    {open && <Modal open title={t('selectTask')} closeLabel={t('close')} onClose={() => { if (!busy) setOpen(false) }} className={css.dialog ?? ''}>
      <div className={css.body}>
        {error !== null && <p role="alert">{t('error', { message: error })}</p>}
        <Button disabled={busy} onClick={() => { void perform(refresh) }}>{t('refresh')}</Button>
        {run === null ? <>
          <label>{t('selectTask')}<select value={selection} disabled={busy || running} onChange={(event) => { setSelection(event.target.value) }}>
            <option value="">{t('chooseReadyTask')}</option>
            {plans.flatMap(view => view.snapshot.definition.tasks.filter(item => view.ready.includes(item.id)).map(item =>
              <option key={item.id} value={item.id}>{item.goal}</option>))}
          </select></label>
          {task !== undefined && plan !== undefined && <>
            <p>{t('revision', { revision: plan.snapshot.revision })}</p><p>{task.goal}</p><p>{task.scope}</p>
            <p>{t('cwd')}: {task.cwd ?? t('conversationDirectory')}</p>
            <ul>{task.acceptance.map((value, index) => <li key={index}>{value}</li>)}</ul>
            <p>{t('artifacts')}: {task.artifacts.join(', ')}</p><p>{t('sharedWorkspace')}</p>
            <label>{t('executionMode')}<select value={mode} disabled={busy} onChange={(event) => { setMode(event.target.value as ExecutionAuthorization['mode']) }}>
              <option value="manual">{t('manual')}</option><option value="auto">{t('auto')}</option><option value="auto_until">{t('auto_until')}</option>
            </select></label>
            <p>{t('stopAtPhase')}: {plan.snapshot.definition.phases.find(item => item.id === task.phaseId)?.title}</p>
            <label>{t('maxActions')}<input type="number" min={1} value={maxActions} onChange={(event) => { setMaxActions(Number(event.target.value)) }} /></label>
            <label>{t('maxTurns')}<input type="number" min={1} value={maxTurns} onChange={(event) => { setMaxTurns(Number(event.target.value)) }} /></label>
            <label>{t('durationMs')}<input type="number" min={1} value={maxDurationMs} onChange={(event) => { setMaxDurationMs(Number(event.target.value)) }} /></label>
            <p>{t('claimHint')}</p>
            <Button disabled={busy || running} onClick={() => { void perform(async () => {
              const value = { sessionId: props.sessionId, planId: plan.snapshot.definition.taskId, taskId: task.id,
                expectedRevision: plan.snapshot.revision,
                authorization: { mode, stopPhaseId: task.phaseId, maxActions, maxTurns, maxDurationMs } }
              const request: ClaimTaskRequest = { ...value, operationId: operation(value) }
              setRun(await props.claim(request)); retry.current = null; await refresh()
            }) }}>{t('claim')}</Button>
          </>}
        </> : <>
          <p>{t(run.status)}</p><p>{t('cwd')}: {run.baseline.cwd}</p>
          <p>{t('executionMode')}: {t(run.authorization.mode)}</p><p>{t('maxActions')}: {run.actions.length}/{run.authorization.maxActions}</p>
          <p>{t('maxTurns')}: {run.turnsUsed}/{run.authorization.maxTurns}</p>
          {run.reason !== null && <p>{run.reason}</p>}
          <ul>{run.actions.filter(action => action.status === 'unknown' || action.status === 'pending').map(action => <li key={action.callId}>{action.name}: {action.callId} — {action.status}</li>)}</ul>
          {run.handoffs.map(handoff => <p key={handoff.id}>{handoff.context}</p>)}
          {run.evidence.map((evidence, index) => <p key={index}>{evidence.summary}</p>)}
          {run.sessionId !== props.sessionId ? <Button onClick={() => { props.openSession(run.sessionId) }}>{t('openOwner')}</Button> : <>
            <label>{t('reconciliationNote')}<textarea value={note} onChange={(event) => { setNote(event.target.value) }} /></label>
            <p>{t('resumeHint')}</p>
            <Button disabled={busy || (run.status !== 'paused' && run.status !== 'needs_reconciliation')} onClick={() => { void perform(async () => {
              const value = { ...control('resume'), reconciliation: note }
              setRun(await props.resume(value)); retry.current = null
            }) }}>{t('resume')}</Button>
            <Button disabled={busy || run.status !== 'running'} onClick={() => { void perform(async () => {
              const value = control('pause')
              setRun(await props.stop(value, false)); retry.current = null
            }) }}>{t('pause')}</Button>
            <Button disabled={busy || run.status === 'completed' || run.status === 'cancelled'} onClick={() => { void perform(async () => {
              const value = control('cancel')
              setRun(await props.stop(value, true)); retry.current = null
            }) }}>{t('cancelTask')}</Button>
            <Button disabled={busy || running || (prepared === undefined && !note.trim()) || (run.status !== 'running' && run.status !== 'paused')} onClick={() => { void perform(async () => {
              const value = prepared === undefined ? { ...control('handoff'), context: note }
                : { sessionId: props.sessionId, runId: run.id, ownerEpoch: prepared.ownerEpoch,
                  operationId: prepared.operationId, context: prepared.context }
              const next = await props.handoff(value); setRun(next); retry.current = null; props.openSession(next.sessionId)
            }) }}>{t('handoff')}</Button>
          </>}
        </>}
      </div>
    </Modal>}
  </>
}
