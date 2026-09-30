/** Current-version dependency admission and immutable target verification authority. */
import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { z } from 'zod'
import { integrationRecordSchema, integrationObservationSchema, type integrationReadSchema, type integrationCommandSchema, type integrationViewSchema, type integrationInputSchema, type integrationReceiptSchema } from './integration-schema.ts'
import { acceptanceSchema, submissionSchema, gitChangeSchema } from './delivery-schema.ts'
import { readArtifact } from './delivery.ts'
import { visibleTasks, selectedPlan } from './workgraph-access.ts'
import { authorizeWorkgraph, readWorkgraphVersion } from './workgraph.ts'
import { OrganizationError } from './error.ts'
import type { Principal } from './types.ts'
import type { OrganizationPlanDefinition, OrganizationTaskId } from './workgraph-types.ts'
type Query = z.output<typeof integrationReadSchema>
type Input = z.output<typeof integrationInputSchema>
type Observation = z.output<typeof integrationObservationSchema>
/** Integration records and final confirmations are independent durable facts. */
export const integrationDdl = `
CREATE TABLE organization_integrations (id TEXT PRIMARY KEY, planId TEXT NOT NULL REFERENCES organization_plans(id), data TEXT NOT NULL) STRICT;
CREATE TABLE integration_confirmations (integrationId TEXT PRIMARY KEY REFERENCES organization_integrations(id), revision INTEGER UNIQUE NOT NULL REFERENCES organization_events(revision), observation TEXT NOT NULL) STRICT;
CREATE TABLE integration_events (revision INTEGER PRIMARY KEY REFERENCES organization_events(revision), integrationId TEXT NOT NULL REFERENCES organization_integrations(id), result TEXT NOT NULL) STRICT;
`
function requiredLeaves(definition: OrganizationPlanDefinition, taskId: OrganizationTaskId): OrganizationTaskId[] {
  const children = definition.tasks.filter(t => t.parentTaskId === taskId)
  return children.length ? children.filter(t => t.required).flatMap(t => requiredLeaves(definition, t.id)) : [taskId]
}
function acceptedInput(db: DatabaseSync, query: Query, taskId: OrganizationTaskId): Input | undefined {
  const row = db.prepare(`SELECT r.data FROM organization_acceptances r JOIN task_assignments a ON a.id=r.assignmentId
    WHERE a.planId=? AND a.taskId=? AND a.planRevision=? AND json_extract(r.data,'$.state')='accepted'`).get(query.planId, taskId, query.planRevision)
  if (!row) return
  const r = acceptanceSchema.parse(JSON.parse(String(row.data)))
  return { assignmentId: r.assignmentId, taskId, submissionId: r.submissionId, artifacts: r.artifacts }
}
function issuer(db: DatabaseSync, query: Query, definition: OrganizationPlanDefinition, fallback: Principal['membershipId']) {
  if (definition.tasks.some(t => t.parentTaskId === query.taskId)) return fallback
  const input = acceptedInput(db, query, query.taskId)
  if (!input) return fallback
  return submissionSchema.parse(JSON.parse(String(db.prepare('SELECT data FROM organization_submissions WHERE id=?').get(input.submissionId)?.data))).handlerId
}
function inputsFor(db: DatabaseSync, query: Query, ids: OrganizationTaskId[], visible: Set<OrganizationTaskId>): Input[] | undefined {
  const result: Input[] = []
  for (const id of ids) {
    if (!visible.has(id)) return
    const input = acceptedInput(db, query, id)
    if (!input) return
    for (const item of input.artifacts) if (readArtifact(db, item.artifactId).artifact.sha256 !== item.sha256) throw new OrganizationError('incompatible-store')
    result.push(input)
  }
  return result.length ? result : undefined
}
/**
 * Project only readable accepted inputs; inaccessible siblings produce no partial evidence list.
 * @param db - Current authority transaction.
 * @param principal - Fresh authenticated member.
 * @param query - Exact task version.
 * @returns Separate dependency, accepted-input, target and delivery facts.
 */
