/** Global account conversation creation without a project picker. */
import { useEffect, useState } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { ConversationRequest } from '@deepseek-ai/dsh-organization-conversation/protocol'
import type { OrganizationProps } from './contract.ts'
import type { ConversationStartTarget } from './ConversationEntry.tsx'
/** Framework-owned modal visibility. */
export interface NewConversationInjected {
  hooks: { creating: ObservableSnapshot<boolean>; conversationStartTarget: ObservableSnapshot<ConversationStartTarget> }
  dismiss(): void
}
/** @param props - Account identity, standard Session starter and modal hook. @returns Creation status or retry. */
export function NewConversation(props: OrganizationProps & InjectFace<NewConversationInjected>) {
  const open = props.useCreating(value => value), c = props.useOrganization(s => s.connection)
  if (!open || c.mode !== 'organization') return null
  return <Starter key={`${c.principal?.serverId}:${c.principal?.accountId}:${c.organizationId}:${c.generation}`} {...props} />
}
function Starter(props: OrganizationProps & InjectFace<NewConversationInjected>) {
  const c = props.useOrganization(s => s.connection)
  const target = props.useConversationStartTarget(value => value)
  const [conversationId] = useState(randomUUID() as ConversationRequest['conversationId'])
  const [attempt, setAttempt] = useState(0), [notice, setNotice] = useState('')
  useEffect(() => {
    let active = true
    setNotice('')
    if (c.phase !== 'ready' || !c.principal || !c.organizationId || !props.selectConversation) {
      setNotice(props.t('conversationUnavailable')); return
    }
    void props.selectConversation({ ...c.principal, organizationId: c.organizationId, conversationId,
      ...(target.project ? { projectId: target.project.id } : {}), ...(target.botId ? { botId: target.botId } : {}) }).then(() => {
      if (active) { props.dismiss() }
    }, () => { if (active) setNotice(props.t('conversationFailure')) })
    return () => { active = false }
  }, [attempt])
  return <Modal open title={props.t('newConversation')} closeLabel={props.t('close')} onClose={props.dismiss}
    footer={notice ? <><Button onClick={props.dismiss}>{props.t('cancel')}</Button>
      <Button variant="primary" onClick={() => { setAttempt(value => value + 1) }}>{props.t('newConversation')}</Button></> : undefined}>
    {notice ? <p role="alert">{notice}</p> : <p role="status">{props.t('loading')}</p>}
  </Modal>
}
