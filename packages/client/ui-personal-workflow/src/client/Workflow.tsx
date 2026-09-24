/** Plan review dialog; all execution state comes from the Host projection. */
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import { useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { OperationId, PlanDefinition, PlanView, TaskDefinition, TaskId, PhaseId } from '@deepseek-ai/dsh-personal-workflow/types'
import type { WorkflowProps } from './contract.ts'
import { childrenOf, overlappingArtifacts, selectPlans } from './view.ts'
import css from './Workflow.module.css'

/** Present one entrance's persisted plans and exact-version review actions.
 * @param props - Framework slot data and Host callbacks.
 * @returns Plan opener and review dialog.
 */
export function Workflow(props: WorkflowProps) {
  const { t } = props
  const [open, setOpen] = useState(false)
  const [plans, setPlans] = useState<PlanView[]>([])
  const [selected, setSelected] = useState<TaskId | null>(null)
  const [taskId, setTaskId] = useState<TaskId | null>(null)
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
  const refresh = async (): Promise<void> => {
    const result = selectPlans(await props.list(), props.projectId, props.botId)
    setPlans(result)
  }
  const select = (plan: PlanView): void => {
    setSelected(plan.snapshot.definition.taskId)
    setTaskId(plan.snapshot.definition.taskId)
    setDraft(null)
    setError(null)
  }
  const update = (patch: Partial<TaskDefinition>): void => {
    if (draft === null || task === undefined) return
    setDraft({ ...draft, tasks: draft.tasks.map(item => item.id === task.id ? { ...item, ...patch } : item) })
  }
  const names = (ids: readonly TaskId[]): string => ids.map(id => definition?.tasks.find(item => item.id === id)?.goal ?? id).join(' · ') || t('none')
  const tree = (parent: TaskId | null): ReactNode => <ul>{childrenOf(definition?.tasks ?? [], parent).map(item => <li key={item.id}>
    <button type="button" aria-pressed={taskId === item.id} onClick={() => { setTaskId(item.id) }}>{item.goal}</button>
    <span>{t(view?.tasks.find(state => state.taskId === item.id)?.status ?? 'pending_review')}</span>
    {tree(item.id)}
  </li>)}</ul>
  return <>
    <Button variant="ghost" onClick={() => { setOpen(true); void perform(refresh) }}>{t('plans')}</Button>
    {open && <Modal open title={t('plans')} closeLabel={t('close')} className={css.dialog ?? ''}
      onClose={() => { if (!lock.current) { setOpen(false); setDraft(null) } }}>
      <div className={css.body}>
        <Button variant="outline" disabled={busy || draft !== null} onClick={() => { void perform(refresh) }}>{t('refresh')}</Button>
        {busy && <p role="status">{t('loading')}</p>}
        {error !== null && <p role="alert">{t('error', { message: error })}</p>}
        {!busy && plans.length === 0 && <p>{t('empty')}</p>}
        <nav aria-label={t('plans')}>{plans.map(plan => <Button key={plan.snapshot.definition.taskId} variant="ghost" disabled={busy || draft !== null}
          onClick={() => { select(plan) }}>
          {plan.snapshot.definition.tasks.find(item => item.id === plan.snapshot.definition.taskId)?.goal}
        </Button>)}</nav>
        {view !== undefined && definition !== undefined && <>
          <header className={css.actions}>
            <strong>{t('revision', { revision: view.snapshot.revision })}</strong>
            <span>{t(view.snapshot.approval === null ? 'pending' : 'approved')}</span>
            <Button variant="outline" disabled={busy || draft !== null} onClick={() => { setDraft(structuredClone(view.snapshot.definition)) }}>{t('edit')}</Button>
            <Button variant="primary" disabled={busy || draft !== null || view.snapshot.approval !== null} onClick={() => { void perform(async () => {
              const request = { taskId: definition.taskId, expectedRevision: view.snapshot.revision }
              await props.approve({ ...request, operationId: operationId(JSON.stringify(['approve', request])) })
              await refresh()
            }) }}>{t('approve')}</Button>
            <Button variant="outline" disabled={busy || draft !== null} onClick={() => { void perform(async () => {
              const text = await props.exportPlan({ taskId: definition.taskId, revision: view.snapshot.revision })
              const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }))
              const anchor = document.createElement('a')
              anchor.href = url; anchor.download = `${definition.taskId}-v${view.snapshot.revision}.md`; anchor.click()
              setTimeout(() => { URL.revokeObjectURL(url) }, 0)
            }) }}>{t('export')}</Button>
          </header>
          <p>{t('approvalHint')}</p><p>{t('executionPending')}</p>
          {draft !== null && <div className={css.actions}>
            <p>{t('reviewAgain')}</p>
            <Button variant="primary" disabled={busy} onClick={() => { void perform(async () => {
              const request = { definition: draft, expectedRevision: view.snapshot.revision }
              await props.save({ ...request, operationId: operationId(JSON.stringify(['save', request])) })
              setDraft(null)
              await refresh()
            }) }}>{t('save')}</Button>
            <Button variant="outline" disabled={busy} onClick={() => { setDraft(null) }}>{t('cancel')}</Button>
          </div>}
          <div className={css.columns}>
            <section><h3>{t('tree')}</h3>{tree(null)}</section>
            <section><h3>{t('dependencies')}</h3><p>{t('parallel')}</p>
              {definition.phases.map((phase) => {
                const members = definition.tasks.filter(item => item.phaseId === phase.id)
                return <section key={phase.id}>
                  {draft === null ? <h4>{phase.title}</h4> : <label>{t('phase')}<input value={phase.title} disabled={busy} onChange={(event) => {
                    setDraft({ ...draft, phases: draft.phases.map(item =>
                      item.id === phase.id ? { ...item, title: event.target.value } : item) })
                  }} /></label>}
                  <p>{t('phaseProgress', { done: view.tasks.filter(item => item.status === 'completed' && members.some(member => member.id === item.taskId)).length, total: members.length })}</p>
                  <div className={css.branches}>{members.map(item => <div key={item.id} className={css.branch}>
                    <button type="button" onClick={() => { setTaskId(item.id) }}>{item.goal}</button>
                    <p>{t('prerequisites')}: {names(item.dependsOn)}</p>
                  </div>)}</div>
                </section>
              })}
            </section>
          </div>
          {task !== undefined && <section className={css.detail}>
            <h3>{task.goal}</h3>
            {status !== undefined && <><p>{t(status.status)}</p><p>{t('blockers')}: {names(status.blockers)}</p>
              <p>{t('progress', { done: status.completedChildren, total: status.requiredChildren })}</p></>}
            {draft === null ? <dl>
              <dt>{t('scope')}</dt><dd>{task.scope}</dd><dt>{t('phase')}</dt><dd>{definition.phases.find(phase => phase.id === task.phaseId)?.title}</dd>
              <dt>{t('acceptance')}</dt><dd><ul>{task.acceptance.map((text, index) => <li key={index}>{text}</li>)}</ul></dd>
              <dt>{t('artifacts')}</dt><dd><ul>{task.artifacts.map((text, index) => <li key={index}>{text}</li>)}</ul></dd>
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
              <label><input type="checkbox" checked={task.required} disabled={task.parentTaskId === null} onChange={(event) => { update({ required: event.target.checked }) }} />{t('required')}</label>
              <fieldset><legend>{t('prerequisites')}</legend>{definition.tasks.filter(item => item.id !== task.id).map(item => <label key={item.id}>
                <input type="checkbox" checked={task.dependsOn.includes(item.id)} onChange={(event) => { update({ dependsOn: event.target.checked ? [...task.dependsOn, item.id] : task.dependsOn.filter(id => id !== item.id) }) }} />{item.goal}
              </label>)}</fieldset>
            </fieldset>}
            <p>{t('noEvidence')}</p>
            {overlappingArtifacts(definition.tasks, task).length > 0 && <p>{t('overlap', { paths: overlappingArtifacts(definition.tasks, task).join(', ') })}</p>}
            <h4>{t('sessions')}</h4>
            {view.snapshot.sessionId === null ? <p>{t('noSessions')}</p> : <Button variant="ghost" onClick={() => {
              if (view.snapshot.sessionId !== null) props.openSession(view.snapshot.sessionId)
            }}>{sessions.byId[view.snapshot.sessionId]?.displayTitle ?? view.snapshot.sessionId}</Button>}
          </section>}
        </>}
      </div>
    </Modal>}
  </>
}
