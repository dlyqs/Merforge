/** Project task workspace; native generations invalidate every displayed remote fact. */
import { useEffect, useRef, useState } from 'react'
import { IntegrationPanel } from './IntegrationPanel.tsx'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import { brandString } from '@deepseek-ai/dsh-brand'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import type { OrganizationPlanDefinition, OrganizationPlanId, OrganizationTaskId, OrganizationTaskPage, OrganizationTaskView } from '@deepseek-ai/dsh-organization'
import type { OperationId, OrganizationProjectView } from '@deepseek-ai/dsh-organization/types'
import type { OrganizationProps } from './contract.ts'
import { AssignmentPanel } from './AssignmentPanel.tsx'
import { TaskEditor } from './TaskEditor.tsx'
import { ProjectAccess } from './ProjectAccess.tsx'
import { workgraphError } from './workgraph-view.ts'
import css from './Organization.module.css'
import { taskWorkspaceStyles } from '@deepseek-ai/dsh-client-ui-primitives'
import { TaskCanvas } from './TaskCanvas.tsx'

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
export function Workbench(props: OrganizationProps & {
  project: Pick<OrganizationProjectView, 'id' | 'organizationId' | 'name'>
  planId?: OrganizationPlanId
  initialTaskId?: OrganizationTaskId
  assignmentId?: import('@deepseek-ai/dsh-organization').OrganizationAssignmentId
  onSaved?: (planId: OrganizationPlanId, taskId: OrganizationTaskId) => void
  onBack: () => void
}) {
  const c = props.useOrganization(s => s.connection)
  const { t } = props
  const [page, setPage] = useState<{ generation: number; value: OrganizationTaskPage }>()
  const [selected, setSelected] = useState<OrganizationTaskId | undefined>(props.initialTaskId)
  const [access, setAccess] = useState<'project' | null>(null)
  const [draft, setDraft] = useState<Draft>()
  const [assignmentRevision, setAssignmentRevision] = useState<number>()
  const [context, setContext] = useState<ContextReply>()
  const [search, setSearch] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false)
  const loading = useRef(false)
  const loadSequence = useRef(0)
  const denied = useRef(false)
  const alive = useRef(true)
  const contextOperations = useRef(new Map<string, OperationId>())
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const query = { organizationId: props.project.organizationId, projectId: props.project.id }
  const ready = c.phase === 'ready' && c.mode === 'organization' && c.organizationId === props.project.organizationId
  const currentPage = ready && page?.generation === c.generation ? page.value : undefined
  const pageTasks = currentPage?.items ?? []
  const task = currentPage?.items.find(item => item.id === selected)
  const retainedTask = page?.value.items.find(item => item.id === selected)
  const writable = ready && !busy && !c.pendingOperation
  const draftCurrent = draft?.expectedRevision === 0 || draft?.generation === c.generation
  const run = async (work: () => Promise<void>) => {
    setBusy(true); setNotice('')
    try { await work() } catch (error) { if (alive.current) setNotice(t(workgraphError(error))) }
    finally { if (alive.current) setBusy(false) }
  }
  const load = async (offset = 0, querySearch = search) => {
    const sequence = ++loadSequence.current
    loading.current = true
    denied.current = false
    try {
      const items: OrganizationTaskView[] = []
      let nextOffset = offset, cursor = offset ? currentPage?.cursor : undefined
      let next: { generation: number; value: OrganizationTaskPage } | undefined
      while (true) {
        const result = await props.connection({ kind: 'workgraph-tasks', request: { ...query, search: querySearch, offset: nextOffset,
          ...(props.planId ? { planId: props.planId } : {}), ...(cursor ? { cursor } : {}) } })
        if (!alive.current || sequence !== loadSequence.current || result.workgraph?.result.kind !== 'tasks') return
        next = { generation: result.workgraph.generation, value: result.workgraph.result.value }
        items.push(...next.value.items); nextOffset += next.value.items.length; cursor = next.value.cursor
        if (!props.planId || !next.value.items.length || nextOffset >= next.value.total) break
      }
      setPage({
        generation: next.generation, value: { ...next.value, items, offset },
      })
    } catch (error) {
      if (sequence === loadSequence.current) denied.current = workgraphError(error) === 'forbidden'
      throw error
    } finally { if (sequence === loadSequence.current) loading.current = false }
  }
  useEffect(() => { if (ready && !denied.current && !loading.current) void run(() => load()) }, [ready, c.generation])
  useEffect(() => { setSelected(props.initialTaskId); setAccess(null); setContext(undefined) }, [props.initialTaskId])
  const edit = async (item: OrganizationTaskView) => {
    const result = await props.connection({ kind: 'workgraph-read', request: { ...query, planId: item.planId } })
    if (!alive.current || result.workgraph?.result.kind !== 'plan') return
    const version = result.workgraph.result.value
    setDraft({ planId: version.planId, taskId: item.id, expectedRevision: version.revision, definition: version.definition,
      generation: result.workgraph.generation, operationId: randomUUID(), attempted: false, conflict: false })
  }
  const save = async () => {
    if (!draft || draft.conflict) return
    setDraft({ ...draft, attempted: true })
    try {
      await props.connection({ kind: 'workgraph-save', request: { ...query, planId: draft.planId, expectedRevision: draft.expectedRevision,
        operationId: draft.operationId, definition: { ...draft.definition, tasks: draft.definition.tasks.map(item => ({ ...item,
          acceptance: item.acceptance.map(text => text.trim()).filter(Boolean),
          artifacts: item.artifacts.map(text => text.trim()).filter(Boolean) })) } } })
      if (!alive.current) return
      setSelected(draft.taskId); setContext(undefined); setAssignmentRevision(undefined); setDraft(undefined)
      setNotice(t('taskSavedNext')); setSearch('')
      if (props.onSaved) props.onSaved(draft.planId, draft.taskId)
      else await load(0, '')
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
  const openConversation = async (item: OrganizationTaskView) => {
    if (!c.principal || !props.selectConversation || !props.conversation) return
    const conversationId = brandString<import('@deepseek-ai/dsh-organization-conversation/protocol').ConversationRequest['conversationId']>(props.assignmentId ?? randomUUID())
    const selector = { ...query, conversationId,
      ...(props.assignmentId ? { assignment: { planId: item.planId, assignmentId: props.assignmentId } } : {}) }
    await props.conversation({ ...selector, kind: 'open', operationId: randomUUID() as OperationId })
    if (!props.assignmentId) await props.conversation({ ...selector, kind: 'select-task',
      target: { planId: item.planId, taskId: item.id }, operationId: randomUUID() as OperationId })
    await props.selectConversation({ ...query, serverId: c.principal.serverId, accountId: c.principal.accountId, conversationId,
      ...(props.assignmentId ? { assignmentId: props.assignmentId, planId: item.planId } : {}) })
  }
  const openContext = async (item: OrganizationTaskView) => {
    let operationId = contextOperations.current.get(item.id)
    if (!operationId) { operationId = randomUUID() as OperationId; contextOperations.current.set(item.id, operationId) }
    const result = await props.context({ ...query, planId: item.planId, taskId: item.id, operationId })
    if (alive.current) setContext(result)
  }
  return <section className={css.form} aria-busy={busy}>
    <div className={css.cardHeading}><Button onClick={props.onBack}>{t('back')}</Button><h4>{props.project.name}</h4>{c.organizations.find(item => item.id === c.organizationId)?.role === 'admin' && <Button disabled={!writable} onClick={() => { setAccess(access === 'project' ? null : 'project') }}>{t('projectMembers')}</Button>}</div>
    {access === 'project' && <section className={css.card}><h4>{t('projectMembers')}</h4><ProjectAccess {...props} projectId={props.project.id} /></section>}
    {!ready && <p role="status">{t(c.phase)}</p>}
    {notice && <p className={css.notice} role="status">{notice}</p>}
    {ready && !currentPage && <p>{t('taskStale')}</p>}
    <form className={css.search} onSubmit={(event) => { event.preventDefault(); void run(() => load()) }}>
      <Input aria-label={t('taskSearch')} value={search} onChange={(event) =>{  setSearch(event.target.value) }} />
      <Button type="submit" disabled={!writable}>{t('searchAction')}</Button>
    </form>
    {currentPage?.total === 0 && !draft && <div className={css.empty}><h4>{t('emptyTasksTitle')}</h4><p>{t('emptyTasksHint')}</p></div>}
    {currentPage && !props.planId && <div className={css.actions}><Button disabled={!writable || currentPage.offset === 0} onClick={() => { void run(() => load()) }}>{t('firstPage')}</Button>
      <Button disabled={!writable || currentPage.offset + currentPage.items.length >= currentPage.total} onClick={() => { void run(() => load(currentPage.offset + currentPage.items.length)) }}>{t('next')}</Button></div>}
    {(currentPage?.items.length || draft) && <TaskCanvas t={t}
      tasks={draft ? draft.definition.tasks.map(item => ({ ...item, phaseTitle: draft.definition.phases.find(phase => phase.id === item.phaseId)?.title ?? '' })) : pageTasks}
      selected={draft?.taskId ?? selected ?? null} onSelect={(id) => {
        setSelected(id); setAccess(null); setContext(undefined); setAssignmentRevision(undefined)
        if (draft) setDraft({ ...draft, taskId: id })
      }}>
      {(task || draft) && <section className={taskWorkspaceStyles.detail} aria-label={t('taskDetail')}>
        {task && !draft && <section className={css.card}>
          <h4>{task.goal}</h4><p>{task.scope}</p><p>{t('taskVersion', { revision: task.revision })}</p>
          <p>{t('suggestedMember')} ·
            {c.members.find(member => member.id === task.suggestedMembershipId)?.username ?? (task.suggestedMembershipId ? t('selectedMember') : t('noSuggestion'))} · {t(task.assignable ? 'activeMember' : 'unassignable')}</p>
          <h4>{t('taskAcceptance')}</h4><ul>{task.acceptance.map((text, index) => <li key={index}>{text}</li>)}</ul>
          {!!task.artifacts.length && <><h4>{t('taskArtifacts')}</h4><ul>{task.artifacts.map((text, index) => <li key={index}>{text}</li>)}</ul></>}
          <details className={css.advanced}><summary>{t('taskDetails')}</summary><p>{t(task.required ? 'requiredTask' : 'optionalTask')}</p>
            <p>{t('dependencies')} · {task.dependsOn.map(id => currentPage?.items.find(item => item.id === id)?.goal ?? id).join(', ') || t('noDependencies')}</p>
            {task.hasUndisclosedPrerequisite && <p>{t('hiddenPrerequisite')}</p>}</details>
          <details><summary>{t('taskIdentifiers')}</summary><p>{t('planId')}: {task.planId}</p><p>{t('taskId')}: {task.id}</p></details>
          <div className={css.actions}><Button disabled={!writable || !props.selectConversation} onClick={() => { void run(() => openConversation(task)) }}>{t('executeInConversation')}</Button>
            <Button disabled={!writable || !!draft} onClick={() => { void run(() => edit(task)) }}>{t('editTask')}</Button>
            <Button disabled={!writable} onClick={() => { void run(() => openContext(task)) }}>{t('myContext')}</Button>
          </div>
        </section>}
        {task && !draft && <IntegrationPanel key={`${c.principal?.accountId}:${task.id}`} {...props} task={task} projectId={props.project.id} />}
        {retainedTask && !draft && <AssignmentPanel key={selected} {...props}
          task={retainedTask} projectId={props.project.id} current={!!task}
          {...(props.assignmentId ? { assignmentId: props.assignmentId } : {})} onAssignmentRevision={setAssignmentRevision} />}
        {draft && <section className={css.card}>
          <h4>{t('taskDraft')}</h4>
          {!draftCurrent && <><p>{t('draftRetained')}</p><Button disabled={!writable} onClick={() => { void run(revalidate) }}>{t('revalidateDraft')}</Button></>}
          {ready && draftCurrent && <>
            {draft.conflict && <p role="alert">{t('draftConflict')}</p>}
            <TaskEditor t={t} connection={c} definition={draft.definition} taskId={draft.taskId} disabled={!writable || draft.conflict}
              change={(definition) => {
                setDraft({ ...draft, definition, attempted: false, operationId: draft.attempted ? randomUUID() : draft.operationId })
              }}
              save={() => { void run(save) }} />
          </>}
          <Button disabled={busy} onClick={() => { setDraft(undefined) }}>{t('discardDraft')}</Button>
        </section>}
        {ready && context?.generation === c.generation && task?.id === context.result.snapshot.id && <section className={css.card}>
          <h4>{t('myContext')}</h4><p>{t('contextReadonly')}</p>
          {(context.result.snapshot.revision !== task.revision || assignmentRevision !== undefined && context.result.snapshot.revision !== assignmentRevision) && <p role="alert">{t('contextOldVersion')}</p>}<p>{t('taskVersion', { revision: context.result.snapshot.revision })}</p>
          <h4>{context.result.snapshot.goal}</h4><p>{context.result.snapshot.scope}</p>
          <ul>{context.result.snapshot.acceptance.map((text, index) => <li key={index}>{text}</li>)}</ul>
        </section>}
      </section>}
    </TaskCanvas>}
  </section>
}
