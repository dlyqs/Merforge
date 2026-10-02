/** Optional Desktop model setup after the welcome stage, without automatic work. */
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import { useEffect, useState } from 'react'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { CodexCardInjected } from './CodexCard.tsx'
import { OnboardingModal } from './OnboardingModal.tsx'
import css from './CodexCard.module.css'

/** Shared setup observation and a preference-only completion write. */
export interface ModelSetupOnboardingInjected extends CodexCardInjected {
  hooks: CodexCardInjected['hooks'] & { preference: ConfigForm<Record<string, unknown>> }
  acknowledge: () => Promise<boolean>
}

/**
 * Render optional Codex/API choices for a fresh Desktop profile.
 * @param props - coordinator and fixed setup callbacks.
 * @returns first-use dialog or no content.
 */
export function ModelSetupOnboarding(props: PropsRuntime<'settings.onboarding'> & InjectFace<ModelSetupOnboardingInjected>) {
  const { usePreference, useCodex, useSessions, ensure, complete, openSection, acknowledge, t } = props
  const preference = usePreference(value => value)
  const setup = useCodex(value => value)
  const existing = useSessions(state => Object.values(state.byId).some(session => !session.blank))
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)
  const done = preference.value?.modelSetupVersion === 'v1' || existing
  useEffect(() => {
    if (done) complete()
    else if (preference.status === 'ready') ensure()
  }, [done, complete, ensure, preference.status])
  if (done || preference.status === 'loading') return null

  const finish = async (target?: 'codex' | 'api'): Promise<void> => {
    if (saving) return
    setSaving(true)
    setFailed(false)
    try {
      if (!await acknowledge()) {
        setFailed(true)
        if (target === undefined) complete()
        return
      }
      complete()
      if (target !== undefined) openSection('models', target)
    } finally { setSaving(false) }
  }
  const ready = setup.view?.snapshot.catalog.status === 'ready'
  return (
    <OnboardingModal title={t('setup.title')} focusTitle>
      <p>{t('setup.description')}</p>
      <p role="status">{t(ready ? 'setup.ready' : 'setup.detect')}</p>
      <div className={css.actions}>
        <Button variant="primary" disabled={saving} onClick={() => { void finish('codex') }}>{t('setup.codex')}</Button>
        <Button variant="outline" disabled={saving} onClick={() => { void finish('api') }}>{t('setup.api')}</Button>
        {ready && <Button variant="outline" disabled={saving} onClick={() => { void finish() }}>{t('setup.continue')}</Button>}
        <Button variant="ghost" disabled={saving} onClick={() => { void finish() }}>{t('setup.later')}</Button>
      </div>
      {(failed || preference.status === 'unavailable') && <p role="alert">{t('setup.error')}</p>}
    </OnboardingModal>
  )
}
