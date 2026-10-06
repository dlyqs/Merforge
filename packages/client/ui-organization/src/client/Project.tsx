/** Current-authority project information and its task destinations. */
import { useEffect, useRef, useState } from 'react'
import { Button, Input, IconBranchOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { OrganizationProjectView, Principal } from '@deepseek-ai/dsh-organization/types'
import type { OrganizationTaskView } from '@deepseek-ai/dsh-organization'
import type { OrganizationProps } from './contract.ts'
import { readNavigationProjects } from './projects.ts'
import { taskRows, workgraphError } from './workgraph-view.ts'
import css from './Organization.module.css'

/** Selected project and account that opened it. */
export type ProjectSelection = Principal & { project: OrganizationProjectView }
/** Reactive project selection owned by the organization plugin. */
export interface ProjectInjected { hooks: { projectDetails: ObservableSnapshot<ProjectSelection | null> } }
/** @param props - Current account and selected project. @returns Main project information page. */
export function OrganizationProject(props: OrganizationProps & InjectFace<ProjectInjected>) {
  const selection = props.useProjectDetails(value => value), c = props.useOrganization(s => s.connection)
  if (!selection || c.mode !== 'organization' || selection.serverId !== c.principal?.serverId
    || selection.accountId !== c.principal.accountId || selection.project.organizationId !== c.organizationId) return null
  return <ProjectDetails key={`${selection.serverId}:${selection.accountId}:${selection.project.id}`} {...props} project={selection.project} />
}
/** @param props - Authorized project and native operations. @returns Creator editor or participant read view and tasks. */
export function ProjectDetails(props: OrganizationProps & { project: OrganizationProjectView }) {
  const c = props.useOrganization(s => s.connection), { t } = props
  const [value, setValue] = useState<{ generation: number; project: OrganizationProjectView; tasks: OrganizationTaskView[] }>()
  const [draft, setDraft] = useState<Pick<OrganizationProjectView, 'name' | 'background' | 'summary' | 'goal'>>()
  const [notice, setNotice] = useState(''), [busy, setBusy] = useState(false)
  const intent = useRef<{ fingerprint: string; operationId: string }>()
  const alive = useRef(false)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const ready = c.mode === 'organization' && c.phase === 'ready' && c.organizationId === props.project.organizationId
  useEffect(() => {
    let active = true
    const isActive = () => active
    if (ready) void (async () => {
      const projects = await readNavigationProjects(props.connection, c.generation, isActive)
      if (!isActive() || !projects) return
      const project = projects.find(item => item.id === props.project.id)
      if (!project) throw new Error('forbidden')
      const tasks: OrganizationTaskView[] = []
      let offset = 0, cursor: string | undefined
      while (isActive()) {
        const reply = await props.connection({ kind: 'workgraph-tasks', request: { organizationId: project.organizationId,
          projectId: project.id, offset, ...(cursor ? { cursor } : {}) } })
        if (!isActive() || reply.workgraph?.generation !== c.generation || reply.workgraph.result.kind !== 'tasks') return
        const page = reply.workgraph.result.value
        tasks.push(...page.items); offset += page.items.length; cursor = page.cursor
        if (!page.items.length || offset >= page.total) break
      }
      if (isActive()) { setValue({ generation: c.generation, project, tasks }); setNotice('') }
    })().catch((error: unknown) => { if (active) { setValue(undefined); setNotice(t(workgraphError(error))) } })
    return () => { active = false }
  }, [ready, c.generation])
  const current = ready && value?.generation === c.generation ? value : undefined
  const owner = !!current && current.project.createdBy === c.principal?.accountId
  const fields = draft ?? current?.project
  const save = async () => {
    if (!current || !owner || !fields || busy) return
    const command = { kind: 'update-project', organizationId: current.project.organizationId, projectId: current.project.id,
      expectedVersion: current.project.version, name: fields.name.trim(),
      background: fields.background, summary: fields.summary, goal: fields.goal }
    const fingerprint = JSON.stringify(command)
    if (intent.current?.fingerprint !== fingerprint) intent.current = { fingerprint, operationId: randomUUID() }
    setBusy(true); setNotice('')
    try {
      await props.connection({ kind: 'command', command: { ...command, operationId: intent.current.operationId } })
      if (alive.current) { setDraft(undefined); intent.current = undefined }
    } catch (error) { if (alive.current) setNotice(t(workgraphError(error))) }
    finally { if (alive.current) setBusy(false) }
  }
  return <section className={css.projectPage} aria-label={t('viewProject')} aria-busy={busy}>
    <div className={css.heading}><div><h2>{current?.project.name ?? t('viewProject')}</h2><p>{t(owner ? 'projectOwnerHint' : 'projectReadonlyHint')}</p></div></div>
    {notice && <p role="alert" className={css.notice}>{notice}</p>}
    {!current && !notice && <p role="status">{t(ready ? 'loading' : c.phase)}</p>}
    {current && fields && <>
      <form className={css.card} onSubmit={(event) => { event.preventDefault(); void save() }}>
        {(['name', 'background', 'summary', 'goal'] as const).map(key => <label className={css.field} key={key}>
          {t(key === 'name' ? 'projectName' : key === 'background' ? 'projectBackground' : key === 'summary' ? 'projectSummary' : 'projectGoal')}
          {key === 'name' ? <Input required maxLength={120} value={fields[key]} readOnly={!owner} disabled={busy}
            onChange={(event) => { setDraft({ ...fields, name: event.target.value }) }} />
            : <textarea aria-label={t(key === 'background' ? 'projectBackground' : key === 'summary' ? 'projectSummary' : 'projectGoal')}
              rows={key === 'background' ? 6 : 3} maxLength={key === 'background' ? 32000 : 8000}
              value={fields[key]} readOnly={!owner} disabled={busy}
              onChange={(event) => { setDraft({ ...fields, [key]: event.target.value }) }} />}
          {key === 'background' && <small>{t('projectBackgroundHint')}</small>}
        </label>)}
        {owner && <div className={css.actions}><Button type="submit" variant="primary" disabled={busy || !!c.pendingOperation || !fields.name.trim() || !draft}>{t('save')}</Button>
          <Button disabled={busy || !draft} onClick={() => { setDraft(undefined) }}>{t('cancel')}</Button></div>}
      </form>
      <section className={css.card}><h3>{t('projectTasks')}</h3>
        {taskRows(current.tasks).map(({ task, depth }) => <Button key={task.id} variant="ghost" icon={<IconBranchOutlineRegular />}
          style={{ marginInlineStart: depth * 16 }} onClick={() => { props.openTask?.(current.project, task) }}>{task.goal}</Button>)}
      </section>
    </>}
  </section>
}
