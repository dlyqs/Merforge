/** Identity-scoped project, Bot and recent-conversation navigation over private native catalogs. */
import { useEffect, useRef, useState } from 'react'
import { Button, Input, Modal, Menu, Tooltip, AccountNavigationGroup, AccountConversationRow, AccountConversationMenu, accountNavigationStyles as css, IconNewChatOutlineRegular, IconPlusOutlineRegular, IconEditOutlineRegular, IconEllipsisOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import type { ConversationRequest, ConversationResult } from '@deepseek-ai/dsh-organization-conversation/protocol'
import type { OrganizationProjectView } from '@deepseek-ai/dsh-organization/types'
import type { ModelSelection } from '@deepseek-ai/dsh-api-session-controller/types'
import type { OrganizationProps } from './contract.ts'
import type { ConversationSelectionProps } from './conversation-store.ts'
import { readNavigationProjects } from './projects.ts'
import { workgraphError } from './workgraph-view.ts'


type Bot = NonNullable<ConversationResult['catalog']>['bots'][number]
type Catalog = { project: OrganizationProjectView; catalog: NonNullable<ConversationResult['catalog']> }
/** @param props - Framework navigation seat and current identity. @returns Project, Bot or recent rows. */
export function OrganizationBrowser(props: OrganizationProps & ConversationSelectionProps & { section: 'projects' | 'bots' | 'recent'
  wide: boolean
  navigationRevision?: number
  onNavigationHandled?: () => void
  expandSidebar(): void }) {
  const alive = useRef(false)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const c = props.useOrganization(s => s.connection), revision = props.useStore(s => s.revision), selected = props.useStore(s => s.selected)
  const [catalogs, setCatalogs] = useState<{ generation: number; complete: boolean; items: Catalog[] }>()
  const [accountCatalog, setAccountCatalog] = useState<{ generation: number; catalog: Catalog['catalog'] }>()
  const identity = useRef(c); identity.current = c
  const [newTarget, setNewTarget] = useState<{ project: OrganizationProjectView; bot?: Bot }>()
  const [newBot, setNewBot] = useState('')
  const [editing, setEditing] = useState<{ project?: OrganizationProjectView; bot?: Bot }>()
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const [menu, setMenu] = useState<string | null>(null), [sortName, setSortName] = useState(false)
  const [projectDraft, setProjectDraft] = useState<{ name: string; background: string; summary: string; goal: string }>()
  const [deleting, setDeleting] = useState<OrganizationProjectView>()
  const projectOperation = useRef<string>()
  const [notice, setNotice] = useState(''), [busy, setBusy] = useState(false)
  const ready = c.phase === 'ready' && c.mode === 'organization'
  const navigationBegun = useRef<number>()
  useEffect(() => {
    const request = props.navigationRevision
    if (!ready || request === undefined || navigationBegun.current === request) return
    navigationBegun.current = request; props.beginConversationNavigation?.()
  }, [ready, props.navigationRevision])
  useEffect(() => {
    let active = true
    const isActive = () => active, conversation = props.conversation
    setNotice('')
    if (ready && conversation) void (async () => {
      const projects = await readNavigationProjects(props.connection, c.generation, () => active)
      if (!projects) return
      if (isActive()) setCatalogs(previous => ({ generation: c.generation, complete: false, items:
        projects.map(project => ({ project, catalog: previous?.items.find(item => item.project.id === project.id)?.catalog
          ?? { bots: [], conversations: [] } })) }))
      const items = await Promise.all(projects.map(async (project): Promise<Catalog> => {
        try {
          const result = await conversation({ organizationId: project.organizationId, projectId: project.id,
            conversationId: String(project.id) as ConversationRequest['conversationId'], kind: 'catalog', operationId: randomUUID() as ConversationRequest['operationId'] })
          if (result.generation !== c.generation) { active = false; return { project, catalog: { bots: [], conversations: [] } } }
          return { project, catalog: result.result.catalog ?? { bots: [], conversations: [] } }
        } catch (error: unknown) {
          if (isActive()) setNotice(props.t(workgraphError(error)))
          return { project, catalog: { bots: [], conversations: [] } }
        }
      }))
      if (isActive()) setCatalogs({ generation: c.generation, complete: true, items })
    })().catch((error: unknown) => { if (active) setNotice(props.t(workgraphError(error))) })
    return () => { active = false }
  }, [ready, c.generation, revision])
  useEffect(() => {
    let active = true
    if (ready && c.organizationId && props.conversation) void props.conversation({
      organizationId: c.organizationId, conversationId: String(c.organizationId) as ConversationRequest['conversationId'],
      kind: 'catalog', operationId: randomUUID() as ConversationRequest['operationId'],
    }).then((result) => {
      if (active && result.generation === c.generation && result.result.catalog)
        setAccountCatalog({ generation: c.generation, catalog: result.result.catalog })
    }, (error: unknown) => { if (active) setNotice(props.t(workgraphError(error))) })
    return () => { active = false }
  }, [ready, c.generation, revision])
  useEffect(() => {
    setEditing(undefined); setProjectDraft(undefined); setNewTarget(undefined); setDeleting(undefined)
    setExpanded(new Set()); setMenu(null)
  }, [c.principal?.accountId, c.principal?.serverId, c.organizationId])
  const readable = c.mode === 'organization' && ['ready', 'loading'].includes(c.phase)
  const items = readable ? (catalogs?.items ?? []).filter(item => !c.removedProjects?.includes(item.project.id)) : []
  const open = async (project: OrganizationProjectView | undefined, conversationId: ConversationRequest['conversationId'],
    botId?: Bot['id'], assignment?: ConversationRequest['assignment']) => {
    if (!ready || !c.principal || !c.organizationId || busy || !props.conversation) return
    const principal = c.principal
    const navigationRequest = navigationBegun.current
    setBusy(true); setNotice('')
    try {
      const chosen = { ...principal, organizationId: project?.organizationId ?? c.organizationId,
        ...(project ? { projectId: project.id } : {}), conversationId,
        ...(botId ? { botId } : {}), ...(assignment ? { planId: assignment.planId, assignmentId: assignment.assignmentId } : {}) }
      if (props.selectConversation) await props.selectConversation(chosen)
      else {
        const result = await props.conversation({ organizationId: project?.organizationId ?? c.organizationId,
          ...(project ? { projectId: project.id } : {}), conversationId,
          kind: 'open', operationId: randomUUID() as ConversationRequest['operationId'], ...(botId ? { botId } : {}),
          ...(assignment ? { assignment } : {}) })
        if (result.generation !== identity.current.generation) return
      }
      if (!alive.current || c.generation !== identity.current.generation || identity.current.mode !== 'organization'
        || navigationRequest !== navigationBegun.current) return
      if (!props.selectConversation) props.actions.select(chosen)
      setNewTarget(undefined); props.openConversation?.()
    } catch (error) {
      if (alive.current && c.generation === identity.current.generation && navigationRequest === navigationBegun.current)
        setNotice(props.t(workgraphError(error)))
    }
    finally { if (alive.current) setBusy(false) }
  }
  const titleKey = props.section === 'bots' ? 'bots' : props.section === 'projects' ? 'projects' : 'recentConversations'
  const conversations = items.flatMap(({ project, catalog }) => catalog.conversations.map(conversation => ({ project, conversation })))
    .sort((a, b) => b.conversation.createdAt - a.conversation.createdAt)
  const toggle = (id: string) => {
    if (!props.wide) props.expandSidebar()
    setExpanded((previous) => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next })
  }
  const ungrouped = readable ? accountCatalog?.catalog.conversations ?? [] : []
  const recent: { project: OrganizationProjectView | undefined; conversation: Catalog['catalog']['conversations'][number] }[] = [
    ...conversations, ...ungrouped.map(conversation => ({ project: undefined, conversation })),
  ].sort((a, b) => b.conversation.createdAt - a.conversation.createdAt)
  const row = (project: OrganizationProjectView | undefined, conversation: Catalog['catalog']['conversations'][number]) =>
    <AccountConversationRow key={`${project?.id ?? 'account'}:${conversation.conversationId}`} title={conversation.title || props.t('newConversation')}
      tag={props.section === 'recent' ? project?.name : undefined} disabled={busy || !ready}
      selected={selected?.conversationId === conversation.conversationId}
      onOpen={() => { void open(project, conversation.conversationId, conversation.botId, conversation.assignment) }}
      actions={<AccountConversationMenu title={conversation.title || props.t('newConversation')} disabled={busy || !ready}
        labels={{ more: props.t('more'), manage: props.t('manageConversation'), delete: props.t('deleteConversation') }}
        onManage={() => { if (c.principal && c.organizationId) props.manageConversation?.({ ...c.principal,
          organizationId: project?.organizationId ?? c.organizationId,
          ...(project ? { projectId: project.id } : {}), conversationId: conversation.conversationId,
          ...(conversation.assignment ? { planId: conversation.assignment.planId,
            assignmentId: conversation.assignment.assignmentId } : {}) }) }}
        onDelete={() => { if (c.principal && c.organizationId) props.manageConversation?.({ ...c.principal,
          organizationId: project?.organizationId ?? c.organizationId,
          ...(project ? { projectId: project.id } : {}), conversationId: conversation.conversationId,
          ...(conversation.assignment ? { planId: conversation.assignment.planId,
            assignmentId: conversation.assignment.assignmentId } : {}) }, 'delete') }} />} />
  const newButton = (project: OrganizationProjectView, bot?: Bot) => <Tooltip label={props.t('newConversation')}>
    <button type="button" className={css.rowAction} disabled={busy} aria-label={`${props.t('newConversation')} ${bot?.name ?? project.name}`}
      onClick={() => { setNewBot(''); setNewTarget({ project, ...(bot ? { bot } : {}) }) }}><IconNewChatOutlineRegular /></button>
  </Tooltip>
  const ordered = <T extends { name: string },>(values: T[]): T[] =>
    sortName ? [...values].sort((a, b) => a.name.localeCompare(b.name)) : values
  const navigationHandled = useRef<number>()
  useEffect(() => {
    const request = props.navigationRevision
    if (request === undefined || request === navigationHandled.current || !ready || busy
      || catalogs?.generation !== c.generation || !catalogs.complete || notice
      || props.section === 'recent' && accountCatalog?.generation !== c.generation) return
    navigationHandled.current = request
    props.onNavigationHandled?.()
    const firstProject = ordered(items.map(item => ({ ...item, name: item.project.name })))[0]
    const firstBot = ordered(items.flatMap(({ project, catalog }) =>
      catalog.bots.map(bot => ({ project, catalog, bot, name: bot.name }))))[0]
    const target = props.section === 'recent' ? recent[0]
      : props.section === 'projects' ? firstProject && { project: firstProject.project, conversation: firstProject.catalog.conversations[0] }
        : firstBot && { project: firstBot.project,
          conversation: firstBot.catalog.conversations.find(item => item.botId === firstBot.bot.id) }
    if (target?.conversation) void open(target.project, target.conversation.conversationId,
      target.conversation.botId, target.conversation.assignment)
    else props.showConversationStart?.(target?.project, props.section === 'bots' ? firstBot?.bot.id : undefined)
    const groupId = props.section === 'bots' ? firstBot?.bot.id : target?.project?.id
    if (groupId) setExpanded(new Set([groupId]))
  }, [props.navigationRevision, ready, busy, catalogs, accountCatalog, props.section, c.generation, notice])
  return <section className={props.wide ? css.root : `${css.root} ${css.rail}`} aria-label={props.t(titleKey)}><div className={css.body}>
    {props.wide && props.section !== 'recent' && <div className={css.browserActions}><div className={css.headingActions}>
      <Menu open={menu === 'sort'} portal align="end" onClose={() => { setMenu(null) }} selectedId={sortName ? 'name' : 'default'}
        anchor={<button type="button" className={css.headerAction} aria-label={`${props.t('more')} ${props.t(titleKey)}`} aria-expanded={menu === 'sort'} aria-haspopup="menu" onClick={() => { setMenu(menu === 'sort' ? null : 'sort') }}><IconEllipsisOutlineRegular /></button>}
        items={[{ id: 'default', label: props.t('sortDefault') }, { id: 'name', label: props.t('sortName') }]}
        onSelect={(id) => { setSortName(id === 'name'); setMenu(null) }} />
      <Tooltip label={props.t(props.section === 'bots' ? 'createBot' : 'createProject')}>
        <button type="button" className={css.headerAction} aria-label={props.t(props.section === 'bots' ? 'createBot' : 'createProject')} disabled={!ready || busy}
          onClick={() => { if (props.section === 'bots') setEditing({})
          else { projectOperation.current = undefined
            setProjectDraft({ name: '', background: '', summary: '', goal: '' }) } }}><IconPlusOutlineRegular /></button>
      </Tooltip>
    </div></div>}
    {notice && <p role="alert">{notice}</p>}
    {props.section === 'projects' && ordered(items.map(item => ({ ...item, name: item.project.name }))).map(({ project, catalog }) =>
      <AccountNavigationGroup key={project.id} kind="project" name={project.name} open={expanded.has(project.id)} wide={props.wide}
        onToggle={() => { toggle(project.id) }} actions={<>
          <Menu open={menu === project.id} portal align="end" onClose={() => { setMenu(null) }}
            anchor={<button type="button" className={css.rowAction} aria-label={`${props.t('more')} ${project.name}`} aria-haspopup="menu" aria-expanded={menu === project.id} onClick={() => { setMenu(menu === project.id ? null : project.id) }}><IconEllipsisOutlineRegular /></button>}
            items={[{ id: 'view', label: props.t('viewProject'), disabled: !ready || busy },
              { id: 'delete', label: props.t(project.createdBy === c.principal?.accountId ? 'deleteProject' : 'removeLocalProject'),
                disabled: busy || !ready || !props.removeProject }]}
            onSelect={(id) => { setMenu(null)
              if (id === 'view') props.openProject?.(project)
              else if (id === 'delete') setDeleting(project)
            }} />
          {newButton(project)}
        </>}>
        {catalog.conversations.map(conversation => row(project, conversation))}
      </AccountNavigationGroup>)}
    {props.wide && props.section === 'recent' && recent.map(({ project, conversation }) => row(project, conversation))}
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
    {props.wide && !ready && c.phase !== 'loading' && <p>{props.t(c.phase)}</p>}
  </div>
  {deleting && <Modal open title={props.t(deleting.createdBy === c.principal?.accountId ? 'deleteProject' : 'removeLocalProject')}
    closeLabel={props.t('close')} onClose={() => { if (!busy) setDeleting(undefined) }}
    footer={<><Button disabled={busy} onClick={() => { setDeleting(undefined) }}>{props.t('cancel')}</Button>
      <Button variant="primary" disabled={!ready || busy} onClick={() => {
        if (!props.removeProject) return
        setBusy(true); setNotice('')
        void props.removeProject(deleting).then(() => { if (alive.current) { setDeleting(undefined); props.actions.refresh() } },
          (error: unknown) => { if (alive.current) setNotice(props.t(workgraphError(error))) })
          .finally(() => { if (alive.current) setBusy(false) })
      }}>{props.t(deleting.createdBy === c.principal?.accountId ? 'deleteProject' : 'removeLocalProject')}</Button></>}>
    <p>{deleting.name}</p><p>{props.t(deleting.createdBy === c.principal?.accountId ? 'deleteSharedProjectHint' : 'removeLocalProjectHint')}</p>
    {notice && <p role="alert">{notice}</p>}
  </Modal>}
  {newTarget && <Modal open title={props.t('newConversation')} closeLabel={props.t('close')} onClose={() => { if (!busy) setNewTarget(undefined) }}
    footer={<><Button disabled={busy} onClick={() => { setNewTarget(undefined) }}>{props.t('cancel')}</Button>
      <Button variant="primary" disabled={!ready || busy} onClick={() => {
        const bot = newTarget.bot
          ?? items.find(item => item.project.id === newTarget.project.id)?.catalog.bots.find(bot => bot.id === newBot)
        props.showConversationStart?.(newTarget.project, bot?.id); setNewTarget(undefined)
      }}>{props.t('newConversation')}</Button></>}>
    <div className={css.form}><p className={css.contextName}>{newTarget.bot?.name ?? newTarget.project.name}</p>
      {!newTarget.bot && <label>{props.t('bots')}<select value={newBot} disabled={busy} onChange={(event) => { setNewBot(event.target.value) }}>
        <option value="">{props.t('noBot')}</option>{items.find(item => item.project.id === newTarget.project.id)?.catalog.bots.map(bot => <option key={bot.id} value={bot.id}>{bot.name}</option>)}
      </select></label>}{notice && <p role="alert">{notice}</p>}
    </div>
  </Modal>}
  {projectDraft && <Modal open title={props.t('createProject')} closeLabel={props.t('close')} onClose={() => { if (!busy) setProjectDraft(undefined) }}>
    <form className={css.form} onSubmit={(event) => {
      event.preventDefault(); if (!ready || busy || !projectDraft.name.trim()) return
      setBusy(true); setNotice(''); projectOperation.current ??= randomUUID()
      void props.connection({ kind: 'command', command: { operationId: projectOperation.current, organizationId: c.organizationId,
        kind: 'create-project', ...projectDraft, name: projectDraft.name.trim() } })
        .then(() => {
          if (!alive.current || identity.current.mode !== 'organization' || identity.current.organizationId !== c.organizationId
            || identity.current.principal?.serverId !== c.principal?.serverId
            || identity.current.principal?.accountId !== c.principal?.accountId) return
          setProjectDraft(undefined); props.actions.refresh()
        }, (error: unknown) => { if (alive.current) setNotice(props.t(workgraphError(error))) })
        .finally(() => { if (alive.current) setBusy(false) })
    }}>
      <label>{props.t('projectName')}<Input className={css.textInput ?? ''} autoFocus required disabled={busy} value={projectDraft.name} onChange={(event) => { projectOperation.current = undefined
        setProjectDraft({ ...projectDraft, name: event.target.value }) }} /></label>
      <p className={css.contextName}>{props.t('createProjectHint')}</p>
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
  const [models, setModels] = useState<{ selection: ModelSelection; label: string }[]>([]), [model, setModel] = useState('')
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState('')
  const [botId] = useState(props.initial.bot?.id ?? randomUUID() as Bot['id'])
  const alive = useRef(false), pending = useRef<{ digest: string; request: ConversationRequest }>()
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  useEffect(() => {
    let active = true; setModels([]); setModel('')
    if (props.loadModels) void props.loadModels().then((catalog) => {
      if (!active) return
      const items = catalog.groups.flatMap(group => group.models.map(choice => ({ label: `${group.name} · ${choice.name}`,
        selection: { backend: group.backend ?? 'harness-api', provider: group.id, model: choice.id,
          ...(choice.reasoning?.defaultEffort ? { reasoningEffort: choice.reasoning.defaultEffort } : {}) } })))
      setModels(items)
      const selected = props.initial.bot?.selection ?? catalog.default
      const index = items.findIndex(({ selection }) => selection.model === selected.model
        && ('provider' in selected ? selection.provider === selected.provider : selection.backend === 'harness-api'))
      if (index >= 0) setModel(String(index))
    }, (error: unknown) => { if (active) setNotice(t(workgraphError(error))) })
    return () => { active = false }
  }, [projectId, c.generation])
  return <Modal open title={t(props.initial.bot ? 'editBot' : 'createBot')} closeLabel={t('close')} onClose={() => { if (!busy) props.close() }}>
    <form className={css.form} onSubmit={(event) => {
      event.preventDefault()
      const project = props.projects.find(p => p.id === projectId), selection = models[Number(model)]?.selection
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
      <label>{t('botName')}<Input className={css.textInput ?? ''} value={name} maxLength={120} disabled={busy} onChange={(e) => { setName(e.target.value) }} /></label>
      <label>{t('botInstructions')}<textarea value={instructions} maxLength={8192} disabled={busy} onChange={(e) => { setInstructions(e.target.value) }} /></label>
      <label>{t('conversationModel')}<select value={model} disabled={busy} onChange={(e) => { setModel(e.target.value) }}>
        <option value="">{t('conversationChooseModel')}</option>{models.map((m, i) =>
          <option key={`${m.selection.provider}:${m.selection.model}`} value={i}>{m.label}</option>)}</select></label>
      {notice && <p role="alert">{notice}</p>}
      <Button type="submit" disabled={busy || !name.trim() || model === '' || c.phase !== 'ready'}>{t('save')}</Button>
    </form>
  </Modal>
}
