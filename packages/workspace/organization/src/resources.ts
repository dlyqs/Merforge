/** Shared current-authority SQL for resource detail, pagination, totals and event invalidations. */
import type { DatabaseSync } from 'node:sqlite'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { brandString } from '@deepseek-ai/dsh-brand'
import { OrganizationError } from './error.ts'
import { cursorSchema, projectSchema, resourceEventSchema } from './resource-schema.ts'
import type { OrganizationCursor, OrganizationProjectId, OrganizationProjectView, Principal, ProjectAction, OrganizationResourceEvent } from './types.ts'

const visible = (action: ProjectAction) => `SELECT p.* FROM organization_projects p
  JOIN resource_grants g ON g.projectId=p.id
  JOIN memberships m ON m.id=g.membershipId AND m.organizationId=p.organizationId
  JOIN accounts a ON a.id=m.accountId
  WHERE m.accountId=? AND m.organizationId=? AND m.enabled=1 AND a.enabled=1 AND ${action === 'read' ? 'g.canRead' : 'g.canWrite'}=1`

/**
 * Require the current explicit resource action, even for administrators.
 * @param db - Authority connection inside the active transaction.
 * @param principal - Freshly authenticated account and membership.
 * @param projectId - Target project.
 * @param action - Explicit action, separate from organization administration.
 * @returns Current project view after permission is established.
 */
export function authorizedProject(
  db: DatabaseSync, principal: Principal, projectId: OrganizationProjectId, action: ProjectAction,
): OrganizationProjectView {
  const row = db.prepare(visible(action) + ' AND p.id=?')
    .get(principal.accountId, principal.organizationId ?? null, projectId)
  if (!row) throw new OrganizationError('forbidden')
  return projectSchema.parse(row)
}

/**
 * Query one authorized page and its count through the same visibility predicate.
 * @param db - Active authority transaction.
 * @param principal - Current organization member.
 * @param search - Literal case-insensitive name substring, never a SQL pattern.
 * @param offset - Validated page offset.
 * @param limit - Deployment page ceiling.
 * @returns Authorized names and a count excluding every unreadable project.
 */
export function visibleProjects(
  db: DatabaseSync, principal: Principal, search: string, offset: number, limit: number,
): { items: OrganizationProjectView[]; total: number } {
  const query = visible('read') + ' AND instr(lower(p.name), lower(?)) > 0'
  const args = [principal.accountId, principal.organizationId ?? null, search]
  const items = db.prepare(query + ' ORDER BY p.id LIMIT ? OFFSET ?').all(...args, limit, offset).map(row => projectSchema.parse(row))
  const total = Number(db.prepare(`SELECT count(*) AS total FROM (${query})`).get(...args)?.total)
  return { items, total }
}

/**
 * Read only invalidations whose projects remain explicitly readable now.
 * @param db - Active authority transaction.
 * @param principal - Current organization member.
 * @param after - Last committed cursor revision.
 * @param through - Inclusive committed range end.
 * @returns Current-authority project invalidations, without historical names.
 */
export function visibleEvents(db: DatabaseSync, principal: Principal, after: number, through: number): OrganizationResourceEvent[] {
  return db.prepare(`SELECT e.revision,e.projectId FROM resource_events e
    WHERE e.revision>? AND e.revision<=? AND e.projectId IN (SELECT id FROM (${visible('read')})) ORDER BY e.revision`)
    .all(after, through, principal.accountId, principal.organizationId ?? null).map(row => resourceEventSchema.parse(row))
}

/**
 * Read the member's visibility epoch, including structural grants and suggestion assignability.
 * @param db - Active authority transaction.
 * @param principal - Current organization member.
 * @returns Latest account, organization-membership, project/task-grant or structural version.
 */
export function accessVersion(db: DatabaseSync, principal: Principal): number {
  return Number(db.prepare(`SELECT max(a.version,m.version,coalesce((SELECT max(g.version) FROM resource_grants g WHERE g.membershipId=m.id),0),
    coalesce((SELECT max(max(t.version,p.structureVersion)) FROM task_grants t JOIN organization_plans p ON p.id=t.planId WHERE t.membershipId=m.id),0),
    coalesce((SELECT max(max(a2.version,m2.version)) FROM memberships m2 JOIN accounts a2 ON a2.id=m2.accountId WHERE m2.organizationId=m.organizationId),0)) AS version
    FROM memberships m JOIN accounts a ON a.id=m.accountId WHERE m.accountId=? AND m.organizationId=?`)
    .get(principal.accountId, principal.organizationId ?? null)?.version)
}

/**
 * Sign an opaque, identity-scoped cursor for a committed database position.
 * @param secret - Per-authority-lifetime signing key; restart requires a fresh snapshot.
 * @param principal - Current member identity.
 * @param version - Member's current visibility epoch.
 * @param revision - Committed event position.
 * @returns Tamper-evident cursor safe to persist on the client.
 */
export function createCursor(secret: Buffer, principal: Principal, version: number, revision: number): OrganizationCursor {
  const body = Buffer.from(JSON.stringify({ accountId: principal.accountId, organizationId: principal.organizationId, accessVersion: version, revision })).toString('base64url')
  const signature = createHmac('sha256', secret).update(body).digest('base64url')
  return brandString<OrganizationCursor>(`${body}.${signature}`)
}

/**
 * Reject forged, stale, future and cross-identity cursor positions before event delivery.
 * @param secret - Current authority-lifetime signing key.
 * @param cursor - Bounded protocol cursor.
 * @param principal - Current member, reauthenticated in this transaction.
 * @param version - Current visibility epoch.
 * @param head - Latest committed revision.
 * @param window - Maximum replay distance before a snapshot is required.
 * @returns Authorized replay position.
 */
export function readCursor(secret: Buffer, cursor: string, principal: Principal, version: number, head: number, window: number): number {
  const [body, signature, extra] = cursor.split('.')
  if (!body || !signature || extra !== undefined) throw new OrganizationError('snapshot-required')
  const expected = createHmac('sha256', secret).update(body).digest()
  const actual = Buffer.from(signature, 'base64url')
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new OrganizationError('snapshot-required')
  const parsed = cursorSchema.safeParse(JSON.parse(Buffer.from(body, 'base64url').toString('utf8')))
  if (!parsed.success || parsed.data.accountId !== principal.accountId || parsed.data.organizationId !== principal.organizationId
    || parsed.data.accessVersion !== version || parsed.data.revision > head || head - parsed.data.revision > window) throw new OrganizationError('snapshot-required')
  return parsed.data.revision
}