export function integrationView(db: DatabaseSync, principal: Principal, query: Query): z.output<typeof integrationViewSchema> {
  const plan = selectedPlan(db, principal, query)
  const visible = new Set(visibleTasks(db, principal, { ...query, search: '', offset: 0 }).map(t => t.id))
  if (!visible.has(query.taskId)) throw new OrganizationError('forbidden')
  if (plan.currentRevision !== query.planRevision) throw new OrganizationError('version-conflict')
  const definition = readWorkgraphVersion(db, plan.id, plan.currentRevision).definition
  const task = definition.tasks.find(t => t.id === query.taskId)
  if (!task) throw new OrganizationError('forbidden')
  // Detail filtering must not remove independently authorized prerequisites and descendants.
  const allVisible = new Set(visibleTasks(db, principal, { organizationId: query.organizationId, projectId: query.projectId,
    planId: query.planId, search: '', offset: 0 }).map(t => t.id))
  const dependencies = new Set<OrganizationTaskId>()
  let ancestor: typeof task | undefined = task
  while (ancestor) {
    for (const id of ancestor.dependsOn) dependencies.add(id)
    const parent: OrganizationTaskId | null = ancestor.parentTaskId
    ancestor = definition.tasks.find(t => t.id === parent)
  }
  const dependenciesReady = [...dependencies].every(id => !!inputsFor(db, query, requiredLeaves(definition, id), allVisible))
  const inputs = inputsFor(db, query, requiredLeaves(definition, task.id), allVisible)
  let canConfirm = false
  try {
    authorizeWorkgraph(db, principal, query.projectId, query.planId, true)
    canConfirm = issuer(db, query, definition, plan.createdBy) === principal.membershipId
  }
  catch (error) { if (!(error instanceof OrganizationError) || error.code !== 'forbidden') throw error }
  const row = db.prepare(`SELECT data FROM organization_integrations WHERE planId=? AND json_extract(data,'$.taskId')=?
    AND json_extract(data,'$.planRevision')=? ORDER BY rowid DESC LIMIT 1`).get(query.planId, query.taskId, query.planRevision)
  const latest = inputs && row ? integrationRecordSchema.parse(JSON.parse(String(row.data))) : null
  return { ...query, dependenciesReady, inputsReady: !!inputs, inputs: inputs ?? [], canConfirm, latest,
    delivered: !!latest && !!db.prepare('SELECT 1 FROM integration_confirmations WHERE integrationId=?').get(latest.id) }
}
/**
 * Refuse new execution when necessary accepted prerequisites are missing or unreadable.
 * @param db - Current authority transaction.
 * @param principal - Executing employee.
 * @param query - Exact assigned task.
 */
