/** Owner-only TLS identity provisioning for the private organization process. */
import { X509Certificate, createPrivateKey, createPublicKey } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { isIP } from 'node:net'
import { checkServerIdentity } from 'node:tls'
import { generate } from 'selfsigned'
import { z } from 'zod'

/** Explicit service deployment and bounded ingress settings for a small LAN. */
export const configSchema = z.object({
  directory: z.string().refine(isAbsolute),
  host: z.string().refine(value => isIP(value) !== 0),
  port: z.number().int().min(0).max(65535),
  names: z.array(z.string().min(1).max(253)).min(1).max(32),
  certificateDays: z.number().int().min(1).max(825).default(365),
  certificateWarningDays: z.number().int().min(0).max(90).default(30),
  eventPollMs: z.number().int().min(10).max(60000).default(1000),
  streamMaxAgeMs: z.number().int().min(100).max(86400000).default(600000),
  maxSubscriptions: z.number().int().min(1).max(1000).default(16),
  maxConnections: z.number().int().min(1).max(10000).default(64),
  maxInFlight: z.number().int().min(1).max(1000).default(16),
  maxBodyBytes: z.number().int().min(1024).max(1048576).default(16384),
  maxResponseBytes: z.number().int().min(1024).max(10485760).default(1048576),
  requestTimeoutMs: z.number().int().min(100).max(120000).default(15000),
  maxRequestsPerSocket: z.number().int().min(1).max(10000).default(100),
}).strict()

interface TlsIdentity { certificate: string; privateKey: string }
interface PublicIdentity { certificate: string; fingerprint: string; expiresAt: number }

const identitySchema = z.object({ certificate: z.string(), privateKey: z.string() }).strict()

/**
 * Validate certificate dates, key pairing and every advertised SAN before listening.
 * @param identity - PEM certificate and private key from the private identity file.
 * @param names - Required DNS/IP names.
 * @returns Public certificate metadata, safe for local status display.
 */
export function inspectIdentity(identity: z.output<typeof identitySchema>, names: string[]): PublicIdentity {
  const certificate = new X509Certificate(identity.certificate)
  const now = Date.now()
  if (Date.parse(certificate.validFrom) > now || Date.parse(certificate.validTo) <= now) throw new Error('certificate-invalid')
  const publicKey = createPublicKey(createPrivateKey(identity.privateKey))
  if (!certificate.checkPrivateKey(createPrivateKey(identity.privateKey)) || !certificate.verify(publicKey)) throw new Error('certificate-invalid')
  for (const name of names) {
    if (checkServerIdentity(name, certificate.toLegacyObject())) throw new Error('certificate-name-mismatch')
  }
  return { certificate: identity.certificate, fingerprint: certificate.fingerprint256, expiresAt: Date.parse(certificate.validTo) }
}

/**
 * Load or create one exclusive owner-only identity file; existing invalid identities fail closed.
 * @param config - Validated private service settings.
 * @returns TLS PEM pair and public certificate facts.
 */
export async function loadIdentity(config: z.output<typeof configSchema>): Promise<TlsIdentity & PublicIdentity> {
  await mkdir(config.directory, { recursive: true, mode: 0o700 })
  const path = join(config.directory, 'tls-identity.json')
  let identity: z.output<typeof identitySchema>
  try { identity = identitySchema.parse(JSON.parse(await readFile(path, 'utf8'))) }
  catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
    const pair = await generate([{ name: 'commonName', value: config.host }], {
      keySize: 2048, algorithm: 'sha256',
      notBeforeDate: new Date(Date.now() - 60000),
      notAfterDate: new Date(Date.now() + config.certificateDays * 86400000),
      extensions: [
        { name: 'basicConstraints', cA: true },
        { name: 'keyUsage', digitalSignature: true, keyEncipherment: true, keyCertSign: true },
        { name: 'extKeyUsage', serverAuth: true },
        { name: 'subjectAltName', altNames: config.names.map(name => isIP(name) ? { type: 7, ip: name } : { type: 2, value: name }) },
      ],
    })
    identity = { certificate: pair.cert, privateKey: pair.private }
    inspectIdentity(identity, config.names)
    await writeFile(path, JSON.stringify(identity) + '\n', { flag: 'wx', mode: 0o600 })
  }
  return { ...identity, ...inspectIdentity(identity, config.names) }
}
