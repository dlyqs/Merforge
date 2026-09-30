/** Wire validation for the local connection owner and remote safe views. */
import { isAbsolute } from 'node:path'
import { z } from 'zod'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { AccountId, ServerId, MembershipId, OrganizationId, OrganizationCursor, LoginToken, OrganizationProjectId } from '@deepseek-ai/dsh-organization/types'
const version = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const org = z.uuid().transform(v => brandString<OrganizationId>(v))
const member = z.uuid().transform(v => brandString<MembershipId>(v))
const account = z.uuid().transform(v => brandString<AccountId>(v))
const role = z.enum(['admin', 'member'])
/** Deployment bounds for requests and reconnection; no offline writes are queued. */
export const connectionConfig = z.object({
  trustPath: z.string().refine(isAbsolute).optional(),
  timeoutMs: z.number().int().min(100).max(120000).default(15000),
  maxResponseBytes: z.number().int().min(1024).max(10485760).default(1048576),
  renewalFraction: z.number().min(0.1).max(0.8).default(0.5),
  reconnectMs: z.number().int().min(100).max(60000).default(2000),
}).strict()
/** Parsed public server identity. */
export const identitySchema = z.object({ serverId: z.uuid().transform(v => brandString<ServerId>(v)),
  protocolVersion: z.literal(1) }).strict()
/** Parsed bearer response, available only to the native owner and its OS-encrypted session store. */
export const loginResultSchema = z.object({ token: z.string().regex(/^[\w-]{43}$/).transform(v => brandString<LoginToken>(v)),
  expiresAt: version,
  principal: z.object({ serverId: identitySchema.shape.serverId, accountId: account }).strict() }).strict()
/** Current membership options, excluding disabled memberships. */
export const organizationsSchema = z.array(z.object({ id: org, name: z.string(), version, membershipId: member, role }).strict())
/** Administrative member data without secrets. */
export const membersSchema = z.array(z.object({ id: member,
  accountId: account,
  username: z.string(),
  accountEnabled: z.boolean(),
  accountVersion: version, role,
  enabled: z.boolean(), version }).strict())
/** Complete authorized page including its event handoff cursor. */
export const pageSchema = z.object({ items: z.array(z.object({ id: z.uuid().transform(v => brandString<OrganizationProjectId>(v)),
  organizationId: org,
  name: z.string(), version }).strict()),
total: version,
offset: version,
revision: version,
cursor: z.string().transform(v => brandString<OrganizationCursor>(v)) }).strict()
/** Only known local operations can reach the native transport. */
export const actionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.enum(['delivery-command', 'delivery-read', 'delivery-download', 'execution-list', 'execution-command', 'execution-read', 'assignment-review', 'assignment-command', 'assignment-participant', 'assignment-delegate', 'assignment-tasks', 'assignment-inbox', 'assignment-preparation', 'lease-claim', 'lease-release', 'lease-check']), request: z.unknown() }).strict(),
  z.object({ kind: z.literal('device-register'), name: z.string().trim().min(1).max(120) }).strict(),
  z.object({ kind: z.literal('device-revoke'), expectedVersion: z.number().int().positive() }).strict(),
  z.object({ kind: z.literal('device-read') }).strict(),
  z.object({ kind: z.enum(['workgraph-save', 'workgraph-read', 'workgraph-tasks', 'workgraph-grant', 'workgraph-grants']), request: z.unknown() }).strict(),
  z.object({ kind: z.literal('probe'), origin: z.string().max(2048) }).strict(),
  z.object({ kind: z.literal('trust'), fingerprint: z.string() }).strict(),
  z.object({ kind: z.literal('login'), username: z.string(), password: z.string() }).strict(),
  z.object({ kind: z.literal('register'), username: z.string(), password: z.string(), invitationToken: z.string() }).strict(),
  z.object({ kind: z.enum(['logout', 'reconnect', 'personal', 'reconcile']) }).strict(),
  z.object({ kind: z.literal('select'), organizationId: org }).strict(),
  z.object({ kind: z.literal('search'), query: z.string().max(120), offset: version }).strict(),
  z.object({ kind: z.literal('invite'), role }).strict(),
  z.object({ kind: z.literal('command'), command: z.unknown() }).strict(),
  z.object({ kind: z.literal('grants'), projectId: z.uuid() }).strict(),
])

/** Current explicit grant metadata, without project names. */
export const grantsSchema = z.array(z.object({
  membershipId: member,
  projectId: z.uuid().transform(v => brandString<OrganizationProjectId>(v)),
  actions: z.array(z.enum(['read', 'write'])),
  version,
}).strict())
