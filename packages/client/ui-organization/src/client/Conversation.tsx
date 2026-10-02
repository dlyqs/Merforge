/** Private organization conversation view over fixed native actions and current authorized task facts. */
import { useEffect, useRef, useState } from 'react'
import { Button, Input, IconUsersOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import type { ConversationSelectionProps, ConversationSelection } from './conversation-store.ts'
import type { OrganizationProps } from './contract.ts'
import type { OrganizationProjectView } from '@deepseek-ai/dsh-organization/types'
import type { ConversationRequest, ConversationResult } from '@deepseek-ai/dsh-organization-conversation/protocol'
import type { ConnectionResult } from '@deepseek-ai/dsh-organization-connection/types'
import { ConversationPlan } from './ConversationPlan.tsx'
import { Inbox } from './Inbox.tsx'
import css from './Organization.module.css'

type Request = ConversationRequest
type Goal = ConversationResult['goals'][number]
/** @param props - Native identity subscription and fixed actions. @returns Project conversation entry, independent of the workbench. */
export function OrganizationConversation(props: OrganizationProps & ConversationSelectionProps) {
  const c = props.useOrganization(s => s.connection)
  const selectedTask = props.useStore(s => s.selected)
  const taskSelected = selectedTask && selectedTask.serverId === c.principal?.serverId
    && selectedTask.accountId === c.principal.accountId && selectedTask.organizationId === c.organizationId
  const [selected, setSelected] = useState('')
  const project = c.projects?.items.find(p => p.id === selected)
  return <section className={css.card}>
    <h2>{props.t('conversationTitle')}</h2>
    <Inbox {...props} />
    {taskSelected && <SelectedTaskConversation key={`${selectedTask.serverId}:${selectedTask.accountId}:${selectedTask.assignmentId}`}
      {...props} selected={selectedTask} />}
    <label className={css.field}>{props.t('projects')}<select value={selected} onChange={(e) => { setSelected(e.target.value) }}>
      <option value="">{props.t('conversationProject')}</option>
      {c.projects?.items.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
    </select></label>
    {project && c.mode === 'organization' && <ProjectConversation key={`${c.principal?.serverId}:${c.principal?.accountId}:${project.id}`} {...props} project={project} />}
  </section>
}
/** @param props - Account-scoped sidebar selection. @returns The independently authorized employee conversation. */
function SelectedTaskConversation(props: OrganizationProps & { selected: ConversationSelection }) {
  const c = props.useOrganization(s => s.connection), selected = props.selected
  const [project, setProject] = useState<OrganizationProjectView>()
  useEffect(() => {
    let active = true
    if (c.phase === 'ready' && c.mode === 'organization') void props.connection({ kind: 'planning-read', request: {
      organizationId: selected.organizationId, projectId: selected.projectId, conversationId: selected.assignmentId,
    } }).then((result) => { if (active) setProject(result.planning?.project) }, () => { if (active) setProject(undefined) })
    return () => { active = false }
  }, [c.generation, c.phase])
  return project ? <ProjectConversation {...props} project={project}
    assignment={{ planId: selected.planId, assignmentId: selected.assignmentId }} /> : <p>{props.t('conversationUnavailable')}</p>
}
/** @param props - Project and current native actions. @returns Persistent private transcript and unapproved task tree. */
export function ProjectConversation(props: OrganizationProps & { project: OrganizationProjectView; assignment?: Request['assignment'] }) {
  const c = props.useOrganization(s => s.connection), { t } = props
  const [reply, setReply] = useState<{ generation: number; result: ConversationResult }>()
  const [policy, setPolicy] = useState<{ generation: number; value: NonNullable<ConnectionResult['planning']> }>()
  const [targets, setTargets] = useState<NonNullable<ConnectionResult['workgraph']>>()
  const [targetId, setTargetId] = useState('')
  const [text, setText] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false)
  const [route, setRoute] = useState<'modify' | 'query'>('modify')
  const [model, setModel] = useState(''), [goalId, setGoalId] = useState<Goal['id'] | null | undefined>()
  const alive = useRef(false), sequence = useRef(0), lock = useRef(false)
  const pending = useRef<Request>()
  const planningQuery = { organizationId: props.project.organizationId, projectId: props.project.id,
    conversationId: String(props.assignment?.assignmentId ?? props.project.id) as Request['conversationId'] }
  const query = { ...planningQuery, ...(props.assignment ? { assignment: props.assignment } : {}) }
  const ready = c.phase === 'ready' && c.mode === 'organization' && c.organizationId === props.project.organizationId
  const current = ready && reply?.generation === c.generation ? reply.result : undefined
  const retainedGoal = goalId === null ? undefined : reply?.result.goals.find(g => g.id === goalId) ?? reply?.result.goals.at(-1)
  const models = ready && policy?.generation === c.generation ? policy.value.policy.models : []
  const goal = goalId === null ? undefined : current?.goals.find(g => g.id === goalId) ?? current?.goals.at(-1)
  const run = async (request: Request) => {
    if (!props.conversation || lock.current) return
    const epoch = sequence.current
    lock.current = true; setBusy(true); setNotice('')
    try {
      const result = await props.conversation(request)
      if (!alive.current || sequence.current !== epoch) return
      setReply(result); pending.current = undefined
      if (request.kind === 'send') { setText(''); setGoalId(request.goalId ?? result.result.goals.at(-1)?.id) }
    } catch (_error) { if (alive.current && sequence.current === epoch) setNotice(t('conversationFailure')) }
    finally { lock.current = false; if (alive.current) setBusy(false) }
  }
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false; sequence.current++
      if (lock.current && props.conversation) void props.conversation({ ...query, kind: 'stop', operationId: randomUUID() as Request['operationId'] }).catch((_error: unknown) => { /* Native cancellation may already have invalidated this interval. */ })
    }
  }, [])
  useEffect(() => {
    const epoch = ++sequence.current
    setPolicy(undefined); setTargets(undefined)
    if (!ready || !props.conversation) return
    void Promise.all([props.connection({ kind: 'planning-read', request: planningQuery }),
      props.conversation({ ...query, kind: 'open', operationId: randomUUID() as Request['operationId'] }),
      props.connection({ kind: 'workgraph-tasks', request: { organizationId: query.organizationId, projectId: query.projectId } })]).then(([p, r, tasks]) => {
      if (alive.current && epoch === sequence.current && p.planning) { setPolicy({ generation: r.generation, value: p.planning }); setReply(r); setTargets(tasks.workgraph); setNotice('') }
    }, () => { if (alive.current && epoch === sequence.current) setNotice(t('conversationFailure')) })
  }, [ready, c.generation])
  const send = () => {
    const selection = models[Number(model)]
    if (!selection || !text.trim()) return
    const target = targets?.generation === c.generation && targets.result.kind === 'tasks' ? targets.result.value.items.find(t => t.id === targetId) : undefined
    const request: Request = pending.current?.kind === 'send' && pending.current.text === text ? pending.current
      : { ...query, kind: 'send', operationId: randomUUID() as Request['operationId'], selection, text,
        route: !goal ? 'new_goal' : goal.classification === 'clarify' ? 'clarification' : route, ...(goal ? { goalId: goal.id } : {}), ...(!goal && target ? { target: { planId: target.planId, taskId: target.id } } : {}) }
    pending.current = request; void run(request)
  }
  const settings = current?.settings
  return <section className={css.form}>
    <p>{t('conversationPrivate')}</p>
    {current?.assignment && <><p>{t('conversationAssignmentOrigin', { task: current.assignment.taskId, issuer: current.assignment.approvedBy, revision: current.assignment.planRevision })}</p>
      <p>{t(`assignment-${current.assignment.state}`)}</p>{current.assignment.planRevision !== goal?.proposal?.revision && <p>{t('assignmentOldVersion')}</p>}</>}
    {!current && <p role="status">{t('conversationUnavailable')}</p>}
    {notice && <p role="alert">{notice}</p>}
    {c.pendingOperation && <Button disabled={busy} onClick={() => { void props.connection({ kind: 'reconcile' }).catch(() => { if (alive.current) setNotice(t('conversationFailure')) }) }}>{t('reconcile')}</Button>}
    <div className={css.actions}>
      <Button disabled={!ready || busy} onClick={() => { void run({ ...query, kind: 'read', operationId: randomUUID() as Request['operationId'] }) }}>{t('refreshAccess')}</Button>
      {!props.assignment && <Button disabled={busy} onClick={() => { setGoalId(null); setTargetId(''); pending.current = undefined }}>{t('conversationNewGoal')}</Button>}
      {busy && <Button onClick={() => { if (props.conversation) void props.conversation({ ...query, kind: 'stop', operationId: randomUUID() as Request['operationId'] }).catch((_error: unknown) => { /* Native cancellation may already have invalidated this interval. */ }) }}>{t('cancel')}</Button>}
    </div>
    {settings && <div className={css.actions}>
      <label><input type="checkbox" checked={settings.enabled} disabled={busy} onChange={(e) => { void run({ ...query, kind: 'settings', operationId: randomUUID() as Request['operationId'], expectedRevision: settings.revision, settings: { enabled: e.target.checked, granularity: settings.granularity } }) }} />{t('conversationAuto')}</label>
      <label>{t('conversationGranularity')}<select value={settings.granularity} disabled={busy} onChange={(e) => { void run({ ...query, kind: 'settings', operationId: randomUUID() as Request['operationId'], expectedRevision: settings.revision, settings: { enabled: settings.enabled, granularity: e.target.value === 'fine' ? 'fine' : 'balanced' } }) }}>
        <option value="balanced">{t('conversationBalanced')}</option><option value="fine">{t('conversationFine')}</option>
      </select></label>
    </div>}
    <div aria-live="polite">{current?.entries.map((entry, index) => <article key={index} className={css.card}>
      <strong>{t(entry.role === 'user' ? 'me' : 'conversationAssistant')}</strong><p className={css.transcriptText}>{entry.text}</p>
    </article>)}</div>
    {current?.truncated && <p>{t('conversationTruncated')}</p>}
    {current && !props.assignment && <label>{t('conversationGoal')}<select value={goal?.id ?? ''} disabled={busy} onChange={(e) => { setGoalId(e.target.value ? e.target.value as Goal['id'] : null) }}>
      <option value="">{t('conversationNewGoal')}</option>{current.goals.map((g, i) => <option key={g.id} value={g.id}>{t('conversationGoalNumber', { number: i + 1 })}</option>)}
    </select></label>}
    {retainedGoal?.proposal && <div hidden={!current}><ConversationPlan {...props} goal={retainedGoal} query={query}
      generation={c.generation} busy={busy} {...(props.assignment ? { assignmentId: props.assignment.assignmentId,
        ...(reply?.result.assignment ? { assignmentTaskId: reply.result.assignment.taskId } : {}) } : {})}
      suggest={(taskId, membershipId) => { void run({ ...query, kind: 'suggest', goalId: retainedGoal.id, taskId,
        membershipId, expectedRevision: retainedGoal.proposal?.revision ?? 0, operationId: randomUUID() as Request['operationId'] }) }} /></div>}
    {!props.assignment && !goal && targets?.generation === c.generation && targets.result.kind === 'tasks' && <label>{t('conversationExistingTask')}<select value={targetId} disabled={busy} onChange={(e) => { setTargetId(e.target.value) }}>
      <option value="">{t('conversationNewGoal')}</option>{targets.result.value.items.map(task => <option key={task.id} value={task.id}>{task.goal}</option>)}
    </select></label>}
    {goal && goal.classification !== 'clarify' && <label>{t('conversationMessageIntent')}<select value={route} disabled={busy} onChange={(e) => { setRoute(e.target.value === 'query' ? 'query' : 'modify'); pending.current = undefined }}>
      <option value="modify">{t('conversationModify')}</option><option value="query">{t('conversationQuery')}</option>
    </select></label>}
    <form onSubmit={(e) => { e.preventDefault(); send() }} className={css.form}>
      <label>{t('conversationModel')}<select value={model} disabled={busy} onChange={(e) => { setModel(e.target.value) }}>
        <option value="">{t('conversationChooseModel')}</option>{models.map((m, i) => <option key={`${m.endpoint}:${m.model}`} value={i}>{m.model}</option>)}
      </select></label>
      <label>{t('conversationMessage')}<Input value={text} disabled={!ready || busy} placeholder={t('conversationPlaceholder')} onChange={(e) => { setText(e.target.value) }} /></label>
      <p>{t('conversationImpact')}</p>
      <Button type="submit" variant="primary" disabled={!current || !!current.assignment && !['pending', 'accepted'].includes(current.assignment.state) || busy || !text.trim() || model === '' || !!c.pendingOperation}>{t(busy ? 'working' : 'conversationSend')}</Button>
    </form>
  </section>
}

/** @returns Organization conversation navigation glyph. */
export function OrganizationConversationIcon() { return <IconUsersOutlineRegular size={21} /> }
