import { planningPolicySchema, planningReceiptSchema } from './planning-schema.ts'
import { integrationReceiptSchema } from './integration-schema.ts'
/** Strict JSON and durable-row parsers for the organization authority. */
import { deliveryReceiptSchema } from './delivery-schema.ts'
import { executionReceiptSchema, executionModelSchema, executionCodexPolicySchema } from './execution-schema.ts'
import { z } from 'zod'
import { assignmentIdSchema, delegationIdSchema, deviceIdSchema } from './assignment-schema.ts'
import { leaseSchema } from './device-schema.ts'
import { planRevisionSchema } from './workgraph-schema.ts'
import type { OrganizationPlanId } from './workgraph-types.ts'
import type { Branded } from '@deepseek-ai/dsh-brand'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { AccountId, InvitationId, MembershipId, OperationId, OrganizationId, OrganizationProjectId, ServerId } from './types.ts'

function id<T extends Branded<string>>() { return z.uuid().transform(value => brandString<T>(value)) }
const version = z.number().int().nonnegative()
const bit = z.union([z.literal(0), z.literal(1)])
const role = z.enum(['admin', 'member'])
const token = z.string().regex(/^[A-Za-z0-9_-]{43}$/)
const username = z.string().toLowerCase().regex(/^[a-z0-9][a-z0-9_.-]{2,63}$/)
const password = z.string().min(8).max(1024)
const name = z.string().trim().min(1).max(120)
const base = { operationId: id<OperationId>() }
const digest = z.string().regex(/^[a-f0-9]{64}$/)

