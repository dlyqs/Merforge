/** Native-backend setup presentation, independent of API credential forms. */
import { useEffect, useId } from 'react'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { CodexSetupSnapshot, CodexSetupCategory } from '@deepseek-ai/dsh-agent-codex/setup-types'
import type { CodexSetupSource } from './codex-source.ts'
import type { ModelsKey } from './locales.ts'
import css from './CodexCard.module.css'

/** Plain operations and one renderer-bound Desktop observation. */
export interface CodexCardInjected {
  hooks: { codex: CodexSetupSource['store'] }
  ensure: () => void
  detect: () => Promise<void>
  start: () => Promise<void>
  cancel: () => Promise<void>
  openVerification: () => Promise<void>
  copy: () => Promise<void>
  t: (key: ModelsKey) => string
}

const errorKeys: Record<CodexSetupCategory, ModelsKey> = {
  payload: 'codex.error.payload', startup: 'codex.error.startup', protocol: 'codex.error.protocol',
  'frame-limit': 'codex.error.protocol', eof: 'codex.error.process', process: 'codex.error.process',
  rpc: 'codex.error.rpc', timeout: 'codex.error.timeout', closed: 'codex.error.closed',
  'unknown-start': 'codex.error.unknown', 'unknown-send': 'codex.error.unknown', 'unknown-thread': 'codex.error.unknown',
  cleanup: 'codex.error.cleanup', busy: 'codex.error.busy', 'login-required': 'codex.error.loginRequired',
  'login-failed': 'codex.error.loginFailed', 'models-empty': 'codex.error.modelsEmpty', catalog: 'codex.error.catalog',
}

/**
 * Derive authentication copy without treating account:none as login-required.
 * @param snapshot - safe native observations.
 * @returns locale key.
 */
export function accountKey(snapshot: CodexSetupSnapshot): ModelsKey {
  const account = snapshot.account
  if (account.status !== 'known') return account.status === 'error' ? 'codex.account.error' : 'codex.account.unknown'
  if (!account.value.requiresOpenaiAuth) return 'codex.account.notRequired'
  return `codex.account.${account.value.kind}`
}

/**
 * Render availability, owner-only device code and fixed user actions.
 * @param props - registration-bound observation and operations.
 * @returns native settings card.
 */
export function CodexCard(props: InjectFace<CodexCardInjected>) {
  const { useCodex, t, ensure, detect, start, cancel, openVerification, copy } = props
  const state = useCodex(value => value)
  const id = useId()
  useEffect(ensure, [ensure])
  const snapshot = state.view?.snapshot
  const login = snapshot?.login.status ?? 'idle'
  const active = ['starting', 'waiting', 'verifying'].includes(login)
  const device = login === 'waiting' ? state.view?.device : undefined
  const needsLogin = snapshot?.account.status === 'known' && snapshot.account.value.requiresOpenaiAuth && snapshot.account.value.kind === 'none'
  const categories = snapshot === undefined ? [] : [...new Set([
    snapshot.runtime.category, snapshot.account.status === 'error' ? snapshot.account.category : undefined,
    snapshot.catalog.category, snapshot.login.category,
  ].filter((category): category is CodexSetupCategory => category !== undefined))]
  return (
    <section id="codex" className={css.card} aria-labelledby={id} aria-busy={state.busy || active}>
      <h3 id={id}>{t('codex.title')}</h3>
      <p>{t('codex.description')}</p>
      <dl className={css.facts}>
        <dt>{t('codex.runtime')}</dt><dd>{snapshot?.runtime.version ?? t('codex.runtime.bundled')} · {t(`codex.runtime.${snapshot?.runtime.status ?? 'unknown'}`)}</dd>
        <dt>{t('codex.account')}</dt><dd>{t(snapshot ? accountKey(snapshot) : 'codex.account.unknown')}</dd>
        <dt>{t('codex.models')}</dt><dd>{t(`codex.models.${snapshot?.catalog.status ?? 'unknown'}`)}</dd>
      </dl>
      {snapshot?.account.status === 'known' && snapshot.account.value.kind !== 'none' && <p>{t('codex.reuse')}</p>}
      <p role="status" aria-live="polite">{t(`codex.login.${login}`)}</p>
      {snapshot?.login.cancellation && <p>{t(`codex.cancel.${snapshot.login.cancellation}`)}</p>}
      {snapshot?.login.cleanup === 'failed' && <p role="alert">{t('codex.error.cleanup')}</p>}
      {categories.map(category => <p role="alert" key={category}>{t(errorKeys[category])}</p>)}
      {state.error && <p role="alert">{t(`codex.error.${state.error}`)}</p>}
      {device && <div className={css.device}>
        <label htmlFor={`${id}-code`}>{t('codex.code')}</label>
        <input id={`${id}-code`} readOnly value={device.userCode} className={css.code} />
        <p>{t('codex.codeHint')}</p>
        <Button variant="outline" disabled={state.busy} onClick={() => { void copy() }}>{t(state.copied ? 'codex.copied' : 'codex.copy')}</Button>
        <Button variant="primary" disabled={state.busy} onClick={() => { void openVerification() }}>{t('codex.open')}</Button>
        <Button variant="outline" disabled={state.busy} onClick={() => { void cancel() }}>{t('codex.cancel')}</Button>
      </div>}
      {active && !device && <p>{t('codex.ownerWaiting')}</p>}
      <div className={css.actions}>
        <Button variant="outline" disabled={state.busy || active} onClick={() => { void detect() }}>{t(state.busy ? 'codex.detecting' : 'codex.detect')}</Button>
        {needsLogin && !active && <Button variant="primary" disabled={state.busy || snapshot.runtime.status !== 'ready' || snapshot.login.cleanup === 'failed'} onClick={() => { void start() }}>{t('codex.start')}</Button>}
      </div>
      {snapshot?.catalog.models.length ? <ul aria-label={t('codex.modelList')}>
        {snapshot.catalog.models.map(model => <li key={model.id}>{model.displayName} · {t('codex.efforts')}: {model.efforts.join(', ')}</li>)}
      </ul> : null}
    </section>
  )
}
