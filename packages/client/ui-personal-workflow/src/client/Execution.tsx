/** Anchored task selection, phase progress and explicit execution authorization. */
import { useId, useRef, useState } from 'react'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import { Button, Input, Menu, SegmentedControl, IconPlayOutlineRegular, IconRefreshOutlineRegular, IconBranchOutlineRegular, IconCheckOutlineRegular, IconCloseOutlineRegular, taskWorkspaceStyles as css } from '@deepseek-ai/dsh-client-ui-primitives'
import type { OperationId, PlanDefinition, PlanRevision, PlanView, TaskId, TaskRun, ExecutionAuthorization, ClaimTaskRequest, ControlTaskRequest } from '@deepseek-ai/dsh-personal-workflow/types'
import type { ExecutionProps } from './contract.ts'
import { completedRunPhases, phaseProgress } from './view.ts'
import panel from './ComposerPanels.module.css'

/** Select a ready task or explicitly control its current execution.
 * @param props - Composer binding and typed execution callbacks.
 * @returns Upward task panel with phase-aware settings and ownership controls.
 */
export function Execution(props: ExecutionProps) {
  const { t } = props
  const modeId = useId()
  const [open, setOpen] = useState(false)
  const [accountTasks, setAccountTasks] = useState<Awaited<ReturnType<NonNullable<ExecutionProps['account']>['listTasks']>>>([])
  const [plans, setPlans] = useState<PlanView[]>([])
  const [run, setRun] = useState<TaskRun | null>(null)
  const [runPlan, setRunPlan] = useState<PlanRevision | null>(null)
  const [selection, setSelection] = useState('')
  const [mode, setMode] = useState<ExecutionAuthorization['mode']>('manual')
  const [stopPhaseId, setStopPhaseId] = useState('')
  const [relay, setRelay] = useState(false)
  const [relayEveryPhases, setRelayEveryPhases] = useState(1)
  const [maxActions, setMaxActions] = useState(0)
  const [maxTurns, setMaxTurns] = useState(0)
  const [maxDurationMs, setMaxDurationMs] = useState(0)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const lock = useRef(false)
  const retry = useRef<{ fingerprint: string; operationId: OperationId } | null>(null)
  const running = props.useSession(value => value.running)
  const account = props.account
  const accountTask = accountTasks.find(item => item.id === selection)
  const prepared = run?.handoffs.find(handoff => handoff.status === 'prepared' && handoff.sourceSessionId === props.sessionId)
  const plan = plans.find(item => item.ready.some(id => id === selection))
  const task = plan?.snapshot.definition.tasks.find(item => item.id === selection)
  const phases = plan?.snapshot.definition.phases ?? []
  const phasePlan = plan?.snapshot.definition.planningMode === 'phases'
  const sequence = phasePlan && mode !== 'manual'
  const startIndex = phases.findIndex(item => item.id === task?.phaseId)
  const stop = sequence && mode === 'auto' ? phases.at(-1)?.id : stopPhaseId || task?.phaseId
  const rangeLength = Math.max(1, phases.findIndex(item => item.id === stop) - startIndex + 1)
  const batch = Math.min(relayEveryPhases, rangeLength)
  const readyPlans = plans.filter(view => view.ready.length > 0)
  const refresh = async (): Promise<void> => {
    if (account) { setAccountTasks(await account.listTasks()); return }
    const [candidates, binding] = await Promise.all([props.candidates(props.sessionId), props.readRun(props.sessionId)])
    const snapshot = binding === null ? null : await props.readPlan({ taskId: binding.planId, revision: binding.planRevision })
    setPlans(candidates); setRun(binding); setRunPlan(snapshot)
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
  const select = (id: string): void => { setSelection(id); setStopPhaseId(''); setRelay(false); setRelayEveryPhases(1) }
  const claim = (): void => {
    if (!task || !plan) return
    void perform(async () => {
      const value = { sessionId: props.sessionId, planId: plan.snapshot.definition.taskId, taskId: task.id,
        expectedRevision: plan.snapshot.revision,
        authorization: { mode, stopPhaseId: (sequence ? stop : task.phaseId) as typeof task.phaseId, maxActions, maxTurns, maxDurationMs,
          ...(sequence ? { startPhaseId: task.phaseId, ...(relay ? { relayEveryPhases: batch } : {}) } : {}) } }
      const request: ClaimTaskRequest = { ...value, operationId: operation(value) }
      setRun(await props.claim(request)); retry.current = null; await refresh()
    })
  }
  const progress = (definition: PlanDefinition, completed: readonly TaskId[]) => {
    const value = phaseProgress(definition, completed)
    return <div className={panel.phaseProgress}>
      <div className={panel.phaseSummary}><span>{value.through ? t('completedThroughPhase', { phase: value.through.title }) : t('noCompletedPhases')}</span>
        <span>{t('phaseProgress', { done: value.done, total: value.total })}</span></div>
      <progress className={panel.progress} aria-label={t('phaseSequence')} value={value.done} max={value.total} />
    </div>
  }
  const details = (title: string, scope: string, acceptance: readonly string[], artifacts: readonly string[], cwd?: string | null) =>
    <section className={panel.details}>
      <h3>{title}</h3><p className={panel.prose}>{scope}</p>
      <dl className={panel.facts}>{cwd !== undefined && <><dt>{t('cwd')}</dt><dd>{cwd ?? t('conversationDirectory')}</dd></>}
        <dt>{t('acceptanceTitle')}</dt><dd><ul>{acceptance.map((value, index) => <li key={index}>{value}</li>)}</ul></dd>
        <dt>{t('artifactsTitle')}</dt><dd>{artifacts.length > 0 ? <ul>{artifacts.map((path, index) => <li key={index}>{path}</li>)}</ul> : t('none')}</dd>
      </dl>
    </section>
  const footer = account ? <div className={panel.footer}>
    <p className={panel.hint}>{t('accountTaskHint')}</p>
    <Button disabled={busy || !account.assigned} onClick={() => { setOpen(false); account.openExecution() }}>{t('executionSettings')}</Button>
    <Button variant="primary" disabled={busy || running || !accountTask} onClick={() => {
      if (!accountTask) return
      void perform(async () => { await account.selectTask(accountTask.id); setOpen(false) })
    }}>{t('selectTask')}</Button>
  </div> : run === null ? <div className={panel.footer}>
    <p className={panel.hint}>{t('claimHint')}</p>
    <Button variant="primary" icon={<IconPlayOutlineRegular />} disabled={busy || running || !task} onClick={claim}>{t('claim')}</Button>
  </div> : undefined
  return <Menu open={open} side="top" portal role="dialog" label={t('selectTask')} listClassName={panel.executionPanel} panelFooter={footer}
    onClose={() => { setOpen(false) }} anchor={<Button variant="ghost" size="sm" className={css.composerButton} icon={<IconPlayOutlineRegular />}
      aria-haspopup="dialog" aria-expanded={open} aria-pressed={account?.assigned ?? run !== null} disabled={account !== undefined && running}
      onClick={() => {
        if (open) { setOpen(false); return }
        setOpen(true)
        if (account) setSelection(account.taskId ?? '')
        void perform(async () => {
          if (account) { await refresh(); return }
          const [, limits] = await Promise.all([refresh(), props.limits()])
          setMaxActions(limits.maxActions); setMaxTurns(limits.maxTurns); setMaxDurationMs(limits.maxDurationMs)
        })
      }}>{account?.taskTitle ?? t('selectTask')}</Button>}>
    <div className={panel.content}>
      <header className={panel.header}><div><h3>{t(run === null || account ? 'selectTask' : 'currentExecution')}</h3><p className={panel.hint}>{t('executionHint')}</p></div>
        <div className={panel.headerActions}>
          <Button variant="ghost" size="sm" aria-label={t('refresh')} icon={<IconRefreshOutlineRegular />} disabled={busy} onClick={() => { void perform(refresh) }} />
          <Button variant="ghost" size="sm" aria-label={t('close')} icon={<IconCloseOutlineRegular />} onClick={() => { setOpen(false) }} />
        </div></header>
      {busy && <p className={panel.loading} role="status">{t('loadingExecution')}</p>}
      {error !== null && <p className={panel.error} role="alert">{t('error', { message: error })}</p>}
      {account ? <>
        <div className={panel.taskChoices} aria-label={t('chooseAccountTask')}>{accountTasks.map(item => <button key={item.id} type="button"
          className={panel.taskChoice} aria-label={item.title} aria-pressed={selection === item.id} disabled={busy || running}
          onClick={() => { select(item.id) }}>
          <IconPlayOutlineRegular size={18} /><span className={panel.taskCopy}>
            <strong>{item.title}</strong><span className={panel.hint}>{item.scope}</span></span>
          {selection === item.id && <IconCheckOutlineRegular size={16} />}
        </button>)}</div>
        {!busy && accountTasks.length === 0 && <div className={panel.empty}><IconBranchOutlineRegular size={28} /><h4>{t('noReadyTasks')}</h4><p className={panel.hint}>{t('chooseAccountTask')}</p></div>}
        {accountTask && details(accountTask.title, accountTask.scope, accountTask.acceptance, accountTask.artifacts)}
      </> : run === null ? <>
        <div className={panel.taskList} aria-label={t('availableTasks')}>{readyPlans.map((view) => {
          const definition = view.snapshot.definition
          return <section key={definition.taskId} className={panel.section}>
            <div className={panel.planHeading}><h4>{definition.tasks.find(item => item.id === definition.taskId)?.goal}</h4>
              <span className={panel.badge}>{t(definition.planningMode === 'phases' ? 'phaseSequence' : 'balancedGranularity')}</span>
              <span className={panel.hint}>{t('revision', { revision: view.snapshot.revision })}</span></div>
            {definition.planningMode === 'phases' && progress(definition, view.tasks.filter(item => item.status === 'completed').map(item => item.taskId))}
            <div className={panel.taskChoices}>{definition.tasks.filter(item => view.ready.includes(item.id)).map(item => <button key={item.id} type="button"
              className={panel.taskChoice} aria-label={item.goal} aria-pressed={selection === item.id} disabled={busy || running}
              onClick={() => { select(item.id) }}>
              <IconPlayOutlineRegular size={18} /><span className={panel.taskCopy}>
                <strong>{item.goal}</strong><span className={panel.hint}>{item.scope}</span></span>
              <span className={panel.badge}>{item.id === definition.taskId && definition.planningMode === 'phases' ? t('finalVerification') : definition.phases.find(phase => phase.id === item.phaseId)?.title}</span>
              {selection === item.id && <IconCheckOutlineRegular size={16} />}
            </button>)}</div>
          </section>
        })}</div>
        {!busy && readyPlans.length === 0 && <div className={panel.empty}><IconBranchOutlineRegular size={28} /><h4>{t('noReadyTasks')}</h4><p className={panel.hint}>{t('readyTasksHint')}</p></div>}
        {task && plan && <>
          {details(task.goal, task.scope, task.acceptance, task.artifacts, task.cwd)}
          <section className={`${panel.section} ${panel.divider}`} aria-label={t('executionSettings')}>
            <h4>{t('executionSettings')}</h4>
            <SegmentedControl id={modeId} value={mode} label={t('executionMode')} disabled={busy || running}
              options={[{ value: 'manual', label: t('manualShort') }, { value: 'auto', label: t('autoShort') }, { value: 'auto_until', label: t('autoUntilShort') }]}
              onChange={setMode} />
            <div id={`${modeId}-${mode}-panel`} role="tabpanel" aria-labelledby={`${modeId}-${mode}`} className={panel.section}>
              <p className={panel.hint}>{t(mode)}</p>
              {phasePlan ? <>
                <div className={panel.settingsGrid}>
                  <label className={panel.field}>{t('executeThroughPhase')}<select value={stop} disabled={busy || running || mode !== 'auto_until'}
                    onChange={(event) => { setStopPhaseId(event.target.value) }}>
                    {phases.slice(startIndex).map(item => <option key={item.id} value={item.id}>{item.title}</option>)}
                  </select></label>
                  <label className={panel.field}>{t('phasesPerConversation')}<select value={relay ? String(batch) : 'all'} disabled={busy || running || mode === 'manual'}
                    onChange={(event) => { setRelay(event.target.value !== 'all'); if (event.target.value !== 'all') setRelayEveryPhases(Number(event.target.value)) }}>
                    <option value="all">{t('allPhasesOneConversation')}</option>
                    {Array.from({ length: rangeLength }, (_, index) => <option key={index + 1} value={String(index + 1)}>{t('phaseBatch', { count: index + 1 })}</option>)}
                  </select></label>
                </div>
                <p className={panel.hint}>{t('startAtPhase')}: {phases[startIndex]?.title} · {t('phaseRangeHint')}</p>
                <p className={panel.hint}>{t('relayHint')}</p>
              </> : <p className={panel.hint}>{t('stopAtPhase')}: {phases[startIndex]?.title}</p>}
            </div>
            <details className={panel.budget}><summary>{t('executionBudget')}</summary><div className={panel.budgetGrid}>
              <label className={panel.field}>{t('maxActions')}<Input type="number" min={1} value={maxActions} disabled={busy || running} onChange={(event) => { setMaxActions(Number(event.target.value)) }} /></label>
              <label className={panel.field}>{t('maxTurns')}<Input type="number" min={1} value={maxTurns} disabled={busy || running} onChange={(event) => { setMaxTurns(Number(event.target.value)) }} /></label>
              <label className={panel.field}>{t('durationMs')}<Input type="number" min={1} value={maxDurationMs} disabled={busy || running} onChange={(event) => { setMaxDurationMs(Number(event.target.value)) }} /></label>
            </div></details>
          </section>
        </>}
      </> : <>
        <section className={panel.section}>
          <div className={panel.statusRow}><h3>{runPlan?.definition.tasks.find(item => item.id === run.taskId)?.goal ?? t('currentExecution')}</h3><span className={panel.badge}>{t(run.status)}</span></div>
          {runPlan?.definition.planningMode === 'phases' && <>
            {progress(runPlan.definition, completedRunPhases(runPlan.definition, run))}
            <div className={panel.settingsGrid}>
              <div className={panel.field}><span>{t('executeThroughPhase')}</span><strong>{runPlan.definition.phases.find(item => item.id === run.authorization.stopPhaseId)?.title}</strong></div>
              <div className={panel.field}><span>{t('phasesPerConversation')}</span><strong>{run.authorization.relayEveryPhases ? t('phaseBatch', { count: run.authorization.relayEveryPhases }) : t('allPhasesOneConversation')}</strong></div>
            </div>
          </>}
          <dl className={panel.facts}><dt>{t('cwd')}</dt><dd>{run.baseline.cwd}</dd><dt>{t('executionMode')}</dt><dd>{t(run.authorization.mode)}</dd></dl>
          <div className={panel.settingsGrid}>
            <div className={panel.section}><span className={panel.hint}>{t('maxActions')}: {run.actions.length} / {run.authorization.maxActions}</span><progress className={panel.progress} aria-label={t('maxActions')} value={run.actions.length} max={run.authorization.maxActions} /></div>
            <div className={panel.section}><span className={panel.hint}>{t('maxTurns')}: {run.turnsUsed} / {run.authorization.maxTurns}</span><progress className={panel.progress} aria-label={t('maxTurns')} value={run.turnsUsed} max={run.authorization.maxTurns} /></div>
          </div>
        </section>
        {run.reason !== null && <p className={panel.hint}>{run.reason}</p>}
        {run.actions.some(action => action.status === 'unknown' || action.status === 'pending') && <section className={panel.section}><h4>{t('pendingActions')}</h4>
          {run.actions.filter(action => action.status === 'unknown' || action.status === 'pending').map(action => <p className={panel.prose} key={action.callId}>{action.name} · {t(action.status === 'unknown' ? 'actionUnknown' : 'actionPending')} · {action.callId}</p>)}</section>}
        {run.handoffs.length > 0 && <section className={panel.section}><h4>{t('handoffHistory')}</h4>{run.handoffs.map(handoff => <p className={panel.prose} key={handoff.id}>{handoff.context}</p>)}</section>}
        {run.evidence.length > 0 && <section className={panel.section}><h4>{t('evidenceTitle')}</h4>{run.evidence.map((evidence, index) => <p className={panel.prose} key={index}>{evidence.summary}</p>)}</section>}
        {run.sessionId !== props.sessionId ? <Button onClick={() => { props.openSession(run.sessionId) }}>{t('openOwner')}</Button> : <section className={`${panel.section} ${panel.divider}`}>
          <label className={panel.field}>{t('reconciliationNote')}<textarea value={note} onChange={(event) => { setNote(event.target.value) }} /></label>
          <p className={panel.hint}>{t('resumeHint')}</p>
          <div className={panel.runActions}>
            <Button variant="primary" disabled={busy || (run.status !== 'paused' && run.status !== 'needs_reconciliation')} onClick={() => { void perform(async () => {
              setRun(await props.resume({ ...control('resume'), reconciliation: note })); retry.current = null
            }) }}>{t('resume')}</Button>
            <Button variant="outline" disabled={busy || run.status !== 'running'} onClick={() => { void perform(async () => {
              setRun(await props.stop(control('pause'), false)); retry.current = null
            }) }}>{t('pause')}</Button>
            <Button className={css.dangerButton} disabled={busy || run.status === 'completed' || run.status === 'cancelled'} onClick={() => { void perform(async () => {
              setRun(await props.stop(control('cancel'), true)); retry.current = null
            }) }}>{t('cancelTask')}</Button>
            <Button variant="outline" disabled={busy || running || (prepared === undefined && !note.trim()) || (run.status !== 'running' && run.status !== 'paused')} onClick={() => { void perform(async () => {
              const value = prepared === undefined ? { ...control('handoff'), context: note }
                : { sessionId: props.sessionId, runId: run.id, ownerEpoch: prepared.ownerEpoch,
                  operationId: prepared.operationId, context: prepared.context }
              const next = await props.handoff(value); setRun(next); retry.current = null; props.openSession(next.sessionId)
            }) }}>{t('handoff')}</Button>
          </div>
        </section>}
      </>}
    </div>
  </Menu>
}
