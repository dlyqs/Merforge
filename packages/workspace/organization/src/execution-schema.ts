/** Fixed execution requests and durable facts; accepted assignments authorize execution. */
import { z } from 'zod'
import { executionHumanSchema } from './execution-human-schema.ts'
export { executionHumanSchema } from './execution-human-schema.ts'
import { brandString, type Branded } from '@deepseek-ai/dsh-brand'
import { deviceIdSchema, delegationIdSchema } from './assignment-schema.ts'
import { serverEpochSchema, fencingEpochSchema } from './device-schema.ts'
import { assignmentReadSchema } from './assignment-schema.ts'
import { planRevisionSchema } from './workgraph-schema.ts'
import type { OperationId } from './types.ts'
import type { OrganizationRunId, OrganizationActionId, OrganizationExecutionDelegationId } from './execution-types.ts'
const id = <T extends Branded<string>>() => z.uuid().transform(brandString<T>)
const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
/** Non-secret, immutable configuration or request digest. */
export const executionDigestSchema = z.string().regex(/^[a-f0-9]{64}$/)
/** Capabilities selected for an optional isolated Agent run. */
export const executionCapabilitySchema = z.enum(['model', 'fs-read', 'fs-write', 'shell', 'codex-turn'])
/** Employee-selected local scheduling selection; contains no account, home or endpoint. */
export const executionCodexBackendSchema = z.object({ kind: z.literal('codex'), dispatch: z.literal('local'),
  runtimeVersion: z.string().max(100).regex(/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/u), model: z.string().min(1).max(200),
  effort: z.enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']),
  maxTurns: integer.positive(), maxDurationMs: integer.positive().max(2147483647),
}).strict()
/** Deployment-approved native models and scheduling ceilings; independent of HTTP model routes. */
export const executionCodexPolicySchema = executionCodexBackendSchema.omit({ kind: true, dispatch: true, effort: true }).extend({
  efforts: z.array(executionCodexBackendSchema.shape.effort).min(1).max(8),
}).strict()
/** Recorded reason for stopping native scheduling; never a model/tool budget observation. */
export const executionStopReasonSchema = z.enum(['employee-stop', 'duration-limit', 'turn-limit', 'authority-lost', 'native-terminal'])
const base = assignmentReadSchema.extend({ operationId: id<OperationId>(), planRevision: planRevisionSchema })
/** Employee explicitly grants execution for one accepted assignment; never inferred by migration. */
export const grantExecutionSchema = base.extend({ kind: z.literal('grant-execution'),
  capabilities: z.array(executionCapabilitySchema).min(1).max(4).transform(v => [...new Set(v)].sort()),
  backend: executionCodexBackendSchema.optional(),
  budget: integer.positive(), expiresAt: integer.positive(), configDigest: executionDigestSchema,
}).strict()
/** Withdraw execution for this execution configuration. */
export const revokeExecutionSchema = base.extend({ kind: z.literal('revoke-execution'), executionDelegationId: id<OrganizationExecutionDelegationId>() }).strict()
const owner = base.extend({ executionDelegationId: id<OrganizationExecutionDelegationId>() })
/** Reserve a Run identity before local Session creation. */
export const createRunSchema = owner.extend({ kind: z.literal('create-run'), configDigest: executionDigestSchema, backend: executionCodexBackendSchema.optional() }).strict()
/** One exact Run selector; excludes client-selected local Session identities. */
export const executionReadSchema = assignmentReadSchema.extend({ runId: id<OrganizationRunId>() }).strict()
const runCommand = owner.extend({ runId: id<OrganizationRunId>() })
/** Allocate one charged permission per actual attempt. */
export const reserveActionSchema = runCommand.extend({ kind: z.literal('reserve-action'), actionId: id<OrganizationActionId>(),
  capability: executionCapabilitySchema, requestDigest: executionDigestSchema,
  approvalId: executionHumanSchema.shape.id.optional() }).strict()
/** The assigned employee reports only facts about a previously reserved action. */
export const settleActionSchema = runCommand.extend({ kind: z.literal('settle-action'), actionId: id<OrganizationActionId>(),
  outcome: z.enum(['succeeded', 'failed', 'not-issued', 'unknown']), evidenceDigest: executionDigestSchema }).strict()
/** Terminal Run facts are independent of submission and acceptance. */
export const transitionRunSchema = runCommand.extend({ kind: z.literal('transition-run'),
  state: z.enum(['running', 'paused', 'succeeded', 'failed', 'cancelled']), stopReason: executionStopReasonSchema.optional() }).strict()
