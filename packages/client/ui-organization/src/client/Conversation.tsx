/** Private organization conversation view over fixed native actions and current authorized task facts. */
import { useEffect, useRef, useState } from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import type { ConversationSelectionProps } from './conversation-store.ts'
import type { OrganizationProps } from './contract.ts'
import type { OrganizationProjectView } from '@deepseek-ai/dsh-organization/types'
import type { ConversationRequest, ConversationResult } from '@deepseek-ai/dsh-organization-conversation/protocol'
import type { ConnectionResult } from '@deepseek-ai/dsh-organization-connection/types'
import { readNavigationProjects } from './projects.ts'
import { ConversationPlan } from './ConversationPlan.tsx'
import css from './Organization.module.css'

type Request = ConversationRequest
type Goal = ConversationResult['goals'][number]
/** @param props - Native identity subscription and fixed actions. @returns Project conversation entry, independent of the workbench. */
export function OrganizationConversation(props: OrganizationProps & ConversationSelectionProps) {
  const c = props.useOrganization(s => s.connection), selected = props.useStore(s => s.selected)
  const [projectPage, setProjectPage] = useState<{ generation: number; items: OrganizationProjectView[] }>()
  useEffect(() => {
    let active = true; setProjectPage(undefined)
    if (c.phase === 'ready' && c.mode === 'organization') void readNavigationProjects(props.connection, c.generation, () => active)
      .then((items) => { if (active && items) setProjectPage({ generation: c.generation, items }) }, (_error: unknown) => {
        /* A failed read leaves project selection unavailable until refresh. */
      })
    return () => { active = false }
  }, [c.phase, c.mode, c.generation])
  const projects = projectPage && projectPage.generation === c.generation ? projectPage.items : []
  const valid = selected && selected.serverId === c.principal?.serverId && selected.accountId === c.principal.accountId
    && selected.organizationId === c.organizationId
  const project = valid ? projects.find(p => p.id === selected.projectId) : undefined
  const assignment = valid && selected.planId && selected.assignmentId
    ? { planId: selected.planId, assignmentId: selected.assignmentId } : undefined
  return <section className={css.conversationPage}>
    {!valid || !project ? <>
      <h2>{props.t('conversationNewGoal')}</h2>
      <label className={css.field}>{props.t('conversationProject')}<select value="" disabled={c.phase !== 'ready'} onChange={(e) => {
        if (!c.principal || !c.organizationId) return
        const project = projects.find(p => p.id === e.target.value)
        if (project) props.actions.select({ ...c.principal, organizationId: c.organizationId, projectId: project.id,
          conversationId: valid && selected.conversationId ? selected.conversationId : randomUUID() as Request['conversationId'] })
      }}><option value="">{props.t('chooseProject')}</option>
        {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select></label>{!projects.length && <p>{props.t('emptyProjects')}</p>}
    </> : <ProjectConversation key={`${selected.serverId}:${selected.accountId}:${selected.conversationId ?? selected.assignmentId}:${project.id}`}
      {...props} project={project} {...(assignment ? { assignment } : {})}
      conversationId={selected.conversationId} botId={selected.botId} onChange={props.actions.refresh} />}
  </section>
}
/** @param props - Project and current native actions. @returns Persistent private transcript and unapproved task tree. */
export function ProjectConversation(props: OrganizationProps & { project: OrganizationProjectView
  assignment?: Request['assignment']
  conversationId?: Request['conversationId'] | undefined
  botId?: Request['botId']
  onChange?(): void }) {
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
    conversationId: String(
      props.assignment?.assignmentId ?? props.conversationId ?? props.project.id) as Request['conversationId'] }
  const query = { ...planningQuery, ...(props.botId ? { botId: props.botId } : {}),
    ...(props.assignment ? { assignment: props.assignment } : {}) }
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
      if (request.kind === 'send') { setText(''); setGoalId(request.goalId ?? result.result.goals.at(-1)?.id); props.onChange?.() }
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
      if (alive.current && epoch === sequence.current && p.planning) { setPolicy({ generation: r.generation, value: p.planning }); setReply(r); setTargets(tasks.workgraph); setNotice(''); props.onChange?.() }
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
  useEffect(() => {
    if (!props.botId || !current?.catalog) return
    const bot = current.catalog.bots.find(b => b.id === props.botId)
    const index = bot ? models.findIndex(m => m.model === bot.selection.model && m.endpoint === bot.selection.endpoint) : -1
    if (index >= 0) setModel(String(index))
  }, [props.botId, policy?.generation])
  const settings = current?.settings
  return <section className={css.form}>
    <h2>{props.project.name}</h2>
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
