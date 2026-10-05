import { requireDependencies } from './integration.ts'
/** Transaction-local execution permission, budgets and historical settlement. */
import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { z } from 'zod'
import { membershipSchema, accountSchema } from './schema.ts'
import { OrganizationError } from './error.ts'
import { selectedAssignment, assignmentInvalidation, authorizeAssignmentRead } from './assignment.ts'
import { authorizeParticipant } from './assignment-participant.ts'
import { executionHumanSchema } from './execution-human-schema.ts'
import { executionRunSchema, executionDelegationSchema, executionActionSchema, type executionCommandSchema, type executionReadSchema } from './execution-schema.ts'
import type { Principal } from './types.ts'
import type { OrganizationExecutionReceipt, OrganizationExecutionView } from './execution-types.ts'

type Command = z.output<typeof executionCommandSchema>
const fail = (): never => { throw new OrganizationError('version-conflict') }
const terminal = (state: string) => ['succeeded', 'failed', 'cancelled'].includes(state)
function read<T>(db: DatabaseSync, table: string, id: string, schema: z.ZodType<T>): T {
  const row = db.prepare(`SELECT data FROM ${table} WHERE id=?`).get(id)
  if (!row) throw new OrganizationError('forbidden')
  return schema.parse(JSON.parse(String(row.data)))
}
function save(db: DatabaseSync, table: string, id: string, data: object): void {
  db.prepare(`UPDATE ${table} SET data=? WHERE id=?`).run(JSON.stringify(data), id)
}
function grant(db: DatabaseSync, command: Exclude<Command, { kind: 'grant-execution' }>) {
  const d = read(db, 'execution_delegations', command.executionDelegationId, executionDelegationSchema)
  if (d.assignmentId !== command.assignmentId || d.planRevision !== command.planRevision) throw new OrganizationError('forbidden')
  return d
}
function qualify(db: DatabaseSync, principal: Principal, d: z.output<typeof executionDelegationSchema>) {
  const a = selectedAssignment(db, d)
  authorizeParticipant(db, principal, a)
  if (a.state !== 'accepted' || assignmentInvalidation(db, a) || a.planRevision !== d.planRevision
    || d.state !== 'active' || d.expiresAt <= Date.now()) fail()
  requireDependencies(db, principal, { organizationId: a.organizationId, projectId: a.projectId,
    planId: a.planId, taskId: a.taskId, planRevision: a.planRevision })
  return a
}
function owner(db: DatabaseSync, principal: Principal, d: z.output<typeof executionDelegationSchema>) {
  return qualify(db, principal, d)
}
/**
 * Apply an authenticated execution command inside the authority receipt transaction.
 * @param db - Authority transaction.
 * @param principal - Fresh authenticated employee.
 * @param c - Strict execution command.
 * @param revision - Mutation audit position.
 * @param limits - Validated execution limits.
 * @returns Stable identities, never a reusable authorization.
 */
