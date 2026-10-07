/** Account-independent project/Bot disclosure and conversation navigation rows. */
import { useState } from 'react'
import { Menu } from './Menu.tsx'
import type { HTMLAttributes, ReactNode } from 'react'
import { IconAgentPresetOutlineRegular, IconFolderCloseRegular, IconFolderOpenRegular, IconTriangleRightFillRegular, IconEllipsisOutlineRegular, IconEditOutlineRegular, IconTrashOutlineRegular } from './icons/index.tsx'
import css from './AccountNavigation.module.css'

/** @param props - Group identity, disclosure state and account-owned controls. @returns Shared project or Bot row. */
export function AccountNavigationGroup({
  kind, name, label = name, open, wide = true, onToggle, actions, children, unreadLabel, ...events
}: {
  kind: 'project' | 'bot'
  name: string
  label?: string
  open: boolean
  wide?: boolean
  unreadLabel?: string | undefined
  onToggle: () => void
  actions?: ReactNode
  children?: ReactNode
} & Pick<HTMLAttributes<HTMLDivElement>, 'onDragOver' | 'onDrop'>) {
  return <div className={css.group}>
    <div className={css.groupRow} {...events}>
      <button type="button" className={css.groupButton} aria-expanded={open} aria-label={label} onClick={onToggle}>
        <span className={css.leadingIcon} aria-hidden="true">
          {kind === 'project' ? open ? <IconFolderOpenRegular /> : <IconFolderCloseRegular /> : <IconAgentPresetOutlineRegular />}
          <IconTriangleRightFillRegular className={css.chevron} />
        </span>
        {wide && <span className={css.groupTitle}>{name}</span>}
        {unreadLabel && <span className={css.unreadDot} role="img" aria-label={unreadLabel} />}
      </button>
      {wide && actions && <div className={css.rowActions}>{actions}</div>}
    </div>
    {wide && open && <div className={css.groupContents}>{children}</div>}
  </div>
}

/** @param props - Conversation title, status and account-owned open action. @returns Shared conversation row. */
export function AccountConversationRow({ title, label = title, tag, status, actions, onOpen, selected, disabled, unreadLabel, ...events }: {
  title: string
  unreadLabel?: string | undefined
  label?: string
  tag?: string | undefined
  status?: ReactNode
  actions?: ReactNode
  onOpen: () => void
  selected?: boolean
  disabled?: boolean
} & Pick<HTMLAttributes<HTMLDivElement>, 'draggable' | 'onDragStart'>) {
  return <div className={css.sessionRow} data-unread={!!unreadLabel} {...events}>
    <button type="button" className={css.sessionButton} aria-label={label} aria-current={selected ? 'page' : undefined} disabled={disabled} onClick={onOpen}>
      <span className={css.statusSlot}>{unreadLabel ? <span className={css.unreadDot} role="img" aria-label={unreadLabel} /> : status}</span><span className={css.sessionTitle}>{title}</span>
      {tag && <span className={css.tag}>{tag}</span>}
    </button>
    {actions && <div className={css.sessionActions}>{actions}</div>}
  </div>
}
/** @param props - Localized conversation menu labels and account-owned actions. @returns The shared hover/focus row menu. */
export function AccountConversationMenu({ title, labels, disabled, onManage, onDelete }: {
  title: string
  labels: { more: string; manage: string; delete: string }
  disabled?: boolean
  onManage: () => void
  onDelete: () => void
}) {
  const [open, setOpen] = useState(false)
  return <Menu open={open} portal align="end" autoFocus onClose={() => { setOpen(false) }}
    anchor={<button type="button" className={css.rowAction} aria-label={`${labels.more} ${title}`} aria-haspopup="menu"
      aria-expanded={open} onClick={() => { setOpen(!open) }}><IconEllipsisOutlineRegular /></button>}
    items={[{ id: 'manage', label: labels.manage, icon: <IconEditOutlineRegular />, disabled: !!disabled },
      { id: 'delete', label: labels.delete, icon: <IconTrashOutlineRegular />, danger: true, disabled: !!disabled }]}
    onSelect={(action) => { setOpen(false); if (action === 'delete') onDelete(); else onManage() }} />
}
