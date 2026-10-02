/** Private organization conversation view over fixed native actions and current authorized task facts. */
import { useEffect, useRef, useState } from 'react'
import { Button, Input, IconUsersOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import type { OrganizationProps } from './contract.ts'
import type { OrganizationProjectView } from '@deepseek-ai/dsh-organization/types'
import type { ConversationRequest, ConversationResult } from '@deepseek-ai/dsh-organization-conversation/protocol'
import type { ConnectionResult } from '@deepseek-ai/dsh-organization-connection/types'
import { ConversationPlan } from './ConversationPlan.tsx'
import css from './Organization.module.css'

type Request = ConversationRequest
type Goal = ConversationResult['goals'][number]
/** @param props - Native identity subscription and fixed actions. @returns Project conversation entry, independent of the workbench. */
export function OrganizationConversation(props: OrganizationProps) {
  const c = props.useOrganization(s => s.connection)
  const [selected, setSelected] = useState('')
  const project = c.projects?.items.find(p => p.id === selected)
  return <section className={css.card}>
    <h2>{props.t('conversationTitle')}</h2>
    <label className={css.field}>{props.t('projects')}<select value={selected} onChange={(e) => { setSelected(e.target.value) }}>
      <option value="">{props.t('conversationProject')}</option>
      {c.projects?.items.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
    </select></label>
    {project && c.mode === 'organization' && <ProjectConversation key={`${c.principal?.serverId}:${c.principal?.accountId}:${project.id}`} {...props} project={project} />}
  </section>
}
/** @param props - Project and current native actions. @returns Persistent private transcript and unapproved task tree. */
export function ProjectConversation(props: OrganizationProps & { project: OrganizationProjectView }) {
  const c = props.useOrganization(s => s.connection), { t } = props
  const [reply, setReply] = useState<{ generation: number; result: ConversationResult }>()
  const [policy, setPolicy] = useState<{ generation: number; value: NonNullable<ConnectionResult['planning']> }>()
  const [targets, setTargets] = useState<NonNullable<ConnectionResult['workgraph']>>()
  const [targetId, setTargetId] = useState('')
  const [text, setText] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false)
  const [model, setModel] = useState(''), [goalId, setGoalId] = useState<Goal['id'] | null | undefined>()
  const alive = useRef(false), sequence = useRef(0), lock = useRef(false)
  const pending = useRef<Request>()
  const query = { organizationId: props.project.organizationId, projectId: props.project.id,
    conversationId: String(props.project.id) as Request['conversationId'] }
  const ready = c.phase === 'ready' && c.mode === 'organization' && c.organizationId === props.project.organizationId
  const current = ready && reply?.generation === c.generation ? reply.result : undefined
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
    setReply(undefined); setPolicy(undefined); setTargets(undefined)
    if (!ready || !props.conversation) return
    void Promise.all([props.connection({ kind: 'planning-read', request: query }),
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
        route: !goal ? 'new_goal' : goal.classification === 'clarify' ? 'clarification' : 'modify', ...(goal ? { goalId: goal.id } : {}), ...(!goal && target ? { target: { planId: target.planId, taskId: target.id } } : {}) }
    pending.current = request; void run(request)
  }
  const settings = current?.settings
  return <section className={css.form}>
    <p>{t('conversationPrivate')}</p>
    {!current && <p role="status">{t('conversationUnavailable')}</p>}
    {notice && <p role="alert">{notice}</p>}
    {c.pendingOperation && <Button disabled={busy} onClick={() => { void props.connection({ kind: 'reconcile' }).catch(() => { if (alive.current) setNotice(t('conversationFailure')) }) }}>{t('reconcile')}</Button>}
    <div className={css.actions}>
      <Button disabled={!ready || busy} onClick={() => { void run({ ...query, kind: 'read', operationId: randomUUID() as Request['operationId'] }) }}>{t('refreshAccess')}</Button>
      <Button disabled={busy} onClick={() => { setGoalId(null); setTargetId(''); pending.current = undefined }}>{t('conversationNewGoal')}</Button>
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
    {current && <label>{t('conversationGoal')}<select value={goal?.id ?? ''} disabled={busy} onChange={(e) => { setGoalId(e.target.value ? e.target.value as Goal['id'] : null) }}>
      <option value="">{t('conversationNewGoal')}</option>{current.goals.map((g, i) => <option key={g.id} value={g.id}>{t('conversationGoalNumber', { number: i + 1 })}</option>)}
    </select></label>}
    {goal?.proposal && <ConversationPlan {...props} goal={goal} query={query} generation={c.generation} busy={busy}
      suggest={(taskId, membershipId) => { void run({ ...query, kind: 'suggest', goalId: goal.id, taskId,
        membershipId, expectedRevision: goal.proposal?.revision ?? 0, operationId: randomUUID() as Request['operationId'] }) }} />}
    {!goal && targets?.generation === c.generation && targets.result.kind === 'tasks' && <label>{t('conversationExistingTask')}<select value={targetId} disabled={busy} onChange={(e) => { setTargetId(e.target.value) }}>
      <option value="">{t('conversationNewGoal')}</option>{targets.result.value.items.map(task => <option key={task.id} value={task.id}>{task.goal}</option>)}
    </select></label>}
    <form onSubmit={(e) => { e.preventDefault(); send() }} className={css.form}>
      <label>{t('conversationModel')}<select value={model} disabled={busy} onChange={(e) => { setModel(e.target.value) }}>
        <option value="">{t('conversationChooseModel')}</option>{models.map((m, i) => <option key={`${m.endpoint}:${m.model}`} value={i}>{m.model}</option>)}
      </select></label>
      <label>{t('conversationMessage')}<Input value={text} disabled={!ready || busy} placeholder={t('conversationPlaceholder')} onChange={(e) => { setText(e.target.value) }} /></label>
      <p>{t('conversationImpact')}</p>
      <Button type="submit" variant="primary" disabled={!current || busy || !text.trim() || model === '' || !!c.pendingOperation}>{t(busy ? 'working' : 'conversationSend')}</Button>
    </form>
  </section>
}

/** @returns Organization conversation navigation glyph. */
export function OrganizationConversationIcon() { return <IconUsersOutlineRegular size={21} /> }
