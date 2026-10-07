/** Recipient unread facts stay visible until an exact conversation or task is opened. */
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { OrganizationProps } from './contract.ts'
import { unreadTaskNotifications } from './notification-view.ts'
import css from './Organization.module.css'
/** @param props - Current native inbox and navigation destination. @returns Localized unread badge. */
export function NotificationBadge(props: OrganizationProps & PropsRuntime<'sidebar.navigation.badge'>) {
  const c = props.useOrganization(s => s.connection)
  return c.mode === 'organization' && ['ready', 'loading'].includes(c.phase)
    && ['projects', 'tasks'].includes(props.section) && unreadTaskNotifications(c).length > 0
    ? <span className={css.notificationBadge} role="img" aria-label={props.t('unreadTaskNotification')} /> : null
}
