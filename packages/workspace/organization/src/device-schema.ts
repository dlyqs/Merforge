/** Read-only historical device and lease records; current tasks use accepted assignments. */
import { z } from 'zod'
import { brandString, brandNumber } from '@deepseek-ai/dsh-brand'
import type { AccountId, MembershipId, OrganizationId } from './types.ts'
import type { OrganizationFencingEpoch, OrganizationServerEpoch } from './device-types.ts'
import { deviceIdSchema, assignmentReadSchema, delegationIdSchema } from './assignment-schema.ts'

/** Ed25519 SPKI bytes encoded canonically in base64; crypto parsing verifies the algorithm. */
export const devicePublicKeySchema = z.string().max(128).regex(/^[A-Za-z0-9+/]+={0,2}$/)
/** Fencing epochs are safe integers that only the authority allocates. */
export const fencingEpochSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER).transform(brandNumber<OrganizationFencingEpoch>)
/** Each service activation receives an unpredictable epoch. */
export const serverEpochSchema = z.uuid().transform(brandString<OrganizationServerEpoch>)
/** Durable registration parser, including terminal revocation history. */
export const deviceSchema = z.object({ id: deviceIdSchema, organizationId: z.uuid().transform(brandString<OrganizationId>),
  accountId: z.uuid().transform(brandString<AccountId>), membershipId: z.uuid().transform(brandString<MembershipId>),
  publicKey: devicePublicKeySchema, keyGeneration: z.literal(1), name: z.string().trim().min(1).max(120),
  registeredAt: z.number().int().nonnegative(), createdRevision: z.number().int().positive(), version: z.number().int().positive(),
  state: z.enum(['active', 'revoked']),
}).strict()
/** Persisted ownership history; no epoch row is overwritten by a subsequent claim. */
export const leaseSchema = z.object({ assignmentId: assignmentReadSchema.shape.assignmentId, delegationId: delegationIdSchema,
  deviceId: deviceIdSchema, fencingEpoch: fencingEpochSchema, serverEpoch: serverEpochSchema,
  expiresAt: z.number().int().positive(), createdRevision: z.number().int().positive(), version: z.number().int().positive(),
  state: z.enum(['held', 'released', 'expired', 'invalidated']),
}).strict()
