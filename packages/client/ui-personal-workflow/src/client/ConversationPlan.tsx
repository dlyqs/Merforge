/** Inline personal plan review and explicit versioned editing, without changing chat input routing. */
import { useEffect, useRef, useState } from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import type { ChatNodeViewProps } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkflowActions } from './contract.ts'
import type { OperationId, PlanDefinition, PlanView, TaskId } from '@deepseek-ai/dsh-personal-workflow/types'
import { TaskMindMap } from './TaskMindMap.tsx'
import { taskWorkspaceStyles as css } from '@deepseek-ai/dsh-client-ui-primitives'

/** @param props - Keyed durable node, current plan reads and explicit save callback.
 * @returns Inline current tree and retained conflicting draft. */
export function ConversationPlan(props: Pick<ChatNodeViewProps<'personal-plan'>, 'node'> & PropsLocale<'personalWorkflow'> & Pick<WorkflowActions, 'list' | 'save'>) {
  const [view, setView] = useState<PlanView>(), [draft, setDraft] = useState<PlanDefinition>()
  const [selected, setSelected] = useState<TaskId>(props.node.data.taskId)
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [reload, setReload] = useState(0)
  const alive = useRef(false), operation = useRef<OperationId>()
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  useEffect(() => {
    let active = true
    setView(undefined)
    void props.list().then((plans) => {
      if (active) setView(plans.find(p => p.snapshot.definition.taskId === props.node.data.taskId))
    }, (e: unknown) => { if (active) setError(String(e)) })
    return () => { active = false }
  }, [props.node.data.taskId, props.node.data.snapshot.revision, reload])
  const definition = draft ?? view?.snapshot.definition, task = definition?.tasks.find(t => t.id === selected)
  const save = async () => {
    if (!draft || !view || busy) return
    setBusy(true); setError(''); operation.current ??= randomUUID() as OperationId
    try {
      await props.save({ definition: draft, expectedRevision: view.snapshot.revision, operationId: operation.current })
      if (alive.current) { setDraft(undefined); operation.current = undefined; setReload(n => n + 1) }
    } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : String(e)) }
    finally { if (alive.current) setBusy(false) }
  }
  const update = (patch: Partial<NonNullable<typeof task>>) => {
    if (definition) { setDraft({ ...definition, tasks: definition.tasks.map(t => t.id === selected ? { ...t, ...patch } : t) })
      operation.current = undefined
    }
  }
  return <section className={css.executionDetails}>
    <h3>{props.t('plans')}</h3>
    {view && <><p>{props.t('revision', { revision: view.snapshot.revision })}</p><p>{props.t(view.snapshot.approval ? 'approved' : 'pending')}</p></>}
    {!view && <p>{props.t('loading')}</p>}
    {definition && view && <TaskMindMap definition={definition} statuses={view.tasks}
      selected={selected} onSelect={setSelected} t={props.t} />}
    {task && view && <form onSubmit={(e) => { e.preventDefault(); void save() }}>
      <label>{props.t('goal')}<Input value={task.goal} disabled={busy} onChange={(e) => { update({ goal: e.target.value }) }} /></label>
      <label>{props.t('scope')}<Input value={task.scope} disabled={busy} onChange={(e) => { update({ scope: e.target.value }) }} /></label>
      <label>{props.t('acceptanceTitle')}<textarea value={task.acceptance.join('\n')} disabled={busy} onChange={(e) => { update({ acceptance: e.target.value.split('\n') }) }} /></label>
      <Button type="submit" disabled={busy || !draft || !!error}>{props.t('save')}</Button>
    </form>}
    {task && view && <section>
      <h4>{props.t('evidenceTitle')}</h4>
      <p>{props.t('artifactsTitle')}: {task.artifacts.join(', ')}</p>
      {(view.runs ?? []).filter(run => run.taskId === task.id).map(run => <div key={run.id}>
        <p>{props.t(run.status)}</p>
        {run.evidence.map((evidence, index) => <div key={index}><p>{evidence.summary}</p>
          <ul>{evidence.files.map(file => <li key={file.path}>{file.path}: {file.sha256}</li>)}</ul>
        </div>)}
      </div>)}
      {!(view.runs ?? []).some(run => run.taskId === task.id && run.evidence.length) && <p>{props.t('noEvidence')}</p>}
    </section>}
    {error && <p role="alert">{props.t('error', { message: error })}</p>}
    <Button disabled={busy} onClick={() => { setDraft(undefined); operation.current = undefined; setError(''); setReload(n => n + 1) }}>{props.t('refresh')}</Button>
  </section>
}
