/** Device proof and lease identities; ownership is independent of connection generations. */
import type { Branded, BrandedNumber } from '@deepseek-ai/dsh-brand'
import type { z } from 'zod'
import type { deviceChallengeSchema, deviceSchema, leaseSchema } from './device-schema.ts'
/** One short-lived, service-issued signature challenge. */
export type OrganizationChallengeId = Branded<'OrganizationChallengeId'>
/** Monotonically increasing ownership number within one assignment. */
export type OrganizationFencingEpoch = BrandedNumber<'OrganizationFencingEpoch'>
/** Random authority activation identifier; backup rollback cannot reuse it. */
export type OrganizationServerEpoch = Branded<'OrganizationServerEpoch'>
/** Safe registration metadata without private key material. */
export type OrganizationDevice = z.output<typeof deviceSchema>
/** Current or historical ownership reservation; never an execution grant by itself. */
export type OrganizationLease = z.output<typeof leaseSchema>
/** Strict request and identity bindings supplied to the native signer. */
export type OrganizationDeviceChallenge = z.output<typeof deviceChallengeSchema>