export function requireDependencies(db: DatabaseSync, principal: Principal, query: Query): void {
  if (!integrationView(db, principal, query).dependenciesReady) throw new OrganizationError('version-conflict')
}
function sameInputs(a: Input[], b: Input[]): boolean {
  const canonical = (v: Input[]) => JSON.stringify(v.map(i => ({ ...i,
    artifacts: [...i.artifacts].sort((a,b) => a.artifactId.localeCompare(b.artifactId)),
  })).sort((a,b) => a.taskId.localeCompare(b.taskId)))
  return canonical(a) === canonical(b)
}
function expectedFiles(db: DatabaseSync, inputs: Input[]): Map<string, { sha256: string | null; size: number | null }> {
  const files = new Map<string, { sha256: string | null; size: number | null }>()
  const add = (path: string, value: { sha256: string | null; size: number | null }) => {
    const prior = files.get(path)
    if (prior && (prior.sha256 !== value.sha256 || prior.size !== value.size)) throw new OrganizationError('version-conflict')
    files.set(path, value)
  }
  for (const input of inputs) for (const item of input.artifacts) {
    const { artifact, bytes } = readArtifact(db, item.artifactId)
    if (artifact.kind === 'git-change') {
      const change = gitChangeSchema.parse(JSON.parse(bytes.toString('utf8')))
      for (const file of change.files) add(file.path, { sha256: file.newSha256, size: file.bytes === null ? null : Buffer.from(file.bytes, 'base64').length })
    } else add(artifact.path, { sha256: artifact.sha256, size: artifact.size })
  }
  return files
}
function verifyObservation(db: DatabaseSync, inputs: Input[], observation: Observation): void {
  if (new Set(observation.files.map(f => f.path)).size !== observation.files.length) throw new OrganizationError('invalid-input')
  const expected = expectedFiles(db, inputs)
  if (expected.size !== observation.files.length || observation.files.some(f => !expected.has(f.path))) throw new OrganizationError('invalid-input')
  if (observation.result === 'verified') {
    if (observation.files.some((f) => { const value = expected.get(f.path); return f.sha256 !== value?.sha256 || f.size !== value.size })) throw new OrganizationError('invalid-input')
    for (const input of inputs) for (const item of input.artifacts) {
      const { artifact, bytes } = readArtifact(db, item.artifactId)
      if (artifact.kind !== 'git-change') continue
      const change = gitChangeSchema.parse(JSON.parse(bytes.toString('utf8')))
      if (observation.baseCommit !== change.baseCommit || observation.baseTree !== change.baseTree) throw new OrganizationError('version-conflict')
    }
  }
}
/**
 * Record verified/rejected target observations or the original issuer's final confirmation.
 * @param db - Authority mutation transaction.
 * @param principal - Current target operator or original plan issuer.
 * @param command - Strict native observation and human intent.
 * @param revision - New committed audit revision.
 * @returns Stable receipt identity and whether this command confirms delivery.
 */
export function changeIntegration(db: DatabaseSync, principal: Principal, command: z.output<typeof integrationCommandSchema>,
  revision: number): z.output<typeof integrationReceiptSchema> {
  const query = { organizationId: command.organizationId, projectId: command.projectId, planId: command.planId,
    taskId: command.taskId, planRevision: command.planRevision }
  const view = integrationView(db, principal, query)
  if (!view.dependenciesReady || !view.inputsReady) throw new OrganizationError('version-conflict')
  if (command.kind === 'verify-integration') {
    if (view.delivered || !sameInputs(command.inputs, view.inputs)) throw new OrganizationError('version-conflict')
    verifyObservation(db, view.inputs, command.observation)
    const plan = selectedPlan(db, principal, query)
    const record = integrationRecordSchema.parse({ ...query, id: randomUUID(), inputs: view.inputs, observation: command.observation,
      operatorId: principal.membershipId,
      issuerId: issuer(db, query, readWorkgraphVersion(db, query.planId, query.planRevision).definition, plan.createdBy),
      createdRevision: revision })
    db.prepare('INSERT INTO organization_integrations VALUES (?,?,?)').run(record.id, query.planId, JSON.stringify(record))
    return { integrationId: record.id, delivered: false }
  }
  const latest = view.latest
  if (!view.canConfirm) throw new OrganizationError('forbidden')
  if (!latest || latest.id !== command.integrationId || latest.observation.result !== 'verified'
    || !sameInputs(latest.inputs, view.inputs) || command.observation.result !== 'verified'
    || command.observation.verifiedAt < latest.observation.verifiedAt) throw new OrganizationError('version-conflict')
  const { verifiedAt: _oldTime, ...old } = latest.observation
  const { verifiedAt: _time, ...current } = command.observation
  if (JSON.stringify(old) !== JSON.stringify(current)) throw new OrganizationError('version-conflict')
  verifyObservation(db, view.inputs, command.observation)
  if (view.delivered) throw new OrganizationError('version-conflict')
  db.prepare('INSERT INTO integration_confirmations VALUES (?,?,?)').run(latest.id, revision, JSON.stringify(command.observation))
  return { integrationId: latest.id, delivered: true }
}
/**
 * Check persisted authors, event/receipt relations, accepted inputs and target bytes metadata.
 * @param db - Database before serving or stopped-service backup.
 */
