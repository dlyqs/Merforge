/** Organization workspace with task-specific forms, native operations and localized feedback. */
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Button, Input, Modal, IconUsersOutlineRegular, IconFolderCloseRegular, IconChevronLeftOutlineRegular, IconSearchOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { OrganizationProps } from './contract.ts'
import type { ConnectionAction, OrganizationServerAction } from '@deepseek-ai/dsh-organization-connection/types'
import type { OrganizationKey } from './locales.ts'
import { zh } from './locales.ts'
import css from './Organization.module.css'
import { OrganizationHierarchy } from './Hierarchy.tsx'
import { ProjectAccess } from './ProjectAccess.tsx'
type Section = 'connection' | 'projects' | 'members' | 'server' | 'hierarchy'
type Task = 'login' | 'register' | 'accept' | 'createOrg' | 'passwordChange' | 'createProject' | 'permissions' | 'configure' | 'initialize' | 'recover' | 'restore'

/** @param props - Framework facts, initial section and dismissal callback. @returns Centered organization management workspace. */
export function OrganizationDialog(props: OrganizationProps & { initialSection: Section; onClose: () => void }) {
  const c = props.useOrganization(s => s.connection)
  return <OrganizationDialogBody key={[c.principal?.serverId, c.principal?.accountId, c.organizationId, c.mode].join(':')} {...props} />
}

