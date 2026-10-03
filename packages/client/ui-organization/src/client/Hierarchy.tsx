/** Readable organization chart with separately confirmed administrator reporting changes. */
import { useEffect, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import type { ConnectionResult } from '@deepseek-ai/dsh-organization-connection/types'
import type { OrganizationProps } from './contract.ts'
import { workgraphError } from './workgraph-view.ts'
import css from './Organization.module.css'
type Node = NonNullable<ConnectionResult['hierarchy']>[number]
/** @param props - Native identity and fixed hierarchy actions. @returns Reporting tree and admin-only editing. */
export function OrganizationHierarchy(props: OrganizationProps) {
  const c = props.useOrganization(s => s.connection), { t } = props
  const [chart, setChart] = useState<{ generation: number; nodes: Node[] }>(), [selected, setSelected] = useState('')
  const [supervisor, setSupervisor] = useState(''), [busy, setBusy] = useState(false), [notice, setNotice] = useState(''), [reload, setReload] = useState(0)
  const admin = c.organizations.find(o => o.id === c.organizationId)?.role === 'admin'
  useEffect(() => {
    let active = true; setChart(undefined); setSelected(''); setNotice('')
    if (c.phase === 'ready') void props.connection({ kind: 'hierarchy' }).then((r) => {
      if (active && r.hierarchy && r.generation === c.generation) setChart({ generation: c.generation, nodes: r.hierarchy })
    }, (error: unknown) => { if (active) setNotice(t(workgraphError(error))) })
    return () => { active = false }
  }, [c.generation, c.phase, reload])
  const nodes = c.phase === 'ready' && chart?.generation === c.generation ? chart.nodes : []
  const member = nodes.find(n => n.id === selected)
  const isDescendant = (id: string, parent: string) => {
    const visited = new Set<string>(); let current: string | null | undefined = id
    while (current && !visited.has(current)) {
      if (current === parent) return true
      visited.add(current); current = nodes.find(n => n.id === current)?.supervisorId
    }
    return false
  }
  const draw = (node: Node) => <li key={node.id}>
    <button className={css.chartNode} type="button" aria-pressed={selected === node.id} onClick={() => { setSelected(node.id); setSupervisor(node.supervisorId ?? '') }}>
      <strong>{node.username}</strong><span>{t(node.role === 'admin' ? 'adminRole' : 'memberRole')}</span>
      {!node.enabled && <small>{t('disabledMember')}</small>}
    </button>
    {nodes.some(n => n.supervisorId === node.id) && <ul>{nodes.filter(n => n.supervisorId === node.id).map(draw)}</ul>}
  </li>
  return <section className={css.form}>
    <p>{t('hierarchyHint')}</p>
    <div className={css.chart} role="group" aria-label={t('hierarchyTitle')}><ul>{nodes.filter(n => !nodes.some(p => p.id === n.supervisorId)).map(draw)}</ul></div>
    {notice && <p role="status">{notice}</p>}
    {member && admin && <form className={css.form} onSubmit={(event) => {
      event.preventDefault(); if (busy || c.pendingOperation) return
      setBusy(true); setNotice('')
      void props.connection({ kind: 'command', command: { kind: 'set-supervisor', operationId: randomUUID(),
        organizationId: c.organizationId, membershipId: member.id, supervisorId: supervisor || null,
        expectedVersion: member.version } })
        .then(() => { setReload(n => n + 1) }, (error: unknown) => { setNotice(t(workgraphError(error))) })
        .finally(() => { setBusy(false) })
    }}><h4>{member.username}</h4><label>{t('directSupervisor')}<select value={supervisor} disabled={busy} onChange={(e) => { setSupervisor(e.target.value) }}>
        <option value="">{t('hierarchyRoot')}</option>{nodes.filter(n => n.enabled && !isDescendant(n.id, member.id)).map(n => <option key={n.id} value={n.id}>{n.username}</option>)}
      </select></label><p>{t('hierarchyChangeHint')}</p><Button type="submit" disabled={busy || !!c.pendingOperation || supervisor === (member.supervisorId ?? '')}>{t('save')}</Button></form>}
  </section>
}
