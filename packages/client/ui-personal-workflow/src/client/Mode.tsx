/** Upward execution-mode menu for planning and its persisted preference. */
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import { useEffect, useRef, useState } from 'react'
import { Button, Menu, IconBranchOutlineRegular, IconChevronDownOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkflowMode, WorkflowPreferences, OperationId, SetWorkflowModeRequest } from '@deepseek-ai/dsh-personal-workflow/types'
import { taskWorkspaceStyles as css } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ModeProps } from './contract.ts'

/** Persist the user's mode gesture independently from submitting a goal.
 * @param props - Conversation binding and mode callbacks.
 * @returns Execution-mode menu or a retryable loading failure.
 */
export function Mode(props: ModeProps) {
  const [mode, setMode] = useState<WorkflowMode | null>(null)
  const [planning, setPlanning] = useState<WorkflowPreferences | null>(null)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [reload, setReload] = useState(0)
  const pending = useRef<SetWorkflowModeRequest | null>(null)
  const lock = useRef(false)
  const running = props.useSession(value => value.running)
  useEffect(() => {
    let active = true
    const preferences = props.personalPlanning ? props.readPlanningPreferences() : Promise.resolve(null)
    void Promise.all([props.readMode(props.sessionId), preferences]).then(([value, preferences]) => {
      if (active) { setMode(value); setPlanning(preferences); setError(null) }
    }, (reason: unknown) => {
      if (active) setError(String(reason))
    })
    return () => { active = false }
  }, [props.sessionId, props.readMode, props.readPlanningPreferences, props.personalPlanning, reload, running])
  const select = async (enabled: boolean): Promise<void> => {
    if (mode === null || lock.current) return
    lock.current = true; setBusy(true); setError(null)
    if (pending.current?.enabled !== enabled || pending.current.expectedRevision !== mode.revision) {
      pending.current = { sessionId: props.sessionId, enabled, expectedRevision: mode.revision, operationId: randomUUID() as OperationId }
    }
    try {
      setMode(await props.setMode(pending.current))
      pending.current = null
    } catch (reason: unknown) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { lock.current = false; setBusy(false) }
  }
  const prefer = async (granularity: WorkflowPreferences['granularity']): Promise<void> => {
    if (planning === null || lock.current) return
    lock.current = true; setBusy(true); setError(null)
    try { setPlanning(await props.setPlanningPreferences({ enabled: planning.enabled, granularity, expectedRevision: planning.revision })) }
    catch (reason: unknown) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { lock.current = false; setBusy(false) }
  }
  return <div className={css.modeControl}>
    {mode === null ? <Button variant="ghost" disabled={error === null} onClick={() => { setReload(value => value + 1) }}>{props.t(error === null ? 'modeLoading' : 'refresh')}</Button>
      : <Menu open={open} side="top" portal onClose={() => { setOpen(false) }}
        selectedIds={[mode.enabled ? 'on' : 'off', planning?.granularity ?? 'balanced']}
        items={[
          { type: 'label', id: 'planning', text: props.t('planningTitle') },
          { id: 'on', label: props.t('planningOn'), disabled: busy || running },
          { id: 'off', label: props.t('planningOff'), disabled: busy || running },
          ...(!props.personalPlanning ? [] : [
            { type: 'separator' as const, id: 'preferences' },
            { type: 'label' as const, id: 'preference-label', text: props.t('granularity') },
            { id: 'balanced', label: <span className={css.settingCopy}><strong>{props.t('balancedGranularity')}</strong><p>{props.t('hierarchicalHint')}</p></span>, disabled: busy || running || planning === null },
            { id: 'fine', label: <span className={css.settingCopy}><strong>{props.t('fineGranularity')}</strong><p>{props.t('phasePlanningHint')}</p></span>, disabled: busy || running || planning === null },
          ]),
        ]} onSelect={(id) => {
          if (id === 'on' || id === 'off') void select(id === 'on')
          else if (id === 'balanced' || id === 'fine') void prefer(id)
        }} anchor={<Button variant="ghost" size="sm" className={css.composerButton} icon={<IconBranchOutlineRegular />}
          aria-haspopup="menu" aria-expanded={open} title={props.t('modeHint')} disabled={busy || running}
          onClick={() => { setOpen(value => !value); setReload(value => value + 1) }}>{props.t('mode')}<IconChevronDownOutlineRegular size={12} /></Button>} />}
    {error !== null && <><p className={css.error} role="alert">{props.t('error', { message: error })}</p>
      <Button variant="ghost" disabled={busy} onClick={() => {
        pending.current = null; setMode(null); setReload(value => value + 1)
      }}>{props.t('refresh')}</Button></>}

  </div>
}
