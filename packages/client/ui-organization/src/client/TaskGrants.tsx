/** Task grant administration operates on identifiers without requiring content reads. */
import { useEffect, useRef, useState } from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import type { OrganizationTaskGrant } from '@deepseek-ai/dsh-organization'
import type { OrganizationProps } from './contract.ts'
import { workgraphError } from './workgraph-view.ts'
import css from './Organization.module.css'

/** @param props - Native actions and project selector. @returns Separate content-free task grant controls. */
export function TaskGrants(props: OrganizationProps & { projectId: string }) {
  const c = props.useOrganization(s => s.connection)
  const { t } = props
  const [planId, setPlan] = useState(''), [taskId, setTask] = useState(''), [membershipId, setMember] = useState('')
  const [scope, setScope] = useState<'node' | 'subtree'>('node')
  const [rows, setRows] = useState<{ generation: number; items: OrganizationTaskGrant[] }>()
  const [notice, setNotice] = useState(''), [busy, setBusy] = useState(false)
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const isAlive = () => alive.current
  const query = { organizationId: c.organizationId, projectId: props.projectId, planId }
  const run = async (actions?: ('read' | 'edit')[]) => {
    setBusy(true); setNotice('')
    try {
      const result = await props.connection({ kind: 'workgraph-grants', request: query })
      if (!alive.current || result.workgraph?.result.kind !== 'grants') return
      const items = result.workgraph.result.value
      if (actions) {
        const expectedVersion = items.find(row => row.taskId === taskId
          && row.membershipId === membershipId && row.scope === scope)?.version ?? 0
        await props.connection({ kind: 'workgraph-grant', request: { ...query, taskId, membershipId, scope, actions, expectedVersion, operationId: randomUUID() } })
        if (!isAlive()) return
        setRows(undefined); setNotice(t('success'))
      } else setRows({ generation: result.workgraph.generation, items })
    } catch (error) { if (alive.current) setNotice(t(workgraphError(error))) }
    finally { if (alive.current) setBusy(false) }
  }
  return <section className={css.card}>
    <h4>{t('taskPermissions')}</h4><p className={css.muted}>{t('taskPermissionsHint')}</p>
    <fieldset className={css.form} disabled={busy || c.phase !== 'ready' || !!c.pendingOperation}>
      <label className={css.field}>{t('planId')}<Input value={planId} onChange={(event) => { setPlan(event.target.value); setRows(undefined) }} /></label>
      <label className={css.field}>{t('taskId')}<Input value={taskId} onChange={(event) =>{  setTask(event.target.value) }} /></label>
      <label className={css.field}>{t('memberId')}<select value={membershipId} onChange={(event) =>{  setMember(event.target.value) }}><option value="">{t('memberId')}</option>{c.members.map(member => <option key={member.id} value={member.id}>{member.username}</option>)}</select></label>
      <label className={css.field}>{t('grantScope')}<select value={scope} onChange={(event) =>{  setScope(event.target.value === 'subtree' ? 'subtree' : 'node') }}><option value="node">{t('nodeScope')}</option><option value="subtree">{t('subtreeScope')}</option></select></label>
      <div className={css.actions}>
        <Button disabled={!planId} onClick={() => { void run() }}>{t('inspectGrants')}</Button>
        <Button disabled={!planId || !taskId || !membershipId} onClick={() => { void run(['read']) }}>{t('read')}</Button>
        <Button disabled={!planId || !taskId || !membershipId || scope !== 'subtree'} onClick={() => { void run(['read', 'edit']) }}>{t('grantEdit')}</Button>
        <Button disabled={!planId || !taskId || !membershipId} onClick={() => { void run([]) }}>{t('revokeTask')}</Button>
      </div>
    </fieldset>
    {notice && <p role="status">{notice}</p>}
    {rows?.generation === c.generation && rows.items.map(row => <p className={css.secret} key={[row.taskId, row.membershipId, row.scope].join(':')}>
      {row.taskId} · {row.membershipId} · {t(row.scope === 'node' ? 'nodeScope' : 'subtreeScope')} · {t(row.active ? 'grantCurrent' : 'grantStale')} · {t('taskVersion', { revision: row.version })} · {row.actions.map(action => t(action === 'read' ? 'read' : 'grantEdit')).join(', ')}
    </p>)}
  </section>
}
