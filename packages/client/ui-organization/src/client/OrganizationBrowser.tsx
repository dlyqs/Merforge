/** Identity-scoped project, Bot and recent-conversation navigation over private native catalogs. */
import { useEffect, useRef, useState } from 'react'
import { Button, Input, Modal, Menu, Tooltip, AccountNavigationGroup, AccountConversationRow, accountNavigationStyles as css, IconNewChatOutlineRegular, IconPlusOutlineRegular, IconEditOutlineRegular, IconEllipsisOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import type { ConversationRequest, ConversationResult } from '@deepseek-ai/dsh-organization-conversation/protocol'
import type { OrganizationProjectView } from '@deepseek-ai/dsh-organization/types'
import type { OrganizationProps } from './contract.ts'
import type { ConversationSelectionProps } from './conversation-store.ts'
import { readNavigationProjects } from './projects.ts'
import { workgraphError } from './workgraph-view.ts'


type Bot = NonNullable<ConversationResult['catalog']>['bots'][number]
type Catalog = { project: OrganizationProjectView; catalog: NonNullable<ConversationResult['catalog']> }
/** @param props - Framework navigation seat and current identity. @returns Project, Bot or recent rows. */
export function OrganizationBrowser(props: OrganizationProps & ConversationSelectionProps & { section: 'projects' | 'bots' | 'recent'; wide: boolean; expandSidebar(): void }) {
  const alive = useRef(false)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const c = props.useOrganization(s => s.connection), revision = props.useStore(s => s.revision), selected = props.useStore(s => s.selected)
  const [catalogs, setCatalogs] = useState<{ generation: number; complete: boolean; items: Catalog[] }>()
  const identity = useRef(c); identity.current = c
  const [newTarget, setNewTarget] = useState<{ project: OrganizationProjectView; bot?: Bot }>()
  const [newBot, setNewBot] = useState('')
  const [editing, setEditing] = useState<{ project?: OrganizationProjectView; bot?: Bot }>()
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const [menu, setMenu] = useState<string | null>(null), [sortName, setSortName] = useState(false)
  const [projectDraft, setProjectDraft] = useState<{ project?: OrganizationProjectView; name: string }>()
  const projectOperation = useRef<string>()
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
      if (isActive()) setCatalogs({ generation: c.generation, complete: false, items:
        projects.map(project => ({ project, catalog: { bots: [], conversations: [] } })) })
      for (const project of projects) {
        const result = await conversation({ organizationId: project.organizationId, projectId: project.id,
          conversationId: String(project.id) as ConversationRequest['conversationId'], kind: 'catalog', operationId: randomUUID() as ConversationRequest['operationId'] })
        if (result.generation !== c.generation) return
        if (result.result.catalog) items.push({ project, catalog: result.result.catalog })
      }
      if (isActive()) setCatalogs({ generation: c.generation, complete: true, items })
    })().catch((error: unknown) => { if (active) setNotice(props.t(workgraphError(error))) })
    return () => { active = false }
  }, [ready, c.generation, revision, props.section])
  useEffect(() => {
    setEditing(undefined); setProjectDraft(undefined); setNewTarget(undefined); setExpanded(new Set()); setMenu(null)
  }, [c.principal?.accountId, c.principal?.serverId, c.organizationId])
  const items = ready && catalogs?.generation === c.generation ? catalogs.items : []
  const open = async (project: OrganizationProjectView, conversationId: ConversationRequest['conversationId'], botId?: Bot['id']) => {
    if (!c.principal || busy || !props.conversation) return
    const principal = c.principal
    setBusy(true); setNotice('')
    try {
      const result = await props.conversation({ organizationId: project.organizationId, projectId: project.id, conversationId,
        kind: 'open', operationId: randomUUID() as ConversationRequest['operationId'], ...(botId ? { botId } : {}) })
      if (!alive.current || result.generation !== identity.current.generation || identity.current.mode !== 'organization') return
      props.actions.select({ ...principal, organizationId: project.organizationId, projectId: project.id, conversationId,
        ...(botId ? { botId } : {}) })
      setNewTarget(undefined); props.actions.refresh(); props.openConversation?.()
    } catch (error) { setNotice(props.t(workgraphError(error))) }
    finally { setBusy(false) }
  }
  const titleKey = props.section === 'bots' ? 'bots' : props.section === 'projects' ? 'projects' : 'recentConversations'
  const conversations = items.flatMap(({ project, catalog }) => catalog.conversations.map(conversation => ({ project, conversation })))
    .sort((a, b) => b.conversation.createdAt - a.conversation.createdAt)
  const toggle = (id: string) => {
    if (!props.wide) props.expandSidebar()
    setExpanded((previous) => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next })
  }
  const row = (project: OrganizationProjectView, conversation: Catalog['catalog']['conversations'][number]) =>
    <AccountConversationRow key={`${project.id}:${conversation.conversationId}`} title={conversation.title || props.t('newConversation')}
      tag={props.section === 'recent' ? project.name : undefined} disabled={busy}
      selected={selected?.conversationId === conversation.conversationId}
      onOpen={() => { void open(project, conversation.conversationId, conversation.botId) }} />
  const newButton = (project: OrganizationProjectView, bot?: Bot) => <Tooltip label={props.t('newConversation')}>
    <button type="button" className={css.rowAction} disabled={busy} aria-label={`${props.t('newConversation')} ${bot?.name ?? project.name}`}
      onClick={() => { setNewBot(''); setNewTarget({ project, ...(bot ? { bot } : {}) }) }}><IconNewChatOutlineRegular /></button>
  </Tooltip>
  const ordered = <T extends { name: string },>(values: T[]): T[] =>
    sortName ? [...values].sort((a, b) => a.name.localeCompare(b.name)) : values
  return <section className={props.wide ? css.root : `${css.root} ${css.rail}`} aria-label={props.t(titleKey)}><div className={css.body}>
    {props.wide && props.section !== 'recent' && <div className={css.browserActions}><div className={css.headingActions}>
      <Menu open={menu === 'sort'} portal align="end" onClose={() => { setMenu(null) }} selectedId={sortName ? 'name' : 'default'}
        anchor={<button type="button" className={css.headerAction} aria-label={`${props.t('more')} ${props.t(titleKey)}`} aria-expanded={menu === 'sort'} aria-haspopup="menu" onClick={() => { setMenu(menu === 'sort' ? null : 'sort') }}><IconEllipsisOutlineRegular /></button>}
        items={[{ id: 'default', label: props.t('sortDefault') }, { id: 'name', label: props.t('sortName') }]}
        onSelect={(id) => { setSortName(id === 'name'); setMenu(null) }} />
      {(props.section === 'bots' || c.organizations.find(org => org.id === c.organizationId)?.role === 'admin') && <Tooltip label={props.t(props.section === 'bots' ? 'createBot' : 'createProject')}>
        <button type="button" className={css.headerAction} aria-label={props.t(props.section === 'bots' ? 'createBot' : 'createProject')} disabled={!ready || busy}
          onClick={() => { if (props.section === 'bots') setEditing({}); else { projectOperation.current = undefined; setProjectDraft({ name: '' }) } }}><IconPlusOutlineRegular /></button>
      </Tooltip>}
    </div></div>}
    {notice && <p role="alert">{notice}</p>}
    {props.wide && ready && !catalogs?.complete && !notice && <p role="status">{props.t('loading')}</p>}
    {props.section === 'projects' && ordered(items.map(item => ({ ...item, name: item.project.name }))).map(({ project, catalog }) =>
      <AccountNavigationGroup key={project.id} kind="project" name={project.name} open={expanded.has(project.id)} wide={props.wide}
        onToggle={() => { toggle(project.id) }} actions={<>
          <Menu open={menu === project.id} portal align="end" onClose={() => { setMenu(null) }}
            anchor={<button type="button" className={css.rowAction} aria-label={`${props.t('more')} ${project.name}`} aria-haspopup="menu" aria-expanded={menu === project.id} onClick={() => { setMenu(menu === project.id ? null : project.id) }}><IconEllipsisOutlineRegular /></button>}
            items={[{ id: 'tasks', label: props.t('tasks') }, { id: 'edit', label: props.t('editProject'), icon: <IconEditOutlineRegular /> }]}
            onSelect={(id) => { setMenu(null); if (id === 'tasks') props.openProjectTasks?.(project); else { projectOperation.current = undefined; setProjectDraft({ project, name: project.name }) } }} />
          {newButton(project)}
        </>}>
        {catalog.conversations.map(conversation => row(project, conversation))}
      </AccountNavigationGroup>)}
    {props.wide && props.section === 'recent' && conversations.map(({ project, conversation }) => row(project, conversation))}
    {props.section === 'bots' && ordered(items.flatMap(({ project, catalog }) => catalog.bots.map(bot => ({ project, catalog, bot, name: bot.name })))).map(({ project, catalog, bot }) =>
      <AccountNavigationGroup key={`${project.id}:${bot.id}`} kind="bot" name={bot.name} open={expanded.has(bot.id)} wide={props.wide}
        onToggle={() => { toggle(bot.id) }} actions={<>
          <Menu open={menu === bot.id} portal align="end" onClose={() => { setMenu(null) }}
            anchor={<button type="button" className={css.rowAction} aria-label={`${props.t('more')} ${bot.name}`} aria-haspopup="menu" aria-expanded={menu === bot.id} onClick={() => { setMenu(menu === bot.id ? null : bot.id) }}><IconEllipsisOutlineRegular /></button>}
            items={[{ id: 'edit', label: props.t('editBot'), icon: <IconEditOutlineRegular />, disabled: busy }]}
            onSelect={() => { setMenu(null); setEditing({ project, bot }) }} />
          {newButton(project, bot)}
        </>}>
        {catalog.conversations.filter(conversation => conversation.botId === bot.id).map(conversation => row(project, conversation))}
      </AccountNavigationGroup>)}
    {props.wide && ready && catalogs?.complete && props.section === 'recent' && !conversations.length && <p>{props.t('noRecentConversations')}</p>}
    {props.wide && ready && catalogs?.complete && props.section === 'bots' && !items.some(i => i.catalog.bots.length) && <p>{props.t('noBots')}</p>}
    {props.wide && ready && catalogs?.complete && props.section === 'projects' && !items.length && <p>{props.t('emptyProjects')}</p>}
    {props.wide && !ready && <p>{props.t(c.phase)}</p>}
  </div>
  {newTarget && <Modal open title={props.t('newConversation')} closeLabel={props.t('close')} onClose={() => { if (!busy) setNewTarget(undefined) }}
    footer={<><Button disabled={busy} onClick={() => { setNewTarget(undefined) }}>{props.t('cancel')}</Button>
      <Button variant="primary" disabled={!ready || busy} onClick={() => {
        const bot = newTarget.bot
          ?? items.find(item => item.project.id === newTarget.project.id)?.catalog.bots.find(bot => bot.id === newBot)
        void open(newTarget.project, randomUUID() as ConversationRequest['conversationId'], bot?.id)
      }}>{props.t('newConversation')}</Button></>}>
    <div className={css.form}><p className={css.contextName}>{newTarget.bot?.name ?? newTarget.project.name}</p>
      {!newTarget.bot && <label>{props.t('bots')}<select value={newBot} disabled={busy} onChange={(event) => { setNewBot(event.target.value) }}>
        <option value="">{props.t('noBot')}</option>{items.find(item => item.project.id === newTarget.project.id)?.catalog.bots.map(bot => <option key={bot.id} value={bot.id}>{bot.name}</option>)}
      </select></label>}{notice && <p role="alert">{notice}</p>}
    </div>
  </Modal>}
  {projectDraft && <Modal open title={props.t(projectDraft.project ? 'editProject' : 'createProject')} closeLabel={props.t('close')} onClose={() => { if (!busy) setProjectDraft(undefined) }}>
    <form className={css.form} onSubmit={(event) => {
      event.preventDefault(); if (!ready || busy || !projectDraft.name.trim()) return
      setBusy(true); setNotice(''); projectOperation.current ??= randomUUID()
      const project = projectDraft.project
      void props.connection({ kind: 'command', command: { operationId: projectOperation.current, organizationId: c.organizationId,
        ...(project ? { kind: 'rename-project', projectId: project.id, expectedVersion: project.version } : { kind: 'create-project' }),
        name: projectDraft.name.trim() } })
        .then(() => {
          if (!alive.current || identity.current.mode !== 'organization' || identity.current.organizationId !== c.organizationId
            || identity.current.principal?.serverId !== c.principal?.serverId
            || identity.current.principal?.accountId !== c.principal?.accountId) return
          setProjectDraft(undefined); props.actions.refresh()
        }, (error: unknown) => { if (alive.current) setNotice(props.t(workgraphError(error))) })
        .finally(() => { if (alive.current) setBusy(false) })
    }}>
      <label>{props.t('projectName')}<Input autoFocus required disabled={busy} value={projectDraft.name} onChange={(event) => { projectOperation.current = undefined; setProjectDraft({ ...projectDraft, name: event.target.value }) }} /></label>
      {notice && <p role="alert">{notice}</p>}
      <div className={css.formActions}><Button disabled={busy} onClick={() => { setProjectDraft(undefined) }}>{props.t('cancel')}</Button><Button type="submit" variant="primary" disabled={busy || !projectDraft.name.trim()}>{props.t('save')}</Button></div>
    </form>
  </Modal>}
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
