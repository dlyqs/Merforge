/** Transactional finite planning qualifications and exactly-once attempt consumption. */
import { createHash, randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { z } from 'zod'
import { savePlanningDraft } from './planning-draft.ts'
import type { WorkgraphLimits } from './workgraph.ts'
import { OrganizationError } from './error.ts'
import { authorizedProject } from './resources.ts'
import { type accountConversationReadSchema, accountConversationViewSchema, planningReadSchema, planningGrantSchema, planningPermitSchema,
  planningViewSchema, planningCandidatesPageSchema, planningReceiptSchema,
  type planningPolicySchema, type planningCommandSchema,
  type planningCandidatesSchema } from './planning-schema.ts'
import type { Principal } from './types.ts'
type Policy = z.output<typeof planningPolicySchema>
type Selection = z.output<typeof planningReadSchema>
/** Physical planning records are separate from assignments, Runs and private conversation text. */
export const planningDdl = `
CREATE TABLE planning_grants (conversationId TEXT NOT NULL, accountId TEXT NOT NULL REFERENCES accounts(id),
  organizationId TEXT NOT NULL REFERENCES organizations(id), projectId TEXT NOT NULL REFERENCES organization_projects(id),
  data TEXT NOT NULL, PRIMARY KEY(conversationId,accountId)) STRICT;
CREATE TABLE planning_permits (id TEXT PRIMARY KEY, conversationId TEXT NOT NULL, accountId TEXT NOT NULL,
  data TEXT NOT NULL, FOREIGN KEY(conversationId,accountId) REFERENCES planning_grants(conversationId,accountId)) STRICT;
CREATE TABLE planning_events (revision INTEGER PRIMARY KEY REFERENCES organization_events(revision),
  conversationId TEXT NOT NULL, accountId TEXT NOT NULL, result TEXT NOT NULL,
  FOREIGN KEY(conversationId,accountId) REFERENCES planning_grants(conversationId,accountId)) STRICT;
`
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
function accessDigest(db: DatabaseSync, principal: Principal, query: Selection): string {
  return digest(db.prepare(`SELECT a.version AS accountVersion,m.version AS memberVersion,g.version AS grantVersion
    FROM accounts a JOIN memberships m ON m.accountId=a.id JOIN resource_grants g ON g.membershipId=m.id
    WHERE a.id=? AND m.id=? AND g.projectId=?`).get(principal.accountId, principal.membershipId ?? null, query.projectId))
}
function readGrant(db: DatabaseSync, principal: Principal, query: Selection) {
  const row = db.prepare('SELECT data FROM planning_grants WHERE conversationId=? AND accountId=?').get(query.conversationId, principal.accountId)
  if (!row) return null
  const grant = planningGrantSchema.parse(JSON.parse(String(row.data)))
  if (grant.projectId !== query.projectId || grant.organizationId !== query.organizationId) throw new OrganizationError('forbidden')
  return grant
}
function eligible(db: DatabaseSync, principal: Principal, query: Selection, grant: z.output<typeof planningGrantSchema> | null,
  epoch: string, policy: Policy): boolean {
  return !!grant && grant.serverEpoch === epoch && Math.min(grant.expiresAt, grant.createdAt + policy.ttlMs,
    grant.createdAt + policy.maxDurationMs) > Date.now()
    && grant.policyDigest === digest(policy) && grant.accessDigest === accessDigest(db, principal, query)
    && policy.models.some(m => m.model === grant.selection.model && m.endpoint === grant.selection.endpoint)
}
/**
 * Resolve current read authorization separately from permission to dispatch another model request.
 * @param db - Active authority transaction.
 * @param principal - Current enabled member.
 * @param query - Account conversation selection with an optional project.
 * @param epoch - Active authority lifetime.
 * @param policy - Deployment planning policy.
 * @returns Membership-authorized account facts, or project facts and finite qualification.
 */
export function readPlanning(db: DatabaseSync, principal: Principal, query: z.output<typeof accountConversationReadSchema>, epoch: string,
  policy: Policy): z.output<typeof accountConversationViewSchema> {
  if (!query.projectId) return accountConversationViewSchema.parse({ grant: null, eligible: false, canWrite: false,
    plans: [], serverTime: Date.now(), policy })
  const selection = planningReadSchema.parse(query)
  const project = authorizedProject(db, principal, query.projectId, 'read'), grant = readGrant(db, principal, selection)
  return planningViewSchema.parse({ project, grant,
    canWrite: !!db.prepare('SELECT 1 FROM resource_grants WHERE projectId=? AND membershipId=? AND canWrite=1').get(query.projectId, principal.membershipId ?? null),
    plans: db.prepare('SELECT goalId,planId,taskId FROM planning_goals WHERE accountId=? AND conversationId=?').all(principal.accountId, query.conversationId),
    eligible: eligible(db, principal, selection, grant, epoch, policy),
    serverTime: Date.now(), policy })
}
/**
 * Mutate planning permission only; reservations charge maximum byte exposure and are never refunded.
 * @param db - Active receipt transaction.
 * @param principal - Fresh enabled organization identity.
 * @param command - Strict fixed planning operation.
 * @param revision - Owning durable event.
 * @param epoch - Active service epoch.
 * @param policy - Validated deployment ceilings and destinations.
 * @param limits - Full WorkGraph deployment limits.
 * @returns Historical permission identifiers, without a reusable token.
 */
export function changePlanning(db: DatabaseSync, principal: Principal, command: z.output<typeof planningCommandSchema>,
  revision: number, epoch: string, policy: Policy, limits: WorkgraphLimits): z.output<typeof import('./planning-schema.ts').planningReceiptSchema> {
  authorizedProject(db, principal, command.projectId, 'read')
  const grant = readGrant(db, principal, command)
  if (command.kind === 'open-planning') {
    if (grant && (grant.selection.model !== command.selection.model || grant.selection.endpoint !== command.selection.endpoint)
      || grant && (grant.usedRequests >= policy.maxRequests || grant.usedBytes >= policy.maxTotalBytes)
      || !policy.models.some(m => m.model === command.selection.model
        && m.endpoint === command.selection.endpoint)) throw new OrganizationError('forbidden')
    const { models: _models, ...currentLimits } = policy, now = Date.now()
    const limits = grant?.limits ?? currentLimits
    const created = planningGrantSchema.parse({ organizationId: command.organizationId,
      projectId: command.projectId, conversationId: command.conversationId,
      accountId: principal.accountId, membershipId: principal.membershipId, serverEpoch: epoch,
      policyDigest: digest(policy), accessDigest: accessDigest(db, principal, command), selection: command.selection,
      limits, createdAt: now, expiresAt: now + Math.min(limits.ttlMs, limits.maxDurationMs),
      usedRequests: grant?.usedRequests ?? 0, usedBytes: grant?.usedBytes ?? 0, createdRevision: grant?.createdRevision ?? revision,
      qualificationRevision: revision })
    db.prepare('INSERT INTO planning_grants VALUES (?,?,?,?,?) ON CONFLICT(conversationId,accountId) DO UPDATE SET data=excluded.data').run(command.conversationId, principal.accountId,
      command.organizationId, command.projectId, JSON.stringify(created))
    return { conversationId: command.conversationId }
  }
  if (command.kind === 'save-planning-draft') {
    if (!grant) throw new OrganizationError('forbidden')
    return savePlanningDraft(db, principal, command, revision, limits)
  }
  if (!grant || !eligible(db, principal, command, grant, epoch, policy)) throw new OrganizationError('forbidden')
  if (command.kind === 'reserve-planning-request') {
    const bytes = command.inputBytes + command.outputBytes
    if (grant.usedRequests >= Math.min(grant.limits.maxRequests, policy.maxRequests)
      || command.inputBytes > Math.min(grant.limits.maxInputBytes, policy.maxInputBytes)
        || command.outputBytes > Math.min(grant.limits.maxOutputBytes, policy.maxOutputBytes)
      || grant.usedBytes + bytes > Math.min(grant.limits.maxTotalBytes, policy.maxTotalBytes)) throw new OrganizationError('rate-limited')
    const permit = planningPermitSchema.parse({ organizationId: command.organizationId, projectId: command.projectId,
      conversationId: command.conversationId, requestDigest: command.requestDigest, inputBytes: command.inputBytes,
      outputBytes: command.outputBytes,
      id: randomUUID(), accountId: principal.accountId, serverEpoch: epoch, expiresAt: Math.min(grant.expiresAt,
        Date.now() + policy.permitTtlMs),
      qualificationRevision: grant.qualificationRevision, state: 'reserved', createdRevision: revision, consumedRevision: null })
    db.prepare('INSERT INTO planning_permits VALUES (?,?,?,?)').run(permit.id, permit.conversationId,
      permit.accountId, JSON.stringify(permit))
    db.prepare('UPDATE planning_grants SET data=? WHERE conversationId=? AND accountId=?')
      .run(JSON.stringify({ ...grant, usedRequests: grant.usedRequests + 1, usedBytes: grant.usedBytes + bytes }),
        grant.conversationId, grant.accountId)
    return { conversationId: command.conversationId, permitId: permit.id, permitExpiresAt: permit.expiresAt }
  }
  const row = db.prepare('SELECT data FROM planning_permits WHERE id=? AND conversationId=? AND accountId=?')
    .get(command.permitId, command.conversationId, principal.accountId)
  if (!row) throw new OrganizationError('forbidden')
  const permit = planningPermitSchema.parse(JSON.parse(String(row.data)))
  if (permit.state !== 'reserved' || permit.expiresAt <= Date.now() || permit.serverEpoch !== epoch
    || permit.qualificationRevision !== grant.qualificationRevision
    || permit.requestDigest !== command.requestDigest) throw new OrganizationError('forbidden')
  db.prepare('UPDATE planning_permits SET data=? WHERE id=?').run(JSON.stringify({ ...permit, state: 'consumed',
    consumedRevision: revision }), permit.id)
  return { conversationId: command.conversationId, permitId: permit.id, permitExpiresAt: permit.expiresAt }
}
/**
 * Read minimal currently visible peer identities with project-scoped pagination.
 * @param db - Active authority transaction.
 * @param principal - Fresh member identity.
 * @param query - Project and literal username substring.
 * @param limit - Deployment page ceiling.
 * @returns Enabled project readers only; selection conveys no task permission.
 */
export function planningCandidates(db: DatabaseSync, principal: Principal,
  query: z.output<typeof planningCandidatesSchema>, limit: number): z.output<typeof planningCandidatesPageSchema> {
  authorizedProject(db, principal, query.projectId, 'read')
  const sql = `FROM memberships m JOIN accounts a ON a.id=m.accountId JOIN resource_grants g ON g.membershipId=m.id
    WHERE m.organizationId=? AND m.enabled=1 AND a.enabled=1 AND g.projectId=? AND g.canRead=1 AND instr(a.username,lower(?))>0`
  const args = [query.organizationId, query.projectId, query.search]
  return planningCandidatesPageSchema.parse({ items: db.prepare(`SELECT m.id AS membershipId,a.username ${sql} ORDER BY a.username,m.id LIMIT ? OFFSET ?`)
    .all(...args, limit, query.offset), total: Number(db.prepare(`SELECT count(*) AS n ${sql}`).get(...args)?.n), offset: query.offset })
}
/**
 * Reject cold-store corruption in ownership, charged usage, operation events and permit consumption.
 * @param db - Open authority database under its startup transaction.
 */
export function validatePlanningDatabase(db: DatabaseSync): void {
  for (const row of db.prepare('SELECT * FROM planning_grants').all()) {
    const g = planningGrantSchema.parse(JSON.parse(String(row.data)))
    const member = db.prepare('SELECT accountId,organizationId FROM memberships WHERE id=?').get(g.membershipId)
    const project = db.prepare('SELECT organizationId FROM organization_projects WHERE id=?').get(g.projectId)
    const permits = db.prepare('SELECT data FROM planning_permits WHERE conversationId=? AND accountId=?').all(g.conversationId, g.accountId)
      .map(r => planningPermitSchema.parse(JSON.parse(String(r.data))))
    if (row.conversationId !== g.conversationId || row.accountId !== g.accountId || row.organizationId !== g.organizationId
      || row.projectId !== g.projectId || member?.accountId !== g.accountId || member.organizationId !== g.organizationId
      || project?.organizationId !== g.organizationId || permits.length !== g.usedRequests
      || permits.reduce((n, p) => n + p.inputBytes + p.outputBytes, 0) !== g.usedBytes
      || g.usedRequests > g.limits.maxRequests || g.usedBytes > g.limits.maxTotalBytes
      || g.expiresAt !== g.createdAt + Math.min(g.limits.ttlMs, g.limits.maxDurationMs)) throw new OrganizationError('incompatible-store')
  }
  for (const row of db.prepare('SELECT * FROM planning_permits').all()) {
    const p = planningPermitSchema.parse(JSON.parse(String(row.data)))
    const stored = db.prepare('SELECT data FROM planning_grants WHERE conversationId=? AND accountId=?').get(p.conversationId, p.accountId)
    const g = stored ? planningGrantSchema.parse(JSON.parse(String(stored.data))) : null
    if (!g || row.id !== p.id || row.conversationId !== p.conversationId || row.accountId !== p.accountId
      || p.organizationId !== g.organizationId || p.projectId !== g.projectId
      || p.expiresAt > g.expiresAt || p.inputBytes > g.limits.maxInputBytes
      || p.outputBytes > g.limits.maxOutputBytes || (p.state === 'consumed') !== (p.consumedRevision !== null)) throw new OrganizationError('incompatible-store')
    for (const [revision, kind] of [[p.createdRevision, 'reserve-planning-request'], [p.consumedRevision,
      'consume-planning-request']] as const) {
      if (revision === null) continue
      const e = db.prepare(`SELECT e.kind,e.actorId,e.organizationId,x.result FROM organization_events e
        JOIN planning_events x ON x.revision=e.revision WHERE e.revision=? AND x.conversationId=? AND x.accountId=?`)
        .get(revision, p.conversationId, p.accountId)
      if (e?.kind !== kind || e.actorId !== p.accountId || e.organizationId !== p.organizationId
        || planningReceiptSchema.parse(JSON.parse(String(e.result))).permitId !== p.id) throw new OrganizationError('incompatible-store')
    }
  }
  for (const row of db.prepare(`SELECT e.kind,e.actorId,e.organizationId,x.* FROM planning_events x
    JOIN organization_events e ON e.revision=x.revision`).all()) {
    const receipt = planningReceiptSchema.parse(JSON.parse(String(row.result)))
    const stored = db.prepare('SELECT data FROM planning_grants WHERE conversationId=? AND accountId=?')
      .get(String(row.conversationId), String(row.accountId))
    const grant = stored ? planningGrantSchema.parse(JSON.parse(String(stored.data))) : null
    if (!grant || row.actorId !== grant.accountId || row.organizationId !== grant.organizationId
      || receipt.conversationId !== grant.conversationId) throw new OrganizationError('incompatible-store')
    if (row.kind === 'open-planning') {
      if (receipt.permitId !== undefined || receipt.permitExpiresAt !== undefined) throw new OrganizationError('incompatible-store')
    } else if (row.kind === 'save-planning-draft') {
      const link = db.prepare('SELECT 1 FROM planning_goals WHERE accountId=? AND conversationId=? AND planId=? AND taskId=?').get(grant.accountId, grant.conversationId, receipt.planId ?? null, receipt.taskId ?? null)
      if (!link || !db.prepare('SELECT 1 FROM plan_revisions WHERE planId=? AND revision=?').get(receipt.planId ?? null, receipt.planRevision ?? null)) throw new OrganizationError('incompatible-store')
    } else {
      const storedPermit = db.prepare('SELECT data FROM planning_permits WHERE id=?').get(receipt.permitId ?? null)
      const permit = storedPermit ? planningPermitSchema.parse(JSON.parse(String(storedPermit.data))) : null
      const expectedRevision = row.kind === 'reserve-planning-request' ? permit?.createdRevision
        : row.kind === 'consume-planning-request' ? permit?.consumedRevision : null
      if (!permit || row.revision !== expectedRevision || receipt.permitExpiresAt !== permit.expiresAt
        || permit.conversationId !== grant.conversationId || permit.accountId !== grant.accountId)
        throw new OrganizationError('incompatible-store')
    }
  }
  const missingOpen = db.prepare(`SELECT g.conversationId FROM planning_grants g
    JOIN json_each(json_array(json_extract(g.data,'$.createdRevision'),json_extract(g.data,'$.qualificationRevision'))) r
    LEFT JOIN planning_events e ON e.revision=r.value LEFT JOIN organization_events o ON o.revision=e.revision
    WHERE e.revision IS NULL OR o.kind!='open-planning' OR e.conversationId!=g.conversationId OR e.accountId!=g.accountId
    UNION ALL SELECT p.conversationId FROM planning_permits p LEFT JOIN planning_events e
    ON e.revision=json_extract(p.data,'$.qualificationRevision') LEFT JOIN organization_events o ON o.revision=e.revision
    WHERE e.revision IS NULL OR o.kind!='open-planning' OR e.conversationId!=p.conversationId OR e.accountId!=p.accountId`).get()
  if (missingOpen) throw new OrganizationError('incompatible-store')
}
