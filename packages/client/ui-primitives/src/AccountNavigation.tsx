/** Account-independent project/Bot disclosure and conversation navigation rows. */
import type { HTMLAttributes, ReactNode } from 'react'
import { IconAgentPresetOutlineRegular, IconFolderCloseRegular, IconFolderOpenRegular, IconTriangleRightFillRegular } from './icons/index.tsx'
import css from './AccountNavigation.module.css'

/** @param props - Group identity, disclosure state and account-owned controls. @returns Shared project or Bot row. */
export function AccountNavigationGroup({ kind, name, label = name, open, wide = true, onToggle, actions, children, ...events }: {
  kind: 'project' | 'bot'
  name: string
  label?: string
  open: boolean
  wide?: boolean
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
      </button>
      {wide && actions && <div className={css.rowActions}>{actions}</div>}
    </div>
    {wide && open && <div className={css.groupContents}>{children}</div>}
  </div>
}

/** @param props - Conversation title, status and account-owned open action. @returns Shared conversation row. */
export function AccountConversationRow({ title, label = title, tag, status, actions, onOpen, selected, disabled, ...events }: {
  title: string
  label?: string
  tag?: string | undefined
  status?: ReactNode
  actions?: ReactNode
  onOpen: () => void
  selected?: boolean
  disabled?: boolean
} & Pick<HTMLAttributes<HTMLDivElement>, 'draggable' | 'onDragStart'>) {
  return <div className={css.sessionRow} {...events}>
    <button type="button" className={css.sessionButton} aria-label={label} aria-current={selected ? 'page' : undefined} disabled={disabled} onClick={onOpen}>
      <span className={css.statusSlot}>{status}</span><span className={css.sessionTitle}>{title}</span>
      {tag && <span className={css.tag}>{tag}</span>}
    </button>
    {actions && <div className={css.sessionActions}>{actions}</div>}
  </div>
}
