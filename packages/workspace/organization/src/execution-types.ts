/** Branded organization execution identities and authority read types. */
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { z } from 'zod'
import type { executionRunSchema, executionActionSchema, executionDelegationSchema, executionViewSchema, executionReceiptSchema } from './execution-schema.ts'
/** One explicit employee execution grant, independent of preparation authority. */
export type OrganizationExecutionDelegationId = Branded<'OrganizationExecutionDelegationId'>
/** A durable execution attempt for one exact assignment and owner. */
export type OrganizationRunId = Branded<'OrganizationRunId'>
/** One actual request or side-effect attempt, including retries. */
export type OrganizationActionId = Branded<'OrganizationActionId'>
/** Shared Run summary without private log content. */
export type OrganizationRun = z.output<typeof executionRunSchema>
/** Single-use charged action and its historical evidence. */
export type OrganizationExecutionAction = z.output<typeof executionActionSchema>
/** Explicit finite execution permission. */
export type OrganizationExecutionDelegation = z.output<typeof executionDelegationSchema>
/** Currently authorized Run metadata. */
export type OrganizationExecutionView = z.output<typeof executionViewSchema>
/** Stable references returned by an execution mutation. */
export type OrganizationExecutionReceipt = z.output<typeof executionReceiptSchema>
