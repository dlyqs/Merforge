/** Durable pending and processed requests; notification acknowledgement never answers a request. */
import { useEffect, useRef, useState } from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import type { OrganizationInboxPage, OrganizationInboxItem, OrganizationTaskView } from '@deepseek-ai/dsh-organization'
import type { OperationId } from '@deepseek-ai/dsh-organization/types'
import type { OrganizationProps } from './contract.ts'
import { AssignmentPanel } from './AssignmentPanel.tsx'
import { workgraphError } from './workgraph-view.ts'
import css from './Organization.module.css'

/** @param props - Current native identity and localized labels. @returns Persistent request list and exact approved task details. */
export function Inbox(props: OrganizationProps) {
  const c = props.useOrganization(s => s.connection), { t } = props
  const [page, setPage] = useState<{ generation: number; value: OrganizationInboxPage }>()
  const [filter, setFilter] = useState<'pending' | 'processed' | 'all'>('pending')
  const [search, setSearch] = useState(''), [notice, setNotice] = useState('')
  const [selected, setSelected] = useState<OrganizationInboxItem>()
  const [detail, setDetail] = useState<{ generation: number; task: OrganizationTaskView }>()
  const [context, setContext] = useState<Awaited<ReturnType<OrganizationProps['context']>>>()
  const contextOperations = useRef(new Map<string, OperationId>())
  const selection = useRef(0)
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const ready = c.phase === 'ready' && c.mode === 'organization' && !!c.organizationId
  const current = ready && page?.generation === c.generation ? page.value : undefined
  const task = ready && detail?.generation === c.generation ? detail.task : undefined
  const load = async (offset = 0) => {
    const result = await props.connection({ kind: 'assignment-inbox', request: { organizationId: c.organizationId, state: filter, search, offset,
      ...(offset && current ? { cursor: current.cursor } : {}) } })
    if (alive.current && result.assignment?.result.kind === 'inbox') setPage({ generation: result.assignment.generation, value: result.assignment.result.value })
  }
  const open = async (item: OrganizationInboxItem) => {
    const sequence = ++selection.current
    setSelected(item); if (selected?.request.id !== item.request.id) { setDetail(undefined); setContext(undefined) }
    const a = item.assignment
    const result = await props.connection({ kind: 'workgraph-tasks', request: { organizationId: a.organizationId, projectId: a.projectId,
      planId: a.planId, taskId: a.taskId, revision: a.planRevision } })
    if (alive.current && sequence === selection.current && result.workgraph?.result.kind === 'tasks' && result.workgraph.result.value.items[0]) {
      setDetail({ generation: result.workgraph.generation, task: result.workgraph.result.value.items[0] })
    }
  }
  const openContext = async () => {
    if (!selected) return
    const a = selected.assignment
    let operationId = contextOperations.current.get(a.taskId)
    if (!operationId) { operationId = randomUUID() as OperationId; contextOperations.current.set(a.taskId, operationId) }
    const result = await props.context({ organizationId: a.organizationId, projectId: a.projectId,
      planId: a.planId, taskId: a.taskId, operationId })
    if (alive.current) setContext(result)
  }
  const report = (error: unknown) => { if (alive.current) setNotice(t(workgraphError(error))) }
  useEffect(() => {
    if (ready) {
      void load().catch(report)
      if (selected) void open(selected).catch(report)
    }
  }, [ready, c.generation, filter])
  return <section className={css.form}>
    <h4>{t('inbox')}</h4><p>{t('inboxHint')}</p>
    {notice && <p role="status">{notice}</p>}
    <div className={css.actions}>{(['pending', 'processed', 'all'] as const).map(value =>
      <Button key={value} aria-pressed={filter === value} onClick={() =>{  setFilter(value) }}>{t(`inbox-${value}`)}</Button>)}</div>
    <form onSubmit={(event) => { event.preventDefault(); void load().catch(report) }}>
      <label>{t('inboxSearch')}<Input value={search} onChange={(event) =>{  setSearch(event.target.value) }} /></label>
      <Button type="submit" disabled={!ready}>{t('searchAction')}</Button>
    </form>
    {!ready && <p>{t('qualificationRecheck')}</p>}
    {current && <>
      <p>{t('inboxCounts', { total: current.total, unread: current.unread })}</p>
      {!current.items.length && <p>{t('empty')}</p>}
      <ul className={css.taskList}>{current.items.map(item => <li key={item.request.id}>
        <Button onClick={() => { void open(item).catch(report) }}>{t('taskId')}: {item.assignment.taskId} · {t(`assignment-${item.assignment.state}`)}</Button>
        {item.readAt === null && <Button disabled={!!c.pendingOperation} onClick={() => {
          const a = item.assignment
          void props.connection({ kind: 'assignment-participant', request: { organizationId: a.organizationId, projectId: a.projectId,
            planId: a.planId, assignmentId: a.id, operationId: randomUUID(), kind: 'read-notification', notificationId: item.notificationId } }).then(() => load()).catch(report)
        }}>{t('markReadOnly')}</Button>}
      </li>)}</ul>
      <div className={css.actions}>
        <Button disabled={current.offset === 0} onClick={() => { void load().catch(report) }}>{t('firstPage')}</Button>
        <Button disabled={current.offset + current.items.length >= current.total} onClick={() => { void load(current.offset + current.items.length).catch(report) }}>{t('next')}</Button>
      </div>
    </>}
    {task && <section className={css.card}><h4>{task.goal}</h4><p>{task.scope}</p><p>{t('taskVersion', { revision: task.revision })}</p>
      <h4>{t('taskAcceptance')}</h4><ul>{task.acceptance.map((text, index) => <li key={index}>{text}</li>)}</ul>
      <Button disabled={!!c.pendingOperation} onClick={() => { void openContext().catch(report) }}>{t('myContext')}</Button></section>}
    {task && context?.generation === c.generation && context.result.snapshot.id === task.id && <section className={css.card}>
      <h4>{t('myContext')}</h4><p>{t('contextReadonly')}</p>
      {context.result.snapshot.revision !== selected?.assignment.planRevision && <p role="alert">{t('contextOldVersion')}</p>}
      <p>{t('taskVersion', { revision: context.result.snapshot.revision })}</p>
      <h4>{context.result.snapshot.goal}</h4><p>{context.result.snapshot.scope}</p>
      <ul>{context.result.snapshot.acceptance.map((text, index) => <li key={index}>{text}</li>)}</ul>
    </section>}
    {selected && detail && <AssignmentPanel key={selected.assignment.id} {...props} task={detail.task}
      projectId={selected.assignment.projectId} assignmentId={selected.assignment.id} current={!!task} />}
  </section>
}
