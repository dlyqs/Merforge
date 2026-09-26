/** Electron ownership of the opt-in organization process, independent of the personal Host. */
import { spawn, type ChildProcess } from 'node:child_process'
import { join } from 'node:path'

/** Public process status; ready metadata contains no credentials or private keys. */
export type OrganizationProcessState =
  | { phase: 'disabled' | 'starting' | 'stopping' }
  | { phase: 'failed'; error: string }
  | { phase: 'ready'; port: number; certificate: string; fingerprint: string; expiresAt: number; renewalDue: boolean }

interface Attempt {
  child: ChildProcess
  ready: Promise<OrganizationProcessState>
  exited: Promise<void>
  resolve: (value: OrganizationProcessState) => void
  reject: (error: Error) => void
  stop?: Promise<void>
  pending: Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>
}

/** Defaults to disabled; constructing the controller never spawns or binds a port. */
export class DesktopOrganizationProcess {
  private attempt: Attempt | undefined
  private current: OrganizationProcessState = { phase: 'disabled' }
  private sequence = 0
  private readonly listeners = new Set<() => void>()

  /** @param listener - Native process status observer. @returns Observer removal. */
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private changed(): void {
    for (const listener of this.listeners) {
      try { listener() } catch (error) { console.error('organization component=process result=observer-failed', error instanceof Error ? error.name : 'Error') }
    }
  }

  /**
   * @param executable - Packaged Electron executable, used in Node mode.
   * @param runtimeDirectory - Desktop dependency payload containing the private Host entry.
   * @param deadlineMs - Startup/control/graceful-exit deadline supplied by the Desktop owner.
   */
  constructor(private readonly executable: string, private readonly runtimeDirectory: string, private readonly deadlineMs: number) {
    if (!Number.isSafeInteger(deadlineMs) || deadlineMs <= 0) throw new Error('organization-invalid-deadline')
  }

  /** @returns Current process status, never a speculative online state. */
  status(): OrganizationProcessState { return { ...this.current } }

  /**
   * Explicitly start the organization-only entry; configuration is validated again in the child.
   * @param config - Private organization deployment settings, never supplied by a LAN route.
   * @returns Ready facts only after the database, TLS identity and listener are ready.
   */
  start(config: unknown): Promise<OrganizationProcessState> {
    if (this.attempt) return this.attempt.stop ? Promise.reject(new Error('organization-stopping')) : this.attempt.ready
    this.current = { phase: 'starting' }; this.changed()
    console.info('organization component=process result=starting')
    const entry = join(this.runtimeDirectory, 'node_modules', '@deepseek-ai', 'dsh-desktop-host', 'lib', 'organization.js')
    const child = spawn(this.executable, [entry], {
      env: { ELECTRON_RUN_AS_NODE: '1', PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TMPDIR: process.env.TMPDIR, TEMP: process.env.TEMP },
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    })
    let resolve!: Attempt['resolve']
    let reject!: Attempt['reject']
    const ready = new Promise<OrganizationProcessState>((yes, no) => { resolve = yes; reject = no })
    const exited = new Promise<void>(yes => child.once('close', () =>{  yes() }))
    const attempt: Attempt = { child, ready, exited, resolve, reject, pending: new Map() }
    this.attempt = attempt
    const fail = (code: string) => {
      const error = new Error(code)
      attempt.reject(error)
      for (const request of attempt.pending.values()) request.reject(error)
      attempt.pending.clear()
      if (this.attempt === attempt && !attempt.stop) {
        if (this.current.phase !== 'failed') this.current = { phase: 'failed', error: code }
        this.changed()
        console.error('organization component=process result=failed decisionCode=%s', code)
      }
    }
    child.on('message', (input: unknown) => {
      if (typeof input !== 'object' || input === null || !('type' in input)) { fail('invalid-control-message'); return }
      if (input.type === 'ready' && 'port' in input && typeof input.port === 'number' && Number.isInteger(input.port) && input.port > 0 && input.port <= 65535
        && 'certificate' in input && typeof input.certificate === 'string' && 'fingerprint' in input && typeof input.fingerprint === 'string'
        && 'expiresAt' in input && typeof input.expiresAt === 'number' && 'renewalDue' in input && typeof input.renewalDue === 'boolean') {
        if (attempt.stop) return
        this.current = { phase: 'ready', port: input.port, certificate: input.certificate, fingerprint: input.fingerprint, expiresAt: input.expiresAt, renewalDue: input.renewalDue }
        this.changed()
        attempt.resolve(this.status())
        console.info('organization component=process result=ready')
      } else if (input.type === 'receipt' && 'requestId' in input && typeof input.requestId === 'number') {
        const request = attempt.pending.get(input.requestId)
        if ('error' in input && typeof input.error === 'string') request?.reject(new Error(input.error))
        else if ('receipt' in input) request?.resolve(input.receipt)
        else request?.reject(new Error('invalid-control-message'))
      } else if (input.type === 'failed') {
        const codes = ['organization-invalid-configuration', 'organization-certificate-invalid', 'organization-port-in-use',
          'organization-bind-unavailable', 'organization-listener-failed', 'organization-storage-unavailable', 'organization-start-or-control-failed']
        fail('error' in input && typeof input.error === 'string' && codes.includes(input.error) ? input.error : 'organization-start-or-control-failed')
      }
      else if (input.type !== 'stopped') fail('invalid-control-message')
    })
    child.once('error', () =>{  fail('organization-spawn-failed') })
    child.once('close', () => {
      fail('organization-process-exited')
      if (this.attempt === attempt) this.attempt = undefined
    })
    child.send({ type: 'boot', config }, (error) => { if (error) fail('organization-control-failed') })
    const timer = setTimeout(() => { fail('organization-start-timeout'); void this.stop() }, this.deadlineMs)
    return ready.finally(() =>{  clearTimeout(timer) }).catch(async (error: unknown) => {
      await this.stop()
      if (!(error instanceof Error && error.message === 'organization-start-cancelled')) {
        this.current = { phase: 'failed', error: error instanceof Error ? error.message : 'organization-start-failed' }; this.changed()
      }
      throw error
    })
  }

