/** Identity-scoped project, Bot and recent-conversation navigation over private native catalogs. */
import { useEffect, useRef, useState } from 'react'
import { Button, Input, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import type { ConversationRequest, ConversationResult } from '@deepseek-ai/dsh-organization-conversation/protocol'
import type { OrganizationProjectView } from '@deepseek-ai/dsh-organization/types'
import type { OrganizationProps } from './contract.ts'
import type { ConversationSelectionProps } from './conversation-store.ts'
import { readNavigationProjects } from './projects.ts'
import { workgraphError } from './workgraph-view.ts'
import css from './Organization.module.css'

type Bot = NonNullable<ConversationResult['catalog']>['bots'][number]
type Catalog = { project: OrganizationProjectView; catalog: NonNullable<ConversationResult['catalog']> }
/** @param props - Framework navigation seat and current identity. @returns Project, Bot or recent rows. */
export function OrganizationBrowser(props: OrganizationProps & ConversationSelectionProps & { section: 'projects' | 'bots' | 'recent' }) {
  const alive = useRef(false)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const c = props.useOrganization(s => s.connection), revision = props.useStore(s => s.revision)
  const [catalogs, setCatalogs] = useState<{ generation: number; items: Catalog[] }>()
  const [editing, setEditing] = useState<{ project?: OrganizationProjectView; bot?: Bot }>()
  const [notice, setNotice] = useState(''), [busy, setBusy] = useState(false)
  const ready = c.phase === 'ready' && c.mode === 'organization'
  useEffect(() => {
    let active = true
    const isActive = () => active, conversation = props.conversation
    setCatalogs(undefined); setNotice('')
    if (ready && conversation) void (async () => {
      const items: Catalog[] = []
      const projects = await readNavigationProjects(props.connection, c.generation, () => active)
      if (!projects) return
      if (isActive()) setCatalogs({ generation: c.generation, items:
        projects.map(project => ({ project, catalog: { bots: [], conversations: [] } })) })
      if (props.section === 'projects') return
      for (const project of projects) {
        const result = await conversation({ organizationId: project.organizationId, projectId: project.id,
          conversationId: String(project.id) as ConversationRequest['conversationId'], kind: 'catalog', operationId: randomUUID() as ConversationRequest['operationId'] })
        if (result.generation !== c.generation) return
        if (result.result.catalog) items.push({ project, catalog: result.result.catalog })
      }
      if (isActive()) setCatalogs({ generation: c.generation, items })
    })().catch((error: unknown) => { if (active) setNotice(props.t(workgraphError(error))) })
    return () => { active = false }
  }, [ready, c.generation, revision, props.section])
  useEffect(() => { setEditing(undefined) }, [c.principal?.accountId, c.principal?.serverId, c.organizationId])
  const items = ready && catalogs?.generation === c.generation ? catalogs.items : []
  const open = async (project: OrganizationProjectView, conversationId: ConversationRequest['conversationId'], botId?: Bot['id']) => {
    if (!c.principal || busy || !props.conversation) return
    const identity = c.principal
    setBusy(true); setNotice('')
    try {
      const result = await props.conversation({ organizationId: project.organizationId, projectId: project.id, conversationId,
        kind: 'open', operationId: randomUUID() as ConversationRequest['operationId'], ...(botId ? { botId } : {}) })
      if (!alive.current || result.generation !== c.generation) return
      props.actions.select({ ...identity, organizationId: project.organizationId, projectId: project.id, conversationId,
        ...(botId ? { botId } : {}) })
      props.actions.refresh(); props.openConversation?.()
    } catch (error) { setNotice(props.t(workgraphError(error))) }
    finally { setBusy(false) }
  }
  const titleKey = props.section === 'bots' ? 'bots' : props.section === 'projects' ? 'projects' : 'recentConversations'
  const conversations = items.flatMap(({ project, catalog }) => catalog.conversations.map(conversation => ({ project, conversation })))
    .sort((a, b) => b.conversation.createdAt - a.conversation.createdAt)
  return <section className={css.browser}>
    <div className={css.cardHeading}><h3>{props.t(titleKey)}</h3>
      {props.section === 'bots' && <Button size="sm" disabled={!ready || busy} onClick={() => { setEditing({}) }}>{props.t('createBot')}</Button>}
    </div>
    {notice && <p role="alert">{notice}</p>}
    {props.section === 'projects' && items.map(({ project }) => <Button key={project.id} disabled={!ready || busy}
      onClick={() => { void open(project, randomUUID() as ConversationRequest['conversationId']) }}>{project.name}</Button>)}
    {props.section === 'recent' && conversations.map(({ project, conversation }) => <Button key={`${project.id}:${conversation.conversationId}`} disabled={busy}
      onClick={() => { void open(project, conversation.conversationId, conversation.botId) }}>{conversation.title || props.t('newConversation')}<small>{project.name}</small></Button>)}
    {props.section === 'bots' && items.flatMap(({ project, catalog }) => catalog.bots.map(bot => <div className={css.botRow} key={bot.id}>
      <Button disabled={busy} onClick={() => { void open(project, randomUUID() as ConversationRequest['conversationId'], bot.id) }}>{bot.name}<small>{project.name}</small></Button>
      <Button size="sm" disabled={busy} onClick={() => { setEditing({ project, bot }) }}>{props.t('editBot')}</Button>
    </div>))}
    {ready && props.section === 'recent' && !conversations.length && <p>{props.t('noRecentConversations')}</p>}
    {ready && props.section === 'bots' && !items.some(i => i.catalog.bots.length) && <p>{props.t('noBots')}</p>}
    {!ready && <p>{props.t(c.phase)}</p>}
    {editing && <BotEditor {...props} key={editing.bot?.id ?? 'new'} projects={items.map(i => i.project)} initial={editing}
      close={() => { setEditing(undefined) }} saved={() => { setEditing(undefined); props.actions.refresh() }} />}
  </section>
}
/** @param props - Authorized projects and an optional persisted Bot. @returns Explicit private Bot editor. */
function BotEditor(props: OrganizationProps & { projects: OrganizationProjectView[]
  initial: { project?: OrganizationProjectView; bot?: Bot }
  close(): void
  saved(): void }) {
  const c = props.useOrganization(s => s.connection), { t } = props
  const [projectId, setProjectId] = useState(props.initial.project?.id ?? props.projects[0]?.id ?? '')
  const [name, setName] = useState(props.initial.bot?.name ?? ''), [instructions, setInstructions] = useState(props.initial.bot?.instructions ?? '')
  const [models, setModels] = useState<Bot['selection'][]>([]), [model, setModel] = useState('')
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState('')
  const [botId] = useState(props.initial.bot?.id ?? randomUUID() as Bot['id'])
  const alive = useRef(false), pending = useRef<{ digest: string; request: ConversationRequest }>()
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  useEffect(() => {
    let active = true; setModels([]); setModel('')
    const project = props.projects.find(p => p.id === projectId)
    if (project) void props.connection({ kind: 'planning-read', request: { organizationId: project.organizationId, projectId,
      conversationId: String(projectId) as ConversationRequest['conversationId'] } }).then((result) => {
      if (!active || !result.planning) return
      const items = result.planning.policy.models; setModels(items)
      const index = items.findIndex(m => m.model === props.initial.bot?.selection.model
        && m.endpoint === props.initial.bot.selection.endpoint)
      if (index >= 0) setModel(String(index))
    }, (error: unknown) => { if (active) setNotice(t(workgraphError(error))) })
    return () => { active = false }
  }, [projectId, c.generation])
  return <Modal open title={t(props.initial.bot ? 'editBot' : 'createBot')} closeLabel={t('close')} onClose={() => { if (!busy) props.close() }}>
    <form className={css.form} onSubmit={(event) => {
      event.preventDefault()
      const project = props.projects.find(p => p.id === projectId), selection = models[Number(model)]
      if (!project || !selection || model === '' || !props.conversation || busy) return
      setBusy(true); setNotice('')
      const draft = { kind: 'bot-save' as const, organizationId: project.organizationId, projectId: project.id,
        conversationId: String(project.id) as ConversationRequest['conversationId'], expectedVersion: props.initial.bot?.version ?? 0,
        bot: { id: botId, name, instructions, selection, version: props.initial.bot?.version ?? 0 } }
      const digest = JSON.stringify(draft)
      if (!pending.current || pending.current.digest !== digest) pending.current = { digest, request: { ...draft, operationId: randomUUID() as ConversationRequest['operationId'] } }
      void props.conversation(pending.current.request).then((result) => {
        if (alive.current && result.generation === c.generation) props.saved()
      }, (error: unknown) => { setNotice(t(workgraphError(error))) }).finally(() => { setBusy(false) })
    }}>
      <label>{t('projects')}<select disabled={busy || !!props.initial.bot} value={projectId} onChange={(e) => { setProjectId(e.target.value) }}>
        {props.projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <label>{t('botName')}<Input value={name} maxLength={120} disabled={busy} onChange={(e) => { setName(e.target.value) }} /></label>
      <label>{t('botInstructions')}<textarea value={instructions} maxLength={8192} disabled={busy} onChange={(e) => { setInstructions(e.target.value) }} /></label>
      <label>{t('conversationModel')}<select value={model} disabled={busy} onChange={(e) => { setModel(e.target.value) }}>
        <option value="">{t('conversationChooseModel')}</option>{models.map((m, i) => <option key={`${m.endpoint}:${m.model}`} value={i}>{m.model}</option>)}</select></label>
      {notice && <p role="alert">{notice}</p>}
      <Button type="submit" disabled={busy || !name.trim() || model === '' || c.phase !== 'ready'}>{t('save')}</Button>
    </form>
  </Modal>
}
