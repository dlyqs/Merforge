/** Settings shell navigation consumed without importing presentation implementations. */
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'

/** One shell-owned settings view; targets are fixed model-setup sections. */
export interface SettingsNavigationView {
  readonly open: boolean
  readonly section?: string
  readonly target?: 'codex' | 'api'
  /** Originating settings section retained while visiting model setup. */
  readonly returnSection?: string
}

/** Service supplied by the active settings shell. */
export interface SettingsNavigation {
  readonly view: ObservableSnapshot<SettingsNavigationView>
  /**
   * Open a registered section without changing the underlying editor.
   * @param section - settings entry ID.
   * @param target - optional model-setup card.
   */
  open(section: string, target?: 'codex' | 'api'): void
  /** Close settings and return to the mounted caller. */
  close(): void
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    settingsNavigation: SettingsNavigation
  }
}
