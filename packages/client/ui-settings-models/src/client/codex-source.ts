/** One registration-owned Desktop setup observation, with ephemeral owner grants. */
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { CodexSetupDesktopBridge, CodexSetupSnapshot, CodexSetupView } from '@deepseek-ai/dsh-agent-codex/setup-types'

/** Client operation feedback; native errors remain fixed Host classifications. */
export interface CodexSetupState {
  view?: CodexSetupView
  busy: boolean
  error?: 'operation' | 'copy'
  copied: boolean
}

type SetupAction = 'detect' | 'start' | 'cancel' | 'openVerification' | 'copy'

/** Shares one preload subscription across settings and first-use surfaces. */
export class CodexSetupSource {
  /** Renderer-bound source; never persisted or sent to a Session. */
  readonly store = createSnapshotStore<CodexSetupState>({ busy: false, copied: false })
  private live = true
  private generation = 0
  private revision = -1
  private loaded = false
  private readonly unsubscribe: () => void

  /**
   * @param bridge - Fixed Desktop preload capability for this document.
   * @param report - Fixed action-failure diagnostic, without exception details.
   */
  constructor(private readonly bridge: CodexSetupDesktopBridge, private readonly report?: (action: SetupAction) => void) {
    this.unsubscribe = bridge.subscribe((snapshot) => { this.receive(snapshot) })
  }

  /** Load availability once; subsequent remounts retain the same attempt. */
  ensure(): void {
    if (this.loaded || !this.live) return
    this.loaded = true
    void this.detect()
  }

  /** Refresh independent runtime, authentication and catalog observations. @returns action settlement. */
  detect(): Promise<void> { return this.run('detect', () => this.bridge.detect()) }
  /** Start only from an explicit user gesture. @returns action settlement. */
  start(): Promise<void> { return this.run('start', () => this.bridge.start()) }
  /** Cancel only the currently owned grant. @returns action settlement. */
  cancel(): Promise<void> {
    const device = this.store.getSnapshot().view?.device
    return device === undefined ? Promise.resolve() : this.run('cancel', () => this.bridge.cancel(device.attemptId))
  }
  /** Open the current Host-held URL, without accepting Renderer URLs. @returns action settlement. */
  openVerification(): Promise<void> {
    const device = this.store.getSnapshot().view?.device
    return device === undefined ? Promise.resolve() : this.run('openVerification', async () => {
      await this.bridge.openVerification(device.attemptId)
      return this.bridge.snapshot()
    })
  }
  /**
   * Copy the current short-lived code.
   * @param write - Clipboard writer.
   * @returns Copy settlement.
   */
  async copy(write: (code: string) => Promise<void>): Promise<void> {
    const device = this.store.getSnapshot().view?.device
    if (!device || !this.live) return
    const generation = this.generation
    try {
      await write(device.userCode)
      if (this.isCurrent(generation) && this.store.getSnapshot().view?.device?.attemptId === device.attemptId) {
        this.store.update((state) => { state.copied = true; delete state.error })
      }
    } catch (error) {
      void error // Clipboard errors may carry arbitrary platform text.
      if (this.isCurrent(generation)) {
        this.store.update((state) => { state.error = 'copy' })
        this.report?.('copy')
      }
    }
  }
  /** Retire this registration's ephemeral view; the Host owns cancellation. */
  dispose(): void {
    this.live = false
    this.generation++
    this.unsubscribe()
    this.store.set({ busy: false, copied: false })
  }

  private isCurrent(generation: number): boolean { return this.live && generation === this.generation }

  private accept(view: CodexSetupView, generation: number): void {
    if (!this.isCurrent(generation) || view.snapshot.revision < this.revision) return
    this.revision = view.snapshot.revision
    const previous = this.store.getSnapshot()
    this.store.set({ ...previous, view, copied: previous.view?.device?.attemptId === view.device?.attemptId && previous.copied })
  }

  private receive(snapshot: CodexSetupSnapshot): void {
    if (!this.live) return
    if (snapshot.runtime.category === 'closed') {
      this.generation++
      this.revision = -1
      this.loaded = false
      this.store.set({ view: { snapshot }, busy: false, copied: false })
      return
    }
    if (snapshot.revision < this.revision) return
    this.accept({ snapshot }, this.generation)
    if (snapshot.login.status === 'waiting') {
      const generation = this.generation
      void this.bridge.snapshot().then((view) => { this.accept(view, generation) }, (error: unknown) => {
        void error // Safe pushed state remains usable when an owner read fails.
      })
    }
  }

  private async run(action: SetupAction, operation: () => Promise<CodexSetupView>): Promise<void> {
    if (!this.live || this.store.getSnapshot().busy) return
    const generation = this.generation
    this.store.update((state) => { state.busy = true; delete state.error })
    try {
      this.accept(await operation(), generation)
    } catch (error) {
      void error // Never expose IPC exception text or grants in diagnostics.
      if (this.isCurrent(generation)) {
        this.store.update((state) => { state.error = 'operation' })
        this.report?.(action)
      }
    } finally {
      if (this.isCurrent(generation)) this.store.update((state) => { state.busy = false })
    }
  }
}
