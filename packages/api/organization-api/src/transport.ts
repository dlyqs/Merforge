/** Certificate-bound organization transport; never uses the personal Host cookie or follows redirects. */
import { X509Certificate } from 'node:crypto'
import { connect, checkServerIdentity } from 'node:tls'
import { request, type RequestOptions } from 'node:https'
import { z } from 'zod'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { LoginToken, OrganizationId, OrganizationCursor, OrganizationProjectId, OrganizationEventBatch } from '@deepseek-ai/dsh-organization'
import { workgraphBatchSchema } from '@deepseek-ai/dsh-organization/workgraph'
import type { OrganizationWorkgraphBatch } from '@deepseek-ai/dsh-organization'
import { isIP } from 'node:net'

/** Public certificate facts obtained without HTTP credentials. */
export interface CertificateOffer { certificate: string; fingerprint: string; expiresAt: number }
/** Locally approved certificate and bounded client request settings. */
export interface OrganizationTrust extends CertificateOffer { origin: string; timeoutMs: number; maxResponseBytes: number }

function originUrl(origin: string): URL {
  const url = new URL(origin)
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('invalid-origin')
  return url
}
function hostname(url: URL): string { return url.hostname.replace(/^\[|\]$/g, '') }

/**
 * Probe only the TLS certificate, with no HTTP request, token or cookie. This does not grant trust.
 * @param origin - Manually entered HTTPS origin.
 * @param timeoutMs - Positive connection deadline in milliseconds.
 * @returns Certificate for explicit fingerprint comparison with the service machine.
 */
export async function probeOrganizationCertificate(origin: string, timeoutMs: number): Promise<CertificateOffer> {
  const url = originUrl(origin)
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new Error('invalid-timeout')
  return new Promise((resolve, reject) => {
    // The unauthenticated probe only observes a candidate. Business requests require an approved CA below.
    const socket = connect({ host: hostname(url), port: Number(url.port || 443), rejectUnauthorized: false,
      servername: isIP(hostname(url)) ? undefined : hostname(url) })
    socket.setTimeout(timeoutMs, () => socket.destroy(new Error('connection-timeout')))
    socket.once('error', reject)
    socket.once('secureConnect', () => {
      try {
        const certificate = new X509Certificate(socket.getPeerCertificate().raw)
        const mismatch = checkServerIdentity(hostname(url), certificate.toLegacyObject())
        if (mismatch || Date.parse(certificate.validFrom) > Date.now() || Date.parse(certificate.validTo) <= Date.now()) {
          throw new Error('certificate-invalid')
        }
        resolve({ certificate: certificate.toString(), fingerprint: certificate.fingerprint256,
          expiresAt: Date.parse(certificate.validTo) })
      } catch (error) { reject(error instanceof Error ? error : new Error('invalid-response')) }
      finally { socket.destroy() }
    })
  })
}

/**
 * Make a fixed organization-protocol request against an explicitly trusted certificate.
 * @param trust - Host-owned trust, including the manually verified fingerprint.
 * @param method - Protocol verb.
 * @param path - Organization route; no absolute URL or redirect target is accepted.
 * @param body - Optional JSON request.
 * @param token - Organization bearer credential only.
 * @param signal - Native owner cancellation when the selected identity changes.
 * @returns Status and parsed JSON; redirects reject before any second request.
 */
export async function organizationRequest(trust: OrganizationTrust, method: 'GET' | 'POST', path: string, body?: unknown, token?: string, signal?: AbortSignal): Promise<{ status: number; body: unknown }> {
  const options = trustedOptions(trust)
  const target = new URL(path, trust.origin)
  if (!path.startsWith('/organization/v1/') || target.origin !== new URL(trust.origin).origin
    || !/^\/organization\/v1\/[a-z0-9/-]+$/i.test(target.pathname)) throw new Error('invalid-route')
  const data = body === undefined ? undefined : JSON.stringify(body)
  return new Promise((resolve, reject) => {
    const req = request({ ...options, method, path, signal,
      headers: { ...(data === undefined ? {} : { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) }),
        ...(token === undefined ? {} : { authorization: `Bearer ${token}` }) },
    }, (response) => {
      const status = response.statusCode ?? 500
      if (status >= 300 && status < 400) { response.destroy(); reject(new Error('redirect-refused')); return }
      let size = 0
      const chunks: Buffer[] = []
      response.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > trust.maxResponseBytes) response.destroy(new Error('response-too-large'))
        else chunks.push(chunk)
      })
      response.once('error', reject)
      response.once('end', () => {
        try { resolve({ status, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }) }
        catch (error) { reject(error instanceof Error ? error : new Error('invalid-response')) }
      })
    })
    const deadline = setTimeout(() => req.destroy(new Error('request-timeout')), trust.timeoutMs)
    req.once('close', () =>{  clearTimeout(deadline) })
    req.once('error', reject)
    req.end(data)
  })
}

function trustedOptions(trust: OrganizationTrust): RequestOptions {
  const url = originUrl(trust.origin)
  if (!Number.isSafeInteger(trust.timeoutMs) || trust.timeoutMs <= 0 ||
    !Number.isSafeInteger(trust.maxResponseBytes) || trust.maxResponseBytes <= 0) {
    throw new Error('invalid-limits')
  }
  const certificate = new X509Certificate(trust.certificate)
  if (certificate.fingerprint256 !== trust.fingerprint) throw new Error('certificate-changed')
  return { hostname: hostname(url), port: Number(url.port || 443), agent: false, ca: trust.certificate, rejectUnauthorized: true,
    checkServerIdentity(host, peer) {
      const error = checkServerIdentity(host, peer)
      return error ?? (new X509Certificate(peer.raw).fingerprint256 !== trust.fingerprint ? new Error('certificate-changed') : undefined)
    },
  }
}

