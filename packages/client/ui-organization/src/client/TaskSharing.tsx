/** Shared task background and creator-reviewed whole-tree requests. */
import { useEffect, useRef, useState } from 'react'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import { Button, IconEditOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { OrganizationPlanId } from '@deepseek-ai/dsh-organization'
import type { OrganizationProjectId } from '@deepseek-ai/dsh-organization/types'
import type { ConnectionResult } from '@deepseek-ai/dsh-organization-connection/types'
import type { OrganizationProps } from './contract.ts'
import { sharedContextView } from './shared-context-view.ts'
import { workgraphError } from './workgraph-view.ts'
import css from './Organization.module.css'

/**
 * @param props - Currently readable plan in the task workspace.
 * @returns Creator-editable background and employee request/creator decision controls.
 */
export function TaskSharing(props: OrganizationProps & {
  projectId: OrganizationProjectId
  planId: OrganizationPlanId
  overallGoal?: string | undefined
}) {
  const c = props.useOrganization(s => s.connection), { t } = props
  const [data, setData] = useState<{ generation: number; value: NonNullable<ConnectionResult['sharing']> }>()
  const [draft, setDraft] = useState<{ text: string; version: number }>()
  const [notice, setNotice] = useState(''), [busy, setBusy] = useState(false), [reload, setReload] = useState(0)
  const alive = useRef(true)
  const operation = useRef<{ fingerprint: string; id: string }>()
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const ready = c.phase === 'ready' && c.mode === 'organization'
  const query = { organizationId: c.organizationId, projectId: props.projectId, planId: props.planId }
  useEffect(() => {
    let active = true
    if (ready) void props.connection({ kind: 'workgraph-sharing', request: query }).then((result) => {
      if (active && result.sharing && result.generation === c.generation) setData({ generation: result.generation, value: result.sharing })
    }, (error: unknown) => { if (active) setNotice(t(workgraphError(error))) })
    return () => { active = false }
  }, [ready, c.generation, props.planId, props.projectId, reload])
  const current = ready && data?.generation === c.generation ? data.value : undefined
  const writable = !!current && !busy && !c.pendingOperation
  const send = async (fields: Record<string, unknown>) => {
    const fingerprint = JSON.stringify(fields)
    if (operation.current?.fingerprint !== fingerprint) operation.current = { fingerprint, id: randomUUID() }
    setBusy(true); setNotice('')
    try {
      await props.connection({ kind: 'workgraph-share', request: { ...query, ...fields, operationId: operation.current.id } })
      if (alive.current) { operation.current = undefined; setDraft(undefined); setReload(n => n + 1) }
    } catch (error) { if (alive.current) setNotice(t(workgraphError(error))) }
    finally { if (alive.current) setBusy(false) }
  }
  if (!current) return notice ? <p role="status">{notice}</p> : null
  const background = sharedContextView(current.sharedContext)
  const mine = current.requests.find(item => item.membershipId === c.organizations.find(org => org.id === c.organizationId)?.membershipId)
  return <section className={`${css.card} ${css.sharedContext}`} aria-label={t('sharedTaskContext')} aria-busy={busy}>
    <div className={css.sharedContextHeading}><h3>{props.overallGoal || t('sharedTaskContext')}</h3>
      {current.canEdit && !draft && <Button variant="outline" size="sm" icon={<IconEditOutlineRegular />} disabled={!writable}
        onClick={() => { setDraft({ text: current.sharedContext, version: current.version }) }}>{t('editSharedContext')}</Button>}
    </div>
    {notice && <p role="alert">{notice}</p>}
    {draft && current.canEdit ? <form className={css.form} onSubmit={(event) => {
      event.preventDefault(); void send({ kind: 'edit-context', expectedVersion: draft.version, sharedContext: draft.text })
    }}><label className={css.field}>{t('sharedTaskContext')}<textarea value={draft.text} disabled={!writable}
        onChange={(event) => { setDraft({ ...draft, text: event.target.value }) }} /></label>
      {draft.version !== current.version && <p role="alert">{t('sharedContextConflict')}</p>}
      <div className={css.actions}><Button type="submit" disabled={!writable || draft.version !== current.version}>{t('save')}</Button>
        <Button disabled={busy} onClick={() => { setDraft(undefined) }}>{t('cancel')}</Button></div>
    </form> : <><p className={css.sharedContextText}>{background.preview || t('sharedContextEmpty')}</p>
      {background.more && <details className={css.sharedContextMore}><summary>{t('sharedContextMore')}</summary><p className={css.sharedContextText}>{background.more}</p></details>}
    </>}
    {!current.canEdit && <div className={css.actions}>
      {current.fullTreeVisible ? <p role="status">{t('fullTreeVisible')}</p> : <>
        {mine && <p role="status">{t(mine.state === 'pending' ? 'treeRequestPending' : mine.state === 'rejected' ? 'treeRequestRejected' : 'treeRequestApproved')}</p>}
        {current.canRequest && <Button disabled={!writable || mine?.state === 'pending'} onClick={() => { void send({ kind: 'request-tree' }) }}>{t('requestFullTree')}</Button>}
      </>}
    </div>}
    {current.canEdit && current.requests.filter(item => item.state === 'pending').map(item => <div key={item.id} className={css.card}>
      <p>{t('fullTreeRequestFrom', { name: item.username })}</p><p className={css.muted}>{t('fullTreeReadonlyHint')}</p>
      <div className={css.actions}><Button disabled={!writable} onClick={() => { void send({ kind: 'decide-tree', requestId: item.id, expectedVersion: item.version, answer: 'approved' }) }}>{t('approveTreeRequest')}</Button>
        <Button disabled={!writable} onClick={() => { void send({ kind: 'decide-tree', requestId: item.id, expectedVersion: item.version, answer: 'rejected' }) }}>{t('rejectTreeRequest')}</Button></div>
    </div>)}
  </section>
}
