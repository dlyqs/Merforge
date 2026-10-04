/** Account-owned management controls over the shared conversation navigation menu. */
import { useEffect, useRef, useState } from 'react'
import { Button, Input, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { ConversationRequest, ConversationResult } from '@deepseek-ai/dsh-organization-conversation/protocol'
import type { OrganizationProps } from './contract.ts'
import type { ConversationSelection } from './conversation-store.ts'
import css from './Organization.module.css'

/** Selected account-owned conversation and explicit menu action. */
export type ConversationManagement = { selected: ConversationSelection; action: 'manage' | 'delete' } | null
/** Framework-created management hook and commit callbacks. */
export interface ManagementInjected {
  hooks: { conversationManagement: ObservableSnapshot<ConversationManagement> }
  dismiss(): void
  committed(selected: ConversationSelection, deleted: boolean): void
}
/** @param props - Native authority and framework-created management selection. @returns Shared modal controls. */
export function ConversationManager(props: OrganizationProps & InjectFace<ManagementInjected>) {
  const selected = props.useConversationManagement(s => s)
  const c = props.useOrganization(s => s.connection)
  const valid = selected && c.phase === 'ready' && c.mode === 'organization'
    && c.organizationId === selected.selected.organizationId && c.principal?.accountId === selected.selected.accountId
    && c.principal.serverId === selected.selected.serverId
  if (!valid || !selected.selected.conversationId) return null
  return <Manager key={`${selected.selected.conversationId}:${selected.action}:${c.generation}`} {...props} management={selected} projectId={selected.selected.projectId} conversationId={selected.selected.conversationId} />
}
/** @param props - One current account management operation. @returns Rename, Bot association or delete confirmation. */
function Manager(props: OrganizationProps & InjectFace<ManagementInjected> & { management: NonNullable<ConversationManagement>; projectId: ConversationRequest['projectId']; conversationId: ConversationRequest['conversationId'] }) {
  const { selected, action } = props.management, { t } = props
  const [title, setTitle] = useState(''), [bot, setBot] = useState('')
  const [result, setResult] = useState<ConversationResult>(), [busy, setBusy] = useState(false), [notice, setNotice] = useState('')
  const alive = useRef(true)
  const attempts = useRef(new Map<string, ConversationRequest['operationId']>())
  const query = { organizationId: selected.organizationId, projectId: props.projectId, conversationId: props.conversationId,
    ...(selected.assignmentId && selected.planId ? { assignment: { planId: selected.planId, assignmentId: selected.assignmentId } } : {}) }
  useEffect(() => {
    alive.current = true
    void props.conversation?.({ ...query, kind: 'read', operationId: randomUUID() as ConversationRequest['operationId'] }).then((reply) => {
      if (!alive.current) return
      setResult(reply.result)
      const row = reply.result.catalog?.conversations.find(row => row.conversationId === selected.conversationId)
      setTitle(reply.result.title ?? row?.title ?? reply.result.entries[0]?.text.split('\n')[0] ?? '')
      setBot(row?.botId ?? '')
    }, () => { if (alive.current) setNotice(t('conversationFailure')) })
    return () => { alive.current = false }
  }, [])
  const perform = async (request: ConversationRequest) => {
    const digest = JSON.stringify({ ...request, operationId: undefined })
    let id = attempts.current.get(digest)
    if (!id) { id = request.operationId; attempts.current.set(digest, id) }
    return props.conversation?.({ ...request, operationId: id })
  }
  const save = async () => {
    if (busy || !result || !props.conversation) return
    setBusy(true); setNotice('')
    try {
      if (action === 'delete') await perform({ ...query, kind: 'delete', operationId: randomUUID() as ConversationRequest['operationId'] })
      else {
        await perform({ ...query, kind: 'rename', title: title.trim(), operationId: randomUUID() as ConversationRequest['operationId'] })
        if (!query.assignment) await perform({ ...query, kind: 'affiliation', nextBotId: bot ? bot as NonNullable<ConversationRequest['botId']> : null,
          operationId: randomUUID() as ConversationRequest['operationId'] })
      }
      if (alive.current) { props.committed(selected, action === 'delete'); props.dismiss() }
    } catch (_error: unknown) { if (alive.current) setNotice(t('conversationFailure')) }
    finally { if (alive.current) setBusy(false) }
  }
  return <Modal open title={t(action === 'delete' ? 'deleteConversation' : 'manageConversation')} closeLabel={t('close')}
    onClose={() => { if (!busy) props.dismiss() }} footer={<><Button disabled={busy} onClick={props.dismiss}>{t('cancel')}</Button>
      <Button variant="primary" disabled={busy || !result || action === 'manage' && !title.trim()} onClick={() => { void save() }}>{t(action === 'delete' ? 'deleteConversation' : 'save')}</Button></>}>
    <div className={css.form}>{action === 'delete' ? <p>{t('confirmDeleteConversation', { name: title || t('newConversation') })}</p>
      : <><label>{t('conversationName')}<Input value={title} maxLength={120} disabled={busy} onChange={(event) => { setTitle(event.target.value) }} /></label>
        {!query.assignment && <label>{t('bots')}<select value={bot} disabled={busy} onChange={(event) => { setBot(event.target.value) }}>
          <option value="">{t('noBot')}</option>{result?.catalog?.bots.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select></label>}</>}{notice && <p role="alert">{notice}</p>}</div>
  </Modal>
}