export function changeExecution(db: DatabaseSync, principal: Principal, c: Command, revision: number,
  limits: { actionPermitTtlMs: number; executionMaxBudget: number; executionMaxDurationMs: number; executionCodex: OrganizationExecutionView['codexPolicy'] }): OrganizationExecutionReceipt {
  const a = selectedAssignment(db, c)
  authorizeParticipant(db, principal, a)
  if (c.kind === 'grant-execution') {
    if (a.state !== 'accepted' || assignmentInvalidation(db, a) || a.planRevision !== c.planRevision) fail()
    if (c.expiresAt <= Date.now() || c.expiresAt - Date.now() > limits.executionMaxDurationMs
      || c.budget > limits.executionMaxBudget) throw new OrganizationError('invalid-input')
    if (c.backend !== undefined) {
      requireCodexPolicy(c.backend, limits.executionCodex)
      if (c.capabilities.length !== 1 || c.capabilities[0] !== 'codex-turn' || c.budget > c.backend.maxTurns
        || c.backend.maxDurationMs > limits.executionMaxDurationMs) throw new OrganizationError('invalid-input')
    } else if (c.capabilities.includes('codex-turn')) throw new OrganizationError('invalid-input')
    const { kind: _kind, operationId: _operation, ...fields } = c
    const d = executionDelegationSchema.parse({ ...fields, id: randomUUID(), state: 'active', used: 0, createdRevision: revision, version: revision })
    db.prepare('INSERT INTO execution_delegations VALUES (?,?,?)').run(d.id, a.id, JSON.stringify(d))
    return { executionDelegationId: d.id }
  }
  const d = grant(db, c)
  if (c.kind === 'revoke-execution') {
    if (d.state !== 'active') fail()
    save(db, 'execution_delegations', d.id, { ...d, state: 'revoked', version: revision })
    return { executionDelegationId: d.id }
  }
  if (c.kind === 'create-run') {
    owner(db, principal, d)
    if (JSON.stringify(c.backend) !== JSON.stringify(d.backend)) throw new OrganizationError('forbidden')
    if (d.backend !== undefined) requireCodexPolicy(d.backend, limits.executionCodex)
    if (c.configDigest !== d.configDigest) throw new OrganizationError('forbidden')
    if (db.prepare("SELECT 1 FROM execution_runs WHERE assignmentId=? AND json_extract(data,'$.state') IN ('prepared','running','paused','waiting-human')").get(a.id)) fail()
    const { kind: _kind, operationId: _operation, ...fields } = c
    const run = executionRunSchema.parse({ ...fields, id: randomUUID(), state: 'prepared', ...c.backend === undefined ? {} : { startedAt: null, stopReason: null }, createdRevision: revision, version: revision })
    db.prepare('INSERT INTO execution_runs VALUES (?,?,?,?)').run(run.id, a.id, d.id, JSON.stringify(run))
    return { executionDelegationId: d.id, runId: run.id }
  }
  const run = read(db, 'execution_runs', c.runId, executionRunSchema)
  if (run.assignmentId !== a.id || run.executionDelegationId !== d.id) throw new OrganizationError('forbidden')
  const result = { executionDelegationId: d.id, runId: run.id }
  if (c.kind === 'settle-action') {
    const action = read(db, 'execution_actions', c.actionId, executionActionSchema)
    if (action.runId !== run.id) throw new OrganizationError('forbidden')
    if (action.state === c.outcome && action.evidenceDigest === c.evidenceDigest) return { ...result, actionId: action.actionId }
    if (action.state !== 'reserved' && !(action.state === 'unknown' && ['succeeded', 'failed', 'not-issued'].includes(c.outcome))) fail()
    // Historical action evidence never refunds budget or reactivates permission.
    save(db, 'execution_actions', action.actionId, { ...action, state: c.outcome, evidenceDigest: c.evidenceDigest, version: revision })
    return { ...result, actionId: action.actionId }
  }
  if (c.kind === 'request-execution-human') {
    owner(db, principal, d)
    if (run.state !== 'running' || c.expiresAt <= Date.now() || c.expiresAt - Date.now() > limits.executionMaxDurationMs) fail()
    if (![a.assigneeId, a.approvedBy].includes(c.handlerId)
      || (c.requestKind === 'tool-approval' && (c.handlerId !== a.assigneeId || !c.requestDigest))) throw new OrganizationError('forbidden')
    const handler = membershipSchema.parse(db.prepare('SELECT * FROM memberships WHERE id=?').get(c.handlerId))
    const account = accountSchema.parse(db.prepare('SELECT * FROM accounts WHERE id=?').get(handler.accountId))
    if (!handler.enabled || !account.enabled) throw new OrganizationError('forbidden')
    authorizeAssignmentRead(db, { ...principal, membershipId: c.handlerId, accountId: handler.accountId, role: handler.role }, a)
    if (c.actionId && read(db, 'execution_actions', c.actionId, executionActionSchema).runId !== run.id) throw new OrganizationError('forbidden')
    const human = executionHumanSchema.parse({ id: c.requestId, assignmentId: a.id, runId: run.id, planRevision: run.planRevision,
      handlerId: c.handlerId, kind: c.requestKind, prompt: c.prompt, actionId: c.actionId, requestDigest: c.requestDigest,
      state: 'pending', expiresAt: c.expiresAt, answer: null, createdRevision: revision, version: revision, answeredRevision: null })
    db.prepare('INSERT INTO execution_human_requests VALUES (?,?,?,?)').run(human.id, a.id, run.id, JSON.stringify(human))
    save(db, 'execution_runs', run.id, { ...run, state: 'waiting-human', version: revision })
    return { ...result, requestId: human.id }
  }
  if (c.kind === 'resume-run') {
    owner(db, principal, d)
    requireNativeDispatch(db, run, limits.executionCodex)
    if (!['paused', 'waiting-human'].includes(run.state) || d.used >= d.budget
      || db.prepare("SELECT 1 FROM execution_actions WHERE runId=? AND json_extract(data,'$.state') IN ('reserved','unknown')").get(run.id)
      || db.prepare("SELECT 1 FROM execution_human_requests WHERE runId=? AND json_extract(data,'$.state') NOT IN ('answered','approved','denied')").get(run.id)) fail()
    save(db, 'execution_runs', run.id, { ...run, state: 'running', ...run.backend === undefined ? {} : { startedAt: run.startedAt ?? Date.now(), stopReason: null }, version: revision })
    return result
  }
  if (c.kind === 'transition-run') {
    if (terminal(run.state)) fail()
    if (run.state === 'waiting-human' && c.state === 'paused') return result
    // The employee can stop a historical Run after its execution permission expires.
    if (c.state === 'running') { owner(db, principal, d); requireNativeDispatch(db, run, limits.executionCodex); if (run.state !== 'prepared') fail() }
    if (['succeeded', 'failed'].includes(c.state) && (run.state !== 'running'
      || db.prepare("SELECT 1 FROM execution_actions WHERE runId=? AND json_extract(data,'$.state') IN ('reserved','unknown')").get(run.id))) fail()
    save(db, 'execution_runs', run.id, { ...run, state: c.state, ...run.backend === undefined ? {} : {
      startedAt: run.startedAt ?? (c.state === 'running' ? Date.now() : null),
      stopReason: c.state === 'running' ? null : c.stopReason ?? (terminal(c.state) ? 'native-terminal' : 'employee-stop'),
    }, version: revision })
    return result
  }
  owner(db, principal, d)
  if (run.state !== 'running' || !d.capabilities.includes(c.capability)) fail()
  if ((run.backend !== undefined) !== (c.capability === 'codex-turn')) throw new OrganizationError('forbidden')
  const old = db.prepare('SELECT data FROM execution_actions WHERE id=?').get(c.actionId)
  if (old) {
    const action = executionActionSchema.parse(JSON.parse(String(old.data)))
    if (action.runId !== run.id || action.capability !== c.capability || action.requestDigest !== c.requestDigest || action.approvalId !== c.approvalId) throw new OrganizationError('operation-conflict')
    return { ...result, actionId: action.actionId }
  }
  if (run.backend !== undefined) {
    requireNativeDispatch(db, run, limits.executionCodex)
    if (db.prepare("SELECT 1 FROM execution_actions WHERE runId=? AND json_extract(data,'$.state') IN ('reserved','unknown')").get(run.id)) fail()
  }
  if (c.approvalId) {
    const approval = read(db, 'execution_human_requests', c.approvalId, executionHumanSchema)
    if (c.capability !== 'fs-write' || approval.runId !== run.id || approval.kind !== 'tool-approval' || approval.state !== 'approved'
      || approval.expiresAt <= Date.now() || approval.requestDigest !== c.requestDigest
      || db.prepare("SELECT 1 FROM execution_actions WHERE json_extract(data,'$.approvalId')=?").get(approval.id)) fail()
  }
  if (d.used >= d.budget) fail()
  const { kind: _kind, operationId: _operation, ...fields } = c
  const action = executionActionSchema.parse({ ...fields, state: 'reserved', evidenceDigest: null,
    expiresAt: Math.min(Date.now() + limits.actionPermitTtlMs, d.expiresAt), createdRevision: revision,
    version: revision })
  db.prepare('INSERT INTO execution_actions VALUES (?,?,?)').run(action.actionId, run.id, JSON.stringify(action))
  save(db, 'execution_delegations', d.id, { ...d, used: d.used + 1, version: revision })
  if (run.backend !== undefined && (d.used + 1 >= d.budget
    || Number(db.prepare('SELECT count(*) AS n FROM execution_actions WHERE runId=?').get(run.id)?.n) >= run.backend.maxTurns)) {
    save(db, 'execution_runs', run.id, { ...run, stopReason: 'turn-limit', version: revision })
  }
  return { ...result, actionId: action.actionId }
}
/**
 * Read a current-authority summary and separately determine whether new actions are eligible.
 * @param db - Authority transaction.
 * @param principal - Current task reader.
 * @param query - Exact Run selector.
 * @param modelPolicy - Current deployment-approved outbound model routes.
 * @param codexPolicy - Current deployment-approved native scheduling limits.
 * @returns Shared metadata only; no full local log.
 */
