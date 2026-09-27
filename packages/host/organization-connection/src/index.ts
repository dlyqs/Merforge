/** Native organization client: scoped identity, cancellation, events and explicit mutations. */
import { readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs'
import { randomBytes, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { brandString } from '@deepseek-ai/dsh-brand'
import { organizationRequest, probeOrganizationCertificate, followOrganizationEvents, followWorkgraphEvents, OrganizationStreamReset, type OrganizationTrust, type CertificateOffer } from '@deepseek-ai/dsh-organization-api/transport'
import { commandSchema, registerSchema, receiptSchema } from '@deepseek-ai/dsh-organization/protocol'
import { projectCommandSchema, grantCommandSchema } from '@deepseek-ai/dsh-organization/resources'
import { workgraphSaveSchema, workgraphReadSchema, workgraphTasksSchema, workgraphGrantSchema, workgraphGrantsSchema, workgraphVersionSchema, workgraphPageSchema, workgraphGrantViewSchema } from '@deepseek-ai/dsh-organization/workgraph'
import type { AccountId, OperationId, LoginToken, OrganizationId, ServerId } from '@deepseek-ai/dsh-organization/types'
import { actionSchema, connectionConfig, identitySchema, loginResultSchema, organizationsSchema, pageSchema, membersSchema, grantsSchema } from './schema.ts'
import type { ConnectionAction, ConnectionSnapshot, ConnectionResult, OrganizationRequestId } from './types.ts'

/** Configurable request bounds and reconnection interval for a small LAN client. */
export type Config = z.input<typeof connectionConfig>
interface Pending { operationId: OperationId; accountId: AccountId; serverId: ServerId; invitationToken?: string }

/** One native connection; no personal cookie, model credential or filesystem record enters this owner. */
export class OrganizationConnection {
  private state: ConnectionSnapshot = { revision: 0, generation: 0, phase: 'disconnected', mode: 'personal', organizations: [], members: [] }
  private trust: OrganizationTrust | undefined
  private offer: (CertificateOffer & { origin: string }) | undefined
  private token: LoginToken | undefined
  private serverId: ServerId | undefined
  private generation = 0
  private discardedResponses = 0
  private cancel = new AbortController()
  private readonly streams = new Set<Promise<void>>()
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
  private journalError = false
  private readonly config: z.output<typeof connectionConfig>
  private readonly listeners = new Set<() => void>()
  /** @param config - Validated native deployment bounds. */
  constructor(config: Config = {}) {
    this.config = connectionConfig.parse(config)
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
          serverId: identitySchema.shape.serverId }).strict()).parse(JSON.parse(readFileSync(`${this.config.trustPath}.pending`, 'utf8')))
        for (const entry of saved) this.uncertain.set(`${entry.serverId}:${entry.accountId}`, entry)
      } catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) { this.journalError = true; this.state.error = 'invalid-operation-journal' } }
    }
  }
  private save(path: string, data: unknown): void {
    const temporary = `${path}.${randomUUID()}`
    writeFileSync(temporary, JSON.stringify(data), { mode: 0o600, flag: 'wx' })
    try { renameSync(temporary, path) } catch (error) { unlinkSync(temporary); throw error }
  }
  private savePending(): void {
    if (this.config.trustPath) this.save(`${this.config.trustPath}.pending`, [...this.uncertain.values()].map(({ operationId, serverId, accountId }) => ({ operationId, serverId, accountId })))
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
  private publish(next: Partial<ConnectionSnapshot>): void {
    if (next.phase && next.phase !== this.state.phase) console.info('organization component=connection phase=%s result=state-change', next.phase)
    this.state = { ...this.state, ...next, revision: this.state.revision + 1 }
    for (const listener of this.listeners) {
      try { listener() } catch (error) { console.error('organization component=connection result=observer-failed', error instanceof Error ? error.name : 'Error') }
    }
  }
  private reset(next: Partial<ConnectionSnapshot>): number {
    this.cancel.abort(); this.cancel = new AbortController(); clearTimeout(this.retry)
    this.generation++
    this.publish({ generation: this.generation, projects: undefined, members: [], error: undefined, ...next })
    return this.generation
  }
  private async request(route: string, body?: unknown, generation = this.generation): Promise<unknown> {
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
      else if (code === 'forbidden') this.reset({ organizationId: undefined, phase: 'ready', error: code })
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
    const action = actionSchema.parse(input)
    if (action.kind === 'personal') { this.reset({ mode: 'personal', organizationId: undefined }); return {} }
    if (action.kind === 'logout' || action.kind === 'probe' || action.kind === 'login') {
      const previousTrust = this.trust; const previousToken = this.token
      this.token = undefined
      this.reset({ phase: this.trust ? 'signed-out' : 'disconnected',
        mode: 'personal',
        principal: undefined,
        username: undefined,
        organizations: [],
        organizationId: undefined })
      if (previousTrust && previousToken) void organizationRequest(previousTrust, 'POST', '/organization/v1/logout', {}, previousToken).catch(() => {})
    }
    const generation = this.generation
    try {
      switch (action.kind) {
        case 'probe': {
          this.trust = undefined; this.offer = undefined; this.serverId = undefined
          this.publish({ origin: action.origin, offer: undefined, pendingOperation: undefined })
          const offer = await probeOrganizationCertificate(action.origin, this.config.timeoutMs)
          if (generation !== this.generation) return {}
          this.offer = { ...offer, origin: action.origin }
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
          this.publish({ principal: result.principal, username: action.username, phase: 'loading' })
          this.publish({ pendingOperation: this.pending?.operationId })
          await this.refresh(generation)
          return {}
        }
        case 'register': {
          const { kind: _kind, ...fields } = action
          const request = registerSchema.parse({ ...fields, operationId: randomUUID() })
          return { receipt: receiptSchema.parse(await this.request('/register', request)) }
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

  private currentOrganization(): OrganizationId {
    if (!this.token || !this.state.organizationId || this.state.phase !== 'ready') throw new Error('unavailable')
    return this.state.organizationId
  }
  private async mutate(input: unknown, invitationToken?: string, workgraph?: 'save' | 'grant'): Promise<ConnectionResult> {
    if (this.journalError) throw new Error('invalid-operation-journal')
    if (this.writing || this.pending) throw new Error('operation-pending')
    if (!this.token || this.state.phase !== 'ready' || !this.state.principal) throw new Error('unavailable')
    const command = workgraph === 'save' ? workgraphSaveSchema.parse(input)
      : workgraph === 'grant' ? workgraphGrantSchema.parse(input) : z.union([commandSchema, projectCommandSchema, grantCommandSchema]).parse(input)
    const kind = 'kind' in command ? command.kind : undefined
    if ('organizationId' in command && command.organizationId !== this.state.organizationId) throw new Error('forbidden')
    const route = workgraph ? `/workgraph/${workgraph}` : kind === 'set-grant' ? '/grants'
      : kind === 'create-project' || kind === 'rename-project' ? '/projects' : '/commands'
    this.pending = { operationId: command.operationId,
      accountId: this.state.principal.accountId,
      serverId: this.state.principal.serverId, ...(invitationToken ? { invitationToken } : {}) }
    this.publish({ pendingOperation: command.operationId })
    this.writing = true
    const generation = this.reset({ phase: 'ready' })
    const pending = this.pending
    try {
      const receipt = receiptSchema.parse(await this.request(route, command))
      this.pending = undefined; this.publish({ pendingOperation: undefined })
      if (kind === 'change-password') this.invalidate('unauthenticated')
      else {
        try { await this.refresh(this.reset({ phase: 'loading' })) } catch (error) { if (error instanceof Error && error.message === 'superseded') throw error }
      }
      if (kind !== 'change-password' && `${pending.serverId}:${pending.accountId}` !== this.identityKey()) throw new Error('superseded')
      return { receipt, ...(invitationToken ? { invitationToken } : {}) }
    } catch (error) {
      if (error instanceof Error && ['invalid-input', 'last-admin', 'version-conflict', 'forbidden', 'operation-conflict', 'invalid-credentials'].includes(error.message)) {
        this.uncertain.delete(`${pending.serverId}:${pending.accountId}`); this.savePending()
        if (generation === this.generation) { this.publish({ pendingOperation: undefined }); await this.refresh(this.reset({ phase: 'loading' })) }
      }
      throw error
    } finally { this.writing = false }
  }
  private async reconcile(): Promise<ConnectionResult> {
    if (this.writing) throw new Error('operation-pending')
    const pending = this.pending
    if (!pending || pending.accountId !== this.state.principal?.accountId || pending.serverId !== this.state.principal.serverId) throw new Error('forbidden')
    const receipt = receiptSchema.nullable().parse(await this.request(`/receipts/${pending.operationId}`))
    console.info('organization component=connection operationId=%s result=%s', pending.operationId, receipt ? 'receipt-found' : 'receipt-absent')
    if (!receipt) { this.pending = undefined; this.publish({ pendingOperation: undefined }); throw new Error('operation-not-committed') }
    this.pending = undefined; this.publish({ pendingOperation: undefined })
    await this.refresh(this.reset({ phase: 'loading' }))
    if (`${pending.serverId}:${pending.accountId}` !== this.identityKey()) throw new Error('superseded')
    return { receipt, ...(pending.invitationToken ? { invitationToken: pending.invitationToken } : {}) }
  }
  private async refresh(generation: number, query = '', offset = 0, cursor?: string): Promise<void> {
    const organizations = organizationsSchema.parse(await this.request('/organizations', undefined, generation))
    const id = this.state.organizationId
    if (!id) { this.publish({ organizations, phase: 'ready' }); return }
    const selected = organizations.find(org => org.id === id)
    if (!selected) { this.reset({ organizations, organizationId: undefined, phase: 'ready', error: 'forbidden' }); return }
    const projects = pageSchema.parse(await this.request(`/organizations/${id}/search?q=${encodeURIComponent(query)}&offset=${offset}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, undefined, generation))
    const members = selected.role === 'admin' ? membersSchema.parse(await this.request(`/organizations/${id}/members`, undefined, generation)) : []
    if (generation !== this.generation) return
    this.publish({ organizations, projects, members, phase: 'ready', error: undefined })
    this.follow(generation, id, projects, false)
    this.follow(generation, id, projects, true)
  }
  private follow(generation: number,
    id: OrganizationId,
    page: { cursor: import('@deepseek-ai/dsh-organization/types').OrganizationCursor; revision: number }, workgraph: boolean): void {
    if (!this.trust || !this.token) return
    const stream = (workgraph ? followWorkgraphEvents : followOrganizationEvents)(this.trust, id, this.token, page, this.cancel.signal)
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
          workgraph ? 'workgraph' : 'projects', error instanceof OrganizationStreamReset ? error.code : 'transport-failed')
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
    this.token = undefined
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
   * @returns Settlement after subscriptions are aborted and credentials erased.
   */
  async close(): Promise<void> { this.token = undefined; this.reset({ phase: 'disconnected',
    principal: undefined,
    organizations: [],
    organizationId: undefined }); await Promise.allSettled([...this.streams]); this.listeners.clear() }
}
function assertNever(value: never): never { throw new Error(`unknown action ${String(value)}`) }
