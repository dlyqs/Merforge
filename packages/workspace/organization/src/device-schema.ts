/** Fixed device actions and signed challenge bytes shared with the native key owner. */
import { z } from 'zod'
import { brandString, brandNumber } from '@deepseek-ai/dsh-brand'
import type { AccountId, MembershipId, OperationId, OrganizationId, ServerId } from './types.ts'
import type { OrganizationChallengeId, OrganizationFencingEpoch, OrganizationServerEpoch } from './device-types.ts'
import { deviceIdSchema, assignmentReadSchema, delegationIdSchema } from './assignment-schema.ts'

const base = z.object({
  organizationId: z.uuid().transform(brandString<OrganizationId>), operationId: z.uuid().transform(brandString<OperationId>),
})
/** Ed25519 SPKI bytes encoded canonically in base64; crypto parsing verifies the algorithm. */
export const devicePublicKeySchema = z.string().max(128).regex(/^[A-Za-z0-9+/]+={0,2}$/)
/** Fencing epochs are safe integers that only the authority allocates. */
export const fencingEpochSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER).transform(brandNumber<OrganizationFencingEpoch>)
/** Each service activation receives an unpredictable epoch. */
export const serverEpochSchema = z.uuid().transform(brandString<OrganizationServerEpoch>)
/** Fixed key-ownership registration input, excluding its separately supplied proof. */
export const registerDeviceSchema = base.extend({ kind: z.literal('register-device'), publicKey: devicePublicKeySchema,
  keyGeneration: z.literal(1), name: z.string().trim().min(1).max(120) }).strict()
/** The current account can revoke its device even after losing access to its private key. */
export const revokeDeviceSchema = base.extend({ kind: z.literal('revoke-device'), deviceId: deviceIdSchema,
  expectedVersion: z.number().int().positive() }).strict()
const leaseBase = assignmentReadSchema.extend({ operationId: base.shape.operationId, deviceId: deviceIdSchema })
/** Claim only reserves ownership; it cannot run a model or tool. */
export const claimSchema = leaseBase.extend({ kind: z.literal('claim'), delegationId: delegationIdSchema }).strict()
const ownerBase = leaseBase.extend({
  fencingEpoch: fencingEpochSchema, serverEpoch: serverEpochSchema, expectedVersion: z.number().int().positive(),
})
/** Renewal must identify the still-live owner and server activation. */
export const renewSchema = ownerBase.extend({ kind: z.literal('renew') }).strict()
/** Release terminates the current owner and never reverses prior effects. */
export const releaseSchema = ownerBase.extend({ kind: z.literal('release') }).strict()
/** Only these actions may be signed by the native device owner. */
export const provenDeviceCommandSchema = z.discriminatedUnion('kind', [registerDeviceSchema, claimSchema, renewSchema, releaseSchema])
/** Device and lease mutations use account-scoped receipts. */
export const deviceCommandSchema = z.discriminatedUnion('kind', [registerDeviceSchema, revokeDeviceSchema, claimSchema, renewSchema, releaseSchema])
/** Strict one-use signature envelope; the server retains the bound challenge. */
export const deviceProofSchema = z.object({ challengeId: z.uuid().transform(brandString<OrganizationChallengeId>),
  signature: z.string().regex(/^[A-Za-z0-9_-]{86}$/) }).strict()
/** Signed bytes contain every identity and request binding in this fixed field order. */
export const deviceChallengeSchema = z.object({ protocol: z.literal('merforge-device-v1'),
  challengeId: z.uuid().transform(brandString<OrganizationChallengeId>), serverId: z.uuid().transform(brandString<ServerId>),
  serverEpoch: serverEpochSchema,
  accountId: z.uuid().transform(brandString<AccountId>), membershipId: z.uuid().transform(brandString<MembershipId>),
  organizationId: base.shape.organizationId, action: z.enum(['register-device', 'claim', 'renew', 'release', 'grant-execution', 'revoke-execution', 'create-run', 'reserve-action', 'settle-action', 'transition-run']),
  requestDigest: z.string().regex(/^[a-f0-9]{64}$/), operationId: base.shape.operationId,
  deviceId: deviceIdSchema.nullable(), publicKey: devicePublicKeySchema, keyGeneration: z.literal(1),
  issuedAt: z.number().int().nonnegative(), expiresAt: z.number().int().positive(),
}).strict()
/**
 * Serialize the strict ordered challenge, never caller-selected arbitrary bytes.
 * @param input - Service-issued device challenge.
 * @returns Canonical UTF-8 JSON text for Ed25519.
 */
export function deviceChallengeText(input: z.input<typeof deviceChallengeSchema>): string {
  return JSON.stringify(deviceChallengeSchema.parse(input))
}
/** Durable registration parser, including terminal revocation history. */
export const deviceSchema = z.object({ id: deviceIdSchema, organizationId: base.shape.organizationId,
  accountId: deviceChallengeSchema.shape.accountId, membershipId: deviceChallengeSchema.shape.membershipId,
  publicKey: devicePublicKeySchema, keyGeneration: z.literal(1), name: registerDeviceSchema.shape.name,
  registeredAt: z.number().int().nonnegative(), createdRevision: z.number().int().positive(), version: z.number().int().positive(),
  state: z.enum(['active', 'revoked']),
}).strict()
/** Persisted ownership history; no epoch row is overwritten by a subsequent claim. */
export const leaseSchema = z.object({ assignmentId: assignmentReadSchema.shape.assignmentId, delegationId: delegationIdSchema,
  deviceId: deviceIdSchema, fencingEpoch: fencingEpochSchema, serverEpoch: serverEpochSchema,
  expiresAt: z.number().int().positive(), createdRevision: z.number().int().positive(), version: z.number().int().positive(),
  state: z.enum(['held', 'released', 'expired', 'invalidated']),
}).strict()