export function readExecution(db: DatabaseSync, principal: Principal, query: z.output<typeof executionReadSchema>,
  modelPolicy: OrganizationExecutionView['modelPolicy'], codexPolicy: OrganizationExecutionView['codexPolicy']): OrganizationExecutionView {
  const a = selectedAssignment(db, query)
  authorizeAssignmentRead(db, principal, a)
  const run = read(db, 'execution_runs', query.runId, executionRunSchema)
  if (run.assignmentId !== a.id) throw new OrganizationError('forbidden')
  const delegation = read(db, 'execution_delegations', run.executionDelegationId, executionDelegationSchema)
  let nativeActive = false
  try {
    owner(db, principal, delegation)
    if (run.backend !== undefined) {
      requireCodexPolicy(run.backend, codexPolicy)
      nativeActive = run.state === 'running' && run.startedAt != null
        && Date.now() - run.startedAt < run.backend.maxDurationMs
    }
  } catch (error) { if (!(error instanceof OrganizationError)) throw error }
  let eligible = false
  try { owner(db, principal, delegation); requireNativeDispatch(db, run, codexPolicy); eligible = ['prepared', 'running', 'paused', 'waiting-human'].includes(run.state) }
  catch (error) { if (!(error instanceof OrganizationError)) throw error }
  const actions = db.prepare('SELECT data FROM execution_actions WHERE runId=? ORDER BY rowid').all(run.id)
    .map(row => executionActionSchema.parse(JSON.parse(String(row.data))))
  const humanRequests = db.prepare('SELECT data FROM execution_human_requests WHERE runId=? ORDER BY rowid').all(run.id)
    .map(row => executionHumanSchema.parse(JSON.parse(String(row.data))))
  return { run, delegation, actions, humanRequests, assigneeId: a.assigneeId, approvedBy: a.approvedBy,
    serverTime: Date.now(), eligible, nativeActive, modelPolicy, codexPolicy }
}
/**
 * Retire stale execution authority and mark unconfirmed attempts unknown without refunding.
 * @param db - Same transaction as qualification changes or restart.
 * @param revision - Causing audit position.
 * @param restart - Whether all nonterminal Runs must pause after service activation.
 */
