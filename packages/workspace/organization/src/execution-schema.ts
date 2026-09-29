/** Fixed execution requests and durable facts; preparation permissions remain unchanged. */
import { z } from 'zod'
import { brandString, type Branded } from '@deepseek-ai/dsh-brand'
import { assignmentReadSchema, delegationIdSchema, deviceIdSchema } from './assignment-schema.ts'
import { serverEpochSchema, fencingEpochSchema, deviceProofSchema, provenDeviceCommandSchema } from './device-schema.ts'
import { planRevisionSchema } from './workgraph-schema.ts'
import type { OperationId } from './types.ts'
import type { OrganizationRunId, OrganizationActionId, OrganizationExecutionDelegationId } from './execution-types.ts'
const id = <T extends Branded<string>>() => z.uuid().transform(brandString<T>)
const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
/** Non-secret, immutable configuration or request digest. */
export const executionDigestSchema = z.string().regex(/^[a-f0-9]{64}$/)
/** Independently granted actual-call capabilities. */
export const executionCapabilitySchema = z.enum(['model', 'fs-read', 'fs-write', 'shell'])
const base = assignmentReadSchema.extend({ operationId: id<OperationId>(), deviceId: deviceIdSchema, planRevision: planRevisionSchema })
/** Employee explicitly grants execution against one preparation delegation; never inferred by migration. */
export const grantExecutionSchema = base.extend({ kind: z.literal('grant-execution'), delegationId: delegationIdSchema,
  capabilities: z.array(executionCapabilitySchema).min(1).max(4).transform(v => [...new Set(v)].sort()),
  budget: integer.positive(), expiresAt: integer.positive(), configDigest: executionDigestSchema,
}).strict()
/** Withdraw execution independently of its preparation delegation. */
export const revokeExecutionSchema = base.extend({ kind: z.literal('revoke-execution'), executionDelegationId: id<OrganizationExecutionDelegationId>() }).strict()
const owner = base.extend({ executionDelegationId: id<OrganizationExecutionDelegationId>(), serverEpoch: serverEpochSchema,
  fencingEpoch: fencingEpochSchema })
/** Reserve a Run identity before local Session creation. */
export const createRunSchema = owner.extend({ kind: z.literal('create-run'), configDigest: executionDigestSchema }).strict()
/** One exact Run selector; excludes client-selected local Session identities. */
export const executionReadSchema = assignmentReadSchema.extend({ runId: id<OrganizationRunId>() }).strict()
const runCommand = owner.extend({ runId: id<OrganizationRunId>() })
/** Allocate one charged permission per actual attempt. */
export const reserveActionSchema = runCommand.extend({ kind: z.literal('reserve-action'), actionId: id<OrganizationActionId>(),
  capability: executionCapabilitySchema, requestDigest: executionDigestSchema }).strict()
/** Original device reports only facts about a previously reserved action. */
export const settleActionSchema = runCommand.extend({ kind: z.literal('settle-action'), actionId: id<OrganizationActionId>(),
  outcome: z.enum(['succeeded', 'failed', 'not-issued', 'unknown']), evidenceDigest: executionDigestSchema }).strict()
/** Terminal Run facts are independent of submission and acceptance. */
export const transitionRunSchema = runCommand.extend({ kind: z.literal('transition-run'),
  state: z.enum(['running', 'paused', 'succeeded', 'failed', 'cancelled']) }).strict()
/** Closed set of signed organization execution mutations. */
export const executionCommandSchema = z.discriminatedUnion('kind', [grantExecutionSchema, revokeExecutionSchema, createRunSchema,
  reserveActionSchema, settleActionSchema, transitionRunSchema])
/** Native signing accepts only fixed device or execution commands. */
export const signedOrganizationCommandSchema = z.union([provenDeviceCommandSchema, executionCommandSchema])
/** Strict HTTPS mutation envelope. */
export const executionEnvelopeSchema = z.object({ command: executionCommandSchema, proof: deviceProofSchema }).strict()
/** Durable explicit execution delegation. */
export const executionDelegationSchema = grantExecutionSchema.omit({ kind: true, operationId: true }).extend({
  id: id<OrganizationExecutionDelegationId>(), state: z.enum(['active', 'revoked', 'invalidated', 'expired']),
  used: integer, createdRevision: integer.positive(), version: integer.positive(),
}).strict()
/** Shared Run summary; contains neither local directory nor conversation. */
export const executionRunSchema = createRunSchema.omit({ kind: true, operationId: true }).extend({
  id: id<OrganizationRunId>(), state: z.enum(['prepared', 'running', 'paused', 'succeeded', 'failed', 'cancelled']),
  createdRevision: integer.positive(), version: integer.positive(),
}).strict()
/** Charged action identity and retained result evidence. */
export const executionActionSchema = reserveActionSchema.omit({ kind: true, operationId: true }).extend({
  state: z.enum(['reserved', 'succeeded', 'failed', 'not-issued', 'unknown']), expiresAt: integer.positive(),
  evidenceDigest: executionDigestSchema.nullable(), createdRevision: integer.positive(), version: integer.positive(),
}).strict()
/** Receipts refer to immutable operation snapshots; they never grant a fresh permission. */
export const executionReceiptSchema = z.object({ executionDelegationId: id<OrganizationExecutionDelegationId>(),
  runId: id<OrganizationRunId>().optional(), actionId: id<OrganizationActionId>().optional() }).strict()
/** Authorized Run read includes retained action facts and current delegation usage. */
export const executionViewSchema = z.object({ run: executionRunSchema, delegation: executionDelegationSchema,
  actions: z.array(executionActionSchema), serverTime: integer, eligible: z.boolean() }).strict()
