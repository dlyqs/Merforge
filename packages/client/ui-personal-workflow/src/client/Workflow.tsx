/** Main task workspace; all execution state comes from the Host projection. */
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import { useEffect, useRef, useState } from 'react'
import { Button, TaskDetail, TaskStages, IconBranchOutlineRegular, IconRefreshOutlineRegular, IconEditOutlineRegular, IconDownloadOutlineRegular, IconCheckOutlineRegular, IconNewChatOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { OperationId, PlanDefinition, PlanView, TaskDefinition, TaskId, PhaseId } from '@deepseek-ai/dsh-personal-workflow/types'
import type { WorkflowProps } from './contract.ts'
import { overlappingArtifacts } from './view.ts'
import { TaskMindMap } from './TaskMindMap.tsx'
import { taskWorkspaceStyles as css } from '@deepseek-ai/dsh-client-ui-primitives'

/** Present one entrance's persisted plans and exact-version review actions.
 * @param props - Framework slot data and Host callbacks.
 * @returns Selected plan map, stages and review controls.
 */
export function Workflow(props: WorkflowProps) {
  const { t } = props
  const [plans, setPlans] = useState<PlanView[]>([])
  const { selected, revision } = props.useStore(value => value)
  const [detailsOpen, setDetailsOpen] = useState(true)
  const [taskId, setTaskId] = useState<TaskId | null>(selected)
  const [draft, setDraft] = useState<PlanDefinition | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const lock = useRef(false)
  const receipt = useRef<{ fingerprint: string; operationId: OperationId } | null>(null)
  const sessions = props.useSessions(value => value)
  const view = plans.find(plan => plan.snapshot.definition.taskId === selected)
  const definition = draft ?? view?.snapshot.definition
  const task = definition?.tasks.find(item => item.id === taskId)
  const status = view?.tasks.find(item => item.taskId === taskId)
  const operationId = (fingerprint: string): OperationId => {
    if (receipt.current?.fingerprint !== fingerprint) receipt.current = { fingerprint, operationId: randomUUID() as OperationId }
    return receipt.current.operationId
  }
  const perform = async (action: () => Promise<void>): Promise<void> => {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setError(null)
    try { await action() }
    catch (reason: unknown) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { lock.current = false; setBusy(false) }
  }
  useEffect(() => {
    let active = true
    setBusy(true)
    setError(null)
    void props.list().then((result) => { if (active) setPlans(result) }, (reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : String(reason))
    }).finally(() => { if (active) setBusy(false) })
    return () => { active = false }
  }, [props.list, revision])
  useEffect(() => { setTaskId(selected); setDetailsOpen(true); setDraft(null); setError(null) }, [selected])
  useEffect(() => {
    props.actions.setEditing(draft !== null)
    return () => { props.actions.setEditing(false) }
  }, [draft, props.actions])
  const showTask = (id: TaskId): void => { setTaskId(id); setDetailsOpen(true) }
  const update = (patch: Partial<TaskDefinition>): void => {
    if (draft === null || task === undefined) return
    setDraft({ ...draft, tasks: draft.tasks.map(item => item.id === task.id ? { ...item, ...patch } : item) })
  }
  const names = (ids: readonly TaskId[]): string => ids.map(id => definition?.tasks.find(item => item.id === id)?.goal ?? id).join(' · ') || t('none')
  const linkedSessions = task === undefined || view === undefined ? [] : [...new Set([
    ...(view.snapshot.sessionId === null ? [] : [view.snapshot.sessionId]),
    ...(view.runs ?? []).filter(run => run.taskId === task.id).flatMap(run => run.sessions),
  ])]
  return <section className={css.taskPage} aria-label={t('plans')}>
    <div className={css.body}>
      <div className={css.toolbar}>
        <div><h2>{t('plans')}</h2><p className={css.muted}>{t('plansHint')}</p></div>
        <Button variant="ghost" size="sm" icon={<IconRefreshOutlineRegular />} disabled={busy || draft !== null} onClick={props.actions.refresh}>{t('refresh')}</Button>
      </div>
      {busy && <p className={css.notice} role="status">{t('loading')}</p>}
      {error !== null && <p className={css.error} role="alert">{t('error', { message: error })}</p>}
      {!busy && view === undefined && <div className={css.empty}><IconBranchOutlineRegular size={28} /><h3>{t('selectPlan')}</h3><p>{t('selectPlanHint')}</p></div>}
      {view !== undefined && definition !== undefined && <>
        <header className={css.planHeader}>
          <div className={css.planIdentity}><span className={css.status} data-status={view.snapshot.approval === null ? 'pending_review' : 'completed'}>{t(view.snapshot.approval === null ? 'pending' : 'approved')}</span>
            <span className={css.muted}>{t('revision', { revision: view.snapshot.revision })}</span></div>
          <div className={css.actions}>
            <Button variant="outline" size="sm" icon={<IconEditOutlineRegular />} disabled={busy || draft !== null} onClick={() => { setDraft(structuredClone(view.snapshot.definition)); setDetailsOpen(true) }}>{t('edit')}</Button>
            <Button variant="primary" size="sm" icon={<IconCheckOutlineRegular />} disabled={busy || draft !== null || view.snapshot.approval !== null} onClick={() => { void perform(async () => {
              const request = { taskId: definition.taskId, expectedRevision: view.snapshot.revision }
              await props.approve({ ...request, operationId: operationId(JSON.stringify(['approve', request])) })
              props.actions.refresh()
            }) }}>{t('approve')}</Button>
            <Button variant="ghost" size="sm" icon={<IconDownloadOutlineRegular />} disabled={busy || draft !== null} onClick={() => { void perform(async () => {
              const text = await props.exportPlan({ taskId: definition.taskId, revision: view.snapshot.revision })
              const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }))
              const anchor = document.createElement('a')
              anchor.href = url; anchor.download = `${definition.taskId}-v${view.snapshot.revision}.md`; anchor.click()
              setTimeout(() => { URL.revokeObjectURL(url) }, 0)
            }) }}>{t('export')}</Button>
          </div>
        </header>
        <div className={css.notice}><p>{t('approvalHint')}</p><p>{t('executionPending')}</p></div>
        {draft !== null && <div className={css.editBar}>
          <p>{t('reviewAgain')}</p>
          <Button variant="primary" disabled={busy} onClick={() => { void perform(async () => {
            const request = { definition: draft, expectedRevision: view.snapshot.revision }
            await props.save({ ...request, operationId: operationId(JSON.stringify(['save', request])) })
            setDraft(null)
            props.actions.refresh()
          }) }}>{t('save')}</Button>
          <Button variant="outline" disabled={busy} onClick={() => { setDraft(null) }}>{t('cancel')}</Button>
        </div>}
        <div className={css.workspace}>
          <TaskMindMap key={definition.taskId} definition={definition} statuses={view.tasks}
            selected={taskId} onSelect={showTask} t={t}>
            {task !== undefined && detailsOpen && <TaskDetail taskId={task.id} title={task.goal}
              labels={{ taskDetail: t('taskDetail'), hideDetails: t('hideDetails') }} onClose={() => { setDetailsOpen(false) }}
              {...(status ? { status: { value: status.status, label: t(status.status) } } : {})}>
              {status !== undefined && <div className={css.taskProgress}>
                <p>{t('blockers')}: {names(status.blockers)}</p>
                {status.requiredChildren > 0 && <><p>{t('progress', { done: status.completedChildren, total: status.requiredChildren })}</p>
                  <progress className={css.progress} aria-label={t('progress', { done: status.completedChildren, total: status.requiredChildren })} value={status.completedChildren} max={status.requiredChildren} /></>}
              </div>}
              {draft === null ? <dl>
                <dt>{t('scope')}</dt><dd>{task.scope}</dd><dt>{t('phase')}</dt><dd>{definition.phases.find(phase => phase.id === task.phaseId)?.title}</dd>
                <dt>{t('prerequisites')}</dt><dd>{names(task.dependsOn)}</dd>
                <dt>{t('acceptanceTitle')}</dt><dd><ul>{task.acceptance.map((text, index) => <li key={index}>{text}</li>)}</ul></dd>
                <dt>{t('artifactsTitle')}</dt><dd>{task.artifacts.length === 0 && <span className={css.muted}>{t('none')}</span>}<ul className={css.fileList}>{task.artifacts.map((text, index) => <li key={index}>{text}</li>)}</ul></dd>
                <dt>{t('cwd')}</dt><dd>{task.cwd ?? t('none')}</dd>
              </dl> : <fieldset disabled={busy} className={css.editor}>
                <label>{t('goal')}<input value={task.goal} onChange={(event) => { update({ goal: event.target.value }) }} /></label>
                <label>{t('scope')}<textarea value={task.scope} onChange={(event) => { update({ scope: event.target.value }) }} /></label>
                <label>{t('acceptance')}<textarea value={task.acceptance.join('\n')} onChange={(event) => { update({ acceptance: event.target.value.split('\n') }) }} /></label>
                <label>{t('artifacts')}<textarea value={task.artifacts.join('\n')} onChange={(event) => { update({ artifacts: event.target.value === '' ? [] : event.target.value.split('\n') }) }} /></label>
                <label>{t('cwd')}<input value={task.cwd ?? ''} onChange={(event) => { update({ cwd: event.target.value || null }) }} /></label>
                <label>{t('phase')}<select value={task.phaseId} onChange={(event) => { update({ phaseId: event.target.value as PhaseId }) }}>
                  {definition.phases.map(phase => <option key={phase.id} value={phase.id}>{phase.title}</option>)}
                </select></label>
                {task.parentTaskId !== null && <label>{t('parent')}<select value={task.parentTaskId} onChange={(event) => { update({ parentTaskId: event.target.value as TaskId }) }}>
                  {definition.tasks.filter(item => item.id !== task.id).map(item =>
                    <option key={item.id} value={item.id}>{item.goal}</option>)}
                </select></label>}
                <label className={css.checkRow}><input type="checkbox" checked={task.required} disabled={task.parentTaskId === null} onChange={(event) => { update({ required: event.target.checked }) }} />{t('required')}</label>
                <fieldset><legend>{t('prerequisites')}</legend>{definition.tasks.filter(item => item.id !== task.id).map(item => <label className={css.checkRow} key={item.id}>
                  <input type="checkbox" checked={task.dependsOn.includes(item.id)} onChange={(event) => { update({ dependsOn: event.target.checked ? [...task.dependsOn, item.id] : task.dependsOn.filter(id => id !== item.id) }) }} />{item.goal}
                </label>)}</fieldset>
              </fieldset>}
              <section className={css.detailSection}><h4>{t('evidenceTitle')}</h4>
                {(view.runs ?? []).filter(run => run.taskId === task.id).map(run => <div className={css.evidence} key={run.id}>
                  <p>{t('revision', { revision: run.planRevision })} · {t(run.status)}</p>
                  {run.evidence.map((evidence, index) => <div key={index}><p>{evidence.summary}</p>
                    <ul>{evidence.files.map(file => <li key={file.path}>{file.path}: {file.sha256}</li>)}</ul>
                  </div>)}
                </div>)}
                {!(view.runs ?? []).some(run => run.taskId === task.id && run.evidence.length) && <p className={css.hint}>{t('noEvidence')}</p>}
                {overlappingArtifacts(definition.tasks, task).length > 0 && <p className={css.notice}>{t('overlap', { paths: overlappingArtifacts(definition.tasks, task).join(', ') })}</p>}
              </section>
              <section className={css.detailSection}><h4>{t('sessions')}</h4>
                <div className={css.sessionLinks}>{linkedSessions.map(id => <Button key={id} variant="ghost" size="sm" icon={<IconNewChatOutlineRegular />} onClick={() => { props.openSession(id) }}>{sessions.byId[id]?.displayTitle ?? id}</Button>)}</div>
                {linkedSessions.length === 0 && <p className={css.hint}>{t('noSessions')}</p>}
              </section>
            </TaskDetail>}
          </TaskMindMap>
          <TaskStages phases={definition.phases.map((phase) => {
            const members = definition.tasks.filter(item => item.phaseId === phase.id)
            return { ...phase, progressLabel: t('phaseProgress', { done: view.tasks.filter(item => item.status === 'completed' && members.some(member => member.id === item.taskId)).length, total: members.length }) }
          })} tasks={definition.tasks} selected={taskId} disabled={busy}
          labels={{ dependencies: t('dependencies'), parallel: t('parallel'), phase: t('phase'), prerequisites: t('prerequisites'), none: t('none') }}
          onSelect={(id) => { const item = definition.tasks.find(item => item.id === id); if (item) showTask(item.id) }}
          {...(draft ? { onPhaseTitleChange: (id: string, title: string) => {
            setDraft({ ...draft, phases: draft.phases.map(phase => phase.id === id ? { ...phase, title } : phase) })
          } } : {})} />
        </div>
      </>}
    </div>
  </section>
}
