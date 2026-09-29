/** Project access editing starts from a named project and shows the member's current permissions. */
import { useEffect, useRef, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import type { ResourceGrantView } from '@deepseek-ai/dsh-organization/types'
import type { OrganizationProps } from './contract.ts'
import { MemberSelect } from './MemberSelect.tsx'
import { workgraphError } from './workgraph-view.ts'
import css from './Organization.module.css'

type Access = 'none' | 'read' | 'write'
const level = (grant: ResourceGrantView | undefined): Access => grant?.actions.includes('write') ? 'write' : grant?.actions.includes('read') ? 'read' : 'none'

/** @param props - Authorized project identity and native actions. @returns Current access list and a single explicit permission change. */
export function ProjectAccess(props: OrganizationProps & { projectId: string }) {
  const c = props.useOrganization(s => s.connection), { t } = props
  const [rows, setRows] = useState<{ generation: number; items: ResourceGrantView[] }>()
  const [member, setMember] = useState('')
  const [access, setAccess] = useState<Access>('read')
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState('')
  const current = rows?.generation === c.generation ? rows.items : undefined
  const active = useRef(true)
  const sequence = useRef(0)
  const latest = useRef(c); latest.current = c
  useEffect(() => { active.current = true; return () => { active.current = false; sequence.current++ } }, [])
  const load = async () => {
    const request = ++sequence.current, generation = latest.current.generation
    const result = await props.connection({ kind: 'grants', projectId: props.projectId })
    if (active.current && request === sequence.current && generation === latest.current.generation && result.grants) {
      setRows({ generation, items: result.grants })
    }
  }
  useEffect(() => {
    if (c.phase === 'ready') void load().catch((error: unknown) => { if (active.current) setNotice(t(workgraphError(error))) })
  }, [c.generation, c.phase, props.projectId])
  const selected = current?.find(row => row.membershipId === member)
  const choose = (id: string) => { setMember(id); setAccess(current?.some(row => row.membershipId === id) ? level(current.find(row => row.membershipId === id)) : 'read'); setNotice('') }
  const save = async () => {
    if (!current || !member) return
    setBusy(true); setNotice('')
    try {
      await props.connection({ kind: 'command', command: { kind: 'set-grant', organizationId: c.organizationId,
        projectId: props.projectId, membershipId: member, actions: access === 'write' ? ['read', 'write'] : access === 'read' ? ['read'] : [],
        expectedVersion: selected?.version ?? 0, operationId: randomUUID() } })
      if (active.current) { setNotice(t('accessSaved')); await load() }
    } catch (error) { if (active.current) setNotice(t(workgraphError(error))) }
    finally { if (active.current) setBusy(false) }
  }
  return <section className={css.form} aria-busy={busy}>
    <p className={css.muted}>{t('projectAccessHint')}</p>
    {notice && <p role="status">{notice}</p>}
    {current && <div className={css.accessList}>{current.filter(row => row.actions.length).map(row => <button type="button" className={css.accessMember}
      key={row.membershipId} disabled={busy} onClick={() => { choose(row.membershipId) }}>
      <span>{c.members.find(item => item.id === row.membershipId)?.username ?? t('selectedMember')}</span>
      <span className={css.badge}>{t(level(row) === 'write' ? 'accessWrite' : 'accessRead')}</span>
    </button>)}</div>}
    <form onSubmit={(event) => { event.preventDefault(); void save() }}>
      <fieldset className={css.form} disabled={busy || c.phase !== 'ready' || !!c.pendingOperation || !current}>
        <div className={css.fieldsGrid}>
          <MemberSelect t={t} connection={c} labelKey="memberId" value={member} change={choose} />
          <label className={css.field}>{t('accessLevel')}<select value={access} onChange={(event) => { setAccess(event.target.value as Access) }}>
            <option value="none">{t('accessNone')}</option><option value="read">{t('accessRead')}</option><option value="write">{t('accessWrite')}</option>
          </select></label>
        </div>
        <Button type="submit" variant="primary" disabled={!member || access === level(selected)}>{t('saveAccess')}</Button>
      </fieldset>
    </form>
    {!current && <Button disabled={busy || c.phase !== 'ready'} onClick={() => { void load().catch((error: unknown) => { setNotice(t(workgraphError(error))) }) }}>{t('refreshAccess')}</Button>}
  </section>
}
