/** Task grant administration operates on identifiers without requiring content reads. */
import { useEffect, useRef, useState } from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import type { OrganizationTaskGrant, OrganizationTaskView } from '@deepseek-ai/dsh-organization'
import type { OrganizationProps } from './contract.ts'
import { MemberSelect } from './MemberSelect.tsx'
import { workgraphError } from './workgraph-view.ts'
import css from './Organization.module.css'

/** @param props - Native actions and project selector. @returns Separate content-free task grant controls. */
export function TaskGrants(props: OrganizationProps & { projectId: string; task?: OrganizationTaskView }) {
  const c = props.useOrganization(s => s.connection)
  const { t } = props
  const [planId, setPlan] = useState(props.task?.planId ?? ''), [taskId, setTask] = useState(props.task?.id ?? ''), [membershipId, setMember] = useState('')
  const [permission, setPermission] = useState<'read' | 'edit' | 'none'>('read')
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
      if (actions) {
        if (rows?.generation !== c.generation) throw new Error('superseded')
        const items = rows.items
        const expectedVersion = items.find(row => row.taskId === taskId
          && row.membershipId === membershipId && row.scope === scope)?.version ?? 0
        await props.connection({ kind: 'workgraph-grant', request: { ...query, taskId, membershipId, scope, actions, expectedVersion, operationId: randomUUID() } })
        if (!isAlive()) return
        setRows(undefined); setNotice(t('accessSaved'))
        const refreshed = await props.connection({ kind: 'workgraph-grants', request: query })
        if (isAlive() && refreshed.workgraph?.result.kind === 'grants') setRows({ generation: refreshed.workgraph.generation, items: refreshed.workgraph.result.value })
      } else {
        const result = await props.connection({ kind: 'workgraph-grants', request: query })
        if (alive.current && result.workgraph?.result.kind === 'grants') setRows({ generation: result.workgraph.generation, items: result.workgraph.result.value })
      }
    } catch (error) { if (alive.current) setNotice(t(workgraphError(error))) }
    finally { if (alive.current) setBusy(false) }
  }
  useEffect(() => { if (props.task) void run() }, [props.task?.id])
  return <section className={css.card}>
    <h4>{t('taskPermissions')}</h4><p className={css.muted}>{t('taskPermissionsHint')}</p>
    <fieldset className={css.form} disabled={busy || c.phase !== 'ready' || !!c.pendingOperation}>
      {props.task ? <strong>{props.task.goal}</strong> : <>
        <label className={css.field}>{t('planId')}<Input value={planId} onChange={(event) => { setPlan(event.target.value); setRows(undefined) }} /></label>
        <label className={css.field}>{t('taskId')}<Input value={taskId} onChange={(event) => { setTask(event.target.value) }} /></label>
      </>}
      <MemberSelect t={t} connection={c} labelKey="memberId" value={membershipId} change={setMember} />
      <div className={css.fieldsGrid}>
        <label className={css.field}>{t('accessLevel')}<select value={permission} onChange={(event) => {
          const next = event.target.value as typeof permission
          setPermission(next); if (next === 'edit') setScope('subtree')
        }}><option value="read">{t('accessRead')}</option>
          <option value="edit">{t('accessEdit')}</option>
          <option value="none">{t('accessNone')}</option>
        </select></label>
        <label className={css.field}>{t('grantScope')}<select value={scope} disabled={permission === 'edit'} onChange={(event) => { setScope(event.target.value === 'subtree' ? 'subtree' : 'node') }}>
          <option value="node">{t('nodeScope')}</option><option value="subtree">{t('subtreeScope')}</option>
        </select></label>
      </div>
      <div className={css.actions}>
        <Button variant="primary" disabled={!planId || !taskId || !membershipId || rows?.generation !== c.generation} onClick={() => { void run(permission === 'edit' ? ['read', 'edit'] : permission === 'read' ? ['read'] : []) }}>{t('saveAccess')}</Button>
        <Button disabled={!planId} onClick={() => { void run() }}>{t(props.task ? 'refreshAccess' : 'inspectGrants')}</Button>
      </div>
    </fieldset>
    {notice && <p role="status">{notice}</p>}
    {rows?.generation === c.generation && <div className={css.accessList}>{rows.items.filter(row => !props.task || row.taskId === taskId).map(row => <button type="button" className={css.accessMember}
      disabled={busy} key={[row.taskId, row.membershipId, row.scope].join(':')} onClick={() => {
        setTask(row.taskId); setMember(row.membershipId); setScope(row.scope)
        setPermission(row.actions.includes('edit') ? 'edit' : row.actions.includes('read') ? 'read' : 'none')
      }}>
      <span>{c.members.find(member => member.id === row.membershipId)?.username ?? t('selectedMember')}</span>
      <span>{t(row.scope === 'node' ? 'nodeScope' : 'subtreeScope')} · {t(row.active ? 'grantCurrent' : 'grantStale')}</span>
      <span className={css.badge}>{t(row.actions.includes('edit') ? 'accessEdit' : row.actions.includes('read') ? 'accessRead' : 'accessNone')}</span>
    </button>)}</div>}
  </section>
}
