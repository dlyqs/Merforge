/** Restricted HTTPS listener for the organization authority; no personal Host composition or generic RPC. */
import { executionEnvelopeSchema } from '@deepseek-ai/dsh-organization/execution'
import { Context, Service } from '@deepseek-ai/cordis'
import { OrganizationError, type OrganizationService } from '@deepseek-ai/dsh-organization'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { LoginToken, OrganizationId } from '@deepseek-ai/dsh-organization'
import { createServer, type Server } from 'node:https'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'
import { z } from 'zod'
import { OrganizationStreams } from './events.ts'
import { configSchema, loadIdentity } from './tls.ts'

/** Validated deployment settings; defaults target a small LAN. */
export type Config = z.input<typeof configSchema>
/** Local status with public certificate facts, never the private key. */
export interface OrganizationApiReady { port: number; certificate: string; fingerprint: string; expiresAt: number; renewalDue: boolean }

declare module '@deepseek-ai/cordis' {
  interface Context { organizationApi: OrganizationApiService }
  interface Events {
    /**
     * The owned listener failed after readiness; the process owner must leave the ready state.
     * @mode parallel
     */
    'organization-api/failed'(): void
  }
}

/** Owns HTTPS admission and drains admitted work before releasing sockets. */
export class OrganizationApiService extends Service {
  static inject = ['organization']
  static Config = configSchema
  private readonly config: z.output<typeof configSchema>
  private server: Server | undefined
  private shutdown: Promise<void> | undefined
  private readonly sockets = new Set<Duplex>()
  private readonly work = new Set<Promise<void>>()
  private streams!: OrganizationStreams
  private facts: OrganizationApiReady | undefined

  constructor(ctx: Context, config: Config) {
    super(ctx, 'organizationApi')
    this.config = configSchema.parse(config)
  }

  protected async [Service.init](): Promise<void> {
    const identity = await loadIdentity(this.config).catch((error: unknown) => {
      throw new Error('organization-certificate-invalid', { cause: error })
    })
    this.streams = new OrganizationStreams(this.ctx, this.config)
    const server = createServer({ key: identity.privateKey, cert: identity.certificate, minVersion: 'TLSv1.2', handshakeTimeout: this.config.requestTimeoutMs,
      requestTimeout: this.config.requestTimeoutMs, headersTimeout: this.config.requestTimeoutMs }, (req, res) => {
      if (this.shutdown !== undefined || this.work.size >= this.config.maxInFlight) {
        res.setHeader('connection', 'close')
        this.respond(res, 503, { error: 'unavailable' })
        return
      }
      const task = this.handle(req, res)
      this.work.add(task)
      void task.finally(() => this.work.delete(task))
    })
    this.server = server
    server.setTimeout(this.config.requestTimeoutMs, socket => socket.destroy())
    server.maxConnections = this.config.maxConnections
    server.maxRequestsPerSocket = this.config.maxRequestsPerSocket
    server.on('connection', (socket) => {
      this.sockets.add(socket)
      socket.once('close', () => this.sockets.delete(socket))

    })
    server.on('tlsClientError', () => { /* TLS rejects unauthenticated peers before application admission. */ })
    this.ctx.effect(() => () => this.stop(), 'organization-api.close')
    try {
      await new Promise<void>((resolve, reject) => {
        const fail = (error: Error) => { server.off('listening', ready); reject(error) }
        const ready = () => { server.off('error', fail); resolve() }
        server.once('error', fail)
        server.once('listening', ready)
        server.listen(this.config.port, this.config.host)
      })
      server.on('error', () => {
        this.ctx.logger.error('organization component=https result=failed')
        void this.ctx.parallel('organization-api/failed').catch(() => { this.ctx.logger.error('organization component=https result=listener-failed') })
        void this.stop()
      })
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('listener-unavailable')
      this.facts = { port: address.port, certificate: identity.certificate, fingerprint: identity.fingerprint,
        expiresAt: identity.expiresAt,
        renewalDue: identity.expiresAt - Date.now() <= this.config.certificateWarningDays * 86400000 }
      this.ctx.logger.info('organization component=https result=ready port=%s', address.port)
    } catch (error) { await this.stop(); throw error }
  }

