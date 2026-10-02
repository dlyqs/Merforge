import { planningCommandSchema, planningPlanReadSchema, planningPlanViewSchema, planningReadSchema, planningViewSchema, planningCandidatesSchema, planningCandidatesPageSchema } from '@deepseek-ai/dsh-organization/planning'
import { integrationReadSchema, integrationCommandSchema, integrationViewSchema } from '@deepseek-ai/dsh-organization/delivery'
/** Native organization client: scoped identity, cancellation, events and explicit mutations. */
import { deliveryCommandSchema, deliveryReadSchema, deliveryPageSchema, artifactReadSchema, artifactDownloadSchema } from '@deepseek-ai/dsh-organization/delivery'
import { executionCommandSchema, executionReadSchema, executionViewSchema, executionListSchema, executionPageSchema } from '@deepseek-ai/dsh-organization/execution'
import { readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs'
import { randomBytes, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { brandString } from '@deepseek-ai/dsh-brand'
import { organizationRequest, probeOrganizationCertificate, followOrganizationEvents, followWorkgraphEvents, followInboxEvents, OrganizationStreamReset, type OrganizationTrust, type CertificateOffer } from '@deepseek-ai/dsh-organization-api/transport'
import { OrganizationLoginSession } from './login-session.ts'
import { OrganizationDeviceMaterial, type OrganizationDeviceVault } from './device-material.ts'
import { approvalReviewSchema, approvalReviewResultSchema, assignmentCommandSchema, participantCommandSchema, delegateSchema, assignmentReadSchema, taskAssignmentsQuerySchema, taskAssignmentsPageSchema, inboxQuerySchema, inboxPageSchema, preparationSchema, deviceCommandSchema, devicesSchema, claimSchema } from '@deepseek-ai/dsh-organization/assignment'
import { commandSchema, registerSchema, receiptSchema } from '@deepseek-ai/dsh-organization/protocol'
import { projectCommandSchema, grantCommandSchema } from '@deepseek-ai/dsh-organization/resources'
import { workgraphSaveSchema, workgraphReadSchema, workgraphTasksSchema, workgraphGrantSchema, workgraphGrantsSchema, workgraphVersionSchema, workgraphPageSchema, workgraphGrantViewSchema } from '@deepseek-ai/dsh-organization/workgraph'
import type { AccountId, OperationId, LoginToken, OrganizationId, ServerId } from '@deepseek-ai/dsh-organization/types'
import { actionSchema, connectionConfig, identitySchema, loginResultSchema, organizationsSchema, pageSchema, membersSchema, grantsSchema } from './schema.ts'
import type { ConnectionAction, ConnectionSnapshot, ConnectionResult, OrganizationRequestId, OrganizationExecutionChannel } from './types.ts'

/** Configurable request bounds and reconnection interval for a small LAN client. */
export type Config = z.input<typeof connectionConfig>
interface Pending { operationId: OperationId; accountId: AccountId; serverId: ServerId; invitationToken?: string; organizationId?: OrganizationId | undefined; deviceAction?: 'register-device' | 'revoke-device' | undefined }

/** One native connection; no personal cookie, model credential or filesystem record enters this owner. */
export class OrganizationConnection {
  private state: ConnectionSnapshot = { revision: 0, generation: 0, phase: 'disconnected', mode: 'personal', organizations: [], members: [] }
  private trust: OrganizationTrust | undefined
  private offer: (CertificateOffer & { origin: string }) | undefined
  private readonly loginSession: OrganizationLoginSession | undefined
  private loginExpiresAt: number | undefined
  private loginExpiry: ReturnType<typeof setTimeout> | undefined
  private token: LoginToken | undefined
  private serverId: ServerId | undefined
  private generation = 0
  private denialRefreshed = false
  private discardedResponses = 0
  private cancel = new AbortController()
  private executionLifetime = new AbortController()
  private readonly executionWork = new Map<string, { cancel: AbortController; done: Promise<unknown> }>()
  private readonly streams = new Set<Promise<void>>()
  private renewal: ReturnType<typeof setTimeout> | undefined
  private retry: ReturnType<typeof setTimeout> | undefined
  private readonly uncertain = new Map<string, Pending>()
  private get pending(): Pending | undefined { return this.uncertain.get(this.identityKey()) }
  private set pending(value: Pending | undefined) {
    if (value) this.uncertain.set(`${value.serverId}:${value.accountId}`, value)
    else this.uncertain.delete(this.identityKey())
    this.savePending()
  }
  private identityKey(): string { return `${this.state.principal?.serverId}:${this.state.principal?.accountId}` }
  private writing = false
  private closed = false
  private readonly operations = new Set<Promise<unknown>>()
  private renewingMutation = false
  private journalError = false
  private readonly config: z.output<typeof connectionConfig>
  private readonly listeners = new Set<() => void>()
  /**
   * @param config - Validated native deployment bounds.
   * @param device - Main-process OS vault and private material directory.
   */
  constructor(config: Config = {}, private readonly device?: { directory: string; vault: OrganizationDeviceVault }) {
    this.config = connectionConfig.parse(config)
    this.loginSession = this.config.trustPath && device ? new OrganizationLoginSession(`${this.config.trustPath}.login`, device.vault) : undefined
    if (this.config.trustPath) {
      try {
        const saved = z.object({ origin: z.url(),
          certificate: z.string(),
          fingerprint: z.string(),
          expiresAt: z.number(),
          serverId: identitySchema.shape.serverId }).strict().parse(JSON.parse(readFileSync(this.config.trustPath, 'utf8')))
        this.trust = { ...saved, ...this.config }; this.serverId = saved.serverId
        this.state = { ...this.state, origin: saved.origin, phase: 'signed-out' }
      } catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) this.state.error = 'certificate-changed' }
      try {
        const saved = z.array(z.object({ operationId: receiptSchema.shape.operationId,
          accountId: loginResultSchema.shape.principal.shape.accountId,
          serverId: identitySchema.shape.serverId, organizationId: organizationsSchema.element.shape.id.optional(), deviceAction: z.enum(['register-device', 'revoke-device']).optional() }).strict()).parse(JSON.parse(readFileSync(`${this.config.trustPath}.pending`, 'utf8')))
        for (const entry of saved) this.uncertain.set(`${entry.serverId}:${entry.accountId}`, entry)
      } catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) { this.journalError = true; this.state.error = 'invalid-operation-journal' } }
    }
  }
  /** Restore encrypted login and recheck current access with the authority.
   * @returns Settlement of the first verification; temporary outages use normal reconnection.
   */
  async restoreLogin(): Promise<void> {
    if (this.closed || this.token || !this.trust || !this.serverId) return
    const saved = this.loginSession?.read()
    if (!saved) return
    if (saved.expiresAt <= Date.now() || saved.origin !== this.trust.origin
      || saved.fingerprint !== this.trust.fingerprint || saved.principal.serverId !== this.serverId) {
      this.clearLogin(); return
    }
    this.token = saved.token
    this.armLoginExpiry(saved.expiresAt)
    const generation = this.reset({ phase: 'loading', principal: saved.principal, username: saved.username })
    this.publish({ pendingOperation: this.pending?.operationId })
    const task = this.refresh(generation).then(() => ({})).catch((_error: unknown) => {
      if (generation === this.generation && this.state.phase === 'loading') this.invalidate('unauthenticated')
      return {}
    })
    this.operations.add(task)
    try { await task } finally { this.operations.delete(task) }
  }
  private armLoginExpiry(expiresAt: number): void {
    clearTimeout(this.loginExpiry)
    this.loginExpiresAt = expiresAt
    this.loginExpiry = setTimeout(() => { this.invalidate('unauthenticated') }, Math.max(0, expiresAt - Date.now()))
    this.loginExpiry.unref()
  }
  private clearLogin(): void {
    this.token = undefined; this.loginExpiresAt = undefined
    clearTimeout(this.loginExpiry)
    try { this.loginSession?.clear() } catch (_error) { console.error('organization component=login-session result=clear-failed') }
  }
  private save(path: string, data: unknown): void {
    const temporary = `${path}.${randomUUID()}`
    writeFileSync(temporary, JSON.stringify(data), { mode: 0o600, flag: 'wx' })
    try { renameSync(temporary, path) } catch (error) { unlinkSync(temporary); throw error }
  }
  private savePending(): void {
    if (this.config.trustPath) this.save(`${this.config.trustPath}.pending`, [...this.uncertain.values()].map(({ operationId, serverId, accountId, organizationId, deviceAction }) => ({ operationId, serverId, accountId, organizationId, deviceAction })))
  }
  /** Native deadline shared by private context reads and their authorization requests. */
  get timeoutMs(): number { return this.config.timeoutMs }
  /** Read the native state.
   * @returns Safe copied snapshot without login credentials.
   */
  snapshot(): ConnectionSnapshot { return structuredClone(this.state) }
  /** Observe state changes.
   * @param listener - State observer.
   * @returns Observer removal.
   */
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private stopExecution(): void {
    this.executionLifetime.abort(); this.executionLifetime = new AbortController()
    clearTimeout(this.renewal)
    this.state = { ...this.state, renewing: undefined }
  }
  private publish(next: Partial<ConnectionSnapshot>): void {
    if (next.phase === 'offline' || next.phase === 'signed-out' || next.phase === 'disconnected'
      || ('organizationId' in next && next.organizationId !== this.state.organizationId)
      || (next.mode !== undefined && next.mode !== this.state.mode)) this.stopExecution()
    if (next.phase && next.phase !== this.state.phase && (!this.renewingMutation || next.phase === 'offline' || next.phase === 'signed-out')) console.info('organization component=connection phase=%s result=state-change', next.phase)
    this.state = { ...this.state, ...next, revision: this.state.revision + 1 }
    for (const listener of this.listeners) {
      try { listener() } catch (error) { console.error('organization component=connection result=observer-failed', error instanceof Error ? error.name : 'Error') }
    }
  }
  private reset(next: Partial<ConnectionSnapshot>, denialRefreshed = false): number {
    this.cancel.abort(); this.cancel = new AbortController()
    clearTimeout(this.retry)
    this.generation++
    this.denialRefreshed = denialRefreshed
    this.publish({ generation: this.generation, projects: undefined, inbox: undefined,
      members: [], error: undefined, ...next })
    return this.generation
  }
  private async request(route: string, body?: unknown, generation = this.generation): Promise<unknown> {
    if (this.loginExpiresAt !== undefined && this.loginExpiresAt <= Date.now()) { this.invalidate('unauthenticated'); throw new Error('unauthenticated') }
    if (!this.trust) throw new Error('untrusted')
    let response: Awaited<ReturnType<typeof organizationRequest>>
    try { response = await organizationRequest(this.trust, body === undefined ? 'GET' : 'POST', `/organization/v1${route}`, body, this.token, this.cancel.signal) }
    catch (error) {
      if (generation !== this.generation) {
        console.info('organization component=connection result=discarded count=%s', ++this.discardedResponses)
        throw new Error('superseded')
      }
      const code = error instanceof Error && 'code' in error ? String(error.code) : ''
      if (/CERT|TLS|SELF_SIGNED/.test(code)) { this.trust = undefined; this.invalidate('certificate-changed'); throw new Error('certificate-changed') }
      if (this.token) this.offline(generation)
      throw new Error('unavailable')
    }
    if (generation !== this.generation) {
      console.info('organization component=connection result=discarded count=%s', ++this.discardedResponses)
      throw new Error('superseded')
    }
    if (response.status !== 200) {
      const code = z.object({ error: z.string() }).parse(response.body).error
      if (code === 'unauthenticated') this.invalidate(code)
      else if (code === 'forbidden') {
        if (route.startsWith('/planning/') || route.startsWith('/integration/') || route.startsWith('/delivery/') || route.startsWith('/execution/') || route.startsWith('/workgraph/')
          || route.startsWith('/assignment/') || route.startsWith('/device/')) {
          // Automatic detail readers retry after refresh; repeated denials must settle in that generation.
          if (!this.denialRefreshed) {
            const next = this.reset({ phase: 'loading', error: code }, true)
            try { await this.refresh(next) } catch (_error) {
              if (next === this.generation && this.token) this.offline(next)
            }
          }
        } else this.reset({ organizationId: undefined, phase: 'ready', error: code })
      }
      else if (response.status >= 500 && this.token) this.offline(generation)
      throw new Error(code)
    }
    return response.body
  }
  /**
   * Execute a fixed local operation; mutations are never queued while disconnected.
   * @param input - Strict local IPC action; command bodies are validated by their authority parser.
   * @returns Safe receipts, invitation or grant metadata for the initiating user.
   */
  async perform(input: ConnectionAction): Promise<ConnectionResult> {
    if (this.closed) throw new Error('closed')
    const task = this.performAction(input)
    this.operations.add(task)
    try { return await task } finally { this.operations.delete(task) }
  }
  /**
   * Capture a native-only Run channel whose lifetime survives projection refreshes.
   * @param input - Exact authorized Run selector, parsed before capture.
   * @returns Fixed online read/command operations and identity cancellation signal.
   */
  executionChannel(input: z.input<typeof executionReadSchema>): OrganizationExecutionChannel {
    const selector = executionReadSchema.parse(input)
    this.assertOrganization(selector.organizationId)
    const trust = this.trust, token = this.token, principal = this.state.principal
    if (!trust || !token || !principal || this.closed) throw new Error('unavailable')
    const material = this.material(), deviceId = this.localDeviceId()
    const cancellation = new AbortController()
    const signal = AbortSignal.any([this.executionLifetime.signal, cancellation.signal])
    const generation = this.generation
    const current = () => {
      signal.throwIfAborted()
      if (this.closed || this.token !== token || this.trust !== trust
        || this.state.organizationId !== selector.organizationId || this.state.mode !== 'organization'
        || !['ready', 'loading'].includes(this.state.phase)) throw new Error('superseded')
      if (this.loginExpiresAt === undefined || this.loginExpiresAt <= Date.now()) {
        this.invalidate('unauthenticated'); throw new Error('unauthenticated')
      }
    }
    const request = async (route: '/execution/read' | '/execution/challenge' | '/execution/command', body: unknown) => {
      current()
      let response: Awaited<ReturnType<typeof organizationRequest>>
      try { response = await organizationRequest(trust, 'POST', `/organization/v1${route}`, body, token, signal) }
      catch (error) {
        current()
        const code = error instanceof Error && 'code' in error ? String(error.code) : ''
        if (/CERT|TLS|SELF_SIGNED/.test(code)) { this.trust = undefined; this.invalidate('certificate-changed') }
        else this.offline(this.generation)
        throw new Error('unavailable')
      }
      current()
      if (response.status !== 200) {
        const code = z.object({ error: z.string() }).parse(response.body).error
        if (code === 'unauthenticated') this.invalidate(code)
        else if (response.status >= 500) this.offline(this.generation)
        throw new Error(code)
      }
      return response.body
    }
    const read = async () => executionViewSchema.parse(await request('/execution/read', selector))
    const command = async (input: z.output<typeof executionCommandSchema>) => {
      current()
      const command = executionCommandSchema.parse(input)
      if (!('runId' in command) || command.runId !== selector.runId
        || command.organizationId !== selector.organizationId || command.projectId !== selector.projectId
        || command.planId !== selector.planId || command.assignmentId !== selector.assignmentId
        || command.deviceId !== deviceId || !['reserve-action', 'settle-action', 'transition-run', 'request-execution-human', 'resume-run'].includes(command.kind)) throw new Error('forbidden')
      if (this.journalError) throw new Error('invalid-operation-journal')
      if (this.writing || this.pending) throw new Error('operation-pending')
      this.writing = true
      const key = `${principal.serverId}:${principal.accountId}`
      try {
        this.pending = { ...principal, operationId: command.operationId, organizationId: selector.organizationId }
        this.publish({ pendingOperation: command.operationId })
        const challenge = await request('/execution/challenge', command)
        current()
        const receipt = receiptSchema.parse(await request('/execution/command', { command, proof: material.proof(command, challenge) }))
        this.uncertain.delete(key); this.savePending(); this.publish({ pendingOperation: undefined })
        return receipt
      } catch (error) {
        if (error instanceof Error && ['invalid-input', 'version-conflict', 'forbidden', 'operation-conflict', 'rate-limited'].includes(error.message)) {
          this.uncertain.delete(key); this.savePending()
          if (key === this.identityKey()) this.publish({ pendingOperation: this.pending?.operationId })
        }
        throw error
      } finally { this.writing = false }
    }
    const track = async <T>(operation: () => Promise<T>): Promise<T> => {
      const task = operation()
      this.operations.add(task)
      try { return await task } finally { this.operations.delete(task) }
    }
    const run = async <T>(work: (signal: AbortSignal) => Promise<T>): Promise<T> => {
      current()
      if (this.executionWork.has(selector.runId)) throw new Error('operation-pending')
      const done = Promise.resolve().then(() => work(signal))
      this.executionWork.set(selector.runId, { cancel: cancellation, done })
      try { return await track(() => done) }
      finally { this.executionWork.delete(selector.runId); cancellation.abort() }
    }
    return { generation, signal, run, read: () => track(read),
      command: (input: z.output<typeof executionCommandSchema>) => track(() => command(input)) }
  }
  /**
   * Commit one private Host planning command with a durable native uncertainty journal.
   * @param input - Closed project-bound planning operation; not exposed through Renderer actions.
   * @param generation - Captured online identity generation.
   * @returns Historical receipt. An uncertain attempt must be reconciled before any new mutation.
   */
  async planningCommand(input: z.output<typeof planningCommandSchema>, generation: number): Promise<import('@deepseek-ai/dsh-organization/types').Receipt> {
    const command = planningCommandSchema.parse(input)
    this.assertOrganization(command.organizationId)
    const principal = this.state.principal
    if (this.closed || !principal || generation !== this.generation || this.state.phase !== 'ready') throw new Error('superseded')
    if (this.journalError) throw new Error('invalid-operation-journal')
    if (this.writing || this.pending) throw new Error('operation-pending')
    const task = (async () => {
      this.writing = true
      const key = this.identityKey()
      try {
        this.pending = { ...principal, operationId: command.operationId, organizationId: command.organizationId }
        this.publish({ pendingOperation: command.operationId })
        const receipt = receiptSchema.parse(await this.request('/planning/command', command, generation))
        this.uncertain.delete(key); this.savePending(); this.publish({ pendingOperation: undefined })
        return receipt
      } catch (error) {
        if (error instanceof Error && ['invalid-input', 'forbidden', 'operation-conflict', 'rate-limited', 'version-conflict'].includes(error.message)) {
          this.uncertain.delete(key); this.savePending()
          if (key === this.identityKey()) this.publish({ pendingOperation: this.pending?.operationId })
        }
        throw error
      } finally { this.writing = false }
    })()
    this.operations.add(task)
    try { return await task } finally { this.operations.delete(task) }
  }
  private async performAction(input: ConnectionAction): Promise<ConnectionResult> {
    const action = actionSchema.parse(input)
    if (['personal', 'select', 'reconnect', 'logout', 'probe', 'login'].includes(action.kind)) this.stopExecution()
    if (action.kind === 'personal') { this.reset({ mode: 'personal', organizationId: undefined }); return {} }
    if (action.kind === 'logout' || action.kind === 'probe' || action.kind === 'login') {
      const previousTrust = this.trust; const previousToken = this.token
      this.clearLogin()
      this.reset({ phase: this.trust ? 'signed-out' : 'disconnected',
        mode: 'personal',
        principal: undefined,
        username: undefined,
        organizations: [],
        organizationId: undefined })
      if (previousTrust && previousToken) {
        const logout = organizationRequest(previousTrust, 'POST', '/organization/v1/logout', {}, previousToken)
          .then(() => {}, (_error: unknown) => {
            // The identity is already cleared locally; remote expiry bounds a failed logout.
          })
        this.streams.add(logout)
        void logout.finally(() => this.streams.delete(logout))
      }
    }
    const generation = this.generation
    try {
      switch (action.kind) {
        case 'probe': {
          this.trust = undefined; this.offer = undefined; this.serverId = undefined
          const input = action.origin.trim()
          const origin = /^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? input : `https://${input}`
          this.publish({ origin, offer: undefined, pendingOperation: undefined, error: undefined })
          const offer = await probeOrganizationCertificate(origin, this.config.timeoutMs)
          if (generation !== this.generation) return {}
          this.offer = { ...offer, origin }
          this.publish({ phase: 'untrusted', offer: { fingerprint: offer.fingerprint, expiresAt: offer.expiresAt } })
          return {}
        }
        case 'trust': {
          if (!this.offer || this.offer.fingerprint !== action.fingerprint) throw new Error('certificate-changed')
          this.trust = { ...this.offer, ...this.config }
          const identity = identitySchema.parse(await this.request('/identity'))
          this.serverId = identity.serverId
          if (this.config.trustPath) this.save(this.config.trustPath, { ...this.offer, serverId: identity.serverId })
          this.publish({ phase: 'signed-out', offer: undefined }); return {}
        }
        case 'login': {
          const result = loginResultSchema.parse(await this.request('/login', { username: action.username, password: action.password }))
          if (result.principal.serverId !== this.serverId) throw new Error('certificate-changed')
          this.token = result.token
          this.armLoginExpiry(result.expiresAt)
          if (this.trust) {
            try { this.loginSession?.save({ ...result, format: 1, origin: this.trust.origin,
              fingerprint: this.trust.fingerprint, username: action.username }) }
            catch (_error) { console.warn('organization component=login-session result=save-unavailable') }
          }
          this.publish({ principal: result.principal, username: action.username, phase: 'loading' })
          this.publish({ pendingOperation: this.pending?.operationId })
          await this.refresh(generation)
          return {}
        }
        case 'register': {
          const { kind: _kind, ...fields } = action
          const request = registerSchema.parse({ ...fields, operationId: randomUUID() })
          const receipt = receiptSchema.parse(await this.request('/register', request))
          await this.performAction({ kind: 'login', username: action.username, password: action.password })
          return { receipt }
        }
        case 'logout': return {}
        case 'select': {
          if (!this.state.organizations.some(org => org.id === action.organizationId)) throw new Error('forbidden')
          const next = this.reset({ organizationId: action.organizationId, mode: 'organization', phase: 'loading' })
          await this.refresh(next); return {}
        }
        case 'reconnect': await this.refresh(this.reset({ phase: 'loading' })); return {}
        case 'search': {
          this.currentOrganization()
          const cursor = action.offset ? this.state.projects?.cursor : undefined
          const next = this.reset({ phase: 'loading' })
          await this.refresh(next, action.query, action.offset, cursor); return {}
        }
        case 'grants': {
          const id = this.currentOrganization()
          return { grants: grantsSchema.parse(await this.request(`/projects/${action.projectId}/grants?organizationId=${id}`)) }
        }
        case 'reconcile': return await this.reconcile()
        case 'invite': {
          const invitationToken = randomBytes(32).toString('base64url')
          return await this.mutate({ kind: 'invite',
            operationId: randomUUID(),
            organizationId: this.currentOrganization(),
            role: action.role, invitationToken }, invitationToken)
        }
        case 'command': return await this.mutate(action.command)
        case 'integration-verify':
        case 'integration-confirm': throw new Error('forbidden')
        case 'integration-read': {
          const request = integrationReadSchema.parse(action.request)
          const generation = this.generation
          if (request.organizationId !== this.currentOrganization()) throw new Error('forbidden')
          const integration = integrationViewSchema.parse(await this.request('/integration/read', request, generation))
          return { generation, integration }
        }
        case 'delivery-command': return await this.mutate(action.request, undefined, 'delivery')
        case 'delivery-read': {
          const request = deliveryReadSchema.parse(action.request)
          this.assertOrganization(request.organizationId)
          const delivery = deliveryPageSchema.parse(await this.request('/delivery/read', request, generation))
          return { generation, delivery }
        }
        case 'delivery-download': {
          const request = artifactReadSchema.parse(action.request)
          this.assertOrganization(request.organizationId)
          const artifact = artifactDownloadSchema.parse(await this.request('/delivery/download', request, generation))
          return { generation, artifact }
        }
        case 'execution-command': {
          const input = z.record(z.string(), z.unknown()).parse(action.request)
          if ('deviceId' in input) throw new Error('invalid-input')
          if (!['grant-execution', 'revoke-execution', 'create-run', 'transition-run'].includes(String(input.kind))
            || input.kind === 'transition-run' && input.state !== 'paused' && input.state !== 'cancelled') throw new Error('forbidden')
          return await this.mutate({ ...input, deviceId: this.localDeviceId() }, undefined, 'execution', this.material())
        }
        case 'planning-plan': {
          const query = planningPlanReadSchema.parse(action.request)
          this.assertOrganization(query.organizationId)
          const planningPlan = planningPlanViewSchema.parse(await this.request('/planning/plan', query, generation))
          return { generation, planningPlan }
        }
        case 'planning-read': {
          const query = planningReadSchema.parse(action.request)
          this.assertOrganization(query.organizationId)
          const planning = planningViewSchema.parse(await this.request('/planning/read', query, generation))
          return { generation, planning }
        }
        case 'planning-candidates': {
          const query = planningCandidatesSchema.parse(action.request)
          this.assertOrganization(query.organizationId)
          const candidates = planningCandidatesPageSchema.parse(await this.request('/planning/candidates', query, generation))
          return { generation, candidates }
        }
        case 'execution-list': {
          const request = executionListSchema.parse(action.request)
          this.assertOrganization(request.organizationId)
          const executions = executionPageSchema.parse(await this.request('/execution/list', request, generation))
          return { generation, executions }
        }
        case 'execution-read': {
          const request = executionReadSchema.parse(action.request)
          this.assertOrganization(request.organizationId)
          const value = executionViewSchema.parse(await this.request('/execution/read', request, generation))
          if (generation !== this.generation) throw new Error('superseded')
          return { generation, execution: value }
        }
        case 'assignment-command': return await this.mutate(action.request, undefined, 'assignment')
        case 'assignment-participant': {
          const command = participantCommandSchema.parse(action.request)
          if (command.kind === 'delegate') throw new Error('invalid-input')
          return await this.mutate(command, undefined, 'participant')
        }
        case 'assignment-delegate': {
          const input = delegateSchema.omit({ deviceId: true, expiresAt: true })
            .extend({ durationMs: z.number().int().positive() }).strict().parse(action.request)
          const selector = assignmentReadSchema.parse({ organizationId: input.organizationId, projectId: input.projectId,
            planId: input.planId, assignmentId: input.assignmentId })
          this.assertOrganization(selector.organizationId)
          const preparation = preparationSchema.parse(await this.request('/assignment/preparation', selector))
          if (input.durationMs > preparation.delegationMaxDurationMs) throw new Error('invalid-input')
          const { durationMs, ...fields } = input
          return await this.mutate({ ...fields, deviceId: this.localDeviceId(), expiresAt: preparation.serverTime + durationMs }, undefined, 'participant')
        }
        case 'assignment-review':
        case 'assignment-tasks':
        case 'assignment-inbox':
        case 'assignment-preparation': return await this.readAssignmentAction({ kind: action.kind, request: action.request }, generation)
        case 'device-read': {
          const value = await this.readLocalDevice()
          return { assignment: { generation, result: { kind: 'device', value } } }
        }
        case 'device-register': {
          const material = this.material()
          if (material.deviceId()) {
            const device = await this.readLocalDevice()
            if (device?.state === 'revoked') material.retire(device)
          }
          const command = material.registration(action.name, brandString<OperationId>(randomUUID()))
          // A durable registration may have succeeded before the native reply was lost.
          const receipt = receiptSchema.nullable().parse(await this.request(`/receipts/${command.operationId}`))
          if (receipt) { material.registered(receipt); return { generation, receipt } }
          const result = await this.mutate(command, undefined, 'device', material)
          if (result.receipt) material.registered(result.receipt)
          return result
        }
        case 'device-revoke': {
          const material = this.material()
          const result = await this.mutate({ kind: 'revoke-device', organizationId: this.currentOrganization(),
            operationId: randomUUID(), deviceId: this.localDeviceId(), expectedVersion: action.expectedVersion }, undefined, 'device')
          if (result.receipt) material.forgetRevoked(result.receipt)
          return result
        }
        case 'lease-claim':
        case 'lease-release':
        case 'lease-check': return await this.leaseAction(action.kind, action.request)
        case 'workgraph-save': return await this.mutate(workgraphSaveSchema.parse(action.request), undefined, 'save')
        case 'workgraph-grant': return await this.mutate(workgraphGrantSchema.parse(action.request), undefined, 'grant')
        case 'workgraph-read':
        case 'workgraph-tasks':
        case 'workgraph-grants': return await this.readWorkgraph({ kind: action.kind, request: action.request }, generation)
        default: return assertNever(action.kind)
      }
    } catch (error) {
      if (generation === this.generation && error instanceof Error && error.message !== 'superseded') {
        if (['unauthenticated', 'certificate-changed'].includes(error.message)) this.invalidate(error.message)
        else this.publish({ error: error.message })
        throw error
      }
      throw error
    }
  }
  private async readWorkgraph(
    action: { kind: 'workgraph-read' | 'workgraph-tasks' | 'workgraph-grants'; request: unknown }, generation: number,
  ): Promise<ConnectionResult> {
    const organizationId = this.currentOrganization()
    const principal = this.state.principal
    if (!principal) throw new Error('unavailable')
    const requestId = brandString<OrganizationRequestId>(randomUUID())
    const request = (action.kind === 'workgraph-read' ? workgraphReadSchema
      : action.kind === 'workgraph-tasks' ? workgraphTasksSchema : workgraphGrantsSchema).parse(action.request)
    if (request.organizationId !== organizationId) throw new Error('forbidden')
    const route = action.kind === 'workgraph-read' ? '/workgraph/read' : action.kind === 'workgraph-tasks' ? '/workgraph/tasks' : '/workgraph/grants'
    const value = await this.request(route, request, generation)
    if (generation !== this.generation) throw new Error('superseded')
    const result: NonNullable<ConnectionResult['workgraph']>['result'] = action.kind === 'workgraph-read'
      ? { kind: 'plan', value: workgraphVersionSchema.parse(value) }
      : action.kind === 'workgraph-tasks' ? { kind: 'tasks', value: workgraphPageSchema.parse(value) }
        : { kind: 'grants', value: z.array(workgraphGrantViewSchema).parse(value) }
    return { workgraph: { generation, requestId, principal: { ...principal }, organizationId, result } }
  }

  private assertOrganization(id: OrganizationId): void {
    if (id !== this.currentOrganization()) throw new Error('forbidden')
  }
  private material(): OrganizationDeviceMaterial {
    const organizationId = this.currentOrganization()
    const membershipId = this.state.organizations.find(org => org.id === organizationId)?.membershipId
    if (!this.device || !this.state.principal || !membershipId) throw new Error('device-vault-unavailable')
    return new OrganizationDeviceMaterial(this.device.directory,
      { ...this.state.principal, organizationId, membershipId }, this.device.vault)
  }
  private localDeviceId() {
    const id = this.material().deviceId()
    if (!id) throw new Error('device-registration-required')
    return id
  }
  private async readLocalDevice() {
    const organizationId = this.currentOrganization(), deviceId = this.material().deviceId()
    const devices = devicesSchema.parse(await this.request('/device/list', { organizationId }))
    return devices.find(device => device.id === deviceId) ?? null
  }
  private async readAssignmentAction(action: { kind: 'assignment-review' | 'assignment-tasks' | 'assignment-inbox' | 'assignment-preparation'; request: unknown }, generation: number): Promise<ConnectionResult> {
    const input = (action.kind === 'assignment-review' ? approvalReviewSchema : action.kind === 'assignment-tasks' ? taskAssignmentsQuerySchema : action.kind === 'assignment-inbox' ? inboxQuerySchema : assignmentReadSchema).parse(action.request)
    this.assertOrganization(input.organizationId)
    const route = action.kind === 'assignment-review' ? '/assignment/review' : action.kind === 'assignment-tasks' ? '/assignment/tasks' : action.kind === 'assignment-inbox' ? '/assignment/inbox' : '/assignment/preparation'
    const value = await this.request(route, input, generation)
    const result: NonNullable<ConnectionResult['assignment']>['result'] = action.kind === 'assignment-review' ? { kind: 'review', value: approvalReviewResultSchema.parse(value) } : action.kind === 'assignment-tasks'
      ? { kind: 'tasks', value: taskAssignmentsPageSchema.parse(value) } : action.kind === 'assignment-inbox'
        ? { kind: 'inbox', value: inboxPageSchema.parse(value) } : { kind: 'preparation', value: preparationSchema.parse(value) }
    return { assignment: { generation, result } }
  }
  private async leaseAction(kind: 'lease-claim' | 'lease-release' | 'lease-check', input: unknown): Promise<ConnectionResult> {
    const query = kind === 'lease-claim' ? claimSchema.omit({ kind: true, operationId: true, deviceId: true }).parse(input) : assignmentReadSchema.parse(input)
    this.assertOrganization(query.organizationId)
    const material = this.material(), deviceId = this.localDeviceId()
    const selector = assignmentReadSchema.parse({ organizationId: query.organizationId, projectId: query.projectId,
      planId: query.planId, assignmentId: query.assignmentId })
    const preparation = preparationSchema.parse(await this.request('/assignment/preparation', selector))
    const lease = preparation.lease
    const command = kind === 'lease-claim' ? { ...query, kind: 'claim', operationId: randomUUID(), deviceId }
      : lease && lease.deviceId === deviceId && lease.state === 'held' ? { ...selector, deviceId,
        kind: kind === 'lease-release' ? 'release' : 'renew', operationId: randomUUID(),
        fencingEpoch: lease.fencingEpoch, serverEpoch: lease.serverEpoch, expectedVersion: lease.version } : null
    if (!command) throw new Error('lease-recheck-required')
    this.renewingMutation = kind === 'lease-check'
    let result: ConnectionResult
    try { result = await this.mutate(command, undefined, 'device', material) } finally { this.renewingMutation = false }
    if (kind !== 'lease-release' && result.receipt?.lease?.state === 'held') {
      const current = preparationSchema.parse(await this.request('/assignment/preparation', selector))
      if (current.lease?.state === 'held' && current.lease.deviceId === deviceId
        && current.lease.fencingEpoch === result.receipt.lease.fencingEpoch) {
        const lifetime = this.executionLifetime.signal
        const expires = performance.now() + current.lease.expiresAt - current.serverTime
        this.publish({ renewing: query.assignmentId })
        const renew = () => {
          if (lifetime.aborted) return
          if (performance.now() >= expires || this.pending && !this.writing) {
            this.publish({ renewing: undefined, error: 'lease-recheck-required' }); return
          }
          if (this.writing || this.state.phase === 'loading') {
            this.renewal = setTimeout(renew, Math.min(this.config.reconnectMs, Math.max(1, expires - performance.now())))
            return
          }
          const task = this.leaseAction('lease-check', selector).then(() => {}).catch((error: unknown) => {
            if (!lifetime.aborted) this.publish({ renewing: undefined, error: error instanceof Error ? error.message : 'unavailable' })
          })
          this.streams.add(task)
          void task.finally(() => this.streams.delete(task))
        }
        clearTimeout(this.renewal)
        this.renewal = setTimeout(renew, Math.max(1, (current.lease.expiresAt - current.serverTime) * this.config.renewalFraction))
      }
    }
    return result
  }
  /** Stop lease renewal before sleep; reconnection requires explicit current-owner checking. */
  suspend(): void { this.reset({ phase: 'offline', error: 'lease-recheck-required' }) }

  private currentOrganization(): OrganizationId {
    if (!this.token || !this.state.organizationId || this.state.phase !== 'ready') throw new Error('unavailable')
    return this.state.organizationId
  }
  /**
   * Send an observation constructed by Electron after actual target reads.
   * @param input - Native-generated strict command, never a Renderer connection action.
   * @returns Durable receipt with uncertain-write reconciliation.
   */
  commitIntegration(input: unknown): Promise<ConnectionResult> {
    return this.mutate(input, undefined, 'integration')
  }

  private async mutate(input: unknown, invitationToken?: string, workgraph?: 'integration' | 'delivery' | 'save' | 'grant' | 'assignment' | 'participant' | 'device' | 'execution', material?: OrganizationDeviceMaterial): Promise<ConnectionResult> {
    if (this.journalError) throw new Error('invalid-operation-journal')
    if (this.writing || this.pending) throw new Error('operation-pending')
    if (!this.token || this.state.phase !== 'ready' || !this.state.principal) throw new Error('unavailable')
    const command = workgraph === 'integration' ? integrationCommandSchema.parse(input) : workgraph === 'delivery' ? deliveryCommandSchema.parse(input) : workgraph === 'execution' ? executionCommandSchema.parse(input) : workgraph === 'assignment' ? assignmentCommandSchema.parse(input)
      : workgraph === 'participant' ? participantCommandSchema.parse(input)
        : workgraph === 'device' ? deviceCommandSchema.parse(input)
          : workgraph === 'save' ? workgraphSaveSchema.parse(input)
            : workgraph === 'grant' ? workgraphGrantSchema.parse(input) : z.union([commandSchema, projectCommandSchema, grantCommandSchema]).parse(input)
    const kind = 'kind' in command ? command.kind : undefined
    if ('organizationId' in command && command.organizationId !== this.state.organizationId) throw new Error('forbidden')
    const route = workgraph === 'integration' ? '/integration/command' : workgraph === 'delivery' ? '/delivery/command' : workgraph === 'execution' ? '/execution/command' : workgraph === 'assignment' ? '/assignment/command' : workgraph === 'participant' ? '/assignment/participant'
      : workgraph === 'device' ? '/device/command' : workgraph ? `/workgraph/${workgraph}` : kind === 'set-grant' ? '/grants'
        : kind === 'create-project' || kind === 'rename-project' ? '/projects' : '/commands'
    this.pending = { operationId: command.operationId,
      accountId: this.state.principal.accountId,
      serverId: this.state.principal.serverId, ...('organizationId' in command ? { organizationId: command.organizationId } : {}),
      ...(kind === 'register-device' || kind === 'revoke-device' ? { deviceAction: kind } : {}), ...(invitationToken ? { invitationToken } : {}) }
    this.publish({ pendingOperation: command.operationId })
    this.writing = true
    const generation = this.reset({ phase: 'ready' })
    const pending = this.pending
    if (kind !== 'renew') console.info('organization component=connection operation=%s operationId=%s generation=%s result=started', kind ?? workgraph, command.operationId, generation)
    try {
      if (workgraph === 'execution' && !material) throw new Error('device-vault-unavailable')
      const body = workgraph === 'execution' && material ? { command, proof: material.proof(command, await this.request('/execution/challenge', command)) } : workgraph === 'device' ? { command, ...(material ? { proof: material.proof(command, await this.request('/device/challenge', command)) } : {}) } : command
      const receipt = receiptSchema.parse(await this.request(route, body))
      this.pending = undefined; this.publish({ pendingOperation: undefined })
      if (workgraph === 'execution' && 'kind' in command && command.kind === 'transition-run'
        && (command.state === 'paused' || command.state === 'cancelled')) {
        const work = this.executionWork.get(command.runId)
        work?.cancel.abort()
        if (work) await work.done.catch((_error: unknown) => { /* The stop receipt is independent of the drained interval's outcome. */ })
      }
      if (kind === 'change-password') this.invalidate('unauthenticated')
      else {
        try { await this.refresh(this.reset({ phase: 'loading' })) } catch (error) { if (error instanceof Error && error.message === 'superseded') throw error }
      }
      if (kind !== 'change-password' && (`${pending.serverId}:${pending.accountId}` !== this.identityKey() || pending.organizationId && pending.organizationId !== this.state.organizationId)) throw new Error('superseded')
      if (kind !== 'renew') console.info('organization component=connection operationId=%s generation=%s result=confirmed', command.operationId, this.generation)
      return { generation: this.generation, receipt, ...(invitationToken ? { invitationToken } : {}) }
    } catch (error) {
      if (error instanceof Error && ['invalid-input', 'last-admin', 'version-conflict', 'forbidden', 'operation-conflict', 'invalid-credentials', 'rate-limited', 'snapshot-required'].includes(error.message)) {
        this.uncertain.delete(`${pending.serverId}:${pending.accountId}`); this.savePending()
        if (`${pending.serverId}:${pending.accountId}` === this.identityKey()) this.publish({ pendingOperation: this.pending?.operationId })
        if (generation === this.generation) await this.refresh(this.reset({ phase: 'loading' }))
      }
      throw error
    } finally { this.writing = false }
  }
  private async reconcile(): Promise<ConnectionResult> {
    if (this.writing) throw new Error('operation-pending')
    const pending = this.pending
    if (!pending || pending.accountId !== this.state.principal?.accountId || pending.serverId !== this.state.principal.serverId) throw new Error('forbidden')
    const organizationId = this.state.organizationId
    if (organizationId && pending.organizationId && organizationId !== pending.organizationId) throw new Error('forbidden')
    const receipt = receiptSchema.nullable().parse(await this.request(`/receipts/${pending.operationId}`))
    console.info('organization component=connection operationId=%s result=%s', pending.operationId, receipt ? 'receipt-found' : 'receipt-absent')
    if (!receipt) { this.pending = undefined; this.publish({ pendingOperation: undefined }); throw new Error('operation-not-committed') }
    if (pending.deviceAction) {
      if (pending.organizationId !== this.currentOrganization()) throw new Error('forbidden')
      const material = this.material()
      if (pending.deviceAction === 'register-device') material.registered(receipt)
      else material.forgetRevoked(receipt)
    }
    this.pending = undefined; this.publish({ pendingOperation: undefined })
    await this.refresh(this.reset({ phase: 'loading' }))
    if (`${pending.serverId}:${pending.accountId}` !== this.identityKey()
      || organizationId !== this.state.organizationId) throw new Error('superseded')
    return { generation: this.generation, receipt, ...(pending.invitationToken ? { invitationToken: pending.invitationToken } : {}) }
  }
  private async refresh(generation: number, query = '', offset = 0, cursor?: string): Promise<void> {
    const organizations = organizationsSchema.parse(await this.request('/organizations', undefined, generation))
    const id = this.state.organizationId
    if (!id) { this.publish({ organizations, phase: 'ready' }); return }
    const selected = organizations.find(org => org.id === id)
    if (!selected) { this.reset({ organizations, organizationId: undefined, phase: 'ready', error: 'forbidden' }); return }
    const projects = pageSchema.parse(await this.request(`/organizations/${id}/search?q=${encodeURIComponent(query)}&offset=${offset}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, undefined, generation))
    const inbox = inboxPageSchema.parse(await this.request('/assignment/inbox', { organizationId: id }, generation))
    const members = selected.role === 'admin' ? membersSchema.parse(await this.request(`/organizations/${id}/members`, undefined, generation)) : []
    if (generation !== this.generation) return
    this.publish({ organizations, projects, members, inbox, phase: 'ready', error: undefined })
    this.follow(generation, id, projects, 'projects')
    this.follow(generation, id, projects, 'workgraph')
    this.follow(generation, id, inbox, 'inbox')
  }
  private follow(generation: number,
    id: OrganizationId,
    page: { cursor: import('@deepseek-ai/dsh-organization/types').OrganizationCursor; revision: number }, domain: 'projects' | 'workgraph' | 'inbox'): void {
    if (!this.trust || !this.token) return
    const stream = (domain === 'inbox' ? followInboxEvents : domain === 'workgraph' ? followWorkgraphEvents : followOrganizationEvents)(this.trust, id, this.token, page, this.cancel.signal)
    const task = (async () => {
      try {
        for await (const batch of stream) {
          if (generation !== this.generation) return
          if (batch.events.length === 0) continue
          this.scheduleRefresh(generation); return
        }
      } catch (error) {
        if (generation !== this.generation) return
        console.info('organization component=connection stream=%s result=reset decisionCode=%s',
          domain, error instanceof OrganizationStreamReset ? error.code : 'transport-failed')
        if (error instanceof OrganizationStreamReset && error.code === 'snapshot-required') this.scheduleRefresh(generation)
        else if (error instanceof OrganizationStreamReset && ['forbidden', 'unauthenticated'].includes(error.code)) this.invalidate(error.code)
        else {
          const code = error instanceof Error && 'code' in error ? String(error.code) : ''
          if (/CERT|TLS|SELF_SIGNED/.test(code)) { this.trust = undefined; this.invalidate('certificate-changed') }
          else this.offline(generation)
        }
      }
    })()
    this.streams.add(task)
    void task.finally(() => this.streams.delete(task))
  }
  private scheduleRefresh(generation: number): void {
    if (generation !== this.generation) return
    const next = this.reset({ phase: 'loading' })
    void this.refresh(next).catch(() => { this.offline(next) })
  }
  private invalidate(error: string): void {
    this.clearLogin()
    this.reset({ phase: this.trust ? 'signed-out' : 'disconnected',
      principal: undefined,
      organizations: [],
      organizationId: undefined, error })
  }
  private offline(generation: number): void {
    if (generation !== this.generation) return
    const next = this.reset({ phase: 'offline', error: 'unavailable' })
    this.retry = setTimeout(() => { void this.refresh(next).catch((error: unknown) => {
      if (next !== this.generation) return
      if (error instanceof Error && error.message === 'unauthenticated') this.invalidate('unauthenticated')
      else this.offline(next)
    }) }, this.config.reconnectMs)
  }
  /** Dispose the native connection.
   * @returns Settlement after subscriptions are aborted and in-memory credentials erased; encrypted login survives shutdown.
   */
  async close(): Promise<void> { this.closed = true; this.token = undefined; clearTimeout(this.loginExpiry); this.reset({ phase: 'disconnected',
    principal: undefined,
    organizations: [],
    organizationId: undefined }); this.listeners.clear(); await Promise.allSettled([...this.streams, ...this.operations]) }
}
function assertNever(value: never): never { throw new Error(`unknown action ${String(value)}`) }

export { OrganizationDeviceMaterial, type OrganizationDeviceVault } from './device-material.ts'
