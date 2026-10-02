/** The settings shell owns navigation and publishes one view to its renderer. */
import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsNavigation, SettingsNavigationView } from '@deepseek-ai/dsh-client-ui-settings/client'

/** Opens settings over the current caller instead of replacing its view or draft. */
export class SettingsNavigationService extends Service implements SettingsNavigation {
  /** One observable settings view, shared by shell actions and feature callbacks. */
  readonly view = createSnapshotStore<SettingsNavigationView>({ open: false })
  /** @param ctx - the owning shell plugin lifetime. */
  constructor(ctx: Context) { super(ctx, 'settingsNavigation') }
  /**
   * Open a section or one of its fixed model cards.
   * @param section - registered settings section.
   * @param target - optional model setup target.
   */
  open(section: string, target?: 'codex' | 'api'): void {
    const previous = this.view.getSnapshot()
    const returnSection = target && previous.open && previous.section !== section
      ? previous.section : previous.returnSection
    this.view.set({ open: true, section, ...(target === undefined ? {} : { target }),
      ...(target && returnSection ? { returnSection } : {}) })
  }
  /** Close settings while leaving the underlying caller mounted. */
  close(): void {
    const previous = this.view.getSnapshot()
    this.view.set(previous.returnSection ? { open: true, section: previous.returnSection } : { open: false })
  }
}