  /**
   * Invoke a private credential-protected bootstrap/recovery operation on the service machine.
   * @param operation - One of the two private authority methods, absent from network routes.
   * @param input - Strict authority request validated in the child.
   * @returns Durable receipt JSON without credentials.
   */
  async control(operation: 'initialize' | 'recover', input: unknown): Promise<unknown> {
    const attempt = this.attempt
    if (!attempt || attempt.stop || this.current.phase !== 'ready') throw new Error('organization-unavailable')
    if (attempt.pending.size !== 0) throw new Error('organization-control-busy')
    const requestId = ++this.sequence
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await new Promise((resolve, reject) => {
        attempt.pending.set(requestId, { resolve, reject })
        timer = setTimeout(() =>{  reject(new Error('organization-control-timeout')) }, this.deadlineMs)
        attempt.child.send({ type: operation, requestId, input }, (error) => { if (error) reject(new Error('organization-control-failed')) })
      })
    } finally { clearTimeout(timer); attempt.pending.delete(requestId) }
  }

  /** @returns Resolution only when the owned child has exited, including startup cancellation. */
  stop(): Promise<void> {
    const attempt = this.attempt
    if (!attempt) return Promise.resolve()
    return attempt.stop ??= (async () => {
      this.current = { phase: 'stopping' }; this.changed()
      attempt.reject(new Error('organization-start-cancelled'))
      for (const request of attempt.pending.values()) request.reject(new Error('organization-stopping'))
      if (attempt.child.connected) attempt.child.send({ type: 'shutdown' }, () => {})
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        const graceful = await Promise.race([attempt.exited.then(() => true), new Promise<false>((resolve) => {
          timer = setTimeout(() =>{  resolve(false) }, this.deadlineMs)
        })])
        if (!graceful) attempt.child.kill('SIGKILL')
        await attempt.exited
        if (this.attempt === attempt) this.attempt = undefined
        this.current = { phase: 'disabled' }; this.changed()
        console.info('organization component=process result=stopped')
      } finally { clearTimeout(timer) }
    })()
  }
}
