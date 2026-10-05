/** Native-backend setup presentation, independent of API credential forms. */
import { useEffect, useId } from 'react'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import { Button, Input, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { CodexSetupSnapshot, CodexSetupCategory } from '@deepseek-ai/dsh-agent-codex/setup-types'
import type { CodexSetupSource } from './codex-source.ts'
import type { ModelsKey } from './locales.ts'
import css from './CodexCard.module.css'
import styles from './ModelsSection.module.css'

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
    snapshot.catalog.category === 'login-required' && needsLogin ? undefined : snapshot.catalog.category, snapshot.login.category,
  ].filter((category): category is CodexSetupCategory => category !== undefined))]
  return (
    <section id="codex" className={css.section} aria-labelledby={id} aria-busy={state.busy || active}>
      <h2 id={id} className={styles.title}>{t('codex.title')}</h2>
      <div className={styles.rowCard}>
        <div className={`${styles.rowHead} ${css.accountRow}`}>
          <span className={styles.rowIdentity}>
            <StateDot state={snapshot?.account.status === 'known' ? needsLogin ? 'warning' : 'done' : snapshot?.account.status === 'error' ? 'error' : 'idle'} />
            <span className={styles.rowName}>{t(snapshot ? accountKey(snapshot) : 'codex.account.unknown')}</span>
          </span>
          <div className={styles.rowActions}>
            <Button variant="ghost" size="sm" disabled={state.busy || active} onClick={() => { void detect() }}>{t(state.busy ? 'codex.detecting' : 'codex.detect')}</Button>
            {needsLogin && !active && <Button variant="primary" size="sm" disabled={state.busy || snapshot.runtime.status !== 'ready' || snapshot.login.cleanup === 'failed'} onClick={() => { void start() }}>{t('codex.start')}</Button>}
          </div>
        </div>
        <dl className={css.facts}>
          <div><dt>{t('codex.runtime')}</dt><dd>{snapshot?.runtime.version ?? t('codex.runtime.bundled')} · {t(`codex.runtime.${snapshot?.runtime.status ?? 'unknown'}`)}</dd></div>
          <div><dt>{t('codex.models')}</dt><dd>{t(`codex.models.${snapshot?.catalog.status ?? 'unknown'}`)}</dd></div>
        </dl>
        {login !== 'idle' && <p className={styles.intro} role="status" aria-live="polite">{t(`codex.login.${login}`)}</p>}
        {snapshot?.login.cancellation && <p className={styles.intro}>{t(`codex.cancel.${snapshot.login.cancellation}`)}</p>}
        {snapshot?.login.cleanup === 'failed' && <p className={styles.error} role="alert">{t('codex.error.cleanup')}</p>}
        {categories.map(category => <p className={styles.error} role="alert" key={category}>{t(errorKeys[category])}</p>)}
        {state.error && <p className={styles.error} role="alert">{t(`codex.error.${state.error}`)}</p>}
        {device && <div className={css.device}>
          <label htmlFor={`${id}-code`}>{t('codex.code')}</label>
          <Input id={`${id}-code`} readOnly value={device.userCode} className={css.code ?? ''} />
          <p className={styles.intro}>{t('codex.codeHint')}</p>
          <div className={css.deviceActions}>
            <Button variant="outline" disabled={state.busy} onClick={() => { void copy() }}>{t(state.copied ? 'codex.copied' : 'codex.copy')}</Button>
            <Button variant="primary" disabled={state.busy} onClick={() => { void openVerification() }}>{t('codex.open')}</Button>
            <Button variant="outline" disabled={state.busy} onClick={() => { void cancel() }}>{t('codex.cancel')}</Button>
          </div>
        </div>}
        {active && !device && <p className={styles.intro}>{t('codex.ownerWaiting')}</p>}
      </div>
    </section>
  )
}
