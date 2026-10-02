/** One-use organization permissions at the actual model or filesystem dispatch. */
import { createHash, randomUUID } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { z } from 'zod'
import { executionCommandSchema, executionActionSchema } from '@deepseek-ai/dsh-organization/execution'
import { executionAuthoritySchema, type ExecutionAuthority, type ExecutionResult } from './protocol.ts'

type Command = z.output<typeof executionCommandSchema>
type Capability = z.output<typeof executionActionSchema>['capability']
type Outcome = Exclude<z.output<typeof executionActionSchema>['state'], 'reserved'>
/** Durable local evidence is written before dispatch and before reporting a result. */
export const actionEvidenceSchema = z.object({ action: executionActionSchema,
  file: z.object({ path: z.string().min(1), bytes: z.number().int().nonnegative(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict().optional(),
  stage: z.enum(['reserved', 'issued', 'settled']), outcome: z.enum(['succeeded', 'failed', 'not-issued', 'unknown']).optional(),
  evidenceDigest: z.string().regex(/^[a-f0-9]{64}$/).optional(),
}).strict().superRefine((record, ctx) => {
  if (record.stage === 'settled' ? record.outcome === undefined || record.evidenceDigest === undefined
    : record.outcome !== undefined || record.evidenceDigest !== undefined) {
    ctx.addIssue({ code: 'custom', message: 'settlement evidence required exactly at the settled stage' })
  }
})
/** Fixed native online operation, scoped to the initiating employee and Run. */
export type ExecutionBridge = (command?: Command) => Promise<ExecutionAuthority>
/** Local journal record for one charged attempt. */
export type ActionEvidence = z.output<typeof actionEvidenceSchema>
/**
 * Digest an exact action request or observed result without sharing its contents.
 * @param value - JSON-serializable non-secret data.
 * @returns SHA-256 evidence fingerprint.
 */
export function actionDigest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}
/** Serial, one-use permissions; a failed report never repeats an external effect. */
export class ActionGuard {
  private readonly owner: ExecutionAuthority
  private attempts = 0
  private halted = false
  private tail: Promise<void> = Promise.resolve()
  private readonly deadline: number
  constructor(private readonly binding: ExecutionResult, authority: ExecutionAuthority,
    private readonly bridge: ExecutionBridge, private readonly record: (evidence: ActionEvidence) => Promise<void>,
    private readonly signal: AbortSignal, private readonly limits: { maxActions: number; maxDurationMs: number }) {
    this.owner = authority
    this.deadline = performance.now() + limits.maxDurationMs
  }
  private check(): void {
    this.signal.throwIfAborted()
    if (this.halted) throw new Error('organization-execution: reconciliation-required')
    if (performance.now() >= this.deadline) throw new Error('organization-execution: duration-limit')
  }
  private validate(authority: ExecutionAuthority): void {
    const expected = this.binding.run, actual = authority.execution.run
    if (authority.generation !== this.owner.generation || authority.serverId !== this.owner.serverId
      || authority.accountId !== this.owner.accountId || !authority.execution.eligible || actual.state !== 'running'
      || actual.id !== expected.id || actual.assignmentId !== expected.assignmentId
      || actual.executionDelegationId !== expected.executionDelegationId || actual.deviceId !== expected.deviceId
      || actual.serverEpoch !== expected.serverEpoch || actual.fencingEpoch !== expected.fencingEpoch
      || actual.planRevision !== expected.planRevision || authority.task.revision !== expected.planRevision
      || authority.task.id !== this.binding.snapshot.id || actual.configDigest !== expected.configDigest) throw new Error('organization-execution: authority-lost')
  }
  /**
   * Recheck the current lease and identity; never returns a cached permission.
   * @returns Completion when the Run is still eligible.
   */
  async checkOnline(): Promise<void> {
    this.check()
    this.validate(executionAuthoritySchema.parse(await this.bridge()))
    this.check()
  }
  private command(fields: object): Command {
    const { id, state: _state, version: _version, createdRevision: _created,
      configDigest: _digest, backend: _backend, startedAt: _startedAt, stopReason: _stopReason, ...selector } = this.binding.run
    return executionCommandSchema.parse({ ...selector, runId: id, operationId: randomUUID(), ...fields })
  }
  /**
   * Reserve, durably mark and execute one actual attempt after a final online recheck.
   * @param capability - Actual consumer capability, never a tool-name inference.
   * @param request - Exact request included in the permit digest.
   * @param dispatch - Consumer that resolves resources, awaits issue(), then checks and dispatches without another await.
   * @param classify - Outcome derived from the observed result, separate from transport exceptions.
   * @returns The observed result only after local evidence and authority settlement succeed.
   */
  perform<T>(capability: Capability, request: unknown, dispatch: (issue: () => Promise<() => void>) => Promise<T>,
    classify: (value: T) => 'succeeded' | 'failed'): Promise<T> {
    const pending = this.tail.then(() => this.execute(capability, request, dispatch, classify)).catch((error: unknown) => {
      this.halted = true
      throw error
    })
    this.tail = pending.then(() => {}, () => {})
    return pending
  }
  private async execute<T>(capability: Capability, request: unknown, dispatch: (issue: () => Promise<() => void>) => Promise<T>,
    classify: (value: T) => 'succeeded' | 'failed'): Promise<T> {
    this.check()
    if (!this.binding.inputs.capabilities.includes(capability)) throw new Error('organization-execution: capability-denied')
    if (this.attempts >= this.limits.maxActions) throw new Error('organization-execution: action-limit')
    await this.checkOnline()
    const actionId = randomUUID(), requestDigest = actionDigest(request)
    const fileRequest = capability === 'fs-write' ? z.object({ path: z.string(), content: z.string() }).parse(request) : undefined
    const file = fileRequest ? { path: fileRequest.path, bytes: Buffer.byteLength(fileRequest.content),
      sha256: createHash('sha256').update(fileRequest.content).digest('hex') } : undefined
    const evidence = file ? { file } : {}
    let approvalId: string | undefined
    if (capability === 'fs-write' && this.binding.inputs.requireWriteApproval) {
      const current = await this.bridge()
      const approval = current.execution.humanRequests.find(h => h.kind === 'tool-approval' && h.requestDigest === requestDigest
        && h.state === 'approved' && h.expiresAt > current.execution.serverTime
        && !current.execution.actions.some(a => a.approvalId === h.id))
      if (!approval) {
        if (!current.execution.assigneeId) throw new Error('organization-execution: handler-required')
        await this.bridge(this.command({ kind: 'request-execution-human', requestId: randomUUID(),
          handlerId: current.execution.assigneeId, requestKind: 'tool-approval', prompt: 'Approve the pending file replacement.',
          actionId: null, requestDigest, expiresAt: current.execution.delegation.expiresAt }))
        throw new Error('organization-execution: waiting-human')
      }
      approvalId = approval.id
    }
    // Count ambiguous reservation responses against the local ceiling too.
    this.attempts++
    const started = performance.now()
    const authority = executionAuthoritySchema.parse(await this.bridge(this.command({ kind: 'reserve-action', actionId, capability, requestDigest, ...(approvalId ? { approvalId } : {}) })))
    const action = authority.execution.actions.find(item => item.actionId === actionId)
    if (!action || action.runId !== this.binding.run.id || action.requestDigest !== requestDigest || action.capability !== capability
      || action.state !== 'reserved') throw new Error('organization-execution: permit-unconfirmed')
    const expires = started + (action.expiresAt - authority.execution.serverTime)
    const check = () => { this.check(); if (performance.now() >= expires) throw new Error('organization-execution: permit-expired') }
    const dispatchState = { issued: false }
    let outcome: Outcome = 'not-issued'
    let evidenceDigest = actionDigest({ outcome })
    let value: T
    try {
      await this.record({ action, ...evidence, stage: 'reserved' })
      this.validate(authority); check()
      let issuing = false
      const issue = async () => {
        if (issuing) throw new Error('organization-execution: permit-already-used')
        issuing = true
        const final = executionAuthoritySchema.parse(await this.bridge())
        this.validate(final)
        const current = final.execution.actions.find(item => item.actionId === actionId)
        if (!current || current.state !== 'reserved' || current.requestDigest !== requestDigest) throw new Error('organization-execution: permit-revoked')
        check()
        // A crash from this point is unknown even if the syscall had not begun.
        await this.record({ action, ...evidence, stage: 'issued' }); check()
        dispatchState.issued = true
        return check
      }
      value = await dispatch(issue)
      if (!dispatchState.issued) throw new Error('organization-execution: consumer-did-not-issue')
      outcome = classify(value); evidenceDigest = actionDigest(value)
    } catch (error) {
      outcome = dispatchState.issued ? 'unknown' : 'not-issued'
      evidenceDigest = actionDigest({ outcome })
      await this.record({ action, ...evidence, stage: 'settled', outcome, evidenceDigest })
      // If cancellation or expiry prevents a not-issued report, retain the local fact;
      // the server's charged unknown record must be reconciled, never refunded here.
      await this.bridge(this.command({ kind: 'settle-action', actionId, outcome, evidenceDigest })).catch((_reportError: unknown) => { /* The durable local settlement remains pending server reconciliation. */ })
      throw error
    }
    await this.record({ action, ...evidence, stage: 'settled', outcome, evidenceDigest })
    await this.bridge(this.command({ kind: 'settle-action', actionId, outcome, evidenceDigest }))
    return value
  }
  /**
   * Wait until every admitted consumer has stopped and its evidence write has settled.
   * @returns Quiescence; does not claim that unknown effects were rolled back.
   */
  async drain(): Promise<void> { await this.tail }
}
