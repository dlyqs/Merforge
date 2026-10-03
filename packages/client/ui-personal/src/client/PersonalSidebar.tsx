/** Project and Bot entrances over one Session catalog. */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ModelCatalog } from '@deepseek-ai/dsh-api-session-controller/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { AffiliationProjection, BotId, BotProfile, Project, ProjectId } from '@deepseek-ai/dsh-personal-project/types'
import {
  IconAgentPresetOutlineRegular, IconEditOutlineRegular, IconFolderCloseRegular, IconFolderOpenOutlineRegular,
  IconNewChatOutlineRegular, IconPlusOutlineRegular, IconTrashOutlineRegular,
  AccountNavigationGroup, AccountConversationRow, accountNavigationStyles as css,
  IconUnarchiveOutlineRegular, IconEllipsisOutlineRegular, Button, Menu, Modal, StateDot, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PersonalSidebarProps } from './contract.ts'
import { memberIds, unassignedIds, type Entrance } from './membership.ts'

type ProjectDraft = { kind: 'project'; id?: ProjectId; name: string; description: string; path: string }
type BotDraft = {
  kind: 'bot'
  id?: BotId
  name: string
  identity: string
  direction: string
  backend: 'harness-api' | 'codex'
  provider: string
  model: string
  reasoningEffort: string
  tools: string
  skills: string
}
type Draft = ProjectDraft | BotDraft

/** Comma separated allowlists become absent when the user leaves them unrestricted. */
function allowlist(value: string): string[] | undefined {
  const items = value.split(',').map(item => item.trim()).filter(Boolean)
  return items.length === 0 ? undefined : items
}