/** Validated deployment limits; no request may override them. */
export const configSchema = z.object({
  path: z.string().min(1),
  planning: planningPolicySchema.default({ models: [
    { model: 'deepseek-flash', endpoint: 'https://api.deepseek.com/anthropic/v1' },
    { model: 'deepseek-v4-pro', endpoint: 'https://api.deepseek.com/anthropic/v1' },
  ], ttlMs: 1800000, permitTtlMs: 10000, maxRequests: 40, maxInputBytes: 1048576,
  maxOutputBytes: 1048576, maxTotalBytes: 41943040, maxDurationMs: 1800000 }),
  artifactMaxFiles: z.number().int().min(1).max(1000).default(20),
  artifactMaxFileBytes: z.number().int().min(1).max(67108864).default(262144),
  artifactMaxTotalBytes: z.number().int().min(1).max(1073741824).default(1048576),
  loginTtlMs: z.number().int().min(1000).max(604800000).default(28800000),
  invitationTtlMs: z.number().int().min(1000).max(2592000000).default(86400000),
  loginWindowMs: z.number().int().min(1000).max(86400000).default(900000),
  loginMaxAttempts: z.number().int().min(1).max(1000).default(5),
  loginGlobalMaxAttempts: z.number().int().min(1).max(100000).default(100),
  pageSize: z.number().int().min(1).max(200).default(50),
  eventBatchSize: z.number().int().min(1).max(1000).default(100),
  eventReplayWindow: z.number().int().min(1).max(1000000).default(10000),
  workgraphMaxGrants: z.number().int().min(1).max(100000).default(10000),
  workgraphPageSize: z.number().int().min(1).max(1000).default(50),
  workgraphMaxTasks: z.number().int().min(1).max(100000).default(1000),
  workgraphMaxDepth: z.number().int().min(1).max(10000).default(100),
  workgraphMaxBytes: z.number().int().min(256).max(104857600).default(1048576),
  delegationMaxDurationMs: z.number().int().min(1000).max(604800000).default(3600000),
  executionCodex: z.array(executionCodexPolicySchema).max(100).default([]),
  executionModels: z.array(executionModelSchema).max(100).default([
    { model: 'deepseek-flash', endpoint: 'https://api.deepseek.com/anthropic/v1' },
    { model: 'deepseek-v4-pro', endpoint: 'https://api.deepseek.com/anthropic/v1' },
  ]),
  actionPermitTtlMs: z.number().int().min(100).max(60000).default(10000),
  delegationMaxBudget: z.number().int().min(1).max(1000000).default(100),
  deviceChallengeTtlMs: z.number().int().min(1000).max(300000).default(60000),
  deviceChallengeMaxPerAccount: z.number().int().min(1).max(1000).default(30),
  deviceChallengeMaxTotal: z.number().int().min(1).max(100000).default(3000),
  leaseTtlMs: z.number().int().min(1000).max(300000).default(30000),
  busyTimeoutMs: z.number().int().min(1).max(60000).default(5000),
}).strict()
/** Input validator for the private initialization channel. */
export const initializeSchema = z.object({ ...base, username, password, organizationName: name, recoveryToken: token }).strict()
/** Input validator for invitation registration. */
export const registerSchema = z.object({ ...base, username, password, invitationToken: token }).strict()
/** Login deliberately has no replayable secret receipt. */
export const loginSchema = z.object({ username, password }).strict()
/** Local recovery requires a separate credential and rotates it atomically. */
export const recoverySchema = z.object({ ...base, recoveryToken: token, newRecoveryToken: token, newPassword: password }).strict()
/** Network command allow list; private initialization/recovery are excluded. */
export const commandSchema = z.discriminatedUnion('kind', [
  z.object({ ...base, kind: z.literal('create-organization'), name }).strict(),
  z.object({ ...base, kind: z.literal('invite'), organizationId: id<OrganizationId>(), role, invitationToken: token }).strict(),
  z.object({ ...base, kind: z.literal('accept-invitation'), invitationToken: token }).strict(),
  z.object({ ...base, kind: z.literal('set-membership'), organizationId: id<OrganizationId>(), membershipId: id<MembershipId>(), expectedVersion: version, enabled: z.boolean(), role }).strict(),
  z.object({ ...base, kind: z.literal('set-supervisor'), organizationId: id<OrganizationId>(), membershipId: id<MembershipId>(), supervisorId: id<MembershipId>().nullable(), expectedVersion: version }).strict(),
  z.object({ ...base, kind: z.literal('set-account'), accountId: id<AccountId>(), expectedVersion: version, enabled: z.boolean() }).strict(),
  z.object({ ...base, kind: z.literal('change-password'), currentPassword: password, newPassword: password }).strict(),
])
/** Stored account parser; password parameters are fixed by the digest format. */
export const accountSchema = z.object({
  id: id<AccountId>(),
  username: z.string().regex(/^[a-z0-9][a-z0-9_.-]{2,63}$/),
  passwordHash: z.string().regex(/^scrypt-v1\$[a-f0-9]{32}\$[a-f0-9]{64}$/),
  enabled: bit, version,
})
/** Organization persistence parser. */
export const organizationSchema = z.object({
  id: id<OrganizationId>(), name, version,
})
/** Membership persistence parser. */
export const membershipSchema = z.object({
  id: id<MembershipId>(),
  organizationId: id<OrganizationId>(),
  accountId: id<AccountId>(), role,
  enabled: bit, version,
})
/** Invitation persistence parser. */
export const invitationSchema = z.object({
  id: id<InvitationId>(),
  organizationId: id<OrganizationId>(),
  issuerId: id<MembershipId>(), role, tokenHash: digest, expiresAt: version, consumed: bit, version,
})
/** Login records contain only token hashes. */
export const sessionSchema = z.object({
  tokenHash: digest,
  accountId: id<AccountId>(), expiresAt: version,
})
/** Singleton metadata parser; null roots mean not yet initialized. */
export const metadataSchema = z.object({
  singleton: z.literal(1), serverId: id<ServerId>(),
  rootAccountId: id<AccountId>().nullable(),
  rootOrganizationId: id<OrganizationId>().nullable(), recoveryHash: digest.nullable(),
})
/** Safe persisted receipt parser. */
export const receiptSchema = z.object({
  ...base, revision: version,
  accountId: id<AccountId>().optional(),
  organizationId: id<OrganizationId>().optional(),
  membershipId: id<MembershipId>().optional(),
  invitationId: id<InvitationId>().optional(),
  projectId: id<OrganizationProjectId>().optional(),
  planId: id<OrganizationPlanId>().optional(),
  planRevision: planRevisionSchema.optional(),
  assignmentId: assignmentIdSchema.optional(),
  delegationId: delegationIdSchema.optional(),
  deviceId: deviceIdSchema.optional(),
  lease: leaseSchema.optional(),
  execution: executionReceiptSchema.optional(),
  delivery: deliveryReceiptSchema.optional(),
  integration: integrationReceiptSchema.optional(),
  planning: planningReceiptSchema.optional(),
}).strict()
/** Rate-window persistence parser. */
export const attemptSchema = z.object({
  key: z.string(), startedAt: version, attempts: z.number().int().positive(),
})
/** Audit event parser; no request payload or credential is retained. */
export const eventSchema = z.object({
  revision: z.number().int().positive(),
  kind: z.enum(['open-planning', 'reserve-planning-request', 'consume-planning-request', 'save-planning-draft', 'verify-integration', 'confirm-integration', 'accept-delivery', 'reject-delivery', 'publish-artifact', 'submit-delivery', 'grant-execution', 'revoke-execution', 'create-run', 'reserve-action', 'settle-action', 'transition-run', 'request-execution-human', 'resume-run', 'register-device', 'revoke-device', 'claim', 'renew', 'release', 'server-start', 'qualification-expired', 'answer-assignment', 'answer-execution-question', 'approve-execution-tool', 'read-notification', 'delegate', 'revoke-delegation', 'approve-assignment', 'revoke-assignment', 'set-task-grant', 'save-plan', 'restore', 'create-project', 'rename-project', 'set-grant', 'initialize', 'register', 'recover', 'login', 'logout', 'login-denied', 'rate-limited', 'create-organization', 'invite', 'accept-invitation', 'set-membership', 'set-supervisor', 'set-account', 'change-password']),
  actorId: id<AccountId>().nullable(),
  organizationId: id<OrganizationId>().nullable(), at: version,
})
/** Receipt record parser before request equality and response parsing. */
export const receiptRowSchema = z.object({
  scope: z.string(), operationId: id<OperationId>(), fingerprint: digest, response: z.string(),
})

/** Minimal organization chart available to current members, without account or credential fields. */
export const hierarchySchema = z.array(z.object({ id: id<MembershipId>(), username: z.string(), role,
  enabled: z.boolean(), supervisorId: id<MembershipId>().nullable(), version }).strict())
