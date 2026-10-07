/** Pure recipient unread matching over the current native inbox. */
import type { OrganizationDesktopSnapshot } from '@deepseek-ai/dsh-organization-connection/types'
import type { OrganizationInboxItem } from '@deepseek-ai/dsh-organization'
import type { ConversationResult } from '@deepseek-ai/dsh-organization-conversation/protocol'
/**
 * Select unread notifications still visible to the current account.
 * @param connection - Current native identity and full inbox.
 * @returns Visible unread task notifications.
 */
export function unreadTaskNotifications(connection: OrganizationDesktopSnapshot['connection']): OrganizationInboxItem[] {
  return (connection.inbox?.items ?? []).filter(item => item.readAt === null
    && !connection.removedProjects?.includes(item.assignment.projectId) && !connection.removedPlans?.includes(item.assignment.planId))
}
/**
 * Select the revision visible to this notification recipient.
 * @param item - Observed inbox fact.
 * @param memberId - Current recipient.
 * @returns Exact revision that a read may acknowledge.
 */
export function taskNotificationRevision(item: OrganizationInboxItem, memberId: import('@deepseek-ai/dsh-organization/types').MembershipId | undefined): number {
  switch (item.request.kind) {
    case 'accept-assignment': return item.assignment.version
    case 'accept-delivery': return item.request.handlerId === memberId ? item.request.createdRevision
      : item.request.acceptance?.createdRevision ?? item.request.createdRevision
    default: return item.request.answeredRevision ?? item.request.createdRevision
  }
}
/**
 * Match a notification to the conversation that displays its task.
 * @param item - Unread task fact.
 * @param conversation - Private navigation metadata.
 * @returns Whether this row opens that fact.
 */
export function conversationHasNotification(item: OrganizationInboxItem,
  conversation: NonNullable<ConversationResult['catalog']>['conversations'][number]): boolean {
  return conversation.assignment?.assignmentId === item.assignment.id
    || conversation.review?.planId === item.assignment.planId && conversation.review.taskId === item.assignment.taskId
    && item.request.kind === 'accept-delivery'
    || String(conversation.conversationId) === String(item.request.id)
}
