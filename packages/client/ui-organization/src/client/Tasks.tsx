/** Organization task navigation and selected-node assignment over the current authorized WorkGraph. */
import { useEffect, useState } from 'react'
import { Button, IconBranchOutlineRegular, IconRefreshOutlineRegular, taskWorkspaceStyles as css } from '@deepseek-ai/dsh-client-ui-primitives'
import type { OrganizationTaskView } from '@deepseek-ai/dsh-organization'
import type { OrganizationProjectView } from '@deepseek-ai/dsh-organization/types'
import type { OrganizationProps } from './contract.ts'
import type { OrganizationTaskSelectionProps } from './task-store.ts'
import { readNavigationProjects } from './projects.ts'
import { taskRows, workgraphError } from './workgraph-view.ts'
import { Workbench } from './Workbench.tsx'
import { readTaskRequests } from './task-requests.ts'

type TaskProps = OrganizationProps & OrganizationTaskSelectionProps & { openTasks(): void }
/** @param props - Native task reader and declared selection actions. @returns Authorized hierarchical task rows. */
export function OrganizationTaskList(props: TaskProps) {
  const c = props.useOrganization(s => s.connection), selected = props.useStore(s => s.selected)
  const [page, setPage] = useState<{ generation: number
    items: { project: OrganizationProjectView; tasks: OrganizationTaskView[] }[]
    pending: import('@deepseek-ai/dsh-organization').OrganizationInboxItem[] }>()
  const [notice, setNotice] = useState(''), [reload, setReload] = useState(0)
  useEffect(() => {
    let active = true
    const isActive = () => active
    setPage(undefined); setNotice('')
    if (c.phase === 'ready' && c.mode === 'organization') void (async () => {
      const items: { project: OrganizationProjectView; tasks: OrganizationTaskView[] }[] = []
      const projects = await readNavigationProjects(props.connection, c.generation, () => active)
      if (!projects) return
      for (const project of projects) {
        const tasks: OrganizationTaskView[] = []; let offset = 0, cursor: string | undefined
        while (active) {
          const r = await props.connection({ kind: 'workgraph-tasks', request: { organizationId: project.organizationId, projectId: project.id, offset, ...(cursor ? { cursor } : {}) } })
          if (r.workgraph?.result.kind !== 'tasks' || r.workgraph.generation !== c.generation) return
          const p = r.workgraph.result.value; cursor = p.cursor; tasks.push(...p.items)
          offset += p.items.length
          if (!p.items.length || offset >= p.total) break
        }
        items.push({ project, tasks })
      }
      const pending = c.organizationId ? await readTaskRequests(props.connection, c.organizationId, c.generation, () => active) : []
      if (isActive()) setPage({ generation: c.generation, items, pending: pending ?? [] })
    })().catch((error: unknown) => { if (active) setNotice(props.t(workgraphError(error))) })
    return () => { active = false }
  }, [c.generation, c.phase, c.mode, reload])
  const current = c.phase === 'ready' && c.mode === 'organization' && page?.generation === c.generation ? page.items : []
  return <section className={css.taskBrowser}>
    <div className={css.toolbar}><Button variant="ghost" size="sm" icon={<IconRefreshOutlineRegular />} disabled={c.phase !== 'ready'} onClick={() => { setReload(n => n + 1) }}>{props.t('refreshAccess')}</Button></div>
    {notice && <p role="alert">{notice}</p>}
    {current.map(({ project, tasks }) => <section key={project.id}><h4>{project.name}</h4>
      <nav className={css.planList}>{taskRows(tasks).filter(row => row.depth === 0).map(({ task, depth }) => <button key={task.id} className={css.planItem} style={{ marginInlineStart: depth * 8, width: `calc(100% - ${depth * 8}px)` }} type="button" aria-label={task.goal} aria-pressed={selected?.taskId === task.id} onClick={() => {
        if (!c.principal) return
        props.actions.selectTask({ ...c.principal, organizationId: project.organizationId, projectId: project.id,
          planId: task.planId, taskId: task.id })
        props.openTasks()
      }}><IconBranchOutlineRegular /><span><strong>{task.goal}</strong><small>{task.phaseTitle} · {props.t('taskVersion', { revision: task.revision })}</small>
          {page?.pending.some(item => item.assignment.planId === task.planId) && <small className={css.pendingAction}>{props.t('taskActionNeeded')}</small>}
        </span></button>,
      )}</nav></section>)}
    {c.phase === 'ready' && page?.generation !== c.generation && !notice && <p role="status">{props.t('loading')}</p>}
    {page?.generation === c.generation && !current.some(p => p.tasks.length) && !notice && <p>{props.t('emptyTasksTitle')}</p>}
  </section>
}
/** @param props - Identity-scoped selected node. @returns Shared task workspace with assignment and delivery in its right detail area. */
export function OrganizationTasks(props: TaskProps) {
  const c = props.useOrganization(s => s.connection)
  const { selected, project } = props.useStore(s => s)
  const current = selected !== null && c.mode === 'organization' && selected.serverId === c.principal?.serverId
    && selected.accountId === c.principal.accountId && selected.organizationId === c.organizationId
  const currentProject = project !== null && c.mode === 'organization' && project.serverId === c.principal?.serverId
    && project.accountId === c.principal.accountId && project.project.organizationId === c.organizationId
  const navigationProject = current ? c.projects?.items.find(item => item.id === selected.projectId) : undefined
  return <section className={css.taskPage} aria-label={props.t('tasks')}><div className={css.body}>
    {current ? <Workbench key={`${selected.serverId}:${selected.accountId}:${selected.planId}`} {...props}
      project={{ id: selected.projectId, organizationId: selected.organizationId, name: navigationProject?.name ?? props.t('tasks') }}
      planId={selected.planId} initialTaskId={selected.taskId}
      {...(selected.assignmentId ? { assignmentId: selected.assignmentId } : {})} onBack={() => { props.actions.selectTask(null) }}
      onSaved={(planId, taskId) => { props.actions.selectTask({ ...selected, planId, taskId }) }} />
      : currentProject ? <Workbench key={`${project.serverId}:${project.accountId}:${project.project.id}`} {...props}
        project={project.project} onBack={() => { props.actions.selectTask(null) }} />
        : <div className={css.empty}><IconBranchOutlineRegular size={28} /><h3>{props.t('selectTaskNode')}</h3></div>}
  </div></section>
}
