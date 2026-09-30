/** Accepted inputs, native target verification and explicit original-issuer final confirmation. */
import { useEffect, useRef, useState } from 'react'
import { Button, Checkbox } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ConnectionResult } from '@deepseek-ai/dsh-organization-connection/types'
import type { OrganizationTaskView } from '@deepseek-ai/dsh-organization'
import type { OrganizationProjectId } from '@deepseek-ai/dsh-organization/types'
import type { OrganizationProps } from './contract.ts'
import { workgraphError } from './workgraph-view.ts'
import css from './Organization.module.css'
/**
 * @param props - Current visible task and fixed native callbacks.
 * @returns Separate prerequisite, accepted evidence, target and delivery states.
 */
export function IntegrationPanel(props: OrganizationProps & { task: OrganizationTaskView; projectId: OrganizationProjectId }) {
  const c = props.useOrganization(s => s.connection), { t, task } = props
  const [page, setPage] = useState<{ generation: number; value: NonNullable<ConnectionResult['integration']> }>()
  const [busy, setBusy] = useState(false), [confirmed, setConfirmed] = useState(false), [notice, setNotice] = useState('')
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const selector = { organizationId: c.organizationId, projectId: props.projectId, planId: task.planId,
    taskId: task.id, planRevision: task.revision }
  const load = async () => {
    const result = await props.connection({ kind: 'integration-read', request: selector })
    if (alive.current && result.integration && result.generation !== undefined) {
      setPage({ generation: result.generation, value: result.integration })
    }
  }
  useEffect(() => {
    setConfirmed(false)
    if (c.phase === 'ready') void load().catch((e: unknown) => { if (alive.current) setNotice(t(workgraphError(e))) })
  }, [c.generation, c.phase, task.revision])
  const value = c.phase === 'ready' && page?.generation === c.generation ? page.value : undefined
  const act = async (kind: 'integration-verify' | 'integration-confirm') => {
    if (!value || kind === 'integration-confirm' && (!confirmed || !value.latest)) return
    setBusy(true); setNotice('')
    try {
      await props.connection({ kind, request: kind === 'integration-verify' ? selector
        : { ...selector, integrationId: value.latest?.id, confirmed: true } })
      if (alive.current) await load()
    } catch (e) { if (alive.current) setNotice(t(workgraphError(e))) }
    finally { if (alive.current) { setBusy(false); setConfirmed(false) } }
  }
  return <section className={css.card} aria-busy={busy}>
    <h4>{t('integrationTitle')}</h4><p>{t('integrationHint')}</p>
    {notice && <p role="status">{notice}</p>}
    {value && <>
      <p>{t(value.dependenciesReady ? 'integrationDependenciesReady' : 'integrationDependenciesBlocked')}</p>
      <p>{t(value.inputsReady ? 'integrationInputsReady' : 'integrationInputsBlocked')}</p>
      {value.inputs.map(input => <div key={input.submissionId}><p>{input.submissionId}</p>
        {input.artifacts.map(a => <p key={a.artifactId}>{a.artifactId} · {a.sha256}</p>)}
      </div>)}
      <p>{t(value.delivered ? 'integrationDelivered' : value.latest?.observation.result === 'verified'
        ? 'integrationVerified' : value.latest ? 'integrationRejected' : 'integrationPending')}</p>
      {value.latest && <><p>{value.latest.observation.baseCommit}</p>
        {value.latest.observation.files.map(f => <p key={f.path}>{f.path} · {f.sha256 ?? t('integrationAbsent')}</p>)}</>}
      <Button disabled={busy || !!c.pendingOperation || !value.inputsReady || !value.dependenciesReady || value.delivered}
        onClick={() => { void act('integration-verify') }}>{t('integrationVerify')}</Button>
      {value.canConfirm && !value.delivered && <>
        <Checkbox checked={confirmed} disabled={busy} label={t('integrationConfirmIntent')} onChange={setConfirmed} />
        <Button disabled={busy || !!c.pendingOperation || !confirmed || value.latest?.observation.result !== 'verified'}
          onClick={() => { void act('integration-confirm') }}>{t('integrationConfirm')}</Button>
      </>}
    </>}
  </section>
}
