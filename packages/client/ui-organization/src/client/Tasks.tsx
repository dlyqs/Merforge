/** Organization task navigation and selected-node assignment over the current authorized WorkGraph. */
import { useEffect, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { OrganizationTaskView } from '@deepseek-ai/dsh-organization'
import type { OrganizationProjectView } from '@deepseek-ai/dsh-organization/types'
import type { OrganizationProps } from './contract.ts'
import type { OrganizationTaskSelectionProps } from './task-store.ts'
import { readNavigationProjects } from './projects.ts'
import { ConversationTask } from './ConversationTask.tsx'
import { taskRows, workgraphError } from './workgraph-view.ts'
import css from './Organization.module.css'

type TaskProps = OrganizationProps & OrganizationTaskSelectionProps & { openTasks(): void }
/** @param props - Native task reader and declared selection actions. @returns Authorized hierarchical task rows. */
export function OrganizationTaskList(props: TaskProps) {
  const c = props.useOrganization(s => s.connection), selected = props.useStore(s => s.selected)
  const [page, setPage] = useState<{ generation: number; items: { project: OrganizationProjectView; tasks: OrganizationTaskView[] }[] }>()
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
      if (isActive()) setPage({ generation: c.generation, items })
    })().catch((error: unknown) => { if (active) setNotice(props.t(workgraphError(error))) })
    return () => { active = false }
  }, [c.generation, c.phase, c.mode, reload])
  const current = c.phase === 'ready' && c.mode === 'organization' && page?.generation === c.generation ? page.items : []
  return <section className={css.browser}>
    <div className={css.cardHeading}><h3>{props.t('organizationTasks')}</h3><Button size="sm" disabled={c.phase !== 'ready'} onClick={() => { setReload(n => n + 1) }}>{props.t('refreshAccess')}</Button></div>
    {notice && <p role="alert">{notice}</p>}
    {current.map(({ project, tasks }) => <section key={project.id}><h4>{project.name}</h4>
      <ul className={css.taskTree}>{taskRows(tasks).map(({ task, depth }) => <li key={task.id} style={{ paddingInlineStart: depth * 16 }}>
        <button type="button" aria-pressed={selected?.taskId === task.id} onClick={() => {
          if (!c.principal) return
          props.actions.selectTask({ ...c.principal, organizationId: project.organizationId, projectId: project.id,
            planId: task.planId, taskId: task.id })
          props.openTasks()
        }}>{task.goal}</button>
      </li>)}</ul></section>)}
    {!current.some(p => p.tasks.length) && !notice && <p>{props.t('emptyTasksTitle')}</p>}
  </section>
}
/** @param props - Identity-scoped selected node. @returns Assignment, execution and delivery controls for that node. */
export function OrganizationTasks(props: TaskProps) {
  const c = props.useOrganization(s => s.connection), selected = props.useStore(s => s.selected)
  const current = c.mode === 'organization' && selected?.serverId === c.principal?.serverId
    && selected?.accountId === c.principal?.accountId && selected?.organizationId === c.organizationId
  return <section className={css.conversationPage}><h2>{props.t('organizationTasks')}</h2>
    {current && selected ? <>
      <ConversationTask key={`${selected.serverId}:${selected.accountId}:${selected.taskId}`} {...props}
        projectId={selected.projectId} planId={selected.planId} taskId={selected.taskId} />
    </> : <p>{props.t('selectTaskNode')}</p>}
  </section>
}