/** Sidebar Project/Bot browser and editor. */
export function PersonalSidebar(props: PersonalSidebarProps) {
  const {
    management = false, section, wide, expandSidebar, t, useRecords, useSessions, useSessionStatus, useWorkspaces,
    refresh, loadModels, createProject, updateProject, deleteProject, pickDirectory, createBot, updateBot, deleteBot,
    createSession, deleteSession, moveSession, refreshAffiliation, openSession, unarchiveSession,
  } = props
  const modelCatalogRevision = props.useModelCatalogRevision(value => value)
  const settingsNavigation = props.useSettingsNavigation(value => value)
  const setupOpen = settingsNavigation.open && settingsNavigation.section === 'models' && settingsNavigation.target === 'codex'
  const records = useRecords(value => value)
  const sessions = useSessions(value => value)
  const statuses = useSessionStatus(value => value)
  const workspaces = useWorkspaces(value => value)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  const [deleteSessionId, setDeleteSessionId] = useState<SessionId | null>(null)
  const [selectedSession, setSelectedSession] = useState<SessionId | null>(null)
  const [models, setModels] = useState<ModelCatalog | null>(null)
  const [modelError, setModelError] = useState<string | null>(null)
  const [modelRefresh, setModelRefresh] = useState(0)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Entrance | null>(null)
  const [botForNew, setBotForNew] = useState('')
  const [newTarget, setNewTarget] = useState<Entrance | null>(null)
  const [menu, setMenu] = useState<string | null>(null)
  const [sortByName, setSortByName] = useState({ project: false, bot: false })
  const closeOverlay = (): void => {
    if (busy) return
    setDraft(null)
    setDeleteTarget(null)
    setDeleteSessionId(null)
    setSelectedSession(null)
    setNewTarget(null)
    setError(null)
  }
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const requested = useRef(new Set<SessionId>())

  useEffect(() => {
    if (records.phase === 'loading') void refresh()
  }, [records.phase, refresh])

  useEffect(() => {
    for (const id of sessions.ids) {
      if (sessions.projectionsBySession[id]?.state === 'idle') requested.current.delete(id)
      if (requested.current.has(id) || sessions.byId[id]?.projectionValues?.personalAffiliation !== undefined) continue
      requested.current.add(id)
      void refreshAffiliation(id).catch(() => { requested.current.delete(id) })
    }
  }, [sessions, refreshAffiliation])

  useEffect(() => {
    if (draft?.kind !== 'bot' || loadModels === undefined) return
    let current = true
    setModelError(null)
    setModels(null)
    void loadModels().then(
      (value) => { if (current) setModels(value) },
      (reason: unknown) => { if (current) setModelError(String(reason)) },
    )
    return () => { current = false }
  }, [draft?.kind, loadModels, modelRefresh, modelCatalogRevision])

  const unassigned = useMemo(() => unassignedIds(sessions), [sessions])
  const affiliation: AffiliationProjection | undefined = selectedSession === null
    ? undefined
    : sessions.byId[selectedSession]?.projectionValues?.personalAffiliation

  const perform = async (operation: () => Promise<unknown>, after?: () => void): Promise<void> => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await operation()
      after?.()
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }
  const projectDraft = (project?: Project): ProjectDraft => ({
    kind: 'project', ...(project === undefined ? {} : { id: project.id }),
    name: project?.name ?? '', description: project?.description ?? '', path: project?.path ?? '',
  })
  const botDraft = (bot?: BotProfile): BotDraft => ({
    kind: 'bot', ...(bot === undefined ? {} : { id: bot.id }),
    name: bot?.name ?? '', identity: bot?.identity ?? '', direction: bot?.direction ?? '',
    backend: bot?.defaultModel?.backend ?? 'harness-api',
    provider: bot?.defaultModel?.provider ?? '', model: bot?.defaultModel?.model ?? '',
    reasoningEffort: bot?.defaultModel?.reasoningEffort ?? '',
    tools: bot?.allowedTools?.join(', ') ?? '', skills: bot?.allowedSkills?.join(', ') ?? '',
  })
  const saveDraft = (): void => {
    if (draft === null || busy) return
    if (draft.kind === 'project') {
      const path = draft.path.trim() || undefined
      void perform(async () => {
        if (draft.id === undefined) await createProject({
          name: draft.name, description: draft.description,
          ...(path === undefined ? {} : { path }),
        })
        else await updateProject({ id: draft.id, name: draft.name, description: draft.description, path: path ?? null })
      }, () => { setDraft(null) })
      return
    }
    if (draft.backend === 'codex' && (draft.provider === '' || draft.model === '')) {
      setError(t('codexChooseModel'))
      return
    }
    const defaultModel = draft.provider.trim() === '' && draft.model.trim() === '' ? undefined : {
      ...(draft.backend === 'codex' ? { backend: 'codex' as const } : {}),
      provider: draft.provider.trim(), model: draft.model.trim(),
      ...(draft.reasoningEffort.trim() === '' ? {} : { reasoningEffort: draft.reasoningEffort.trim() }),
    }
    const allowedTools = allowlist(draft.tools)
    const allowedSkills = allowlist(draft.skills)
    void perform(async () => {
      if (draft.id === undefined) await createBot({
        name: draft.name, identity: draft.identity, direction: draft.direction,
        ...(defaultModel === undefined ? {} : { defaultModel }),
        ...(allowedTools === undefined ? {} : { allowedTools }),
        ...(allowedSkills === undefined ? {} : { allowedSkills }),
      })
      else await updateBot({
        id: draft.id, name: draft.name, identity: draft.identity, direction: draft.direction,
        defaultModel: defaultModel ?? null, allowedTools: allowedTools ?? null, allowedSkills: allowedSkills ?? null,
      })
    }, () => { setDraft(null) })
  }
  const acceptDrop = (target: Entrance, event: React.DragEvent): void => {
    event.preventDefault()
    const id = event.dataTransfer.getData('application/x-dsh-personal-session') as SessionId
    if (id === '' || sessions.byId[id] === undefined) return
    void perform(() => moveSession({ sessionId: id, ...(target.kind === 'project' ? { projectId: target.id } : { botId: target.id }) }))
  }
  const sessionRow = (id: SessionId, context: 'project' | 'bot' | 'recent') => {
    const menuId = `${context}:session:${id}`
    const summary = sessions.byId[id]
    if (summary === undefined) return null
    const status = statuses.get(id)
    const archived = workspaces.archivedSessionIds.includes(id)
    const botName = summary.projectionValues?.personalAffiliation?.current.botId === undefined
      ? undefined
      : records.bots.find(bot => bot.id === summary.projectionValues?.personalAffiliation?.current.botId)?.name
    const statusLabel = archived ? t('archived')
      : status?.pendingInteraction !== undefined ? t('waiting')
        : status?.running || summary.running ? t('running')
          : status?.completionUnread ? t('completed') : t('idle')
    const statusState = archived ? 'idle' : status?.pendingInteraction !== undefined ? 'warning'
      : status?.running || summary.running ? 'ongoing' : status?.completionUnread ? 'done' : 'idle'
    return <AccountConversationRow key={id} title={summary.blank ? t('newSession') : summary.displayTitle}
      label={`${summary.displayTitle} · ${statusLabel}`} tag={context === 'project' ? botName : undefined}
      status={statusState !== 'idle' ? <StateDot state={statusState} /> : undefined}
      draggable onDragStart={(event) => {
        event.dataTransfer.setData('application/x-dsh-personal-session', id)
        event.dataTransfer.effectAllowed = 'move'
      }} onOpen={() => { if (!archived) openSession(id) }} actions={<>
        <Menu open={menu === menuId} portal align="end" autoFocus onClose={() => { setMenu(null) }}
          anchor={<button type="button" className={css.rowAction} aria-label={`${t('more')} ${summary.displayTitle}`}
            aria-haspopup="menu" aria-expanded={menu === menuId}
            onClick={() => { setMenu(menu === menuId ? null : menuId) }}><IconEllipsisOutlineRegular /></button>}
          items={[
            { id: 'manage', label: t('manageSession'), icon: <IconEditOutlineRegular />, disabled: busy },
            { id: 'delete', label: t('delete'), icon: <IconTrashOutlineRegular />, danger: true, disabled: busy },
          ]}
          onSelect={(action) => {
            setMenu(null); setError(null)
            if (action === 'delete') setDeleteSessionId(id)
            else setSelectedSession(id)
          }} />
        {archived && <Tooltip label={t('unarchive')}><button type="button" className={css.rowAction}
          aria-label={t('unarchive')} onClick={() => { void perform(() => unarchiveSession(id)) }}><IconUnarchiveOutlineRegular /></button></Tooltip>}
      </>} />
  }

  const groupRow = (target: Entrance, name: string, edit: () => void) => {
    const menuId = `${target.kind}:${target.id}`
    const open = expanded.has(menuId)
    const ids = memberIds(sessions, target)
    return <AccountNavigationGroup key={`${target.kind}:${target.id}`} kind={target.kind} name={name}
      open={open} wide={wide} label={`${name} · ${t(target.kind === 'project' ? 'dropProject' : 'dropBot')}`}
      onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move' }}
      onDrop={(event) => { acceptDrop(target, event) }} onToggle={() => {
        if (!wide) expandSidebar()
        setExpanded((current) => {
          const next = new Set(current); if (next.has(menuId)) next.delete(menuId); else next.add(menuId); return next
        })
        setSelectedSession(null)
      }} actions={<>
        <Menu open={menu === menuId} portal align="end" autoFocus
          onClose={() => { setMenu(null) }}
          anchor={<button type="button" className={css.rowAction} aria-label={`${t('more')} ${name}`}
            aria-haspopup="menu" aria-expanded={menu === menuId}
            onClick={() => { setMenu(menu === menuId ? null : menuId) }}><IconEllipsisOutlineRegular /></button>}
          items={[
            { id: 'edit', label: t('edit'), icon: <IconEditOutlineRegular />, disabled: busy },
            { id: 'delete', label: t('delete'), icon: <IconTrashOutlineRegular />, danger: true, disabled: busy },
          ]}
          onSelect={(id) => { setMenu(null); setError(null); if (id === 'edit') edit(); else setDeleteTarget(target) }} />
        {!management && <Tooltip label={t('newSession')}><button type="button" className={css.rowAction} aria-label={`${t('newSession')} ${name}`}
          disabled={busy} onClick={() => { setError(null); setBotForNew(''); setNewTarget(target) }}><IconNewChatOutlineRegular /></button></Tooltip>}
      </>}>
      {!management && ids.map(id => sessionRow(id, target.kind))}
    </AccountNavigationGroup>
  }

  return <section className={wide ? css.root : `${css.root} ${css.rail}`} aria-label={t('section')}>
    {wide && <div className={css.body}>
      {management && <h3>{t('tasks')}</h3>}
      {management && props.renderSlot('personal.manager.workflow', { projectId: null, botId: null, ...(props.onNavigate === undefined ? {} : { onNavigate: props.onNavigate }) })}
      {records.phase === 'loading' && <p>{t('loading')}</p>}
      {records.phase === 'error' && <button type="button" onClick={() => { void refresh() }}>{t('retry')}</button>}
      {(section === undefined || section === 'projects') && <>
        <div className={section === undefined ? css.groupHeading : css.browserActions}>{section === undefined && <span>{t('projects')}</span>}
          <div className={css.headingActions}>
            <Menu open={menu === 'projects'} portal align="end" autoFocus
              onClose={() => { setMenu(null) }}
              anchor={<button type="button" className={css.headerAction} aria-label={`${t('more')} ${t('projects')}`}
                aria-haspopup="menu" aria-expanded={menu === 'projects'}
                onClick={() => { setMenu(menu === 'projects' ? null : 'projects') }}><IconEllipsisOutlineRegular /></button>}
              selectedId={sortByName.project ? 'name' : 'default'}
              items={[{ id: 'default', label: t('sortDefault') }, { id: 'name', label: t('sortName') }]}
              onSelect={(id) => { setSortByName(value => ({ ...value, project: id === 'name' })); setMenu(null) }} />

            <Tooltip label={t('addProject')}><button type="button" className={css.headerAction} aria-label={t('addProject')}
              onClick={() => { setError(null); setDraft(projectDraft()) }}><IconPlusOutlineRegular /></button></Tooltip>
          </div>
        </div>
        {(sortByName.project ? [...records.projects].sort((a, b) => a.name.localeCompare(b.name)) : records.projects).map(project => groupRow({ kind: 'project', id: project.id }, project.name, () => { setDraft(projectDraft(project)) }))}
      </>}
      {(section === undefined || section === 'bots') && <>
        <div className={section === undefined ? css.groupHeading : css.browserActions}>{section === undefined && <span>{t('bots')}</span>}
          <div className={css.headingActions}>
            <Menu open={menu === 'bots'} portal align="end" autoFocus
              onClose={() => { setMenu(null) }}
              anchor={<button type="button" className={css.headerAction} aria-label={`${t('more')} ${t('bots')}`}
                aria-haspopup="menu" aria-expanded={menu === 'bots'}
                onClick={() => { setMenu(menu === 'bots' ? null : 'bots') }}><IconEllipsisOutlineRegular /></button>}
              selectedId={sortByName.bot ? 'name' : 'default'}
              items={[{ id: 'default', label: t('sortDefault') }, { id: 'name', label: t('sortName') }]}
              onSelect={(id) => { setSortByName(value => ({ ...value, bot: id === 'name' })); setMenu(null) }} />

            <Tooltip label={t('addBot')}><button type="button" className={css.headerAction} aria-label={t('addBot')}
              onClick={() => { setError(null); setDraft(botDraft()) }}><IconPlusOutlineRegular /></button></Tooltip>
          </div>
        </div>
        {(sortByName.bot ? [...records.bots].sort((a, b) => a.name.localeCompare(b.name)) : records.bots).map(bot => groupRow({ kind: 'bot', id: bot.id }, bot.name, () => { setDraft(botDraft(bot)) }))}
      </>}
      {!management && (section === undefined || section === 'recent') && <section aria-label={t('recent')}>
        {section === undefined && <div className={css.groupHeading}><span>{t('recent')}</span></div>}
        {unassigned.map(id => sessionRow(id, 'recent'))}
      </section>}
      {records.phase === 'ready' && (section === 'projects' ? records.projects.length === 0 : section === 'bots' ? records.bots.length === 0 : section === 'recent' ? unassigned.length === 0 : records.projects.length === 0 && records.bots.length === 0 && unassigned.length === 0) && <p>{t(section === 'projects' ? 'noProjects' : section === 'bots' ? 'noBots' : section === 'recent' ? 'noRecent' : 'none')}</p>}
      {error !== null && draft === null && deleteTarget === null && deleteSessionId === null && selectedSession === null && newTarget === null && <p role="alert">{t('error', { message: error })}</p>}
    </div>}
    {selectedSession !== null && sessions.byId[selectedSession] !== undefined && <Modal open onClose={closeOverlay} closeLabel={t('close')} title={t('manageSession')}
      className={css.dialog ?? ''} contentClassName={css.dialogContent ?? ''}>
      <div className={css.detail}>
        <strong>{sessions.byId[selectedSession].displayTitle}</strong>
        <label>{t('moveProject')}<select value={affiliation?.current.projectId ?? ''} disabled={busy}
          onChange={(event) => { void perform(() => moveSession({ sessionId: selectedSession, projectId: event.target.value === '' ? null : event.target.value as ProjectId })) }}>
          <option value="">{t('noProject')}</option>
          {records.projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
        </select></label>
        <label>{t('moveBot')}<select value={affiliation?.current.botId ?? ''} disabled={busy}
          onChange={(event) => { void perform(() => moveSession({ sessionId: selectedSession, botId: event.target.value === '' ? null : event.target.value as BotId })) }}>
          <option value="">{t('noBotAffiliation')}</option>
          {records.bots.map(bot => <option key={bot.id} value={bot.id}>{bot.name}</option>)}
        </select></label>
        <strong>{t('history')}</strong>
        {affiliation?.history.length === 0 && <p>{t('historyEmpty')}</p>}
        <ol className={css.history}>{affiliation?.history.map(change => <li key={change.seq}>
          <time dateTime={new Date(change.time).toISOString()}>{new Date(change.time).toLocaleString()}</time>
          {' · '}{t(change.source === 'create' ? 'created' : change.source === 'delete' ? 'deleted' : 'moved')}
          {' · '}{change.from.project?.name ?? t('noProject')} / {change.from.bot?.name ?? t('noBotAffiliation')}
          {' → '}{change.to.project?.name ?? t('noProject')} / {change.to.bot?.name ?? t('noBotAffiliation')}
        </li>)}</ol>
        {error !== null && <p role="alert">{t('error', { message: error })}</p>}
      </div></Modal>}
    {deleteSessionId !== null && <Modal open onClose={closeOverlay} closeLabel={t('close')} title={t('delete')}
      footer={<>
        <Button variant="outline" disabled={busy} onClick={closeOverlay}>{t('cancel')}</Button>
        <Button variant="primary" disabled={busy} onClick={() => { void perform(
          () => deleteSession(deleteSessionId), () => { setDeleteSessionId(null); setSelectedSession(null) },
        ) }}>{t('delete')}</Button>
      </>}>
      <p>{t('confirmDeleteSession', { name: sessions.byId[deleteSessionId]?.displayTitle ?? t('newSession') })}</p>
      {error !== null && <p role="alert">{t('error', { message: error })}</p>}
    </Modal>}
    {deleteTarget !== null && <Modal open onClose={closeOverlay} closeLabel={t('close')} title={t('delete')}>
      <div className={css.confirm}>
        <span>{t('confirmDelete', { name: deleteTarget.kind === 'project'
          ? records.projects.find(project => project.id === deleteTarget.id)?.name ?? ''
          : records.bots.find(bot => bot.id === deleteTarget.id)?.name ?? '' })}</span>
        <Button variant="primary" disabled={busy} onClick={() => { void perform(
          () => deleteTarget.kind === 'project' ? deleteProject(deleteTarget.id) : deleteBot(deleteTarget.id),
          () => {
            setDeleteTarget(null)
            setExpanded((current) => {
              const next = new Set(current)
              next.delete(`${deleteTarget.kind}:${deleteTarget.id}`)
              return next
            })
            setSelectedSession(null)
          },
        ) }}>{t('delete')}</Button>
        <Button variant="outline" disabled={busy} onClick={closeOverlay}>{t('cancel')}</Button>
        {error !== null && <p role="alert">{t('error', { message: error })}</p>}
      </div></Modal>}
    {draft !== null && <Modal open={!setupOpen} onClose={closeOverlay} closeLabel={t('close')}
      title={t(draft.kind === 'project' ? draft.id === undefined ? 'addProject' : 'editProject' : draft.id === undefined ? 'addBot' : 'editBot')}
      className={css.dialog ?? ''} contentClassName={css.dialogContent ?? ''}><form className={css.form} onSubmit={(event) => { event.preventDefault(); saveDraft() }}>
        <label>{t('name')}<input autoFocus required disabled={busy} value={draft.name} onChange={(event) => { setDraft({ ...draft, name: event.target.value }) }} /></label>
        {draft.kind === 'project' ? <>
          <label>{t('description')}<textarea disabled={busy} value={draft.description} onChange={(event) => { setDraft({ ...draft, description: event.target.value }) }} /></label>
          <label>{t('directory')}<span className={css.directoryField}>
            <input disabled={busy} value={draft.path} placeholder={t('noDirectory')}
              onChange={(event) => { setDraft({ ...draft, path: event.target.value }) }} />
            <Tooltip label={t('chooseDirectory')}><button type="button" className={css.rowAction} disabled={busy} aria-label={t('chooseDirectory')}
              onClick={() => { void perform(async () => {
                const path = await pickDirectory()
                if (path !== null) setDraft(current => current?.kind === 'project' ? { ...current, path } : current)
              }) }}><IconFolderOpenOutlineRegular /></button></Tooltip>
          </span></label>
        </> : <>
          <label>{t('identity')}<textarea disabled={busy} value={draft.identity} onChange={(event) => { setDraft({ ...draft, identity: event.target.value }) }} /></label>
          <label>{t('direction')}<textarea disabled={busy} value={draft.direction} onChange={(event) => { setDraft({ ...draft, direction: event.target.value }) }} /></label>
          <label>{t('backend')}<select disabled={busy} value={draft.backend} onChange={(event) => { setDraft({ ...draft, backend: event.target.value === 'codex' ? 'codex' : 'harness-api', provider: '', model: '', reasoningEffort: '' }) }}>
            <option value="harness-api">{t('backendApi')}</option><option value="codex">{t('backendCodex')}</option>
          </select></label>
          <label>{t('modelName')}<select disabled={busy} value={JSON.stringify([draft.provider, draft.model])} onChange={(event) => {
            const chosen = models?.groups.flatMap(group => group.models.map(model => ({ group, model })))
              .find(row => JSON.stringify([row.group.id, row.model.id]) === event.target.value)
            setDraft({ ...draft, provider: chosen?.group.id ?? '', model: chosen?.model.id ?? '', reasoningEffort: chosen?.model.reasoning?.defaultEffort ?? '' })
          }}>
            <option value={JSON.stringify(['', ''])}>{t(draft.backend === 'codex' ? 'codexChooseModel' : 'modelInherit')}</option>
            {draft.model !== '' && !models?.groups.some(group => group.id === draft.provider && group.models.some(model => model.id === draft.model)) && <option value={JSON.stringify([draft.provider, draft.model])}>{draft.provider}/{draft.model}</option>}
            {models?.groups.filter(group => (group.backend ?? 'harness-api') === draft.backend).map(group => <optgroup key={group.id} label={group.name}>{group.models.map(model => <option key={model.id} value={JSON.stringify([group.id, model.id])}>{model.name}</option>)}</optgroup>)}
          </select></label>
          {draft.backend === 'codex' && <><p>{t('codexCapabilities')}</p><p>{t('codexSetup')}</p>
            {props.openCodexSettings && <Button variant="outline" disabled={busy} onClick={props.openCodexSettings}>{t('openCodexSettings')}</Button>}
          </>}
          {loadModels !== undefined && <Button variant="outline" disabled={busy} onClick={() => { setModelRefresh(value => value + 1) }}>{t('refreshModels')}</Button>}
          {modelError !== null && <p role="alert">{modelError}</p>}
          {models?.failures.map(failure => <p key={failure.id}>{failure.name}: {failure.message}</p>)}
          <label>{t('reasoningEffort')}<select disabled={busy} value={draft.reasoningEffort} onChange={(event) => { setDraft({ ...draft, reasoningEffort: event.target.value }) }}>
            <option value="">{t('modelInherit')}</option>
            {draft.reasoningEffort !== '' && <option value={draft.reasoningEffort}>{draft.reasoningEffort}</option>}
            {models?.groups.find(group => group.id === draft.provider)?.models.find(model => model.id === draft.model)
              ?.reasoning?.efforts.filter(effort => effort.id !== draft.reasoningEffort)
              .map(effort => <option key={effort.id} value={effort.id}>{effort.name}</option>)}
          </select></label>
          <label>{t('allowedTools')}<input disabled={busy} value={draft.tools} onChange={(event) => { setDraft({ ...draft, tools: event.target.value }) }} /></label>
          <label>{t('allowedSkills')}<input disabled={busy} value={draft.skills} onChange={(event) => { setDraft({ ...draft, skills: event.target.value }) }} /></label>
        </>}
        {error !== null && <p role="alert">{t('error', { message: error })}</p>}
        <div className={css.formActions}>
          <Button variant="outline" disabled={busy} onClick={closeOverlay}>{t('cancel')}</Button>
          <Button variant="primary" type="submit" disabled={busy || draft.name.trim() === '' || (draft.kind === 'bot' && draft.backend === 'codex' && (draft.provider === '' || draft.model === ''))}>{t('save')}</Button>
        </div>
      </form></Modal>}
    {newTarget !== null && <Modal open onClose={closeOverlay} closeLabel={t('close')} title={t('newSession')}
      footer={<>
        <Button variant="outline" disabled={busy} onClick={closeOverlay}>{t('cancel')}</Button>
        <Button variant="primary" disabled={busy} onClick={() => { void perform(() => createSession(
          newTarget.kind === 'project' ? { projectId: newTarget.id, ...(botForNew === '' ? {} : { botId: botForNew as BotId }) }
            : { botId: newTarget.id },
        ), () => { setNewTarget(null) }) }}>{t('newSession')}</Button>
      </>}>
      <div className={css.form}>
        <p className={css.contextName}>{newTarget.kind === 'project'
          ? records.projects.find(project => project.id === newTarget.id)?.name
          : records.bots.find(bot => bot.id === newTarget.id)?.name}</p>
        {newTarget.kind === 'project' && <label>{t('newWithBot')}
          <select autoFocus disabled={busy} value={botForNew} onChange={(event) => { setBotForNew(event.target.value) }}>
            <option value="">{t('noBot')}</option>
            {records.bots.map(bot => <option value={bot.id} key={bot.id}>{bot.name}</option>)}
          </select>
        </label>}
        {error !== null && <p role="alert">{t('error', { message: error })}</p>}
      </div>
    </Modal>}
    {!wide && <div className={css.railNavigation}>
      <Tooltip label={t('projects')}><button type="button" className={css.railButton} aria-label={t('projects')}
        onClick={expandSidebar}><IconFolderCloseRegular size={18} /></button></Tooltip>
      <Tooltip label={t('bots')}><button type="button" className={css.railButton} aria-label={t('bots')}
        onClick={expandSidebar}><IconAgentPresetOutlineRegular size={18} /></button></Tooltip>
    </div>}
  </section>
}
