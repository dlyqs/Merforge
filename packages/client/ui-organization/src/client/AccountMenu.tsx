/** Account identity and explicit personal/organization workspace selection. */
import { useEffect, useRef, useState } from 'react'
import { Button, Modal, IconUserOutlineRegular, IconUsersOutlineRegular, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { OrganizationProps } from './contract.ts'
import { OrganizationDialog } from './OrganizationDialog.tsx'
import { avatarFileError } from './avatar-file.ts'
import type { OrganizationKey } from './locales.ts'
import { AvatarCrop } from './AvatarCrop.tsx'
import css from './AccountMenu.module.css'

/** @param props - Native account snapshot, commands and localized copy. @returns Avatar and centered account dialog. */
export function AccountMenu(props: OrganizationProps) {
  const c = props.useOrganization(s => s.connection)
  const [view, setView] = useState<'closed' | 'account' | 'manage'>('closed')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<OrganizationKey | null>(null)
  const [file, setFile] = useState<File>()
  const [personalAvatar, setPersonalAvatar] = useState(() => localStorage.getItem('merforge.personal.avatar'))
  const picker = useRef<HTMLInputElement>(null)
  const avatarUrl = c.principal ? c.avatarUrl : personalAvatar
  const saveAvatar = async (url: string) => {
    setBusy(true)
    try {
      if (c.principal) await props.connection({ kind: 'set-avatar', avatarUrl: url })
      else { localStorage.setItem('merforge.personal.avatar', url); setPersonalAvatar(url) }
      setFile(undefined)
    } finally { setBusy(false) }
  }
  useEffect(() => { setFile(undefined) }, [c.identityGeneration])
  const avatar = useRef<HTMLButtonElement>(null)
  const identity = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (view !== 'account') return
    identity.current?.focus()
    return () => { avatar.current?.focus() }
  }, [view])
  const close = () => { if (!busy) setView('closed') }
  const select = async (action: Parameters<OrganizationProps['connection']>[0]) => {
    setBusy(true)
    setError(null)
    try { await props.connection(action); setView('closed') }
    catch (_error) { setError('failure') }
    finally { setBusy(false) }
  }
  return <>
    <Tooltip label={props.t('accountCenter')} side="right"><button ref={avatar} type="button" className={css.avatar}
      aria-label={props.t('accountCenter')} aria-haspopup="dialog" aria-expanded={view !== 'closed'}
      onClick={() => { setError(null); setView('account') }}>{avatarUrl ? <img src={avatarUrl} alt="" /> : <IconUserOutlineRegular size={22} />}</button></Tooltip>
    <Modal open={view === 'account' && !file} onClose={close} title={props.t('accountCenter')} closeLabel={props.t('close')}
      className={css.dialog ?? ''} onKeyDownCapture={(event) => {
        if (event.key !== 'Tab') return
        const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), [tabindex="0"]'))
        const first = controls[0]
        const last = controls.at(-1)
        if (event.shiftKey && (document.activeElement === first || document.activeElement === identity.current)) {
          event.preventDefault(); last?.focus()
        } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
      }}>
      <div className={css.content} aria-busy={busy}>
        <div ref={identity} tabIndex={-1} className={css.identity}>
          <button type="button" className={css.portrait} disabled={busy || !!c.principal && c.phase !== 'ready'} aria-label={props.t('changeAvatar')} title={props.t('avatarFormatsHint')}
            onClick={() => { picker.current?.click() }}>{avatarUrl ? <img src={avatarUrl} alt="" /> : <IconUserOutlineRegular size={28} />}</button>
          <div><strong>{c.username ?? props.t('personal')}</strong><small>{props.t(c.phase)}</small></div>
        </div>
        <span className={css.caption}>{props.t('spaces')}</span>
        <div className={css.spaces}>
          <button type="button" className={css.space} aria-pressed={c.mode === 'personal'} disabled={busy}
            onClick={() => { void select({ kind: 'personal' }) }}>
            <IconUserOutlineRegular size={21} /><span><strong>{props.t('personal')}</strong><small>{props.t('personalDescription')}</small></span>
            {c.mode === 'personal' && <span className={css.selected}>{props.t('currentSpace')}</span>}
          </button>
          {c.organizations.map(org => <button key={org.id} type="button" className={css.space}
            aria-pressed={c.mode === 'organization' && c.organizationId === org.id} disabled={busy || c.phase !== 'ready'}
            onClick={() => { void select({ kind: 'select', organizationId: org.id }) }}>
            <IconUsersOutlineRegular size={21} /><span><strong>{org.name}</strong><small>{props.t(org.role === 'admin' ? 'adminRole' : 'memberRole')}</small></span>
            {c.mode === 'organization' && c.organizationId === org.id && <span className={css.selected}>{props.t('currentSpace')}</span>}
          </button>)}
        </div>
        {error && <p role="alert">{props.t(error)}</p>}
        <Button variant="outline" disabled={busy} onClick={() => { setView('manage') }}>{props.t('account')}</Button>
      </div>
    </Modal>
    <input ref={picker} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/bmp,image/avif,image/x-icon,image/vnd.microsoft.icon,.png,.jpg,.jpeg,.jfif,.webp,.gif,.bmp,.avif,.ico" hidden onChange={(event) => {
      const selected = event.target.files?.[0]
      event.target.value = ''
      if (!selected) return
      const rejection = avatarFileError(selected)
      setError(rejection)
      if (rejection) return
      setFile(selected)
    }} />
    {file && <AvatarCrop key={`${file.name}:${file.lastModified}`} file={file} t={props.t} busy={busy} onClose={() => { setFile(undefined) }} onSave={saveAvatar} />}
    {view === 'manage' && <OrganizationDialog {...props} initialSection="connection" onClose={() => { setView('account') }} />}
  </>
}
