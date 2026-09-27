/** Project task workspace; native generations invalidate every displayed remote fact. */
import { useEffect, useRef, useState } from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import type { OrganizationPlanDefinition, OrganizationPlanId, OrganizationTaskId, OrganizationPhaseId, OrganizationTaskPage, OrganizationTaskView } from '@deepseek-ai/dsh-organization'
import type { OperationId, OrganizationProjectView } from '@deepseek-ai/dsh-organization/types'
import type { OrganizationProps } from './contract.ts'
import { TaskEditor } from './TaskEditor.tsx'
import { TaskGrants } from './TaskGrants.tsx'
import { taskRows, workgraphError } from './workgraph-view.ts'
import css from './Organization.module.css'

type Draft = {
  planId: OrganizationPlanId
  taskId: OrganizationTaskId
  expectedRevision: number
  operationId: string
  definition: OrganizationPlanDefinition
  generation: number
  attempted: boolean
  conflict: boolean
}
type ContextReply = Awaited<ReturnType<OrganizationProps['context']>>

/** @param props - Project chosen in the current identity partition. @returns Authorized task list, editor and pre-execution context. */
export function Workbench(props: OrganizationProps & { project: OrganizationProjectView; onBack: () => void }) {
  const c = props.useOrganization(s => s.connection)
  const { t } = props
  const [page, setPage] = useState<{ generation: number; value: OrganizationTaskPage }>()
  const [selected, setSelected] = useState<OrganizationTaskId>()
  const [draft, setDraft] = useState<Draft>()
  const [context, setContext] = useState<ContextReply>()
  const [search, setSearch] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false)
  const alive = useRef(true)
  const contextOperations = useRef(new Map<string, OperationId>())
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const query = { organizationId: props.project.organizationId, projectId: props.project.id }
  const ready = c.phase === 'ready' && c.mode === 'organization' && c.organizationId === props.project.organizationId
  const currentPage = ready && page?.generation === c.generation ? page.value : undefined
  const task = currentPage?.items.find(item => item.id === selected)
  const writable = ready && !busy && !c.pendingOperation
  const draftCurrent = draft?.expectedRevision === 0 || draft?.generation === c.generation
  const run = async (work: () => Promise<void>) => {
    setBusy(true); setNotice('')
    try { await work() } catch (error) { if (alive.current) setNotice(t(workgraphError(error))) }
    finally { if (alive.current) setBusy(false) }
  }
  const load = async (offset = 0) => {
    const result = await props.connection({ kind: 'workgraph-tasks', request: { ...query, search, offset, ...(offset && currentPage ? { cursor: currentPage.cursor } : {}) } })
    if (alive.current && result.workgraph?.result.kind === 'tasks') setPage({ generation: result.workgraph.generation, value: result.workgraph.result.value })
  }
  useEffect(() => { void run(() => load()) }, [])
  const edit = async (item: OrganizationTaskView) => {
    const result = await props.connection({ kind: 'workgraph-read', request: { ...query, planId: item.planId } })
    if (!alive.current || result.workgraph?.result.kind !== 'plan') return
    const version = result.workgraph.result.value
    setDraft({ planId: version.planId, taskId: item.id, expectedRevision: version.revision, definition: version.definition,
      generation: result.workgraph.generation, operationId: randomUUID(), attempted: false, conflict: false })
  }
  const create = () => {
    const taskId = randomUUID() as OrganizationTaskId, phaseId = randomUUID() as OrganizationPhaseId
    setDraft({ planId: randomUUID() as OrganizationPlanId, taskId, expectedRevision: 0, generation: c.generation,
      operationId: randomUUID(), attempted: false, conflict: false, definition: { taskId,
        phases: [{ id: phaseId, title: t('preparation') }], tasks: [{ id: taskId, phaseId, parentTaskId: null,
          goal: '', scope: '', acceptance: [''], artifacts: [], required: true, dependsOn: [], suggestedMembershipId: null }] } })
    setNotice('')
  }
  const save = async () => {
    if (!draft || draft.conflict) return
    setDraft({ ...draft, attempted: true })
    try {
      await props.connection({ kind: 'workgraph-save', request: { ...query, planId: draft.planId, expectedRevision: draft.expectedRevision,
        operationId: draft.operationId, definition: draft.definition } })
      if (!alive.current) return
      setDraft(undefined); setNotice(t('success')); await load()
    } catch (error) {
      if (alive.current && workgraphError(error) === 'version-conflict') setDraft(previous => previous && ({ ...previous, conflict: true }))
      throw error
    }
  }
  const revalidate = async () => {
    if (!draft) return
    if (draft.expectedRevision > 0) {
      const result = await props.connection({ kind: 'workgraph-read', request: { ...query, planId: draft.planId } })
      if (!alive.current || result.workgraph?.result.kind !== 'plan') return
      const changed = result.workgraph.result.value.revision !== draft.expectedRevision
      const generation = result.workgraph.generation
      setDraft(previous => previous && ({ ...previous, generation, conflict: previous.conflict || changed }))
    }
  }
  const openContext = async (item: OrganizationTaskView) => {
    let operationId = contextOperations.current.get(item.id)
    if (!operationId) { operationId = randomUUID() as OperationId; contextOperations.current.set(item.id, operationId) }
    const result = await props.context({ ...query, planId: item.planId, taskId: item.id, operationId })
    if (alive.current) setContext(result)
  }
  return <section className={css.form} aria-busy={busy}>
    <div className={css.cardHeading}><Button onClick={props.onBack}>{t('back')}</Button><h4>{props.project.name}</h4></div>
    <p className={css.notice}>{t('notDispatched')}</p>
    {!ready && <p role="status">{t(c.phase)}</p>}
    {notice && <p className={css.notice} role="status">{notice}</p>}
    {ready && !currentPage && <p>{t('taskStale')}</p>}
    <form className={css.search} onSubmit={(event) => { event.preventDefault(); void run(() => load()) }}>
      <Input aria-label={t('taskSearch')} value={search} onChange={(event) =>{  setSearch(event.target.value) }} />
      <Button type="submit" disabled={!writable}>{t('searchAction')}</Button>
      <Button disabled={!writable || !!draft} onClick={create}>{t('createTask')}</Button>
    </form>
    {currentPage && <><p>{t('taskTotal', { count: currentPage.total })}</p><ul className={css.taskList}>
      {taskRows(currentPage.items).map(({ task: item, depth }) => <li key={item.id} style={{ '--task-depth': depth } as React.CSSProperties}>
        <button aria-pressed={selected === item.id}
          onClick={() => { setSelected(item.id); setContext(undefined) }}>{item.goal}</button><small>{item.phaseTitle}</small>
      </li>)}
    </ul><div className={css.actions}><Button disabled={!writable || currentPage.offset === 0} onClick={() => { void run(() => load()) }}>{t('firstPage')}</Button>
      <Button disabled={!writable || currentPage.offset + currentPage.items.length >= currentPage.total} onClick={() => { void run(() => load(currentPage.offset + currentPage.items.length)) }}>{t('next')}</Button></div></>}
    {task && <section className={css.card}>
      <h4>{task.goal}</h4><p>{task.scope}</p><p>{t('taskVersion', { revision: task.revision })}</p>
      <p>{t('dispatcher')} · {t('notDispatched')}</p>
      <p>{t('suggestedMember')} · {task.suggestedMembershipId ?? t('noSuggestion')} · {t(task.assignable ? 'activeMember' : 'unassignable')}</p>
      <h4>{t('taskAcceptance')}</h4><ul>{task.acceptance.map((text, index) => <li key={index}>{text}</li>)}</ul>
      <h4>{t('taskArtifacts')}</h4><ul>{task.artifacts.map((text, index) => <li key={index}>{text}</li>)}</ul>
      <p>{t(task.required ? 'requiredTask' : 'optionalTask')}</p>
      <p>{t('dependencies')} · {task.dependsOn.map(id => currentPage?.items.find(item => item.id === id)?.goal ?? id).join(', ') || t('noDependencies')}</p>
      {task.hasUndisclosedPrerequisite && <p>{t('hiddenPrerequisite')}</p>}
      <details><summary>{t('taskIdentifiers')}</summary><p>{t('planId')}: {task.planId}</p><p>{t('taskId')}: {task.id}</p></details>
      <div className={css.actions}><Button disabled={!writable || !!draft} onClick={() => { void run(() => edit(task)) }}>{t('editTask')}</Button>
        <Button disabled={!writable} onClick={() => { void run(() => openContext(task)) }}>{t('myContext')}</Button></div>
    </section>}
    {draft && <section className={css.card}>
      <h4>{t('taskDraft')}</h4>
      {!draftCurrent && <><p>{t('draftRetained')}</p><Button disabled={!writable} onClick={() => { void run(revalidate) }}>{t('revalidateDraft')}</Button></>}
      {ready && draftCurrent && <>
        {draft.conflict && <p role="alert">{t('draftConflict')}</p>}
        <TaskEditor t={t} definition={draft.definition} taskId={draft.taskId} disabled={!writable || draft.conflict}
          change={(definition) => {
            setDraft({ ...draft, definition, attempted: false, operationId: draft.attempted ? randomUUID() : draft.operationId })
          }}
          save={() => { void run(save) }} />
      </>}
      <Button disabled={busy} onClick={() => { setDraft(undefined) }}>{t('discardDraft')}</Button>
    </section>}
    {ready && context?.generation === c.generation && task?.id === context.result.snapshot.id && <section className={css.card}>
      <h4>{t('myContext')}</h4><p>{t('contextReadonly')}</p><p>{t('taskVersion', { revision: context.result.snapshot.revision })}</p>
      <h4>{context.result.snapshot.goal}</h4><p>{context.result.snapshot.scope}</p>
      <ul>{context.result.snapshot.acceptance.map((text, index) => <li key={index}>{text}</li>)}</ul>
    </section>}
    {c.organizations.find(item => item.id === c.organizationId)?.role === 'admin' && <TaskGrants {...props} projectId={props.project.id} />}
  </section>
}