function OrganizationDialogBody(props: OrganizationProps & { initialSection: Section; onClose: () => void }) {
  const { t } = props
  const state = props.useOrganization(s => s)
  const c = state.connection
  const offer = c.offer
  const projects = c.projects
  const stopped = state.server.phase === 'disabled' || state.server.phase === 'failed'
  const org = c.organizations.find(item => item.id === c.organizationId)
  const [section, setSection] = useState<Section>(props.initialSection)
  const [task, setTask] = useState<Task | null>(null)
  const [visiblePasswords, setVisiblePasswords] = useState<Record<string, boolean>>({})
  const [fields, setFields] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null)
  const [secret, setSecret] = useState('')
  const [invitation, setInvitation] = useState('')
  const [saved, setSaved] = useState(false)
  const [autoStart, setAutoStart] = useState(state.server.settings.restoreOnLaunch)
  const root = useRef<HTMLDivElement>(null)
  const focusTarget = useRef<HTMLHeadingElement>(null)
  const value = (key: string) => fields[key] ?? ''
  const set = (key: string, text: string) => { setNotice(null); setFields(previous => ({ ...previous, [key]: text })) }
  useEffect(() => { setInvitation(''); setNotice(null); setFields({}) }, [c.principal?.accountId, c.principal?.serverId, c.organizationId])
  useEffect(() => { setAutoStart(state.server.settings.restoreOnLaunch) }, [state.server.settings.restoreOnLaunch])
  useEffect(() => {
    const previous = document.activeElement
    focusTarget.current?.focus()
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus() }
  }, [])
  useEffect(() => { focusTarget.current?.focus() }, [section, task])
  const labelError = (error: unknown) => {
    const message = error instanceof Error ? error.message : ''
    const code = Object.keys(zh).find(key => message === key || message.endsWith(`: ${key}`)) as OrganizationKey | undefined
    return t(code ?? 'failure')
  }
  useEffect(() => {
    if (c.error) setNotice({ text: labelError(new Error(c.error)), error: true })
  }, [c.error])
  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => { setNotice(null) }, 6000)
    return () => { clearTimeout(timer) }
  }, [notice])
  useEffect(() => {
    const origin = c.origin
    if (origin) setFields(previous => ({ ...previous, origin }))
  }, [c.origin])
  const run = async (operation: () => Promise<unknown>) => {
    setBusy(true); setNotice(null)
    try { await operation(); setNotice({ text: t('success'), error: false }) }
    catch (error) { setNotice({ text: labelError(error), error: true }) }
    finally { setBusy(false) }
  }
  const connect = async (action: ConnectionAction) => {
    const result = await props.connection(action)
    if (result.invitationToken) setInvitation(result.invitationToken)
    if (result.receipt?.projectId) set('projectId', result.receipt.projectId)
    setFields(previous => ({ ...previous, password: '', newPassword: '', confirmPassword: '' }))
    return result
  }
  const server = async (action: OrganizationServerAction) => {
    const result = await props.server(action)
    if (result.recoveryToken) { setSecret(result.recoveryToken); setSaved(false) }
    if (result.path) set('resultPath', result.path)
    setFields(previous => ({ ...previous, password: '', newPassword: '', confirmPassword: '', oldRecovery: '' }))
  }
  const command = (body: Record<string, unknown>) => connect({ kind: 'command', command: { operationId: randomUUID(), ...body } })
  const input = (key: OrganizationKey, type = 'text', fallback = '') =>
    <div className={css.field}><label htmlFor={`organization-${key}`}>{t(key)}</label>
      <div className={type === 'password' ? css.passwordField : undefined}>
        <Input id={`organization-${key}`} className={css.input ?? ''} disabled={busy} type={type === 'password' && visiblePasswords[key] ? 'text' : type} value={fields[key] ?? fallback}
          autoComplete={key === 'username' ? 'username' : type === 'password' ? key === 'password' && (task === 'login' || task === 'passwordChange') ? 'current-password' : 'new-password' : 'off'}
          onChange={(event) => { set(key, event.target.value) }} />
        {type === 'password' && <button type="button" className={css.passwordToggle} disabled={busy}
          aria-label={t(visiblePasswords[key] ? 'hidePassword' : 'showPassword')} aria-pressed={!!visiblePasswords[key]}
          onClick={() => { setVisiblePasswords(previous => ({ ...previous, [key]: !previous[key] })) }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
            <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" />
            {visiblePasswords[key] && <path d="m3 3 18 18" />}
          </svg>
        </button>}
      </div></div>
  const confirmation = (key: 'password' | 'newPassword') => <>{input('confirmPassword', 'password')}
    {value('confirmPassword') && value('confirmPassword') !== value(key) && <p role="alert" className={css.error}>{t('passwordMismatch')}</p>}</>
  const button = (key: OrganizationKey, work: () => Promise<unknown>, disabled = false, primary = false) =>
    <Button variant={primary ? 'primary' : 'outline'} disabled={busy || disabled} onClick={() => { void run(work) }}>{t(key)}</Button>
  const navigate = (next: Task | null) => { setTask(next); setNotice(null); setInvitation(''); setSecret(''); setSaved(false); setVisiblePasswords({}); setFields({}) }
  const launch = (next: Task, disabled = false) => <Button variant="outline" disabled={busy || disabled} onClick={() => { navigate(next) }}>{t(next)}</Button>
  const writable = c.phase === 'ready' && !c.pendingOperation
  const admin = org?.role === 'admin'
  useEffect(() => { if (!admin && section === 'members') { setSection('projects'); navigate(null) } }, [admin, section])
  const form = (submit: () => Promise<unknown>, children: ReactNode, disabled = false) => <form onSubmit={(event) => {
    event.preventDefault()
    if (!busy && !disabled) void run(submit)
  }}>
    <fieldset className={css.form} disabled={busy}>{children}<div className={css.formFooter}><Button disabled={busy} onClick={() => { navigate(null) }}>{t('cancel')}</Button><Button type="submit" variant="primary" disabled={busy || disabled}>{t(busy ? 'working' : task === 'configure' ? 'save' : task ?? 'submit')}</Button></div></fieldset>
  </form>
  const recovery = <><div className={css.notice}>{t('recoveryHint')}</div>{button('secret', async () => { setSecret(await props.secret()); setSaved(false) })}
    {secret && <label className={css.field}>{t('recovery')}<output className={css.secret}>{secret}</output></label>}
    <label className={css.check}><input type="checkbox" checked={saved} onChange={(event) => { setSaved(event.target.checked) }} />{t('savedSecret')}</label></>
  const sectionLabels: Record<Section, OrganizationKey> = { hierarchy: 'hierarchyTitle', connection: 'account', projects: 'projects', members: 'members', server: 'server' }
  return <Modal open title={t('workspace')} closeLabel={t('close')} onClose={() => { if (!busy) props.onClose() }} className={css.dialog ?? ''} contentClassName={css.dialogContent ?? ''}
    onKeyDownCapture={(event) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        if (!busy) props.onClose()
        return
      }
      if (event.key !== 'Tab') return
      const dialog = root.current?.closest('[role="dialog"]')
      const selector = 'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), summary, [tabindex="0"]'
      const controls = Array.from(dialog?.querySelectorAll<HTMLElement>(selector) ?? [])
        .filter(element => element.getClientRects().length > 0)
      const first = controls[0]; const last = controls.at(-1)
      if (event.shiftKey && (document.activeElement === first || document.activeElement === focusTarget.current)) {
        event.preventDefault()
        last?.focus()
      }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }}>
    <div ref={root} className={css.workspace} aria-busy={busy}>
      <div className={css.workspaceHeader}><div className={css.identity}><span className={css.avatar}><IconUsersOutlineRegular size={22} /></span><div><strong>{org?.name ?? t('title')}</strong><p>{c.username ?? t('welcome')}</p></div></div><span className={css.status} data-online={c.phase === 'ready'}>{t(c.phase)}</span></div>
      <nav className={css.tabs} aria-label={t('workspace')}>
        {(['projects', 'hierarchy', 'members', 'connection', 'server'] as const).filter(item => item !== 'members' || admin).map(item => <button key={item} aria-current={section === item ? 'page' : undefined} disabled={busy} onClick={() => { setSection(item)
          navigate(null) }}>{t(sectionLabels[item])}</button>)}
      </nav>
      <div className={css.content}>
        <div className={css.sectionHeading}>{task && <Button size="sm" aria-label={t('back')} icon={<IconChevronLeftOutlineRegular />} disabled={busy} onClick={() => { navigate(null) }} />}<h3 ref={focusTarget} tabIndex={-1}>{t(task ?? sectionLabels[section])}</h3></div>
        {!props.available ? <p className={css.empty}>{t('desktopOnly')}</p> : <>
          {notice && <p className={notice.error ? css.error : css.notice} role={notice.error ? 'alert' : 'status'}>{notice.text} <Button size="sm" onClick={() => { setNotice(null) }}>{t('close')}</Button></p>}
          {busy && <p className={css.muted} role="status">{t('working')}</p>}
          {c.pendingOperation && <div className={css.notice}><p>{t('pending')}</p>{button('reconcile', () => connect({ kind: 'reconcile' }), !c.principal)}</div>}
          {invitation && <label className={css.field}>{t('invitation')}<output className={css.secret}>{invitation}</output><small>{t('invitationHint')}</small></label>}
          {value('resultPath') && <output className={css.secret}>{value('resultPath')}</output>}
          {section === 'connection' && (!task || task === 'login' || task === 'register') && <>
            <section className={css.card}><p className={css.muted}>{t('connectHint')}</p>{input('origin', 'url', c.origin ?? '')}{button('probe', () => connect({ kind: 'probe', origin: fields.origin ?? c.origin ?? '' }), !(fields.origin ?? c.origin), true)}
              {offer && <div className={css.notice}><p>{t('verify')}</p><output className={css.secret}>{offer.fingerprint}</output><p>{t('expiry')} {new Date(offer.expiresAt).toLocaleString()}</p>{button('trust', () => connect({ kind: 'trust', fingerprint: offer.fingerprint }))}</div>}
            </section>
          </>}
          {!task && section === 'connection' && <>
            <p className={css.muted}>{t('accountDescription')}</p>
            <section className={css.card}><div className={css.cardHeading}><h4>{t('connection')}</h4><span className={css.status}>{t(c.phase)}</span></div>
              <p className={css.muted}>{c.origin ?? t('connectHint')}</p>
              <div className={css.actions}>{launch('login', !['signed-out', 'ready'].includes(c.phase))}{launch('register', !['signed-out', 'ready'].includes(c.phase))}{button('reconnect', () => connect({ kind: 'reconnect' }), !c.principal)}</div>
            </section>
            {!!c.organizations.length && <label className={css.field}>{t('choose')}<select value={c.organizationId ?? ''} disabled={busy} onChange={(event) => {
              const selected = c.organizations.find(item => item.id === event.target.value)
              if (selected) void run(() => connect({ kind: 'select', organizationId: selected.id }))
            }}><option value="">{t('choose')}</option>{c.organizations.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
            <div className={css.actions}>{launch('createOrg', !writable)}{launch('accept', !writable)}{launch('passwordChange', !writable)}{c.principal && button('logout', () => connect({ kind: 'logout' }))}</div>
          </>}
          {task === 'login' && <>
            {form(() => connect({ kind: 'login', username: value('username'), password: value('password') }), <>{input('username')}{input('password', 'password')}</>, !['signed-out', 'ready'].includes(c.phase) || !value('username') || !value('password'))}
          </>}
          {task === 'register' && form(() => connect({ kind: 'register', invitationToken: value('invitation'), username: value('username'), password: value('password') }), <><p className={css.muted}>{t('registerHint')}</p>{input('invitation')}{input('username')}{input('password', 'password')}{confirmation('password')}</>, !['signed-out', 'ready'].includes(c.phase) || !value('invitation') || !value('username') || value('password').length < 8 || value('password') !== value('confirmPassword'))}
          {task === 'accept' && form(() => command({ kind: 'accept-invitation', invitationToken: value('invitation') }), input('invitation'), !writable || !value('invitation'))}
          {task === 'createOrg' && form(() => command({ kind: 'create-organization', name: value('orgName') }), input('orgName'), !writable || !value('orgName').trim())}
          {task === 'passwordChange' && form(() => command({ kind: 'change-password', currentPassword: value('password'), newPassword: value('newPassword') }), <>{input('password', 'password')}{input('newPassword', 'password')}{confirmation('newPassword')}</>, !writable || !value('password') || value('newPassword').length < 8 || value('newPassword') !== value('confirmPassword'))}
          {!task && section === 'hierarchy' && <OrganizationHierarchy {...props} />}
          {!task && section === 'projects' && <>
            <p className={css.muted}>{t('scope')}</p>
            {!c.organizationId ? <p className={css.empty}>{t('chooseHint')}</p> : <>
              <form className={css.search} onSubmit={(event) => { event.preventDefault(); if (!busy && c.phase === 'ready') void run(() => connect({ kind: 'search', query: value('search'), offset: 0 })) }}><Input className={css.input ?? ''} icon={<IconSearchOutlineRegular />} aria-label={t('search')} placeholder={t('search')} value={value('search')} onChange={(event) => { set('search', event.target.value) }} /><Button type="submit" variant="outline" disabled={busy || c.phase !== 'ready'}>{t('searchAction')}</Button></form>
              <div className={css.actions}>{launch('createProject', !writable)}</div>
              {admin && <details className={css.advanced}><summary>{t('advancedAccess')}</summary>{launch('permissions', !writable)}</details>}
              {projects && <><div className={css.projectGrid}><p className={css.eyebrow}>{t('total', { count: projects.total })}</p>{projects.items.map(project => <div className={css.listRow} key={project.id}><span className={css.avatar}><IconFolderCloseRegular size={18} /></span><div className={css.entryText}><strong>{project.name}</strong><small>{t('projectCardHint')}</small></div><div className={css.actions}><Button variant="primary" onClick={() => { if (props.openProject) { props.openProject(project)
                props.onClose() } }}>{t('viewProject')}</Button>{admin && <Button variant="outline" onClick={() => { navigate('permissions')
                set('projectId', project.id) }}>{t('projectMembers')}</Button>}</div></div>)}{!projects.items.length && <p className={css.empty}>{t('empty')}</p>}</div>
              <div className={css.pagination}>{button('firstPage', () => connect({ kind: 'search', query: value('search'), offset: 0 }), c.phase !== 'ready' || projects.offset === 0)}{button('next', () => connect({ kind: 'search', query: value('search'), offset: projects.offset + projects.items.length }), c.phase !== 'ready' || projects.offset + projects.items.length >= projects.total)}</div></>}
            </>}
          </>}
          {task === 'createProject' && form(async () => {
            const name = value('projectName').trim()
            const content = { background: '', summary: '', goal: '' }
            const result = await command({ kind: 'create-project', organizationId: c.organizationId, name, ...content })
            navigate(null)
            if (result.receipt?.projectId && result.receipt.organizationId && c.principal) {
              const created = { id: result.receipt.projectId, organizationId: result.receipt.organizationId,
                name, ...content, version: result.receipt.revision, createdBy: c.principal.accountId }
              if (props.openProject) { props.openProject(created); props.onClose() }
            }
          }, <>{input('projectName')}<p className={css.muted}>{t('createProjectHint')}</p></>, !writable || !value('projectName').trim())}
          {task === 'permissions' && admin && <>
            <label className={css.field}>{t('chooseProject')}<select value={value('projectId')} disabled={busy} onChange={(event) => { set('projectId', event.target.value) }}>
              <option value="">{t('chooseProject')}</option>
              {value('projectId') && !projects?.items.some(item => item.id === value('projectId')) && <option value={value('projectId')}>{t('selectedProject')}</option>}
              {projects?.items.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select></label>
            {value('projectId') && <ProjectAccess key={value('projectId')} {...props} projectId={value('projectId')} />}
          </>}
          {!task && section === 'members' && <>
            <p className={css.muted}>{t('membersDescription')}</p>
            {!admin ? <p className={css.empty}>{t('adminRequired')}</p> : <>
              <div className={css.actions}>{button('invite', () => connect({ kind: 'invite', role: 'member' }), !writable, true)}{button('inviteAdmin', () => connect({ kind: 'invite', role: 'admin' }), !writable)}</div>
              <div className={css.list}>{c.members.map(member => <div className={css.memberRow} key={member.id}><div className={css.identity}><span className={css.avatar}>{member.avatarUrl ? <img src={member.avatarUrl} alt="" /> : <IconUsersOutlineRegular size={18} />}</span><div className={css.entryText}><strong>{member.username}</strong><small>{t(member.role === 'admin' ? 'adminRole' : 'memberRole')} · {t(member.enabled && member.accountEnabled ? 'activeMember' : 'disabledMember')}</small></div></div>
                <details className={css.memberActions}><summary>{t('manage')}</summary><div className={css.actions}>
                  {button(member.enabled ? 'disable' : 'enable', () => command({ kind: 'set-membership', organizationId: c.organizationId, membershipId: member.id, expectedVersion: member.version, role: member.role, enabled: !member.enabled }), !writable)}
                  {button(member.role === 'admin' ? 'member' : 'admin', () => command({ kind: 'set-membership', organizationId: c.organizationId, membershipId: member.id, expectedVersion: member.version, role: member.role === 'admin' ? 'member' : 'admin', enabled: member.enabled }), !writable)}
                  {button(member.accountEnabled ? 'disableAccount' : 'enableAccount', () => command({ kind: 'set-account', accountId: member.accountId, expectedVersion: member.accountVersion, enabled: !member.accountEnabled }), !writable)}
                </div></details></div>)}</div>
            </>}
          </>}
          {!task && section === 'server' && <>
            <section className={css.card}><div className={css.cardHeading}><h4>{t('server')}</h4><span className={css.status} data-online={state.server.phase === 'ready'}>{t(state.server.phase)}</span></div><p className={css.muted}>{t('stopNotice')}</p><div className={css.actions}>{button('start', () => server({ kind: 'start' }), state.server.phase === 'ready' || state.server.phase === 'starting' || state.server.phase === 'stopping', true)}{button('stop', () => server({ kind: 'stop' }), state.server.phase === 'disabled' || state.server.phase === 'stopping')}{launch('configure', !stopped)}</div></section>
            <div className={css.actions}>{launch('initialize', state.server.phase !== 'ready')}{launch('recover', state.server.phase !== 'ready')}</div>
            {state.server.fingerprint && <details className={css.details}><summary>{t('fingerprint')}</summary><output className={css.secret}>{state.server.fingerprint}</output><p className={css.muted}>{t('expiry')} {state.server.expiresAt === undefined ? '' : new Date(state.server.expiresAt).toLocaleString()}</p></details>}
            {state.server.renewalDue && <p className={css.notice}>{t('renewal')}</p>}
            <section className={css.card}><h4>{t('maintenance')}</h4><p className={css.muted}>{t('maintenanceHint')}</p><div className={css.actions}>{button('backup', () => server({ kind: 'backup' }), !stopped)}{launch('restore', !stopped)}{button('rotate', () => server({ kind: 'rotate-certificate' }), !stopped)}</div></section>
          </>}
          {task === 'configure' && form(() => server({ kind: 'configure', settings: { host: fields.host ?? state.server.settings.host, port: Number(fields.port ?? state.server.settings.port), names: (fields.names ?? state.server.settings.names.join(',')).split(',').map(name => name.trim()), restoreOnLaunch: autoStart } }), <div className={css.fieldsGrid}>{input('host', 'text', state.server.settings.host)}{input('port', 'number', String(state.server.settings.port))}<div className={css.fullWidth}>{input('names', 'text', state.server.settings.names.join(','))}</div><label className={css.check}><input type="checkbox" checked={autoStart} onChange={(event) => { setAutoStart(event.target.checked) }} />{t('autoStart')}</label></div>, !stopped)}
          {task === 'initialize' && form(() => server({ kind: 'initialize', username: value('username'), password: value('password'), organizationName: value('orgName'), recoveryToken: secret }), <>{input('orgName')}<div className={css.fieldsGrid}>{input('username')}{input('password', 'password')}{confirmation('password')}</div>{recovery}</>, !saved || !secret || state.server.phase !== 'ready' || !value('orgName').trim() || !value('username') || value('password').length < 8 || value('password') !== value('confirmPassword'))}
          {task === 'recover' && form(() => server({ kind: 'recover', recoveryToken: value('oldRecovery'), newRecoveryToken: secret, newPassword: value('newPassword') }), <>{input('oldRecovery', 'password')}{input('newPassword', 'password')}{confirmation('newPassword')}{recovery}</>, !saved || !secret || state.server.phase !== 'ready' || !value('oldRecovery') || value('newPassword').length < 8 || value('newPassword') !== value('confirmPassword'))}
          {task === 'restore' && <><p className={css.notice}>{t('restoreConfirm')}</p>{button('restore', () => server({ kind: 'restore' }), !stopped, true)}{secret && <label className={css.field}>{t('recovery')}<output className={css.secret}>{secret}</output><small>{t('recoveryHint')}</small></label>}</>}
        </>}
      </div>
    </div>
  </Modal>
}