  /**
   * Read the live listener status.
   * @returns Listener and public certificate facts after TLS and the authority are ready.
   */
  status(): OrganizationApiReady {
    if (!this.facts || this.shutdown !== undefined) throw new Error('listener-unavailable')
    return { ...this.facts }
  }

  private stop(): Promise<void> {
    return this.shutdown ??= (async () => {
      const server = this.server
      if (!server) return
      await this.streams.close()
      const closed = new Promise<void>(resolve => server.close(() => { resolve() }))
      // Incomplete bodies must not hold the authority queue or shutdown open.
      for (const socket of this.sockets) socket.destroy()
      await Promise.allSettled([...this.work])
      await closed
      this.ctx.logger.info('organization component=https result=stopped')
    })()
  }

  private respond(res: ServerResponse, status: number, body: unknown): void {
    if (res.destroyed || res.writableEnded) return
    const data = JSON.stringify(body)
    if (Buffer.byteLength(data) > this.config.maxResponseBytes) {
      res.writeHead(503, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      res.end('{"error":"response-too-large"}')
      return
    }
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
    res.end(data)
  }

  private async body(req: IncomingMessage): Promise<unknown> {
    if (req.headers['content-type'] !== 'application/json') throw new OrganizationError('invalid-input')
    let size = 0
    const chunks: Buffer[] = []
    for await (const chunk of req) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
      size += buffer.length
      if (size > this.config.maxBodyBytes) throw new OrganizationError('invalid-input')
      chunks.push(buffer)
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) }
    catch (error) { if (error instanceof SyntaxError) throw new OrganizationError('invalid-input'); throw error }
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const deadline = setTimeout(() => res.destroy(), this.config.requestTimeoutMs)
    try {
      if (!req.url?.startsWith('/organization/v1/')) { this.respond(res, 404, { error: 'not-found' }); return }
      const url = new URL(req.url, 'https://organization.invalid')
      const path = url.pathname.slice('/organization/v1'.length)
      const authority: OrganizationService = this.ctx.organization
      const resourceRoute = /^\/organizations\/([a-f0-9-]+)\/(projects|search|events|deleted-projects)$/.exec(path)
      const detailRoute = /^\/projects\/([a-f0-9-]+)(\/grants)?$/.exec(path)
      const receiptRoute = /^\/receipts\/([a-f0-9-]+)$/.exec(path)
      const memberRoute = /^\/organizations\/([a-f0-9-]+)\/(members|hierarchy)$/.exec(path)
      const method = ['/profile/update', '/planning/plan', '/planning/read', '/planning/command', '/planning/candidates', '/delivery/command', '/delivery/read', '/delivery/download', '/execution/list', '/execution/command', '/execution/read', '/login', '/register', '/logout', '/commands', '/projects', '/grants', '/workgraph/sharing', '/workgraph/share', '/workgraph/delete', '/workgraph/removal', '/workgraph/save', '/workgraph/read', '/workgraph/tasks', '/workgraph/grant', '/workgraph/grants', '/assignment/review', '/assignment/command', '/assignment/participant', '/assignment/read', '/assignment/tasks', '/assignment/inbox', '/assignment/preparation'].includes(path) ? 'POST'
        : ['/profile', '/identity', '/organizations', '/workgraph/events', '/assignment/events'].includes(path) || receiptRoute || memberRoute || resourceRoute || detailRoute ? 'GET' : undefined
      if (!method) { this.respond(res, 404, { error: 'not-found' }); return }
      if (req.method !== method) { this.respond(res, 405, { error: 'method-not-allowed' }); return }
      if (url.search && !resourceRoute && !detailRoute && path !== '/workgraph/events' && path !== '/assignment/events') throw new OrganizationError('invalid-input')
      if (path === '/identity') { this.respond(res, 200, await authority.identity()); return }
      if (path === '/login') { this.respond(res, 200, await authority.login(await this.body(req))); return }
      if (path === '/register') { this.respond(res, 200, await authority.register(await this.body(req))); return }
      const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.headers.authorization ?? '')
      if (!match?.[1]) throw new OrganizationError('unauthenticated')
      const token = brandString<LoginToken>(match[1])
      if (path === '/profile') { this.respond(res, 200, await authority.profile(token)); return }
      if (path === '/profile/update') { this.respond(res, 200, await authority.setProfile(token, await this.body(req))); return }
      if (receiptRoute?.[1]) { this.respond(res, 200, await authority.receipt(token, receiptRoute[1])); return }
      if (path === '/planning/command') { this.respond(res, 200, await authority.planningCommand(token, await this.body(req))); return }
      if (path === '/planning/plan') { await authority.readPlanningPlan(token, await this.body(req), (value) => { this.respond(res, 200, value) }); return }
      if (path === '/planning/read') { await authority.readPlanning(token, await this.body(req), (value) => { this.respond(res, 200, value) }); return }
      if (path === '/planning/candidates') { await authority.readPlanningCandidates(token, await this.body(req), (value) => { this.respond(res, 200, value) }); return }
      if (path === '/assignment/command') { this.respond(res, 200, await authority.assignmentCommand(token, await this.body(req))); return }
      if (path === '/assignment/participant') { this.respond(res, 200, await authority.participantCommand(token, await this.body(req))); return }
      if (path === '/delivery/command') { this.respond(res, 200, await authority.deliveryCommand(token, await this.body(req))); return }
      if (path === '/delivery/read') { await authority.readDelivery(token, await this.body(req), (value) => { this.respond(res, 200, value) }); return }
      if (path === '/delivery/download') { await authority.downloadArtifact(token, await this.body(req), (value) => { this.respond(res, 200, value) }); return }
      if (path === '/execution/list') { await authority.listExecutions(token, await this.body(req), (value) => { this.respond(res, 200, value) }); return }
      if (path === '/execution/read') { await authority.readExecution(token, await this.body(req), (value) => { this.respond(res, 200, value) }); return }
      if (path === '/execution/command') {
        const envelope = executionEnvelopeSchema.safeParse(await this.body(req))
        if (!envelope.success) throw new OrganizationError('invalid-input')
        this.respond(res, 200, await authority.executionCommand(token, envelope.data.command)); return
      }
      if (path === '/assignment/review') { await authority.readApproval(token, await this.body(req), (value) => { this.respond(res, 200, value) }); return }
      if (path === '/assignment/read') { await authority.readAssignment(token, await this.body(req), (value) =>{  this.respond(res, 200, value) }); return }
      if (path === '/assignment/tasks') { await authority.readTaskAssignments(token, await this.body(req), (value) =>{  this.respond(res, 200, value) }); return }
      if (path === '/assignment/inbox') { await authority.readInbox(token, await this.body(req), (value) =>{  this.respond(res, 200, value) }); return }
      if (path === '/assignment/preparation') { await authority.readPreparation(token, await this.body(req), (value) =>{  this.respond(res, 200, value) }); return }
      if (path === '/workgraph/sharing') { await authority.readPlanSharing(token, await this.body(req), (value) => { this.respond(res, 200, value) }); return }
      if (path === '/workgraph/share') { this.respond(res, 200, await authority.sharePlan(token, await this.body(req))); return }
      if (path === '/workgraph/delete') { this.respond(res, 200, await authority.deletePlan(token, await this.body(req))); return }
      if (path === '/workgraph/removal') { this.respond(res, 200, await authority.planRemoval(token, await this.body(req))); return }
      if (path === '/workgraph/save') { this.respond(res, 200, await authority.savePlan(token, await this.body(req))); return }
      if (path === '/workgraph/grant') { this.respond(res, 200, await authority.grantTask(token, await this.body(req))); return }
      if (path === '/workgraph/read') {
        await authority.readPlan(token, await this.body(req), (value) => { this.respond(res, 200, value) }); return
      }
      if (path === '/workgraph/tasks') {
        await authority.readTasks(token, await this.body(req), (value) => { this.respond(res, 200, value) }); return
      }
      if (path === '/workgraph/grants') {
        await authority.readTaskGrants(token, await this.body(req), (value) => { this.respond(res, 200, value) }); return
      }
      if (path === '/workgraph/events' || path === '/assignment/events') {
        const query = parameters(url, ['organizationId', 'cursor', 'stream'])
        if (!query.organizationId || !query.cursor || query.stream !== undefined && query.stream !== 'true') {
          throw new OrganizationError('invalid-input')
        }
        const organizationId = brandString<OrganizationId>(parseUuid(query.organizationId))
        if (query.stream === 'true') await this.streams.open(token, organizationId, query.cursor, res, path === '/assignment/events' ? 'inbox' : 'workgraph')
        else await (path === '/assignment/events' ? authority.readInboxEvents.bind(authority) : authority.readWorkgraphEvents.bind(authority))(token, { organizationId, cursor: query.cursor },
          (value) => { this.respond(res, 200, value) })
        return
      }
      if (resourceRoute?.[1] && resourceRoute[2]) {
        const organizationId = brandString<OrganizationId>(parseUuid(resourceRoute[1]))
        if (resourceRoute[2] === 'events') {
          const query = parameters(url, ['cursor', 'stream'])
          if (!query.cursor || query.stream !== undefined && query.stream !== 'true') {
            throw new OrganizationError('invalid-input')
          }
          if (query.stream === 'true') await this.streams.open(token, organizationId, query.cursor, res)
          else await authority.readProjectEvents(token, { organizationId, cursor: query.cursor },
            (batch) => { this.respond(res, 200, batch) })
        } else if (resourceRoute[2] === 'deleted-projects') {
          const query = parameters(url, ['offset'])
          if (query.offset !== undefined && !/^\d+$/.test(query.offset)) throw new OrganizationError('invalid-input')
          await authority.readDeletedProjects(token, { organizationId, offset: Number(query.offset ?? 0) },
            (page) => { this.respond(res, 200, page) })
        } else {
          const query = parameters(url, resourceRoute[2] === 'search' ? ['q', 'offset', 'cursor', 'excluded'] : ['offset', 'cursor', 'excluded'])
          if (query.offset !== undefined && !/^\d+$/.test(query.offset)) throw new OrganizationError('invalid-input')
          await authority.readProjects(token, { organizationId, search: query.q ?? '', offset: Number(query.offset ?? 0),
            ...(query.cursor === undefined ? {} : { cursor: query.cursor }), excluded: query.excluded ? query.excluded.split(',') : [] }, (page) =>{  this.respond(res, 200, page) })
        }
      } else if (detailRoute?.[1]) {
        const query = parameters(url, ['organizationId'])
        const read = detailRoute[2] ? authority.readGrants.bind(authority) : authority.readProject.bind(authority)
        await read(token, { projectId: parseUuid(detailRoute[1]), organizationId: query.organizationId },
          (project) => { this.respond(res, 200, project) })
      } else if (path === '/projects') this.respond(res, 200, await authority.projectCommand(token, await this.body(req)))
      else if (path === '/grants') this.respond(res, 200, await authority.grant(token, await this.body(req)))
      else if (path === '/logout') {
        await authority.authenticate(token)
        await authority.logout(token)
        this.respond(res, 200, { ok: true })
      } else if (path === '/commands') this.respond(res, 200, await authority.execute(token, await this.body(req)))
      else if (path === '/organizations') this.respond(res, 200, await authority.organizations(token))
      else if (memberRoute?.[1]) {
        const id = z.uuid().safeParse(memberRoute[1])
        if (!id.success) throw new OrganizationError('invalid-input')
        this.respond(res, 200, await (memberRoute[2] === 'hierarchy' ? authority.hierarchy.bind(authority) : authority.members.bind(authority))(token, brandString<OrganizationId>(id.data)))
      }
    } catch (error) {
      const code = error instanceof OrganizationError ? error.code : 'unavailable'
      const status = code === 'unauthenticated' || code === 'invalid-credentials' ? 401 : code === 'forbidden' ? 403
        : code === 'snapshot-required' ? 409 : code === 'rate-limited' ? 429 : code === 'unavailable' || code === 'closed' ? 503 : 400
      this.respond(res, status, { error: code })
    } finally { clearTimeout(deadline) }
  }
}
export default OrganizationApiService

function parseUuid(value: string): string {
  const id = z.uuid().safeParse(value)
  if (!id.success) throw new OrganizationError('invalid-input')
  return id.data
}

function parameters(url: URL, allowed: string[]): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [key, value] of url.searchParams) {
    if (!allowed.includes(key) || Object.hasOwn(result, key)) throw new OrganizationError('invalid-input')
    result[key] = value
  }
  return result
}