const cursorValue = z.string().min(1).max(2048).transform(value => brandString<OrganizationCursor>(value))
const batchSchema = z.object({
  from: cursorValue, cursor: cursorValue, revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  events: z.array(z.object({ revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    projectId: z.uuid().transform(value => brandString<OrganizationProjectId>(value)) }).strict()),
}).strict()

/** Stream reset requires current authentication and a new authorized snapshot before resuming. */
export class OrganizationStreamReset extends Error {
  /** @param code - Fixed protocol reset reason without server diagnostics. */
  constructor(readonly code: 'snapshot-required' | 'unauthenticated' | 'forbidden' | 'unavailable') {
    super(code)
    this.name = 'OrganizationStreamReset'
  }
}

/**
 * Follow persisted invalidations from an authorized snapshot, refusing duplicate application and cursor gaps.
 * @param trust - Explicitly verified certificate and client limits.
 * @param organizationId - Current organization selected through valid membership.
 * @param token - Host-held organization bearer credential.
 * @param snapshot - Last atomically acquired snapshot or accepted event position.
 * @param signal - Owner cancellation, including organization switches or logout.
 * @returns Authorized ordered batches; callers invalidate named projects and fetch fresh current views.
 */
export async function* followOrganizationEvents(
  trust: OrganizationTrust, organizationId: OrganizationId, token: LoginToken,
  snapshot: { cursor: OrganizationCursor; revision: number }, signal: AbortSignal,
): AsyncGenerator<OrganizationEventBatch, void, unknown> {
  const path = `/organization/v1/organizations/${organizationId}/events?stream=true&cursor=${encodeURIComponent(snapshot.cursor)}`
  yield* followEvents(trust, path, token, snapshot, signal, batchSchema)
}

/**
 * Follow task invalidations through the same bounded, ordered SSE transport as projects.
 * @param trust - Native certificate trust and response limits.
 * @param organizationId - Currently selected organization.
 * @param token - Native bearer, never a personal cookie.
 * @param snapshot - Last authorized snapshot or batch cursor.
 * @param signal - Identity-generation cancellation.
 * @returns Content-free, current-authority WorkGraph invalidations.
 */
export async function* followWorkgraphEvents(
  trust: OrganizationTrust, organizationId: OrganizationId, token: LoginToken,
  snapshot: { cursor: OrganizationCursor; revision: number }, signal: AbortSignal,
): AsyncGenerator<OrganizationWorkgraphBatch, void, unknown> {
  const path = `/organization/v1/workgraph/events?organizationId=${organizationId}&stream=true&cursor=${encodeURIComponent(snapshot.cursor)}`
  yield* followEvents(trust, path, token, snapshot, signal, workgraphBatchSchema)
}

async function* followEvents<T extends {
  from: OrganizationCursor
  cursor: OrganizationCursor
  revision: number
  events: { revision: number }[]
}>(
  trust: OrganizationTrust, path: string, token: LoginToken,
  snapshot: { cursor: OrganizationCursor; revision: number }, signal: AbortSignal, schema: z.ZodType<T>,
): AsyncGenerator<T, void, unknown> {
  const options = trustedOptions(trust)
  const req = request({ ...options, path, method: 'GET', signal, headers: { authorization: `Bearer ${token}` } })
  req.setTimeout(trust.timeoutMs, () => req.destroy(new Error('stream-timeout')))
  let cursor = snapshot.cursor
  let revision = snapshot.revision
  try {
    const response = await new Promise<import('node:http').IncomingMessage>((resolve, reject) => {
      req.once('response', resolve)
      req.once('error', reject)
      req.end()
    })
    if (response.statusCode !== 200) {
      throw new OrganizationStreamReset(response.statusCode === 401 ? 'unauthenticated' : response.statusCode === 403 ? 'forbidden' : 'snapshot-required')
    }
    let buffer = ''
    response.setEncoding('utf8')
    for await (const part of response) {
      buffer += String(part)
      let separator: number
      while ((separator = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, separator)
        buffer = buffer.slice(separator + 2)
        if (Buffer.byteLength(frame) + 2 > trust.maxResponseBytes) throw new Error('response-too-large')
        signal.throwIfAborted()
        if (frame.startsWith(':')) continue
        if (frame.startsWith('event: reset\n')) {
          const reason = z.object({ error: z.string() }).parse(JSON.parse(frame.slice('event: reset\ndata: '.length)))
          throw new OrganizationStreamReset(reason.error === 'unauthenticated' || reason.error === 'forbidden' ? reason.error : 'snapshot-required')
        }
        if (!frame.startsWith('data: ')) throw new OrganizationStreamReset('snapshot-required')
        const batch = schema.parse(JSON.parse(frame.slice(6)))
        if (batch.cursor === cursor && batch.revision === revision && batch.events.length === 0) continue
        if (batch.cursor === cursor && batch.revision <= revision) continue
        if (batch.from !== cursor || batch.revision < revision) throw new OrganizationStreamReset('snapshot-required')
        let previous = revision
        for (const event of batch.events) {
          if (event.revision <= previous || event.revision > batch.revision) throw new OrganizationStreamReset('snapshot-required')
          previous = event.revision
        }
        cursor = batch.cursor
        revision = batch.revision
        yield batch
      }
      if (Buffer.byteLength(buffer) > trust.maxResponseBytes) throw new Error('response-too-large')
    }
    throw new OrganizationStreamReset('unavailable')
  } finally { req.destroy() }
}
