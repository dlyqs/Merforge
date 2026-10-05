/** Organization conversation selection and a working entry for empty groups. */
import { Button, IconNewChatOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { OrganizationProjectView } from '@deepseek-ai/dsh-organization/types'
import type { ConversationRequest } from '@deepseek-ai/dsh-organization-conversation/protocol'
import type { OrganizationProps } from './contract.ts'
import css from './Organization.module.css'
/** Affiliation for the next explicitly created conversation. */
export type ConversationStartTarget = { project?: OrganizationProjectView; botId?: ConversationRequest['botId'] }
/** The user's requested new-conversation affiliation. */
export interface ConversationEntryInjected {
  hooks: { conversationStartTarget: ObservableSnapshot<ConversationStartTarget> }
  startConversation(): void
}
/** @param props - Account state and requested affiliation. @returns An actionable new-conversation entry. */
export function OrganizationConversationEntry(props: OrganizationProps & InjectFace<ConversationEntryInjected>) {
  const target = props.useConversationStartTarget(value => value)
  const c = props.useOrganization(s => s.connection)
  return <section className={css.conversationEntry}>
    <IconNewChatOutlineRegular size={32} /><h2>{props.t('newConversation')}</h2>
    <p>{target.project?.name ?? props.t('conversationStartHint')}</p>
    <Button variant="primary" disabled={c.phase !== 'ready'} onClick={props.startConversation}>{props.t('newConversation')}</Button>
    {c.phase !== 'ready' && <p role="status">{props.t(c.phase)}</p>}
  </section>
}
