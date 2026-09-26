/** Stable domain failures; transport consumers must hide underlying storage errors. */
import type { OrganizationErrorCode } from './types.ts'

/** A denial safe to map into a localized protocol response. */
export class OrganizationError extends Error {
  /** Stable machine-readable denial reason. */
  readonly code: OrganizationErrorCode
  constructor(code: OrganizationErrorCode) {
    super(`organization: ${code}`)
    this.name = 'OrganizationError'
    this.code = code
  }
}