export function invalidateExecution(db: DatabaseSync, revision: number, restart = false): void {
  for (const row of db.prepare('SELECT data FROM execution_delegations').all()) {
    const d = executionDelegationSchema.parse(JSON.parse(String(row.data)))
    if (d.state === 'active' && (selectedAssignment(db, d).state !== 'accepted' || assignmentInvalidation(db, selectedAssignment(db, d)) || d.expiresAt <= Date.now())) {
      save(db, 'execution_delegations', d.id, { ...d, state: d.expiresAt <= Date.now() ? 'expired' : 'invalidated', version: revision })
    }
  }
  for (const row of db.prepare('SELECT data FROM execution_runs').all()) {
    const run = executionRunSchema.parse(JSON.parse(String(row.data)))
    const d = read(db, 'execution_delegations', run.executionDelegationId, executionDelegationSchema)
    const expired = run.backend !== undefined && run.startedAt != null && Date.now() - run.startedAt >= run.backend.maxDurationMs
    const lost = restart || expired || d.state !== 'active'
    const stopReason = expired ? 'duration-limit' : 'authority-lost'
    const shouldPause = run.backend === undefined ? ['prepared', 'running'].includes(run.state)
      : !terminal(run.state) && (run.state !== 'paused' || run.stopReason !== stopReason)
    if (lost && shouldPause) save(db, 'execution_runs', run.id, { ...run, state: 'paused',
      ...run.backend === undefined ? {} : { stopReason }, version: revision })
    for (const item of db.prepare('SELECT data FROM execution_actions WHERE runId=?').all(run.id)) {
      const action = executionActionSchema.parse(JSON.parse(String(item.data)))
      if (action.state === 'reserved' && (lost || terminal(run.state) || run.state === 'paused' || action.expiresAt <= Date.now())) {
        save(db, 'execution_actions', action.actionId, { ...action, state: 'unknown', version: revision })
      }
    }
  }
  for (const row of db.prepare('SELECT data FROM execution_human_requests').all()) {
    const human = executionHumanSchema.parse(JSON.parse(String(row.data)))
    const a = selectedAssignment(db, read(db, 'execution_runs', human.runId, executionRunSchema))
    const run = read(db, 'execution_runs', human.runId, executionRunSchema)
    if (human.state === 'pending' && (human.expiresAt <= Date.now() || assignmentInvalidation(db, a) || a.state !== 'accepted' || terminal(run.state)
      || run.backend !== undefined && ['authority-lost', 'duration-limit', 'employee-stop'].includes(run.stopReason ?? ''))) {
      save(db, 'execution_human_requests', human.id, { ...human, state: human.expiresAt <= Date.now() ? 'expired' : 'cancelled', version: revision })
    }
  }
}

function requireCodexPolicy(backend: NonNullable<OrganizationExecutionView['run']['backend']>, policy: OrganizationExecutionView['codexPolicy']): void {
  if (!policy.some(entry => entry.model === backend.model
    && entry.efforts.includes(backend.effort) && backend.maxTurns <= entry.maxTurns
    && backend.maxDurationMs <= entry.maxDurationMs)) throw new OrganizationError('forbidden')
}
function requireNativeDispatch(db: DatabaseSync, run: OrganizationExecutionView['run'], policy: OrganizationExecutionView['codexPolicy']): void {
  if (run.backend === undefined) return
  requireCodexPolicy(run.backend, policy)
  const turns = Number(db.prepare('SELECT count(*) AS n FROM execution_actions WHERE runId=?').get(run.id)?.n)
  if (turns >= run.backend.maxTurns || (run.startedAt != null && Date.now() - run.startedAt >= run.backend.maxDurationMs)) fail()
}
