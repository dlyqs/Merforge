/** Historical device identities retained for stored receipts. */
import type { Branded, BrandedNumber } from '@deepseek-ai/dsh-brand'
import type { z } from 'zod'
import type { deviceSchema, leaseSchema } from './device-schema.ts'
/** Monotonically increasing ownership number within one assignment. */
export type OrganizationFencingEpoch = BrandedNumber<'OrganizationFencingEpoch'>
/** Random authority activation identifier; backup rollback cannot reuse it. */
export type OrganizationServerEpoch = Branded<'OrganizationServerEpoch'>
/** Safe registration metadata without private key material. */
export type OrganizationDevice = z.output<typeof deviceSchema>
/** Current or historical ownership reservation; never an execution grant by itself. */
export type OrganizationLease = z.output<typeof leaseSchema>
