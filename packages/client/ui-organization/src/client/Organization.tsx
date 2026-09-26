/** Forms consume native snapshots; personal sessions remain owned by the existing personal factory. */
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import { useEffect, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRuntime, PropsRenderFactories } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-personal/client'
import type { OrganizationProps } from './contract.ts'
import type { ConnectionAction, ConnectionResult, OrganizationServerAction } from '@deepseek-ai/dsh-organization-connection/types'
import type { OrganizationKey } from './locales.ts'
import { zh } from './locales.ts'
import css from './Organization.module.css'

/** @param props - Framework organization facts and personal factory seat. @returns Mode switch and the selected navigation. */
export function OrganizationSidebar(props: OrganizationProps & PropsRuntime<'sidebar.personal'> & PropsRenderFactories) {
  const state = props.useOrganization(s => s.connection)
  const [show, setShow] = useState(false)
  return <div className={css.panel}>
    <div className={css.row}>
      <Button variant="ghost" onClick={() => { setShow(false); void props.connection({ kind: 'personal' }).catch(() => {}) }}>{props.t('personal')}</Button>
      <Button variant="ghost" onClick={() => { setShow(true) }}>{props.t('organization')}</Button>
    </div>
    {show || state.mode === 'organization' ? <OrganizationView {...props} /> : props.renderFactorySlot('personal.manager', { wide: props.wide, expandSidebar: props.expandSidebar })}
  </div>
}

