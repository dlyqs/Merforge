/** Accepted inputs, native target verification and explicit original-issuer final confirmation. */
import { useEffect, useRef, useState } from 'react'
import { Button, Checkbox } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ConnectionResult } from '@deepseek-ai/dsh-organization-connection/types'
import type { OrganizationTaskView } from '@deepseek-ai/dsh-organization'
import type { OrganizationProjectId } from '@deepseek-ai/dsh-organization/types'
import type { OrganizationProps } from './contract.ts'
import { workgraphError } from './workgraph-view.ts'
import css from './TaskInspector.module.css'
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
  return <section className={css.panel} aria-busy={busy}>
    <h4>{t('integrationTitle')}</h4>
    <p className={css.hint}>{t('integrationHint')}</p>
    {notice && <p className={css.notice} role="status">{notice}</p>}
    {value ? <>
      <dl className={css.facts}>
        <div><dt>{t('dependencies')}</dt><dd>{t(value.dependenciesReady ? 'integrationDependenciesReady' : 'integrationDependenciesBlocked')}</dd></div>
        <div><dt>{t('taskArtifacts')}</dt><dd>{t(value.inputsReady ? 'integrationInputsReady' : 'integrationInputsBlocked')}</dd></div>
      </dl>
      <p className={css.notice} data-tone={value.latest?.observation.result === 'rejected' ? 'warn' : undefined} role="status">
        {t(value.delivered ? 'integrationDelivered' : value.latest?.observation.result === 'verified'
          ? 'integrationVerified' : value.latest ? 'integrationRejected' : 'integrationPending')}
      </p>
      <section className={css.step}>
        <div className={css.stepHeading}><span aria-hidden="true">1</span><h5>{t('taskIntegrationStep')}</h5></div>
        {(!value.inputsReady || !value.dependenciesReady) && <p className={css.hint}>{t('taskIntegrationEmpty')}</p>}
        <div className={css.actions}><Button variant="outline" disabled={busy || !!c.pendingOperation || !value.inputsReady || !value.dependenciesReady || value.delivered}
          onClick={() => { void act('integration-verify') }}>{t('integrationVerify')}</Button></div>
      </section>
      {value.canConfirm && !value.delivered && <section className={css.step}>
        <div className={css.stepHeading}><span aria-hidden="true">2</span><h5>{t('taskFinalConfirmStep')}</h5></div>
        <Checkbox checked={confirmed} disabled={busy || value.latest?.observation.result !== 'verified'} label={t('integrationConfirmIntent')} onChange={setConfirmed} />
        <div className={css.footer}><Button variant="primary" disabled={busy || !!c.pendingOperation || !confirmed || value.latest?.observation.result !== 'verified'}
          onClick={() => { void act('integration-confirm') }}>{t('integrationConfirm')}</Button></div>
      </section>}
      {(value.inputs.length > 0 || value.latest) && <details className={css.advanced}><summary>{t('taskIntegrationInputs')}</summary><div className={css.panel}>
        {value.inputs.map(input => <div className={css.record} key={input.submissionId}>
          <code>{input.submissionId}</code>{input.artifacts.map(artifact => <code key={artifact.artifactId}>
            {artifact.artifactId} · {artifact.sha256}
          </code>)}
        </div>)}
        {value.latest && <div className={css.record}><code>{value.latest.observation.baseCommit}</code>
          {value.latest.observation.files.map(file => <div key={file.path}><strong>{file.path}</strong><p>{file.sha256 ?? t('integrationAbsent')}</p></div>)}
        </div>}
      </div></details>}
    </> : <p className={css.notice} role="status">{t(c.phase === 'ready' ? 'loading' : 'qualificationRecheck')}</p>}
  </section>
}
