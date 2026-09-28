/** SSE streams re-read committed authority before every synchronous transport handoff. */
import type { Context } from '@deepseek-ai/cordis'
import { OrganizationError, type LoginToken, type OrganizationId } from '@deepseek-ai/dsh-organization'
import type { ServerResponse } from 'node:http'

interface Limits { maxSubscriptions: number; eventPollMs: number; streamMaxAgeMs: number; maxResponseBytes: number }
interface Subscription { pump: () => void; close: () => void }

/** Owns only cursor positions; sensitive event payloads are never queued for a later send. */
export class OrganizationStreams {
  private readonly subscriptions = new Set<Subscription>()
  private readonly pending = new Set<Promise<void>>()
  private closed = false

  /**
   * @param ctx - API plugin context; its managed listener wakes streams after commits.
   * @param limits - Validated stream admission, polling and complete-frame bounds.
   */
  constructor(private readonly ctx: Context, private readonly limits: Limits) {
    ctx.on('organization/committed', () => {
      for (const subscription of this.subscriptions) subscription.pump()
    })
  }

  /**
   * Open an authenticated replay/live stream from an atomic snapshot cursor.
   * @param token - Organization bearer credential checked again on every delivery.
   * @param organizationId - Explicit organization scope.
   * @param initialCursor - Previous snapshot or delivered event cursor.
   * @param response - Owned HTTP response; slow clients close instead of accumulating queued payloads.
   * @param domain - Fixed project or WorkGraph invalidation stream.
   * @returns First authority check completion; later polls remain owned until close.
   */
  open(token: LoginToken, organizationId: OrganizationId, initialCursor: string, response: ServerResponse, domain: 'projects' | 'workgraph' | 'inbox' = 'projects'): Promise<void> {
    if (this.closed || this.subscriptions.size >= this.limits.maxSubscriptions) throw new OrganizationError('rate-limited')
    let cursor = initialCursor
    let running: Promise<void> | undefined
    let dirty = false
    let ended = false
    const close = () => {
      if (ended) return
      ended = true
      clearInterval(timer)
      clearTimeout(expiry)
      this.subscriptions.delete(subscription)
      response.destroy()
      this.ctx.logger.debug('organization component=events result=subscription-closed')
    }
    const poll = (): Promise<void> => {
      if (ended) return Promise.resolve()
      if (running) { dirty = true; return running }
      const read = domain === 'inbox' ? this.ctx.organization.readInboxEvents.bind(this.ctx.organization)
        : domain === 'workgraph' ? this.ctx.organization.readWorkgraphEvents.bind(this.ctx.organization)
          : this.ctx.organization.readProjectEvents.bind(this.ctx.organization)
      const task = read(token, { organizationId, cursor }, (batch) => {
        if (ended || response.destroyed) return
        if (response.writableLength > 0) { close(); return }
        const frame = !response.headersSent || batch.cursor !== cursor ? `data: ${JSON.stringify(batch)}\n\n` : ': ping\n\n'
        if (Buffer.byteLength(frame) > this.limits.maxResponseBytes) { close(); return }
        if (!response.headersSent) response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', 'x-accel-buffering': 'no' })
        cursor = batch.cursor
        if (!response.write(frame)) close()
      }).catch((error: unknown) => {
        if (ended || response.destroyed) return
        const code = error instanceof OrganizationError ? error.code : 'unavailable'
        this.ctx.logger.info('organization component=events result=reset decisionCode=%s', code)
        if (!response.headersSent) {
          response.writeHead(code === 'unauthenticated' ? 401 : code === 'forbidden' ? 403 : 409, { 'content-type': 'application/json', 'cache-control': 'no-store' })
          response.end(JSON.stringify({ error: code }))
        } else if (response.writableLength === 0) response.end(`event: reset\ndata: ${JSON.stringify({ error: code })}\n\n`)
        else response.destroy()
      }).finally(() => {
        this.pending.delete(task)
        running = undefined
        if (dirty && !ended) { dirty = false; void poll() }
      })
      running = task
      this.pending.add(task)
      return task
    }
    const subscription = { pump: () => { void poll() }, close }
    this.subscriptions.add(subscription)
    response.once('close', close)
    response.once('finish', close)
    const timer = setInterval(subscription.pump, this.limits.eventPollMs)
    const expiry = setTimeout(close, this.limits.streamMaxAgeMs)
    return poll()
  }

  /**
   * Stop admission and subscriptions before waiting for already admitted authority checks.
   * @returns Resolution after every owned callback has settled.
   */
  async close(): Promise<void> {
    this.closed = true
    for (const subscription of this.subscriptions) subscription.close()
    await Promise.allSettled([...this.pending])
  }
}
