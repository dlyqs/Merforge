/** Strict resource protocol and persisted project/grant parsers. */
import { z } from 'zod'
import { brandString, type Branded } from '@deepseek-ai/dsh-brand'
import type { AccountId, MembershipId, OperationId, OrganizationId, OrganizationProjectId } from './types.ts'

function id<T extends Branded<string>>() { return z.uuid().transform(value => brandString<T>(value)) }
const version = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const name = z.string().trim().min(1).max(120)
const base = { operationId: id<OperationId>(), organizationId: id<OrganizationId>() }

/** Allow-listed creation, write-authorized rename and creator-only shared deletion. */
export const projectCommandSchema = z.discriminatedUnion('kind', [
  z.object({ ...base, kind: z.literal('create-project'), name }).strict(),
  z.object({ ...base, kind: z.literal('rename-project'), projectId: id<OrganizationProjectId>(), expectedVersion: version, name }).strict(),
  z.object({ ...base, kind: z.literal('delete-project'), projectId: id<OrganizationProjectId>(), expectedVersion: version }).strict(),
])
/** Explicit grants use version zero for a missing grant and an empty action list to revoke. */
export const grantCommandSchema = z.object({
  ...base, kind: z.literal('set-grant'), projectId: id<OrganizationProjectId>(), membershipId: id<MembershipId>(),
  expectedVersion: version, actions: z.array(z.enum(['read', 'write'])).max(2).refine(actions => new Set(actions).size === actions.length),
}).strict()
/** Project database row and safe wire view. */
export const projectSchema = z.object({ id: id<OrganizationProjectId>(), organizationId: id<OrganizationId>(), name, version }).strict()
/** Creation identity is supplied by the authority, independently of content grants. */
export const projectViewSchema = projectSchema.extend({ createdBy: id<AccountId>() }).strict()
/** Deleted identifiers remain readable by previous grantees for installation-local cleanup. */
export const deletedProjectsSchema = z.object({ items: z.array(id<OrganizationProjectId>()), total: version, offset: version }).strict()
/** Grant rows remain after revocation to preserve their monotonic version. */
export const grantSchema = z.object({
  projectId: id<OrganizationProjectId>(), membershipId: id<MembershipId>(),
  canRead: z.union([z.literal(0), z.literal(1)]), canWrite: z.union([z.literal(0), z.literal(1)]), version,
}).strict()
/** Committed resource event reference; names and content are not copied into history. */
export const resourceEventSchema = z.object({ revision: version, projectId: id<OrganizationProjectId>() }).strict()
/** List/search pagination input; a later page must carry the first page's cursor. */
export const projectQuerySchema = z.object({
  organizationId: id<OrganizationId>(), search: z.string().max(120).default(''),
  offset: version.default(0), cursor: z.string().max(2048).optional(),
  excluded: z.array(id<OrganizationProjectId>()).default([]),
}).strict()
/** Resource detail request ties guessed project identifiers to an explicit organization. */
export const projectReadSchema = z.object({ organizationId: id<OrganizationId>(), projectId: id<OrganizationProjectId>() }).strict()
/** Event read input is always scoped to an already acquired snapshot cursor. */
export const eventQuerySchema = z.object({ organizationId: id<OrganizationId>(), cursor: z.string().min(1).max(2048) }).strict()
/** Authenticated cursor payload; the HMAC is checked before parsing or trusting any field. */
export const cursorSchema = z.object({
  accountId: id<AccountId>(), organizationId: id<OrganizationId>(), accessVersion: version, revision: version,
}).strict()
