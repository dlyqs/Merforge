/** Organization reporting relationships and current assignment authority. */
import type { DatabaseSync } from 'node:sqlite'
import type { MembershipId, OrganizationId, Principal } from './types.ts'
import { membershipSchema, type hierarchySchema } from './schema.ts'
import type { z } from 'zod'
import { OrganizationError } from './error.ts'

/** Separate reporting records preserve membership identity and membership versions. */
export const hierarchyDdl = `CREATE TABLE organization_hierarchy (
  membershipId TEXT PRIMARY KEY REFERENCES memberships(id),
  supervisorId TEXT REFERENCES memberships(id), version INTEGER NOT NULL CHECK(version>=0)
) STRICT;`

/**
 * Limit employees to their descendants, immediate peers and ancestor reporting chain.
 * @param nodes - Organization reporting records, with disabled members retained for administrators.
 * @param principal - Currently enabled organization member.
 * @returns Visible nodes with no references to hidden supervisors.
 */
export function visibleHierarchy(nodes: z.output<typeof hierarchySchema>, principal: Principal): z.output<typeof hierarchySchema> {
  if (principal.role === 'admin') return nodes
  const byId = new Map(nodes.map(node => [node.id, node]))
  const own = nodes.find(node => node.id === principal.membershipId)
  if (!own) return []
  const visible = new Set<MembershipId>([own.id])
  const descendants = [own.id]
  for (const id of descendants) for (const node of nodes) {
    if (node.supervisorId === id && !visible.has(node.id)) { visible.add(node.id); descendants.push(node.id) }
  }
  if (own.supervisorId) for (const node of nodes) if (node.supervisorId === own.supervisorId) visible.add(node.id)
  let parent = own.supervisorId
  while (parent && !visible.has(parent)) {
    const node = byId.get(parent)
    if (!node) break
    visible.add(parent); parent = node.supervisorId
  }
  const readable = nodes.filter(node => node.enabled && visible.has(node.id)), readableIds = new Set(readable.map(node => node.id))
  return readable.map(node => ({ ...node,
    supervisorId: node.supervisorId && readableIds.has(node.supervisorId) ? node.supervisorId : null }))
}

/**
 * Require an enabled administrator, the employee themselves, or their enabled direct supervisor.
 * @param db - Current authority transaction.
 * @param principal - Authenticated organization member.
 * @param assigneeId - Proposed employee in the same organization.
 */
export function authorizeHierarchyAssignment(db: DatabaseSync, principal: Principal, assigneeId: MembershipId): void {
  const member = membershipSchema.parse(db.prepare('SELECT * FROM memberships WHERE id=? AND organizationId=?')
    .get(principal.membershipId ?? null, principal.organizationId ?? null))
  if (member.role === 'admin' || member.id === assigneeId) return
  const row = db.prepare(`SELECT h.supervisorId FROM organization_hierarchy h JOIN memberships m ON m.id=h.membershipId
    JOIN accounts a ON a.id=m.accountId WHERE h.membershipId=? AND m.organizationId=? AND m.enabled=1 AND a.enabled=1`)
    .get(assigneeId, member.organizationId)
  if (row?.supervisorId === member.id) return
  throw new OrganizationError('forbidden')
}

/**
 * Change a reporting relationship; cross-organization parents, cycles and stale writes are refused.
 * @param db - Current authority write transaction.
 * @param organizationId - Administered organization.
 * @param membershipId - Existing employee.
 * @param supervisorId - Existing enabled supervisor, or null for a root.
 * @param expectedVersion - Last observed reporting record version; zero for no record.
 * @param revision - Committed audit revision.
 */
export function setSupervisor(db: DatabaseSync, organizationId: OrganizationId, membershipId: MembershipId,
  supervisorId: MembershipId | null, expectedVersion: number, revision: number): void {
  if (!db.prepare('SELECT id FROM memberships WHERE id=? AND organizationId=?').get(membershipId, organizationId))
    throw new OrganizationError('forbidden')
  const previous = db.prepare('SELECT version FROM organization_hierarchy WHERE membershipId=?').get(membershipId)
  if ((previous?.version ?? 0) !== expectedVersion) throw new OrganizationError('version-conflict')
  if (supervisorId && !db.prepare(`SELECT m.id FROM memberships m JOIN accounts a ON a.id=m.accountId
    WHERE m.id=? AND m.organizationId=? AND m.enabled=1 AND a.enabled=1`).get(supervisorId, organizationId))
    throw new OrganizationError('forbidden')
  let current: string | null = supervisorId
  const visited = new Set<string>([membershipId])
  while (current) {
    if (visited.has(current)) throw new OrganizationError('invalid-input')
    visited.add(current)
    const row = db.prepare('SELECT supervisorId FROM organization_hierarchy WHERE membershipId=?').get(current)
    current = typeof row?.supervisorId === 'string' ? row.supervisorId : null
  }
  db.prepare(`INSERT INTO organization_hierarchy VALUES (?,?,?) ON CONFLICT(membershipId)
    DO UPDATE SET supervisorId=excluded.supervisorId,version=excluded.version`).run(membershipId, supervisorId, revision)
}

/**
 * Reject damaged reporting relationships during startup and backup validation.
 * @param db - Organization database being validated.
 */
export function validateHierarchy(db: DatabaseSync): void {
  const rows = db.prepare(`SELECT h.*,m.organizationId,p.organizationId AS supervisorOrganization
    FROM organization_hierarchy h JOIN memberships m ON m.id=h.membershipId
    LEFT JOIN memberships p ON p.id=h.supervisorId`).all()
  const parents = new Map<string, string | null>()
  for (const row of rows) {
    if (typeof row.membershipId !== 'string' || typeof row.version !== 'number' || row.version < 0
      || row.supervisorId !== null && (typeof row.supervisorId !== 'string' || row.organizationId !== row.supervisorOrganization))
      throw new OrganizationError('incompatible-store')
    parents.set(row.membershipId, row.supervisorId)
  }
  for (const id of parents.keys()) {
    const visited = new Set<string>()
    let current: string | null = id
    while (current) {
      if (visited.has(current)) throw new OrganizationError('incompatible-store')
      visited.add(current); current = parents.get(current) ?? null
    }
  }
}
