/** Compact organization entry points; all account and administration forms open in a centered dialog. */
import { useState } from 'react'
import { Button, IconUsersOutlineRegular, IconChevronRightOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRuntime, PropsRenderFactories } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-personal/client'
import type { OrganizationProps } from './contract.ts'
import { OrganizationDialog } from './OrganizationDialog.tsx'
import css from './Organization.module.css'

/** @param props - Native mode controls and localized copy. @returns Header selector and centered organization dialog. */
export function OrganizationModeSwitch(props: OrganizationProps) {
  const c = props.useOrganization(s => s.connection)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState(false)
  const [busy, setBusy] = useState(false)
  const personal = async () => {
    setBusy(true)
    try { await props.connection({ kind: 'personal' }); setError(false) }
    catch (_error) { setError(true) }
    finally { setBusy(false) }
  }
  return <>
    <div className={css.switcher} role="group" aria-label={props.t('viewMode')}>
      <Button title={props.t('personal')} size="sm" aria-pressed={c.mode === 'personal'} disabled={busy} onClick={() => { void personal() }}>{props.t('personal')}</Button>
      <Button title={props.t('title')} size="sm" aria-pressed={c.mode === 'organization'} onClick={() => { setOpen(true) }}>{props.t('title')}</Button>
    </div>
    {error && <p role="alert" className={css.error}>{props.t('failure')}</p>}
    {open && <OrganizationDialog {...props} initialSection={c.organizationId ? 'projects' : 'connection'} onClose={() => { setOpen(false) }} />}
  </>
}

/** @param props - Organization facts and personal factory seat. @returns Navigation and centered workspace dialog. */
export function OrganizationSidebar(props: OrganizationProps & PropsRuntime<'sidebar.personal'> & PropsRenderFactories) {
  const c = props.useOrganization(s => s.connection)
  const [open, setOpen] = useState(false)
  const org = c.organizations.find(item => item.id === c.organizationId)
  return <div className={css.sidebar}>
    {c.mode === 'organization'
      ? <div className={css.sidebarSummary}>
        <button className={css.organizationEntry} onClick={() => { setOpen(true) }}>
          <span className={css.avatar}><IconUsersOutlineRegular size={18} /></span>
          <span className={css.entryText}><strong>{org?.name ?? props.t('title')}</strong><small>{props.t(c.phase)}</small></span>
          <IconChevronRightOutlineRegular size={14} />
        </button>
        <p className={css.muted}>{props.t('scope')}</p>
        <Button variant="outline" onClick={() => { setOpen(true) }}>{props.t('openWorkspace')}</Button>
      </div>
      : props.renderFactorySlot('personal.manager', { wide: props.wide, expandSidebar: props.expandSidebar })}
    {open && <OrganizationDialog {...props} initialSection={c.organizationId ? 'projects' : 'connection'} onClose={() => { setOpen(false) }} />}
  </div>
}

/** @param props - Native controls and localized copy. @returns Settings summary with focused dialog entry points. */
export function OrganizationSettings(props: OrganizationProps) {
  const state = props.useOrganization(s => s)
  const [section, setSection] = useState<'connection' | 'server' | null>(null)
  return <section className={css.settings}>
    <div className={css.heading}><span className={css.avatar}><IconUsersOutlineRegular size={24} /></span><div><h2>{props.t('settings')}</h2><p>{props.t('settingsDescription')}</p></div></div>
    <div className={css.launchGrid}>
      <button className={css.launchCard} onClick={() => { setSection('connection') }}>
        <span className={css.eyebrow}>{props.t(state.connection.phase)}</span><strong>{props.t('account')}</strong><span>{props.t('accountDescription')}</span><span className={css.cardLink}>{props.t('manage')}<IconChevronRightOutlineRegular /></span>
      </button>
      <button className={css.launchCard} onClick={() => { setSection('server') }}>
        <span className={css.eyebrow}>{props.t(state.server.phase)}</span><strong>{props.t('server')}</strong><span>{props.t('serverDescription')}</span><span className={css.cardLink}>{props.t('configure')}<IconChevronRightOutlineRegular /></span>
      </button>
    </div>
    {section && <OrganizationDialog {...props} initialSection={section} onClose={() => { setSection(null) }} />}
  </section>
}
