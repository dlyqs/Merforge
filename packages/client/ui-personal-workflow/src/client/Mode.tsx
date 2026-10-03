/** Explicit per-conversation enhancement mode control. */
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import { useEffect, useRef, useState } from 'react'
import { Button, Switch, Tooltip, IconBranchOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkflowMode, OperationId, SetWorkflowModeRequest } from '@deepseek-ai/dsh-personal-workflow/types'
import { taskWorkspaceStyles as css } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ModeProps } from './contract.ts'

/** Persist the user's mode gesture independently from submitting a goal.
 * @param props - Conversation binding and mode callbacks.
 * @returns Mode switch or a retryable loading failure.
 */
export function Mode(props: ModeProps) {
  const [mode, setMode] = useState<WorkflowMode | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [reload, setReload] = useState(0)
  const pending = useRef<SetWorkflowModeRequest | null>(null)
  const lock = useRef(false)
  const running = props.useSession(value => value.running)
  useEffect(() => {
    let active = true
    void props.readMode(props.sessionId).then((value) => {
      if (active) { setMode(value); setError(null) }
    }, (reason: unknown) => {
      if (active) setError(String(reason))
    })
    return () => { active = false }
  }, [props.sessionId, props.readMode, reload, running])
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
  return <div className={css.modeControl}>
    {mode === null ? <Button variant="ghost" disabled={error === null} onClick={() => { setReload(value => value + 1) }}>{props.t(error === null ? 'modeLoading' : 'refresh')}</Button>
      : <Tooltip label={props.t('modeHint')}><span className={css.modePill} data-enabled={mode.enabled}><IconBranchOutlineRegular size={14} />{props.t('mode')}<Switch label={props.t('mode')} checked={mode.enabled} disabled={busy || running}
        onChange={(enabled) => { void select(enabled) }} /></span></Tooltip>}
    {mode !== null && error === null && <Button variant="ghost" size="sm" disabled={busy || running} onClick={() => { setReload(value => value + 1) }}>{props.t('refresh')}</Button>}
    {error !== null && <><p className={css.error} role="alert">{props.t('error', { message: error })}</p>
      <Button variant="ghost" disabled={busy} onClick={() => {
        pending.current = null; setMode(null); setReload(value => value + 1)
      }}>{props.t('refresh')}</Button></>}

  </div>
}
