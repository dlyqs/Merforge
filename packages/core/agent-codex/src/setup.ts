/** Host-owned device authentication and cropped availability; never creates a thread. */
import { randomUUID } from 'node:crypto'
import { Service, type Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import { acquireCodexActivity, openCodexRuntime, CodexRuntimeError, type CodexRuntime,
  type CodexRuntimeSpec, type CodexRuntimeLimits, type CodexAccountNotification, type CodexDeviceCode } from '@deepseek-ai/dsh-codex-runtime'
import type { CodexSetupAttemptId, CodexSetupOwnerId, CodexSetupSnapshot, CodexSetupView, CodexSetupCategory } from './setup-types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context { codexSetup: CodexSetup }
  interface Events {
    /** Native availability changed, never containing device codes or identity.
     * @mode emit
     * @param revision - latest committed setup generation.
     */
    'codex-setup/changed'(revision: number): void
  }
}
/** Deployment-owned login and availability retention limits. */
export interface CodexSetupConfig extends CodexRuntimeLimits {
  readonly loginTimeoutMs: number
  readonly setupCacheMs: number
}
interface Attempt {
  readonly id: CodexSetupAttemptId
  readonly owner: CodexSetupOwnerId
  readonly abort: AbortController
  readonly ready: PromiseWithResolvers<void>
  readonly release: () => void
  readonly events: CodexAccountNotification[]
  wake: PromiseWithResolvers<void>
  done: Promise<void>
  runtime?: CodexRuntime
  grant?: CodexDeviceCode
  stop?: 'cancelled' | 'timeout' | 'protocol'
}
function category(error: unknown): CodexSetupCategory {
  if (error instanceof AggregateError && error.errors.some(value => category(value) === 'cleanup')) return 'cleanup'
  return error instanceof CodexRuntimeError ? error.category : 'protocol'
}
/** Single Host owner shared by discovery and Desktop settings. */
export default class CodexSetup extends Service {
  static inject = ['subprocess']
  private state: CodexSetupSnapshot = { revision: 0, runtime: { version: '0.153.4', status: 'unknown' },
    account: { status: 'unknown' }, catalog: { status: 'unknown', models: [] }, login: { status: 'idle' } }
  private attempt: Attempt | undefined
  private probe: { abort: AbortController; done: Promise<CodexSetupSnapshot> } | undefined
  private generation = 0
  private expiresAt = 0
  private closed = false
  private readonly listeners = new Set<(snapshot: CodexSetupSnapshot) => void>()
  /**
   * @param ctx - Host service context.
   * @param config - validated deployment waits and cache limits.
   */
  constructor(ctx: Context, private readonly config: CodexSetupConfig) {
    super(ctx, 'codexSetup')
    ctx.effect(() => async () => {
      this.closed = true
      this.listeners.clear()
      ++this.generation
      this.probe?.abort.abort()
      const attempt = this.attempt
      if (attempt) this.stopAttempt(attempt, 'cancelled')
      await Promise.allSettled([this.probe?.done, attempt?.done])
    }, 'codex-setup.lifetime')
  }
  /** Read safe shared state.
   * @returns committed snapshot.
   */
  snapshot(): CodexSetupSnapshot { return this.state }
  /** Read only the owning window's short-lived code.
   * @param owner - trusted Electron window lifetime.
   * @returns cropped state and optional active grant.
   */
  view(owner: CodexSetupOwnerId): CodexSetupView {
    const attempt = this.attempt
    const device = attempt?.owner === owner && attempt.grant && !attempt.stop
      && ['waiting', 'verifying'].includes(this.state.login.status)
      ? { attemptId: attempt.id, userCode: attempt.grant.userCode } : undefined
    return { snapshot: this.state, ...device === undefined ? {} : { device } }
  }
  /** Observe committed safe state.
   * @param listener - observer with contained exceptions.
   * @returns disposer.
   */
  subscribe(listener: (snapshot: CodexSetupSnapshot) => void): () => void {
    this.assertOpen(); this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  /** Refresh availability without modifying authentication.
   * @param refresh - bypass deployment cache.
   * @returns same-generation observations after process cleanup.
   */
  detect(refresh: boolean = true): Promise<CodexSetupSnapshot> {
    this.assertOpen()
    if (this.attempt) return this.attempt.ready.promise.then(() => this.state)
    if (this.probe) return this.probe.done
    if (!refresh && this.expiresAt > Date.now()) return Promise.resolve(this.state)
    const generation = ++this.generation
    const abort = new AbortController()
    const done = this.probeAvailability(abort.signal).then((value) => {
      if (!this.closed && generation === this.generation) { this.expiresAt = value.catalog.status === 'ready' ? Date.now() + this.config.setupCacheMs : 0; this.publish({ runtime: value.runtime, account: value.account, catalog: value.catalog, login: value.login }) }
      return this.state
    }).finally(() => { if (this.probe?.done === done) this.probe = undefined })
    this.probe = { abort, done }
    return done
  }
  /** Begin only after native execution admission and a fresh account read.
   * @param owner - initiating window lifetime.
   * @returns view after preparation; repeated starts share the same attempt.
   */
  async start(owner: CodexSetupOwnerId): Promise<CodexSetupView> {
    this.assertOpen()
    if (this.attempt) { await this.attempt.ready.promise; return this.view(owner) }
    const release = acquireCodexActivity('login')
    ++this.generation
    this.expiresAt = 0
    const oldProbe = this.probe
    oldProbe?.abort.abort()
    const attempt: Attempt = {
      id: brandString<CodexSetupAttemptId>(randomUUID()), owner, release,
      abort: new AbortController(), ready: Promise.withResolvers<void>(), wake: Promise.withResolvers<void>(),
      events: [], done: Promise.resolve() }
    this.attempt = attempt
    this.publish({ ...this.state, catalog: { status: 'unknown', models: [] }, login: { status: 'starting' } })
    attempt.done = this.runAttempt(attempt, oldProbe?.done)
    await attempt.ready.promise
    return this.view(owner)
  }
  /** Cancel only a matching owner and attempt, then await managed range cleanup.
   * @param owner - trusted initiating window lifetime.
   * @param id - branded current attempt identity.
   * @returns settled owner view.
   */
  async cancel(owner: CodexSetupOwnerId, id: CodexSetupAttemptId): Promise<CodexSetupView> {
    const attempt = this.owned(owner, id)
    this.stopAttempt(attempt, 'cancelled')
    await attempt.done
    return this.view(owner)
  }
  /** Retire all short-lived state when its window is destroyed.
   * @param owner - retired window lifetime.
   * @returns child and callback cleanup completion.
   */
  async destroyOwner(owner: CodexSetupOwnerId): Promise<void> {
    const attempt = this.attempt
    if (attempt?.owner !== owner) return
    this.stopAttempt(attempt, 'cancelled')
    await attempt.done
  }
  /** Resolve only the current owned endpoint for Electron's explicit open action.
   * @param owner - initiating window lifetime.
   * @param id - current attempt identity.
   * @returns validated official URL, never exposed to Renderer.
   */
  verificationUrl(owner: CodexSetupOwnerId, id: CodexSetupAttemptId): string {
    const attempt = this.owned(owner, id)
    if (!attempt.grant || attempt.stop || this.state.login.status !== 'waiting') throw new Error('codex-setup: closed')
    return attempt.grant.verificationUrl
  }
  private spec(): CodexRuntimeSpec {
    return { cwd: process.cwd(), env: {}, limits: this.config, experimentalApi: false, purpose: 'setup',
      spawn: spec => this.ctx.subprocess.spawn(spec) }
  }
  private assertOpen(): void { if (this.closed) throw new Error('codex-setup: closed') }
  private owned(owner: CodexSetupOwnerId, id: CodexSetupAttemptId): Attempt {
    this.assertOpen()
    const attempt = this.attempt
    if (!attempt || attempt.owner !== owner || attempt.id !== id) throw new Error('codex-setup: closed')
    return attempt
  }
  private publish(value: Omit<CodexSetupSnapshot, 'revision'>): void {
    if (this.closed) return
    const { revision: _revision, ...previous } = this.state
    if (JSON.stringify(previous) === JSON.stringify(value)) return
    this.state = { ...value, revision: this.state.revision + 1 }
    const logger = value.login.status !== previous.login.status || value.login.cleanup === 'failed'
      || value.runtime.status === 'error' ? this.ctx.logger.info.bind(this.ctx.logger) : this.ctx.logger.debug.bind(this.ctx.logger)
    logger('component=codex-setup event=state status=%s category=%s generation=%s cleanup=%s cancellation=%s runtimeVersion=0.153.4',
      value.login.status, value.login.category ?? value.runtime.category ?? value.catalog.category ?? '', this.state.revision,
      value.login.cleanup ?? '', value.login.cancellation ?? '')
    this.ctx.emit('codex-setup/changed', this.state.revision)
    for (const listener of this.listeners) {
      try { listener(this.state) } catch (error) { void error /* UI sinks cannot own setup settlement. */ }
    }
  }
  private async observations(runtime: CodexRuntime): Promise<Pick<CodexSetupSnapshot, 'runtime' | 'account' | 'catalog'>> {
    const ready = { version: '0.153.4', status: 'ready' } as const
    let account
    try { account = await runtime.readAccount() }
    catch (error) { return { runtime: ready, account: { status: 'error', category: category(error) }, catalog: { status: 'unknown', models: [] } } }
    if (account.requiresOpenaiAuth && account.kind === 'none') {
      return { runtime: ready, account: { status: 'known', value: account }, catalog: { status: 'error', models: [], category: 'login-required' } }
    }
    try {
      const catalog = await runtime.catalog(true)
      if (catalog.account.requiresOpenaiAuth && catalog.account.kind === 'none') {
        return { runtime: ready, account: { status: 'known', value: catalog.account },
          catalog: { status: 'error', models: [], category: 'login-required' } }
      }
      return { runtime: ready, account: { status: 'known', value: catalog.account },
        catalog: { status: catalog.models.length ? 'ready' : 'empty', models: catalog.models,
          ...catalog.models.length ? {} : { category: 'models-empty' as const } } }
    } catch (error) {
      return { runtime: ready, account: { status: 'known', value: account }, catalog: { status: 'error', models: [], category: category(error) === 'rpc' ? 'catalog' : category(error) } }
    }
  }
  private async probeAvailability(signal: AbortSignal): Promise<CodexSetupSnapshot> {
    let runtime: CodexRuntime | undefined
    let value = this.state
    try {
      runtime = await openCodexRuntime(this.spec(), signal)
      value = { ...value, ...await this.observations(runtime) }
    } catch (error) {
      value = { ...value, runtime: { version: '0.153.4', status: 'error', category: category(error) },
        account: { status: 'unknown' }, catalog: { status: 'unknown', models: [] } }
    } finally {
      try { await runtime?.dispose() }
      catch (error) { void error; value = { ...value, runtime: { version: '0.153.4', status: 'error', category: 'cleanup' } } }
    }
    return value
  }
  private shouldStop(attempt: Attempt): boolean { return attempt.stop !== undefined }
  private stopAttempt(attempt: Attempt, reason: 'cancelled' | 'timeout' | 'protocol'): void {
    if (attempt.stop) return
    attempt.stop = reason
    attempt.abort.abort()
    if (!attempt.grant) attempt.runtime?.close()
    attempt.wake.resolve()
  }
  private async runAttempt(attempt: Attempt, previous?: Promise<CodexSetupSnapshot>): Promise<void> {
    let login: CodexSetupSnapshot['login'] = { status: 'failed', category: 'protocol' }
    let cleanupFailed = false
    let unsubscribe = () => {}
    const timer = setTimeout(() =>{  this.stopAttempt(attempt, 'timeout') }, this.config.loginTimeoutMs)
    try {
      await previous
      attempt.abort.signal.throwIfAborted()
      const runtime = await openCodexRuntime(this.spec(), attempt.abort.signal)
      attempt.runtime = runtime
      unsubscribe = runtime.onAccount((event) => {
        if (attempt.events.length >= this.config.maxEarlyEvents) { this.stopAttempt(attempt, 'protocol'); return }
        attempt.events.push(event); attempt.wake.resolve()
      })
      void runtime.processOutcome.finally(() => { attempt.wake.resolve() }).catch((error: unknown) => { void error })
      const account = await runtime.readAccount()
      attempt.abort.signal.throwIfAborted()
      if (!account.requiresOpenaiAuth || account.kind !== 'none') {
        this.publish({ ...this.state, ...await this.observations(runtime) })
        login = { status: 'succeeded' }
        return
      }
      this.publish({ ...this.state, runtime: { version: '0.153.4', status: 'ready' }, account: { status: 'known', value: account } })
      attempt.grant = await runtime.startDeviceCode()
      if (attempt.stop) return
      this.publish({ ...this.state, login: { status: 'waiting' } })
      attempt.ready.resolve()
      while (!attempt.stop) {
        if (attempt.events.length === 0) {
          await Promise.race([attempt.wake.promise, runtime.processOutcome.then(() => { throw new CodexRuntimeError('eof') })])
          attempt.wake = Promise.withResolvers<void>()
        }
        if (this.shouldStop(attempt)) break
        const event = attempt.events.shift()
        if (!event) continue
        if (event.type === 'completed' && event.loginId !== null && event.loginId !== attempt.grant.loginId) continue
        if (event.type === 'completed' && event.loginId !== null && !event.success) { login = { status: 'failed', category: 'login-failed' }; break }
        this.publish({ ...this.state, login: { status: 'verifying' } })
        const observed = await this.observations(runtime)
        if (this.shouldStop(attempt)) break
        const verified = observed.account.status === 'known'
          && (!observed.account.value.requiresOpenaiAuth || observed.account.value.kind !== 'none')
        this.publish({ ...this.state, ...observed, login: { status: verified ? 'verifying' : 'waiting' } })
        if (verified) { login = { status: 'succeeded' }; break }
      }
    } catch (error) {
      cleanupFailed = category(error) === 'cleanup'
      login = { status: 'failed', category: category(error) }
      if (!attempt.runtime) this.publish({ ...this.state, runtime: { version: '0.153.4', status: 'error', category: category(error) } })
    } finally {
      clearTimeout(timer)
      unsubscribe()
      if (attempt.stop) {
        let cancellation: 'canceled' | 'notFound' | 'unconfirmed' = 'unconfirmed'
        if (attempt.runtime && attempt.grant) {
          try { cancellation = await attempt.runtime.cancelDeviceCode(attempt.grant.loginId) }
          catch (error) { void error /* Remote cancellation is independent of local cleanup. */ }
        }
        login = { status: attempt.stop === 'protocol' ? 'failed' : attempt.stop, cancellation,
          ...attempt.stop === 'cancelled' ? {} : { category: attempt.stop } }
      }
      let cleanup: 'done' | 'failed' = cleanupFailed ? 'failed' : 'done'
      try { await attempt.runtime?.dispose() }
      catch (error) { void error; cleanup = 'failed' }
      if (cleanup === 'done') attempt.release()
      delete attempt.grant
      this.publish({ ...this.state, login: { ...login, cleanup } })
      this.attempt = undefined
      this.expiresAt = 0
      attempt.ready.resolve()
    }
  }
}
