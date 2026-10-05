/** Organization conversation loading presentation and new-conversation affiliation. */
import type { OrganizationProjectView } from '@deepseek-ai/dsh-organization/types'
import type { ConversationRequest } from '@deepseek-ai/dsh-organization-conversation/protocol'
import type { OrganizationProps } from './contract.ts'
import css from './Organization.module.css'
/** Affiliation for the next explicitly created conversation. */
export type ConversationStartTarget = { project?: OrganizationProjectView; botId?: ConversationRequest['botId'] }
/** @param props - Current account loading state. @returns Loading state until the ordinary conversation is attached. */
export function OrganizationConversationEntry(props: OrganizationProps) {
  const c = props.useOrganization(s => s.connection)
  return <section className={css.conversationEntry} role="status" aria-busy={c.phase === 'ready' || c.phase === 'loading'}>
    {props.t(c.phase === 'ready' || c.phase === 'loading' ? 'loading' : c.phase)}
  </section>
}
