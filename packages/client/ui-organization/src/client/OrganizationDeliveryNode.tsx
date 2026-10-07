/** Shared submission evidence links and exact task navigation in the ordinary Chat. */
import { useEffect, useRef, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChatNodeViewProps } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { OrganizationProps } from './contract.ts'
import { saveSharedArtifact } from './download-artifact.ts'
import { workgraphError } from './workgraph-view.ts'
import css from './TaskInspector.module.css'
/** @param props - Authorized persisted submission and native download actions. @returns Task jump and evidence download links. */
export function OrganizationDeliveryNode(props: OrganizationProps & Pick<ChatNodeViewProps<'organization-delivery'>, 'node'>) {
  const c = props.useOrganization(s => s.connection), context = props.node.data
  const identity = useRef(c); identity.current = c
  const alive = useRef(true)
  const [notice, setNotice] = useState(''), [busy, setBusy] = useState(false)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const current = c.phase === 'ready' && c.mode === 'organization' && c.principal?.serverId === context.owner.serverId
    && c.principal.accountId === context.owner.accountId && c.organizationId === context.owner.organizationId
  if (!current) return null
  return <section className={css.pane}>
    <Button onClick={() => { props.openConversationTask?.({ organizationId: context.assignment.organizationId,
      projectId: context.assignment.projectId, planId: context.assignment.planId, taskId: context.assignment.taskId,
      assignmentId: context.assignment.id }) }}>{props.t('tasks')}</Button>
    <ul className={css.artifactLinks}>{context.artifacts.map(artifact => <li key={artifact.id}>
      <a href="#" download={artifact.path.split('/').at(-1)} aria-disabled={busy} onClick={(event) => {
        event.preventDefault(); if (busy) return
        setBusy(true); setNotice('')
        void props.connection({ kind: 'delivery-download', request: { organizationId: artifact.organizationId,
          projectId: artifact.projectId, planId: artifact.planId, assignmentId: artifact.assignmentId, artifactId: artifact.id,
        } }).then(result => saveSharedArtifact(result, (generation) => {
          if (!alive.current || identity.current.generation !== generation || identity.current.phase !== 'ready'
            || identity.current.principal?.accountId !== context.owner.accountId
            || identity.current.principal.serverId !== context.owner.serverId) throw new Error('superseded')
        })).catch((error: unknown) => { if (alive.current) setNotice(props.t(workgraphError(error))) })
          .finally(() => { if (alive.current) setBusy(false) })
      }}>{artifact.path}</a>
      {artifact.description && artifact.description !== artifact.path && artifact.description !== artifact.path.split('/').at(-1)
        && <small>{artifact.description}</small>}
    </li>)}</ul>
    {notice && <p role="status">{notice}</p>}
  </section>
}
