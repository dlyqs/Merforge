/** Node/OpenSSL password hashing and random organization credentials. */
import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { OrganizationError } from './error.ts'

function derive(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, Buffer.from(salt, 'hex'), 32, { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 }, (error, key) => {
      if (error) reject(error)
      else resolve(key)
    })
  })
}
/**
 * Hash a validated password with a fresh 128-bit salt.
 * @param password - Password admitted by the JSON parser.
 * @returns Versioned scrypt digest, without plaintext.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex')
  return `scrypt-v1$${salt}$${(await derive(password, salt)).toString('hex')}`
}
/**
 * Verify a durable digest using constant-time output comparison.
 * @param password - Submitted password.
 * @param stored - Parsed durable digest, or undefined for a dummy unknown-account check.
 * @returns Whether the submitted password matches an existing digest.
 */
export async function verifyPassword(password: string, stored: string | undefined): Promise<boolean> {
  const [, salt, hash] = (stored ?? `scrypt-v1$${'0'.repeat(32)}$${'0'.repeat(64)}`).split('$')
  if (!salt || !hash) throw new OrganizationError('incompatible-store')
  const key = await derive(password, salt)
  return timingSafeEqual(key, Buffer.from(hash, 'hex')) && stored !== undefined
}
/**
 * Digest a high-entropy credential for lookup without retaining its plaintext.
 * @param token - Credential or limiter key.
 * @returns SHA-256 hex digest.
 */
export function digestToken(token: string): string { return createHash('sha256').update(token).digest('hex') }
/**
 * Produce a credential for a Host-held invitation, recovery or login request.
 * @returns 256 random bits encoded as unpadded base64url.
 */
export function createOrganizationToken(): string { return randomBytes(32).toString('base64url') }

/**
 * Fingerprint a normalized mutation without creating a cheap password verifier in receipts.
 * @param scope - Receipt authorization scope.
 * @param input - Parsed request containing the caller's random operation ID.
 * @param sensitive - Whether the request contains a password.
 * @returns Stable digest; password-bearing requests pay the same scrypt cost as authentication.
 */
export async function requestFingerprint(scope: string, input: { operationId: string }, sensitive = false): Promise<string> {
  const canonical = JSON.stringify(input)
  if (!sensitive) return digestToken(canonical)
  const salt = digestToken(`${scope}:${input.operationId}`).slice(0, 32)
  return (await derive(canonical, salt)).toString('hex')
}