/** Persist a designated question or approval and stop this Run before further actions. */
export const requestExecutionHumanSchema = runCommand.extend({ kind: z.literal('request-execution-human'),
  requestId: executionHumanSchema.shape.id, handlerId: executionHumanSchema.shape.handlerId,
  requestKind: executionHumanSchema.shape.kind, prompt: executionHumanSchema.shape.prompt,
  expiresAt: executionHumanSchema.shape.expiresAt, actionId: executionHumanSchema.shape.actionId,
  requestDigest: executionHumanSchema.shape.requestDigest,
}).strict()
/** Explicit continuation rechecks the accepted assignment, budget and all outstanding facts. */
export const resumeExecutionSchema = runCommand.extend({ kind: z.literal('resume-run') }).strict()
/** Closed set of authenticated organization execution mutations. */
export const executionCommandSchema = z.discriminatedUnion('kind', [grantExecutionSchema, revokeExecutionSchema, createRunSchema,
  reserveActionSchema, settleActionSchema, transitionRunSchema, requestExecutionHumanSchema, resumeExecutionSchema])
/** Strict HTTPS mutation envelope. */
export const executionEnvelopeSchema = z.object({ command: executionCommandSchema }).strict()
// Older private logs retain these fields; current commands never admit or consume them.
const historicalOwner = { deviceId: deviceIdSchema.optional(), serverEpoch: serverEpochSchema.optional(),
  fencingEpoch: fencingEpochSchema.optional() }
const historicalBackend = executionCodexBackendSchema.extend({ dispatch: z.enum(['local', 'device-native']) })
/** Durable explicit execution delegation. */
export const executionDelegationSchema = grantExecutionSchema.omit({ kind: true, operationId: true }).extend({
  deviceId: deviceIdSchema.optional(), delegationId: delegationIdSchema.optional(), backend: historicalBackend.optional(),
  id: id<OrganizationExecutionDelegationId>(), state: z.enum(['active', 'revoked', 'invalidated', 'expired']),
  used: integer, createdRevision: integer.positive(), version: integer.positive(),
}).strict()
/** Shared Run summary; contains neither local directory nor conversation. */
export const executionRunSchema = createRunSchema.omit({ kind: true, operationId: true }).extend({
  ...historicalOwner, backend: historicalBackend.optional(),
  id: id<OrganizationRunId>(), state: z.enum(['prepared', 'running', 'paused', 'waiting-human', 'succeeded', 'failed', 'cancelled']),
  startedAt: integer.positive().nullable().optional(), stopReason: executionStopReasonSchema.nullable().optional(),
  createdRevision: integer.positive(), version: integer.positive(),
}).strict()
/** Charged action identity and retained result evidence. */
export const executionActionSchema = reserveActionSchema.omit({ kind: true, operationId: true }).extend({
  ...historicalOwner,
  state: z.enum(['reserved', 'succeeded', 'failed', 'not-issued', 'unknown']), expiresAt: integer.positive(),
  evidenceDigest: executionDigestSchema.nullable(), createdRevision: integer.positive(), version: integer.positive(),
}).strict()
/** Receipts refer to immutable operation snapshots; they never grant a fresh permission. */
export const executionReceiptSchema = z.object({ executionDelegationId: id<OrganizationExecutionDelegationId>(),
  runId: id<OrganizationRunId>().optional(), actionId: id<OrganizationActionId>().optional(),
  requestId: executionHumanSchema.shape.id.optional() }).strict()
/** Deployment-approved text model and exact HTTPS Messages root; redirects are forbidden. */
export const executionModelSchema = z.object({ model: z.string().min(1).max(200),
  endpoint: z.url().refine((value) => {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash
      && url.pathname.endsWith('/v1')
  }, 'HTTPS /v1 endpoint without credentials, query or fragment required'),
}).strict()
/** Authorized Run read includes retained action facts and current delegation usage. */
export const executionViewSchema = z.object({ run: executionRunSchema, delegation: executionDelegationSchema,
  assigneeId: executionHumanSchema.shape.handlerId, approvedBy: executionHumanSchema.shape.handlerId,
  humanRequests: z.array(executionHumanSchema), actions: z.array(executionActionSchema), serverTime: integer, eligible: z.boolean(),
  nativeActive: z.boolean().default(false),
  codexPolicy: z.array(executionCodexPolicySchema).max(100).default([]),
  modelPolicy: z.array(executionModelSchema).max(100) }).strict()

/** Bounded current-authority Run history for one assignment. */
export const executionListSchema = assignmentReadSchema.extend({ offset: integer.default(0) }).strict()
/** Shared Run history excludes local conversations and paths. */
export const executionPageSchema = z.object({ items: z.array(executionRunSchema), total: integer, offset: integer }).strict()
