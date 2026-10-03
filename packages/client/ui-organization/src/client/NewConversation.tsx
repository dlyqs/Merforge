/** Account project selection before creating a standard conversation Session. */
import { useEffect, useState } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { OrganizationProjectView } from '@deepseek-ai/dsh-organization/types'
import type { ConversationRequest } from '@deepseek-ai/dsh-organization-conversation/protocol'
import type { OrganizationProps } from './contract.ts'
import { readNavigationProjects } from './projects.ts'
import css from './Organization.module.css'
/** Framework-owned modal visibility. */
export interface NewConversationInjected { hooks: { creating: ObservableSnapshot<boolean> }; dismiss(): void }
/** @param props - Account identity, standard Session starter and modal hook. @returns Account project picker. */
export function NewConversation(props: OrganizationProps & InjectFace<NewConversationInjected>) {
  const open = props.useCreating(value => value), c = props.useOrganization(s => s.connection)
  if (!open || c.mode !== 'organization') return null
  return <Picker key={`${c.principal?.serverId}:${c.principal?.accountId}:${c.organizationId}:${c.generation}`} {...props} />
}
function Picker(props: OrganizationProps & InjectFace<NewConversationInjected>) {
  const c = props.useOrganization(s => s.connection)
  const [projects, setProjects] = useState<OrganizationProjectView[]>([]), [projectId, setProjectId] = useState('')
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState('')
  useEffect(() => {
    let active = true
    if (c.phase === 'ready') void readNavigationProjects(props.connection, c.generation, () => active).then((items) => {
      if (active && items) { setProjects(items); setProjectId(items[0]?.id ?? '') }
    }, () => { if (active) setNotice(props.t('conversationFailure')) })
    return () => { active = false }
  }, [])
  return <Modal open title={props.t('newConversation')} closeLabel={props.t('close')} onClose={() => { if (!busy) props.dismiss() }}
    footer={<><Button disabled={busy} onClick={props.dismiss}>{props.t('cancel')}</Button><Button variant="primary" disabled={busy || !projectId || c.phase !== 'ready'} onClick={() => {
      const project = projects.find(project => project.id === projectId)
      if (!project || !c.principal || !props.selectConversation) return
      setBusy(true)
      void props.selectConversation({ ...c.principal, organizationId: project.organizationId, projectId: project.id,
        conversationId: randomUUID() as ConversationRequest['conversationId'] }).then(props.dismiss,
        () => { setNotice(props.t('conversationFailure')) }).finally(() => { setBusy(false) })
    }}>{props.t('newConversation')}</Button></>}>
    <label className={css.field}>{props.t('projects')}<select value={projectId} disabled={busy} onChange={(event) => { setProjectId(event.target.value) }}>
      {projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
    {!projects.length && <p>{props.t('emptyProjects')}</p>}{notice && <p role="alert">{notice}</p>}
  </Modal>
}