/** @param props - Native controls and localized copy. @returns Full organization settings. */
export function OrganizationSettings(props: OrganizationProps) {
  return <section className={css.panel}><h2>{props.t('settings')}</h2><OrganizationView {...props} management /></section>
}
function OrganizationView(props: OrganizationProps & { management?: boolean }) {
  const { t } = props
  const state = props.useOrganization(s => s)
  const c = state.connection
  const offer = c.offer
  const projects = c.projects
  const [fields, setFields] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [secret, setSecret] = useState('')
  const [invitation, setInvitation] = useState('')
  const [saved, setSaved] = useState(false)
  const [autoStart, setAutoStart] = useState(state.server.settings.restoreOnLaunch)
  const value = (key: string) => fields[key] ?? ''
  const set = (key: string, text: string) => { setFields(previous => ({ ...previous, [key]: text })) }
  useEffect(() => { setInvitation(''); setMessage(''); setFields({}) }, [c.principal?.accountId, c.principal?.serverId, c.organizationId])
  useEffect(() => { setAutoStart(state.server.settings.restoreOnLaunch) }, [state.server.settings.restoreOnLaunch])
  const labelError = (error: unknown) => {
    const message = error instanceof Error ? error.message : ''
    const code = Object.keys(zh).find(key => message === key || message.endsWith(`: ${key}`)) as OrganizationKey | undefined
    return t(code ?? 'failure')
  }
  const run = async (operation: () => Promise<unknown>) => {
    setBusy(true); setMessage('')
    try { await operation(); setMessage(t('success')) }
    catch (error) { setMessage(labelError(error)) }
    finally { setBusy(false) }
  }
  const connect = async (action: ConnectionAction) => {
    const result: ConnectionResult = await props.connection(action)
    if (result.invitationToken) setInvitation(result.invitationToken)
    if (result.receipt?.projectId) set('projectId', result.receipt.projectId)
    setFields(previous => ({ ...previous, password: '', newPassword: '' }))
    return result
  }
  const server = async (action: OrganizationServerAction) => {
    const result = await props.server(action)
    if (result.recoveryToken) { setSecret(result.recoveryToken); setSaved(false) }
    if (result.path) set('resultPath', result.path)
    setFields(previous => ({ ...previous, password: '', newPassword: '' }))
  }
  const command = (body: Record<string, unknown>) => connect({ kind: 'command', command: { operationId: randomUUID(), ...body } })
  const input = (key: OrganizationKey, type = 'text', fallback = '') =>
    <label className={css.field}>{t(key)}
      <input type={type} value={fields[key] ?? fallback} onChange={(event) => { set(key, event.target.value) }} /></label>
  const button = (key: OrganizationKey, work: () => Promise<unknown>, disabled = false) =>
    <Button disabled={busy || disabled} onClick={() => { void run(work) }}>{t(key)}</Button>
  const org = c.organizations.find(item => item.id === c.organizationId)
  const writable = c.phase === 'ready' && !c.pendingOperation
  const grant = async (actions: ('read' | 'write')[]) => {
    const projectId = value('projectId'); const membershipId = value('memberId')
    const result = await connect({ kind: 'grants', projectId })
    const expectedVersion = result.grants?.find(row => row.membershipId === membershipId)?.version ?? 0
    await command({ kind: 'set-grant', organizationId: c.organizationId, projectId, membershipId, expectedVersion, actions })
  }
  if (!props.available) return <p>{t('desktopOnly')}</p>
  return <div className={css.panel}>
    <p>{t('scope')}</p>
    <p role="status">{t(c.phase)} {c.origin} {c.username}</p>
    {c.principal && <small>{c.principal.serverId} / {c.principal.accountId}</small>}
    {c.error && <p role="alert">{labelError(new Error(c.error))}</p>}
    {message && <p role="status">{message}</p>}
    {secret && <label>{t('recovery')}<output className={css.secret}>{secret}</output></label>}
    {invitation && <label>{t('invitation')}<output className={css.secret}>{invitation}</output></label>}
    {value('resultPath') && <output>{value('resultPath')}</output>}
    <fieldset disabled={busy}><legend>{t('connection')}</legend>
      {input('origin', 'url', c.origin ?? '')}
      {button('probe', () => connect({ kind: 'probe', origin: fields.origin ?? c.origin ?? '' }))}
      {offer && <><p>{t('verify')}</p><output className={css.secret}>{offer.fingerprint}</output><p>{new Date(offer.expiresAt).toLocaleString()}</p>{button('trust', () => connect({ kind: 'trust', fingerprint: offer.fingerprint }))}</>}
      {input('username')}{input('password', 'password')}
      {button('login', () => connect({ kind: 'login', username: value('username'), password: value('password') }), ['untrusted', 'disconnected'].includes(c.phase))}
      {button('logout', () => connect({ kind: 'logout' }))}{button('reconnect', () => connect({ kind: 'reconnect' }), !c.principal)}
      {input('invitation')}
      {button('register', () => connect({ kind: 'register', invitationToken: value('invitation'), username: value('username'), password: value('password') }), !['signed-out', 'ready'].includes(c.phase))}
      {button('accept', () => command({ kind: 'accept-invitation', invitationToken: value('invitation') }), !writable)}
    </fieldset>
    {!!c.organizations.length && <label className={css.field}>{t('choose')}<select value={c.organizationId ?? ''} disabled={busy} onChange={(event) => {
      const selected = c.organizations.find(item => item.id === event.target.value)
      if (selected) void run(() => connect({ kind: 'select', organizationId: selected.id }))
    }}><option value="">{t('choose')}</option>{c.organizations.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
    {c.pendingOperation && <div><p>{t('pending')}</p>{button('reconcile', () => connect({ kind: 'reconcile' }), !c.principal)}</div>}
    {c.organizationId && <>
      {input('search')}{button('search', () => connect({ kind: 'search', query: value('search'), offset: 0 }), c.phase !== 'ready')}
      {projects && <><p>{t('total', { count: projects.total })}</p><ul>{projects.items.map(project => <li key={project.id}>{project.name}<small>{project.id}</small></li>)}</ul>
        {!projects.items.length && <p>{t('empty')}</p>}
        {button('previous', () => connect({ kind: 'search', query: value('search'), offset: 0 }), projects.offset === 0)}
        {button('next', () => connect({ kind: 'search', query: value('search'), offset: projects.offset + projects.items.length }), projects.offset + projects.items.length >= projects.total)}
      </>}
    </>}
    {props.management && <>
      {input('orgName')}{button('createOrg', () => command({ kind: 'create-organization', name: value('orgName') }), !writable)}
      {input('newPassword', 'password')}{button('passwordChange', () => command({ kind: 'change-password', currentPassword: value('password'), newPassword: value('newPassword') }), !writable)}
      {org?.role === 'admin' && <fieldset disabled={busy || !writable}><legend>{t('members')}</legend>
        {button('invite', () => connect({ kind: 'invite', role: 'member' }))}{button('inviteAdmin', () => connect({ kind: 'invite', role: 'admin' }))}
        <ul>{c.members.map(member => <li key={member.id}>{member.username} / {t(member.role === 'admin' ? 'admin' : 'member')}
          {button(member.enabled ? 'disable' : 'enable', () => command({ kind: 'set-membership', organizationId: c.organizationId, membershipId: member.id, expectedVersion: member.version, role: member.role, enabled: !member.enabled }))}
          {button(member.role === 'admin' ? 'member' : 'admin', () => command({ kind: 'set-membership', organizationId: c.organizationId, membershipId: member.id, expectedVersion: member.version, role: member.role === 'admin' ? 'member' : 'admin', enabled: member.enabled }))}
          {button(member.accountEnabled ? 'disableAccount' : 'enableAccount', () => command({ kind: 'set-account', accountId: member.accountId, expectedVersion: member.accountVersion, enabled: !member.accountEnabled }))}
        </li>)}</ul>
        {input('projectName')}{button('createProject', () => command({ kind: 'create-project', organizationId: c.organizationId, name: value('projectName') }))}
        {input('projectId')}<label className={css.field}>{t('memberId')}<select value={value('memberId')} onChange={(event) => { set('memberId', event.target.value) }}><option value="">{t('memberId')}</option>{c.members.map(member => <option key={member.id} value={member.id}>{member.username}</option>)}</select></label>
        {button('read', () => grant(['read']))}{button('write', () => grant(['read', 'write']))}{button('revoke', () => grant([]))}
      </fieldset>}
      <fieldset disabled={busy}><legend>{t('server')}</legend>
        <p>{t(state.server.phase)}</p><p>{t('stopNotice')}</p>
        {input('host', 'text', state.server.settings.host)}{input('port', 'number', String(state.server.settings.port))}{input('names', 'text', state.server.settings.names.join(','))}
        <label><input type="checkbox" checked={autoStart} onChange={(event) => { setAutoStart(event.target.checked) }} />{t('autoStart')}</label>
        {button('save', () => server({ kind: 'configure', settings: { host: fields.host ?? state.server.settings.host, port: Number(fields.port ?? state.server.settings.port), names: (fields.names ?? state.server.settings.names.join(',')).split(',').map(name => name.trim()), restoreOnLaunch: autoStart } }))}
        {button('start', () => server({ kind: 'start' }))}{button('stop', () => server({ kind: 'stop' }))}
        {state.server.fingerprint && <><p>{t('fingerprint')}</p><output className={css.secret}>{state.server.fingerprint}</output><p>{t('expiry')} {state.server.expiresAt === undefined ? '' : new Date(state.server.expiresAt).toLocaleString()}</p></>}
        {state.server.renewalDue && <p>{t('renewal')}</p>}
        {button('secret', async () => { setSecret(await props.secret()); setSaved(false) })}
        <label><input type="checkbox" checked={saved} onChange={(event) => { setSaved(event.target.checked) }} />{t('savedSecret')}</label>
        {button('initialize', () => server({ kind: 'initialize', username: value('username'), password: value('password'), organizationName: value('orgName'), recoveryToken: secret }), !saved || !secret || state.server.phase !== 'ready')}
        {input('oldRecovery', 'password')}
        {button('recover', () => server({ kind: 'recover', recoveryToken: value('oldRecovery'), newRecoveryToken: secret, newPassword: value('newPassword') }), !saved || !secret || state.server.phase !== 'ready')}
        {button('backup', () => server({ kind: 'backup' }))}
        {button('restore', async () => { if (globalThis.confirm(t('restoreConfirm'))) await server({ kind: 'restore' }) })}
        {button('rotate', () => server({ kind: 'rotate-certificate' }))}
      </fieldset>
    </>}
  </div>
}
