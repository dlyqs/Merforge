/** Upward execution-mode panel for planning and its persisted preference. */
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import { useEffect, useRef, useState } from 'react'
import { Button, Menu, Switch, IconBranchOutlineRegular, IconChevronDownOutlineRegular, IconCheckOutlineRegular, IconCloseOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkflowMode, WorkflowPreferences, OperationId, SetWorkflowModeRequest } from '@deepseek-ai/dsh-personal-workflow/types'
import { taskWorkspaceStyles as css } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ModeProps } from './contract.ts'
import panel from './ComposerPanels.module.css'

/** Persist mode and preference gestures independently from submitting a goal.
 * @param props - Conversation binding and scoped planning callbacks.
 * @returns Anchored settings panel or a retryable loading failure.
 */
export function Mode(props: ModeProps) {
  const { t } = props
  const [mode, setMode] = useState<WorkflowMode | null>(null)
  const [planning, setPlanning] = useState<WorkflowPreferences | null>(null)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [reading, setReading] = useState(true)
  const [reload, setReload] = useState(0)
  const pending = useRef<SetWorkflowModeRequest | null>(null)
  const lock = useRef(false)
  const running = props.useSession(value => value.running)
  useEffect(() => {
    let active = true
    setReading(true)
    void Promise.all([props.readMode(props.sessionId), props.readPlanningPreferences()]).then(([value, preferences]) => {
      if (active) { setMode(value); setPlanning(preferences); setError(null); setReading(false) }
    }, (reason: unknown) => {
      if (active) { setError(String(reason)); setReading(false) }
    })
    return () => { active = false }
  }, [props.sessionId, props.readMode, props.readPlanningPreferences, reload, running])
  const select = async (enabled: boolean): Promise<void> => {
    if (mode === null || lock.current) return
    lock.current = true; setBusy(true); setError(null)
    if (pending.current?.enabled !== enabled || pending.current.expectedRevision !== mode.revision) {
      pending.current = { sessionId: props.sessionId, enabled, expectedRevision: mode.revision, operationId: randomUUID() as OperationId }
    }
    try {
      const next = await props.setMode(pending.current)
      setMode(next)
      if (!props.personalPlanning) setPlanning(value => value === null ? null
        : { ...value, enabled: next.enabled, revision: next.revision })
      pending.current = null
    } catch (reason: unknown) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { lock.current = false; setBusy(false) }
  }
  const prefer = async (granularity: WorkflowPreferences['granularity']): Promise<void> => {
    if (planning === null || lock.current || planning.granularity === granularity) return
    lock.current = true; setBusy(true); setError(null)
    try {
      const next = await props.setPlanningPreferences({ enabled: planning.enabled, granularity, expectedRevision: planning.revision })
      setPlanning(next)
      if (!props.personalPlanning) setMode({ enabled: next.enabled, revision: next.revision })
    } catch (reason: unknown) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { lock.current = false; setBusy(false) }
  }
  return <div className={css.modeControl}>
    {mode === null ? <Button variant="ghost" disabled={error === null} onClick={() => { setReload(value => value + 1) }}>{t(error === null ? 'modeLoading' : 'refresh')}</Button>
      : <Menu open={open} side="top" portal role="dialog" label={t('mode')} listClassName={panel.modePanel}
        onClose={() => { setOpen(false) }} anchor={<Button variant="ghost" size="sm" className={css.composerButton} icon={<IconBranchOutlineRegular />}
          aria-haspopup="dialog" aria-expanded={open} title={t('modeHint')} disabled={busy || running}
          onClick={() => { setOpen(value => !value); if (!open) setReload(value => value + 1) }}>{t('mode')}<IconChevronDownOutlineRegular size={12} /></Button>}>
        <div className={panel.content}>
          <header className={panel.header}><h3>{t('mode')}</h3>
            <Button variant="ghost" size="sm" aria-label={t('close')} icon={<IconCloseOutlineRegular />} onClick={() => { setOpen(false) }} /></header>
          <div className={panel.switchRow}><div><strong>{t('planningTitle')}</strong><p className={panel.hint}>{t('modeHint')}</p></div>
            <Switch label={t('planningTitle')} checked={mode.enabled} disabled={busy || reading || running} onChange={(value) => { void select(value) }} /></div>
          <section className={`${panel.section} ${panel.divider}`} aria-label={t('planningPreference')}>
            <h4>{t('planningPreference')}</h4>
            <div className={panel.choiceGrid}>{(['balanced', 'fine'] as const).map(value => <button key={value} type="button" className={panel.choice}
              aria-pressed={planning?.granularity === value} disabled={busy || reading || running || planning === null}
              onClick={() => { void prefer(value) }}>
              <span className={panel.choiceTitle}><strong>{t(value === 'balanced' ? 'balancedGranularity' : props.personalPlanning ? 'fineGranularity' : 'fineAllocation')}</strong>
                {planning?.granularity === value && <IconCheckOutlineRegular size={14} />}</span>
              <span className={panel.hint}>{t(value === 'balanced' ? 'hierarchicalHint' : props.personalPlanning ? 'phasePlanningHint' : 'fineAllocationHint')}</span>
            </button>)}</div>
            <p className={panel.hint}>{t(props.personalPlanning ? 'preferenceScope' : 'accountPreferenceScope')}</p>
          </section>
          {busy && <p className={panel.loading} role="status">{t('savingPreferences')}</p>}
          {error !== null && <div className={panel.section}><p className={panel.error} role="alert">{t('error', { message: error })}</p>
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => { pending.current = null; setReload(value => value + 1) }}>{t('refresh')}</Button></div>}
        </div>
      </Menu>}
    {error !== null && !open && <p className={panel.error} role="alert">{t('error', { message: error })}</p>}
  </div>
}
