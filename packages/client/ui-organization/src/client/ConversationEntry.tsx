/** Organization conversation loading presentation and new-conversation affiliation. */
import type { OrganizationProjectView } from '@deepseek-ai/dsh-organization/types'
import type { ConversationRequest } from '@deepseek-ai/dsh-organization-conversation/protocol'
import type { OrganizationProps } from './contract.ts'
import type { SessionReference } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './Organization.module.css'
/** Affiliation for the next explicitly created conversation. */
export type ConversationStartTarget = { project?: OrganizationProjectView; botId?: ConversationRequest['botId'] }
/** @param props - Account reference and ordinary conversation subtree. @returns The selected conversation or its loading state. */
export function OrganizationConversationEntry(props: OrganizationProps
  & InjectFace<{ hooks: { conversationReference: ObservableSnapshot<SessionReference | undefined> } }>
  & PropsRuntime<'main.conversation.entry'>) {
  const c = props.useOrganization(s => s.connection)
  const reference = props.useConversationReference(s => s)
  if (reference) return props.conversationContent
  return <section className={css.conversationEntry} role="status" aria-busy={c.phase === 'ready' || c.phase === 'loading'}>
    {props.t(c.phase === 'ready' || c.phase === 'loading' ? 'loading' : c.phase)}
  </section>
}
