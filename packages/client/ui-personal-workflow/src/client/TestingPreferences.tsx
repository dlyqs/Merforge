/** Explicit local testing override; failed writes never appear enabled. */
import { useEffect, useRef, useState } from 'react'
import { Button, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkflowTestingPreferences, SetWorkflowTestingPreferencesRequest } from '@deepseek-ai/dsh-personal-workflow/types'
import css from './Workflow.module.css'

/** Host-owned preference operations available only to the user settings surface. */
export interface TestingPreferencesActions {
  readPreferences(this: void): Promise<WorkflowTestingPreferences>
  setPreferences(request: SetWorkflowTestingPreferencesRequest): Promise<WorkflowTestingPreferences>
}

/** Render a durable test switch with explicit save/error state.
 * @param props - Settings slot, localized copy and Host callbacks.
 * @returns Temporary testing controls.
 */
export function TestingPreferences(props: PropsRuntime<'settings.personal.testing'> & PropsLocale<'personalWorkflow'> & TestingPreferencesActions) {
  const [value, setValue] = useState<WorkflowTestingPreferences | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [reload, setReload] = useState(0)
  const lock = useRef(false)
  useEffect(() => {
    let active = true
    void props.readPreferences().then((result) => { if (active) { setValue(result); setError(null) } }, (reason: unknown) => {
      if (active) setError(String(reason))
    })
    return () => { active = false }
  }, [props.readPreferences, reload])
  const change = async (forceDecomposition: boolean): Promise<void> => {
    if (lock.current || value === null) return
    lock.current = true; setBusy(true); setError(null)
    try { setValue(await props.setPreferences({ forceDecomposition, expectedRevision: value.revision })) }
    catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally { lock.current = false; setBusy(false) }
  }
  return <section className={css.testing}>
    <h3>{props.t('testingTitle')}</h3>
    <div className={css.actions}>
      <Switch label={props.t('forceDecomposition')} checked={value?.forceDecomposition ?? false} disabled={busy || value === null || error !== null}
        onChange={(enabled) => { void change(enabled) }} />
      <span>{props.t('forceDecomposition')}</span>
      {busy && <span role="status">{props.t('loading')}</span>}
    </div>
    <p>{props.t('forceDecompositionHint')}</p>
    {error !== null && <><p role="alert">{props.t('error', { message: error })}</p>
      <Button variant="outline" disabled={busy} onClick={() => { setReload(current => current + 1) }}>{props.t('refresh')}</Button></>}
  </section>
}