export function validateIntegrationDatabase(db: DatabaseSync): void {
  if (db.prepare(`SELECT 1 FROM integration_confirmations c JOIN organization_integrations r ON r.id=c.integrationId
    GROUP BY r.planId,json_extract(r.data,'$.taskId'),json_extract(r.data,'$.planRevision') HAVING count(*)>1`).get()) {
    throw new OrganizationError('incompatible-store')
  }
  for (const row of db.prepare('SELECT * FROM organization_integrations').all()) {
    const r = integrationRecordSchema.parse(JSON.parse(String(row.data)))
    const plan = db.prepare('SELECT * FROM organization_plans WHERE id=?').get(r.planId)
    if (row.id !== r.id || row.planId !== r.planId || !plan || plan.organizationId !== r.organizationId || plan.projectId !== r.projectId) throw new OrganizationError('incompatible-store')
    const definition = readWorkgraphVersion(db, r.planId, r.planRevision).definition
    if (issuer(db, r, definition, readWorkgraphVersion(db, r.planId, 1).createdBy) !== r.issuerId) throw new OrganizationError('incompatible-store')
    const inputs = requiredLeaves(definition, r.taskId).map(id => acceptedInput(db, r, id))
    if (inputs.some(i => !i) || !sameInputs(r.inputs, inputs.filter((i): i is Input => !!i))) throw new OrganizationError('incompatible-store')
    for (const input of r.inputs) {
      const s = submissionSchema.parse(JSON.parse(String(db.prepare('SELECT data FROM organization_submissions WHERE id=?').get(input.submissionId)?.data)))
      const acceptance = acceptanceSchema.parse(JSON.parse(String(db.prepare('SELECT data FROM organization_acceptances WHERE submissionId=?').get(s.id)?.data)))
      if (acceptance.createdRevision >= r.createdRevision || s.createdRevision >= r.createdRevision) throw new OrganizationError('incompatible-store')
    }
    verifyObservation(db, r.inputs, r.observation)
    const events = db.prepare('SELECT * FROM integration_events WHERE integrationId=?').all(r.id)
    const confirmation = db.prepare('SELECT * FROM integration_confirmations WHERE integrationId=?').get(r.id)
    if (events.length !== (confirmation ? 2 : 1)) throw new OrganizationError('incompatible-store')
    for (const event of events) {
      const confirmed = event.revision !== r.createdRevision
      const audit = db.prepare('SELECT e.kind,e.organizationId,m.id FROM organization_events e JOIN memberships m ON m.accountId=e.actorId AND m.organizationId=e.organizationId WHERE e.revision=?').get(event.revision ?? null)
      if (audit?.organizationId !== r.organizationId || audit.kind !== (confirmed ? 'confirm-integration' : 'verify-integration') || audit.id !== (confirmed ? r.issuerId : r.operatorId)
        || event.result !== JSON.stringify({ integrationId: r.id, delivered: confirmed }) || confirmed && confirmation?.revision !== event.revision) throw new OrganizationError('incompatible-store')
    }
    if (confirmation) {
      const observation = integrationObservationSchema.parse(JSON.parse(String(confirmation.observation)))
      const { verifiedAt: _time, ...a } = observation, { verifiedAt: _old, ...b } = r.observation
      if (observation.result !== 'verified' || observation.verifiedAt < r.observation.verifiedAt || JSON.stringify(a) !== JSON.stringify(b)) throw new OrganizationError('incompatible-store')
    }
  }
  if (db.prepare('SELECT 1 FROM organization_events e LEFT JOIN integration_events i ON i.revision=e.revision WHERE e.kind IN (\'verify-integration\',\'confirm-integration\') AND i.revision IS NULL').get()) throw new OrganizationError('incompatible-store')
}
