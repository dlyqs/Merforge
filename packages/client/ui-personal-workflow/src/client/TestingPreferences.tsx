/** Profile planning defaults and explicit testing override. */
import { useEffect, useRef, useState } from 'react'
import { Button, Switch, IconBranchOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkflowPreferences, SetWorkflowPreferencesRequest, WorkflowTestingPreferences, SetWorkflowTestingPreferencesRequest } from '@deepseek-ai/dsh-personal-workflow/types'
import { taskWorkspaceStyles as css } from '@deepseek-ai/dsh-client-ui-primitives'

/** Host-owned preference operations available only to the user settings surface. */
export interface TestingPreferencesActions {
  readPlanningPreferences(this: void): Promise<WorkflowPreferences>
  setPlanningPreferences(request: SetWorkflowPreferencesRequest): Promise<WorkflowPreferences>
  readPreferences(this: void): Promise<WorkflowTestingPreferences>
  setPreferences(request: SetWorkflowTestingPreferencesRequest): Promise<WorkflowTestingPreferences>
}

/** Render durable planning preferences and a separate testing override.
 * @param props - Settings slot, localized copy and Host callbacks.
 * @returns Temporary testing controls.
 */
export function TestingPreferences(props: PropsRuntime<'settings.personal.testing'> & PropsLocale<'personalWorkflow'> & TestingPreferencesActions) {
  const [planning, setPlanning] = useState<WorkflowPreferences | null>(null)
  const [value, setValue] = useState<WorkflowTestingPreferences | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [reload, setReload] = useState(0)
  const lock = useRef(false)
  useEffect(() => {
    let active = true
    void Promise.all([props.readPreferences(), props.readPlanningPreferences()]).then(([result, defaults]) => {
      if (active) { setValue(result); setPlanning(defaults); setError(null) }
    }, (reason: unknown) => {
      if (active) setError(String(reason))
    })
    return () => { active = false }
  }, [props.readPreferences, props.readPlanningPreferences, reload])
  const change = async (forceDecomposition: boolean): Promise<void> => {
    if (lock.current || value === null) return
    lock.current = true; setBusy(true); setError(null)
    try { setValue(await props.setPreferences({ forceDecomposition, expectedRevision: value.revision })) }
    catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally { lock.current = false; setBusy(false) }
  }
  const changePlanning = async (enabled: boolean, granularity: WorkflowPreferences['granularity']): Promise<void> => {
    if (lock.current || planning === null) return
    lock.current = true; setBusy(true); setError(null)
    try { setPlanning(await props.setPlanningPreferences({ enabled, granularity, expectedRevision: planning.revision })) }
    catch (reason: unknown) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { lock.current = false; setBusy(false) }
  }
  return <section className={css.testing}>
    <div className={css.sectionHeading}><h3>{props.t('planningTitle')}</h3></div>
    <div className={css.settingRow}>
      <div className={css.settingCopy}><strong>{props.t('defaultPlanning')}</strong><p>{props.t('defaultPlanningHint')}</p></div>
      <Switch label={props.t('defaultPlanning')} checked={planning?.enabled ?? false} disabled={busy || planning === null || error !== null}
        onChange={(enabled) => { if (planning !== null) void changePlanning(enabled, planning.granularity) }} />
    </div>
    <label className={css.field}>{props.t('granularity')}<select value={planning?.granularity ?? 'balanced'} disabled={busy || planning === null || error !== null}
      onChange={(event) => { if (planning !== null) void changePlanning(planning.enabled, event.target.value === 'fine' ? 'fine' : 'balanced') }}>
      <option value="balanced">{props.t('balancedGranularity')}</option><option value="fine">{props.t('fineGranularity')}</option>
    </select></label>
    <div className={css.sectionHeading}><h3>{props.t('testingTitle')}</h3><span className={css.testTag}>{props.t('testingBadge')}</span></div>
    <div className={css.settingRow}>
      <span className={css.settingIcon}><IconBranchOutlineRegular size={20} /></span>
      <div className={css.settingCopy}><strong>{props.t('forceDecomposition')}</strong><p>{props.t('forceDecompositionHint')}</p></div>
      <Switch label={props.t('forceDecomposition')} checked={value?.forceDecomposition ?? false} disabled={busy || value === null || error !== null}
        onChange={(enabled) => { void change(enabled) }} />
    </div>
    {(busy || (value === null && error === null)) && <p className={css.hint} role="status">{props.t('savingPreferences')}</p>}
    {error !== null && <><p className={css.error} role="alert">{props.t('error', { message: error })}</p>
      <Button variant="outline" disabled={busy} onClick={() => { setReload(current => current + 1) }}>{props.t('refresh')}</Button></>}
  </section>
}
