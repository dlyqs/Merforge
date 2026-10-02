/** Isolated, durable Run/Session coordination and restricted execution intervals. */
import { runCodexExecution, nativeLimitsSchema } from './codex.ts'
import { nativeJournal, nativeBaseline, nativeItemEntry, nativeRequestEntry } from './codex-journal.ts'
import type { CodexRuntimeLimits } from '@deepseek-ai/dsh-codex-runtime'
import type {} from '@deepseek-ai/dsh-subprocess'
import { inspectDirectory, inspectActions } from './recovery.ts'
import { localModelSchema, executionAdapter } from './model.ts'
import { createHash, randomUUID } from 'node:crypto'
import type { LlmAdapter } from '@deepseek-ai/dsh-llm'
import { runExecution, type RuntimeLimits } from './runtime.ts'
import { executionCommandSchema } from '@deepseek-ai/dsh-organization/execution'
import { actionEvidenceSchema, type ActionEvidence, type ExecutionBridge } from './action-guard.ts'
import { Context, Service } from '@deepseek-ai/cordis'
import { z } from 'zod'
import { defineDomain, type DomainGlobal } from '@deepseek-ai/dsh-storage-domain'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { SESSION_FORMAT_VERSION, SessionId, SessionSeq, type SessionEvent } from '@deepseek-ai/dsh-session'
import { executionReportRequestSchema, executionReadAuthoritySchema, executionReportSchema,
  type ExecutionReportRequest, type ExecutionReadAuthority, type ExecutionReport, executionInputsSchema, executionRequestSchema,
  executionAuthoritySchema, executionBindingSchema, executionResultSchema,
  type ExecutionRequest, type ExecutionAuthority, type ExecutionResult } from './protocol.ts'
export * from './protocol.ts'
declare module '@deepseek-ai/cordis' { interface Context { organizationExecution: OrganizationExecution } }
declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Immutable Run, original-context and exact-task linkage owned by this private log. */
    'organization/execution-binding': z.output<typeof executionBindingSchema>
  }
}
const bindingSchema = executionResultSchema.extend({ createdAt: z.number().int().nonnegative(), state: z.enum(['reserved', 'ready', 'executing', 'stopped']) }).strict()
const stateSchema = z.object({ bindings: z.array(bindingSchema), operations: z.array(z.object({ operationId: z.uuid(),
  key: z.string(), digest: z.string() }).strict()) }).strict()
const spec = defineDomain({ name: 'organization_execution', version: 1, tables: {}, global: { schema: stateSchema, initial: { bindings: [], operations: [] } } })
/** Deployment-owned isolated JSONL directory. */
export interface Config {
  /** Dedicated JSONL directory outside personal and pre-execution Session roots. */
  root: string
  /** Optional deployment ceilings; omission keeps actual execution disabled. */
  executionLimits?: RuntimeLimits
  /** Explicit local text model routes and credential destinations. */
  models?: z.output<typeof localModelSchema>[]
  /** Explicit native protocol limits; omission keeps Codex execution disabled. */
  codex?: CodexRuntimeLimits
}
/**
 * Hash exactly the non-secret, validated configuration and inputs retained in the local log.
 * @param inputs - Parsed employee selection.
 * @returns Shared digest; does not disclose local materials or model text.
 */
export function executionInputsDigest(inputs: ExecutionRequest['inputs']): string { return createHash('sha256').update(JSON.stringify(executionInputsSchema.parse(inputs))).digest('hex') }
/** Private local Run coordinator; execution requires an explicit application-owned adapter and deployment limits. */
export default class OrganizationExecution extends Service {
  static inject = ['storageDomain']
  static Config = z.object({ root: z.string().min(1), executionLimits: z.object({
    maxActions: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    maxSteps: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    maxDurationMs: z.number().int().positive().max(2147483647),
    maxBytes: z.number().int().positive().max(2147483647),
    recheckMs: z.number().int().positive().max(2147483647),
  }).strict().optional(), models: z.array(localModelSchema).max(100).optional(), codex: nativeLimitsSchema.optional() }).strict()
  private readonly isolated = new Context()
  private state?: DomainGlobal<z.output<typeof stateSchema>>
  private tail: Promise<void> = Promise.resolve()
  private closing = false
  private readonly running = new Set<AbortController>()
  private readonly reports = new Set<Promise<ExecutionReport>>()
  constructor(ctx: Context, private readonly config: Config) { super(ctx, 'organizationExecution') }
  protected async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(spec)
    this.state = domain.global
    this.ctx.effect(() => async () => { this.closing = true; for (const run of this.running) run.abort(); await this.tail; await Promise.allSettled([...this.reports]); await this.isolated.fiber.dispose(); await domain.close() }, 'organization-execution.close')
    await this.isolated.plugin(JsonlSessionPersistence, { root: this.config.root, compression: 'none', namespace: 'organization-execution' })
    await this.verifyBindings()
  }
  /**
   * Prepare or reopen the same isolated Run without activating a model or tool.
   * @param input - Strict Run selector and explicit local inputs.
   * @param authorize - Native online qualification, identity and task read.
   * @param signal - Request/window/generation cancellation.
   * @returns Durable prepared context after a final online check.
   */
  open(input: ExecutionRequest, authorize: () => Promise<ExecutionAuthority>, signal: AbortSignal): Promise<ExecutionResult> {
    const request = executionRequestSchema.parse(input)
    const run = this.tail.then(() => this.openCurrent(request, authorize, signal))
    this.tail = run.then(() => {}, () => {})
    return run.catch((error: unknown) => {
      this.ctx.logger.info('organization component=execution operationId=%s runId=%s result=reconcile-required', request.operationId, request.runId)
      throw error
    })
  }
  /**
   * Run one interval using an application-owned model adapter and explicit local limits.
   * @param request - Immutable employee inputs for this prepared Run.
   * @param bridge - Private native commands and fresh online qualification.
   * @param runtime - Application-resolved model adapter and employee-selected workspace.
   * @param signal - Native identity and request lifetime.
   * @returns Completion after local consumers and persistence reach quiescence.
   */
  async execute(request: ExecutionRequest, bridge: ExecutionBridge,
    runtime: { adapter: LlmAdapter; directory: string }, signal: AbortSignal): Promise<void> {
    if (request.inputs.backend) throw new Error('organization-execution: native-selection-mismatch')
    return this.executeInterval(request, bridge, { kind: 'api', ...runtime }, signal)
  }
  private async executeInterval(request: ExecutionRequest, bridge: ExecutionBridge,
    runtime: { kind: 'api'; adapter: LlmAdapter; directory: string } | { kind: 'codex'; directory: string }, signal: AbortSignal): Promise<void> {
    const deployment = this.config.executionLimits
    if (!deployment) throw new Error('organization-execution: execution-disabled')
    const selection = executionRequestSchema.parse(request).inputs.execution
    if (!selection || selection.directory !== runtime.directory || selection.maxActions > deployment.maxActions
      || (!request.inputs.backend && selection.maxSteps > deployment.maxSteps) || selection.maxDurationMs > deployment.maxDurationMs) {
      throw new Error('organization-execution: explicit-local-authorization-required')
    }
    const limits: RuntimeLimits = { ...deployment, maxActions: selection.maxActions, maxSteps: selection.maxSteps,
      maxDurationMs: selection.maxDurationMs }
    const prepared = await this.open(request, () => bridge(), signal)
    if (this.closing) throw new Error('organization-execution: unavailable')
    const cancel = new AbortController(), lifetime = AbortSignal.any([signal, cancel.signal])
    this.running.add(cancel)
    let requests: Promise<void> = Promise.resolve()
    const online: ExecutionBridge = (command) => {
      const response = requests.then(() => bridge(command))
      requests = response.then(() => {}, () => {})
      return response
    }
    const execute = this.tail.then(async () => {
      const state = this.state
      if (!state || this.closing) throw new Error('organization-execution: unavailable')
      const saved = state.get(), binding = saved.bindings.find(item => item.sessionId === prepared.sessionId)
      if (!binding || (!request.resume && binding.state !== 'ready') || (request.resume && !['stopped', 'executing'].includes(binding.state))) throw new Error('organization-execution: explicit-reconciliation-required')
      const { id, state: _state, version: _version, createdRevision: _created,
        configDigest: _digest, backend: _backend, startedAt: _startedAt, stopReason: _stopReason, ...selector } = prepared.run
      const transition = (status: 'running' | 'paused' | 'succeeded' | 'failed') => online(executionCommandSchema.parse({
        ...selector, runId: id, kind: 'transition-run', state: status, operationId: randomUUID(),
      }))
      if (request.resume && !request.inputs.backend
        && !await this.reconcileActions(prepared, online, request.resume.baselineDigest, limits.maxBytes, lifetime)) {
        throw new Error('organization-execution: reconciliation-required')
      }
      await state.set({ ...saved, bindings: saved.bindings.map(item => item.sessionId === prepared.sessionId ? { ...item, state: 'executing' } : item) })
      try {
        const authority = executionAuthoritySchema.parse(await (request.resume
          ? online(executionCommandSchema.parse({ ...selector, runId: id, kind: 'resume-run', operationId: randomUUID() }))
          : transition('running')))
        lifetime.throwIfAborted()
        const result = runtime.kind === 'codex'
          ? await this.nativeInterval(prepared, authority, online, limits, lifetime, request.resume)
          : await runExecution(prepared, authority, online, runtime.adapter, this.config.root, runtime.directory,
            limits, lifetime, request.resume?.baselineDigest)
        if (result === 'completed') await transition('succeeded')
        else if (result === 'failed') await transition('failed')
      } catch (error) {
        // Stopping cannot restore an old lease; failed transport leaves authority reconciliation pending.
        await transition('paused').catch((stopError: unknown) => {
          this.ctx.logger.info('organization component=execution runId=%s result=stop-unconfirmed decisionCode=%s',
            prepared.run.id, stopError instanceof Error ? stopError.name : 'Error')
        })
        throw error
      } finally {
        const current = state.get()
        await state.set({ ...current, bindings: current.bindings.map(item => item.sessionId === prepared.sessionId ? { ...item, state: 'stopped' } : item) })
      }
    })
    const settled = execute.finally(() => { this.running.delete(cancel) })
    this.tail = settled.then(() => {}, () => {})
    return settled
  }
  /**
   * Report historical device evidence without granting permission or starting a model.
   * @param request - Original inputs and explicitly reviewed local baseline.
   * @param bridge - Fresh native task read and historical device settlement channel.
   * @param signal - Native request and identity lifetime.
   * @returns Original local binding after evidence reporting; unresolved effects remain unknown.
   */
  async reconcile(request: ExecutionRequest, bridge: ExecutionBridge, signal: AbortSignal): Promise<ExecutionResult> {
    if (!request.reconcile || !request.resume || request.start) throw new Error('organization-execution: invalid-reconciliation')
    const prepared = await this.open(request, () => bridge(), signal)
    const limits = this.config.executionLimits
    if (!limits) throw new Error('organization-execution: execution-disabled')
    const cancel = new AbortController(), lifetime = AbortSignal.any([signal, cancel.signal])
    this.running.add(cancel)
    const baseline = request.resume.baselineDigest
    const work = this.tail.then(async () => {
      if (this.closing) throw new Error('organization-execution: unavailable')
      if (request.inputs.backend) {
        await this.nativeInterval(prepared, await bridge(), bridge, limits, lifetime, { baselineDigest: baseline }, true)
        const reader = await this.isolated.sessionPersistence.open(prepared.sessionId, 'read')
        try {
          const facts = inspectActions((await reader.read()).events, await bridge())
          for (const record of facts.settlements) {
            const { id, state: _state, version: _version, createdRevision: _created, configDigest: _digest,
              backend: _backend, startedAt: _started, stopReason: _stop, ...selector } = prepared.run
            await bridge(executionCommandSchema.parse({ ...selector, runId: id, kind: 'settle-action', operationId: randomUUID(),
              actionId: record.action.actionId, outcome: record.outcome, evidenceDigest: record.evidenceDigest }))
          }
        } finally { await reader.close() }
      } else await this.reconcileActions(prepared, bridge, baseline, limits.maxBytes, lifetime)
      return prepared
    }).finally(() => { this.running.delete(cancel) })
    this.tail = work.then(() => {}, () => {})
    return work
  }
  private async reconcileActions(binding: ExecutionResult, online: ExecutionBridge, baseline: string,
    maxBytes: number, signal: AbortSignal): Promise<boolean> {
    signal.throwIfAborted()
    if (!binding.inputs.execution) throw new Error('organization-execution: explicit-local-authorization-required')
    const observed = await inspectDirectory(binding.inputs.execution.directory, maxBytes)
    if (observed.digest !== baseline) throw new Error('organization-execution: baseline-changed')
    const { id, state: _state, version: _version, createdRevision: _created,
      configDigest: _digest, backend: _backend, startedAt: _startedAt, stopReason: _stopReason, ...selector } = binding.run
    let authority = await online()
    if (authority.execution.run.state === 'running') authority = await online(executionCommandSchema.parse({ ...selector, runId: id,
      kind: 'transition-run', state: 'paused', operationId: randomUUID() }))
    const reader = await this.isolated.sessionPersistence.open(binding.sessionId, 'read')
    try {
      const facts = inspectActions((await reader.read()).events, authority, observed.files)
      for (const record of facts.settlements) {
        signal.throwIfAborted()
        await online(executionCommandSchema.parse({ ...selector, runId: id, kind: 'settle-action', operationId: randomUUID(),
          actionId: record.action.actionId, outcome: record.outcome, evidenceDigest: record.evidenceDigest }))
      }
      signal.throwIfAborted()
      const unknown = facts.actions.filter(a => a.status === 'unknown').length
      this.ctx.logger.info('organization component=recovery runId=%s reported=%s unknown=%s result=checked', id, facts.settlements.length, unknown)
      return unknown === 0
    } finally { await reader.close() }
  }
  /**
   * Execute through the configured local model and current organization outbound policy.
   * @param request - Explicit employee selection and immutable task inputs.
   * @param bridge - Private online authority channel.
   * @param signal - Native identity and window lifetime.
   * @returns Completion after all local execution consumers have drained.
   */
  async executeConfigured(request: ExecutionRequest, bridge: ExecutionBridge,
    signal: AbortSignal): Promise<void> {
    const selection = request.inputs.execution
    if (!selection) throw new Error('organization-execution: explicit-local-authorization-required')
    let pending: Promise<void> = Promise.resolve()
    const online: ExecutionBridge = (command) => {
      const response = pending.then(() => bridge(command))
      pending = response.then(() => {}, () => {})
      return response
    }
    const authority = await online()
    if (JSON.stringify(authority.execution.run.backend) !== JSON.stringify(request.inputs.backend)) throw new Error('organization-execution: native-selection-mismatch')
    if (request.inputs.backend) {
      if (!this.config.codex || !this.ctx.get('subprocess')) throw new Error('organization-execution: native-execution-disabled')
      return this.executeInterval(request, online, { kind: 'codex', directory: selection.directory }, signal)
    }
    const adapter = executionAdapter(this.ctx, request, this.config.models ?? [], online, signal)
    if (!authority.execution.modelPolicy.some(p => p.model === request.inputs.model && p.endpoint === request.inputs.endpoint)) {
      throw new Error('organization-execution: organization-model-policy-denied')
    }
    await this.execute(request, online, { adapter, directory: selection.directory }, signal)
  }
  private nativeInterval(binding: ExecutionResult, authority: ExecutionAuthority, bridge: ExecutionBridge,
    limits: RuntimeLimits, signal: AbortSignal, resume?: ExecutionRequest['resume'], reconcile = false) {
    const subprocess = this.ctx.get('subprocess'), config = this.config.codex, selection = binding.inputs.execution
    if (!subprocess || !config || !selection) throw new Error('organization-execution: native-execution-disabled')
    return runCodexExecution(binding, authority, bridge, this.isolated.sessionPersistence, {
      cwd: selection.directory, env: {}, experimentalApi: true, limits: config,
      spawn: request => subprocess.spawn(request),
    }, limits, signal, resume && { ...resume, reconcile })
  }
  /**
   * Read the employee's local transcript under fresh exact-task access.
   * @param input - Exact Run selector, never a caller-selected Session ID.
   * @param authorize - Native read qualification under the current identity.
   * @param signal - Native identity and request cancellation.
   * @returns Bounded text entries; the organization server receives no transcript.
   */
  report(input: ExecutionReportRequest, authorize: () => Promise<ExecutionReadAuthority>,
    signal: AbortSignal): Promise<ExecutionReport> {
    if (this.closing) return Promise.reject(new Error('organization-execution: unavailable'))
    const cancel = new AbortController()
    this.running.add(cancel)
    const result = this.readReport(input, authorize, AbortSignal.any([signal, cancel.signal]))
      .finally(() => { this.running.delete(cancel); this.reports.delete(result) })
    this.reports.add(result)
    return result
  }
  private async readReport(input: ExecutionReportRequest, authorize: () => Promise<ExecutionReadAuthority>,
    signal: AbortSignal): Promise<ExecutionReport> {
    const request = executionReportRequestSchema.parse(input), first = executionReadAuthoritySchema.parse(await authorize())
    const binding = this.state?.get().bindings.find(b => b.run.id === request.runId
      && b.owner.serverId === first.serverId && b.owner.accountId === first.accountId)
    const check = (authority: ExecutionReadAuthority) => {
      signal.throwIfAborted()
      const run = authority.execution.run
      if (!binding || this.closing || run.id !== request.runId || run.assignmentId !== request.assignmentId
        || run.organizationId !== request.organizationId || run.projectId !== request.projectId || run.planId !== request.planId
        || authority.generation !== first.generation || authority.serverId !== first.serverId || authority.accountId !== first.accountId) {
        throw new Error('organization-execution: unavailable')
      }
    }
    check(first)
    if (!binding) throw new Error('organization-execution: unavailable')
    const reader = await this.isolated.sessionPersistence.open(binding.sessionId, 'read')
    try {
      const { events } = await reader.read()
      const report: ExecutionReport = { runId: request.runId, state: binding.state,
        entries: binding.inputs.messages.map(text => ({ role: 'user', text })), truncated: false }
      for (const event of events) {
        if (event.type === 'assistant/message') {
          report.entries.push({ role: 'assistant', text: event.data.message.content.filter(part => part.type === 'text').map(part => part.text).join('\n') })
        } else if (event.type === 'tool/call') {
          report.entries.push({ role: 'tool', text: `${event.data.name}\n${event.data.arguments}` })
        } else if (event.type === 'user/message') {
          report.entries.push({ role: 'user', text: event.data.content.filter(part => part.type === 'text').map(part => part.text).join('\n') })
        } else if (event.type === 'tool/result') {
          report.entries.push({ role: 'tool', text: event.data.message.content.filter(part => part.type === 'text').map(part => part.text).join('\n') })
        }
      }
      const limit = this.config.executionLimits?.maxBytes
      if (!limit) throw new Error('organization-execution: execution-disabled')
      if (binding.inputs.backend) {
        const journal = nativeJournal(events)
        report.native = { status: journal.status, waitingHuman: first.execution.run.state === 'waiting-human',
          cleanupFailed: events.some(event => event.type === 'organization/execution-native' && event.data.kind === 'diagnostic') }
        for (const event of events) {
          if (event.type !== 'organization/execution-native') continue
          if (event.data.kind === 'result') {
            const result = event.data
            if (event.data.recovered && events.some(e => e.type === 'organization/execution-native'
              && e.data.kind === 'result' && e.data.inputId === result.inputId && !e.data.recovered && e.data.status !== 'unknown')) continue
            for (const item of event.data.items) {
              const entry = nativeItemEntry(item)
              if (entry) report.entries.push(entry)
            }
          } else if (event.data.kind === 'item') {
            const item = event.data
            if (events.some(e => e.type === 'organization/execution-native'
              && e.data.kind === 'result' && e.data.turnId === item.turnId && e.data.status !== 'unknown')) continue
            const entry = nativeItemEntry(event.data.item)
            if (entry) report.entries.push(entry)
          } else if (event.data.kind === 'human') report.entries.push(nativeRequestEntry(event.data.params, event.data.digest))
        }
        report.recovery = { inputs: binding.inputs, baselineDigest: nativeBaseline(events), actions: inspectActions(events, first).actions }
      } else if (binding.inputs.execution && ['executing', 'stopped'].includes(binding.state)) {
        const directory = await inspectDirectory(binding.inputs.execution.directory, limit).catch((_error: unknown) => undefined)
        report.recovery = { inputs: binding.inputs, baselineDigest: directory?.digest ?? null,
          actions: inspectActions(events, first, directory?.files).actions }
      }
      while (Buffer.byteLength(JSON.stringify(report)) > limit && report.entries.length) {
        report.truncated = true; report.entries.shift()
      }
      if (Buffer.byteLength(JSON.stringify(report)) > limit) throw new Error('organization-execution: response-size-limit')
      check(executionReadAuthoritySchema.parse(await authorize()))
      return executionReportSchema.parse(report)
    } finally { await reader.close() }
  }
  private events(binding: z.output<typeof bindingSchema>): SessionEvent[] {
    return [{ type: 'organization/execution-binding', seq: SessionSeq(0), time: binding.createdAt,
      data: executionBindingSchema.parse({ owner: binding.owner, run: binding.run, contextSessionId: binding.contextSessionId,
        snapshot: binding.snapshot, inputs: binding.inputs }) }]
  }
  private async verify(binding: z.output<typeof bindingSchema>, prefix: boolean): Promise<void> {
    const reader = await this.isolated.sessionPersistence.open(binding.sessionId, 'read')
    try {
      const { events } = await reader.read()
      const expected = this.events(binding)
      if (reader.header.createdAt !== binding.createdAt || reader.header.cwd !== undefined || reader.header.parentSession !== undefined
        || reader.header.agentPreset !== undefined || reader.header.origin !== undefined || reader.header.isSeeded
        || JSON.stringify(binding.state === 'executing' || binding.state === 'stopped' ? events.slice(0, expected.length) : events) !== JSON.stringify(prefix ? expected.slice(0, events.length) : expected)) throw new Error('organization-execution: binding/log mismatch')
      const native = nativeJournal(events)
      if (binding.inputs.backend ? native.preparing !== undefined && native.preparing.directory !== binding.inputs.execution?.directory
        : native.status !== 'unbound') throw new Error('organization-execution: native-log-mismatch')
      const actions = new Map<string, ActionEvidence>()
      for (const event of events.slice(expected.length)) {
        if (event.type === 'organization/execution-binding') throw new Error('organization-execution: duplicate binding event')
        if (event.type !== 'organization/execution-action') continue
        const evidence = actionEvidenceSchema.parse(event.data), action = evidence.action
        const previous = actions.get(action.actionId)
        if (action.runId !== binding.run.id || action.assignmentId !== binding.run.assignmentId
          || action.executionDelegationId !== binding.run.executionDelegationId || action.deviceId !== binding.run.deviceId
          || action.planRevision !== binding.run.planRevision || action.serverEpoch !== binding.run.serverEpoch
          || action.fencingEpoch !== binding.run.fencingEpoch || !binding.inputs.capabilities.includes(action.capability)
          || (previous && (JSON.stringify(previous.action) !== JSON.stringify(action)
            || JSON.stringify(previous.file) !== JSON.stringify(evidence.file)))
          || (evidence.file !== undefined && action.capability !== 'fs-write')
          || (evidence.stage === 'reserved' ? previous !== undefined
            : evidence.stage === 'issued' ? previous?.stage !== 'reserved'
              : previous === undefined || previous.stage === 'settled' && !(action.capability === 'codex-turn' && previous.outcome === 'unknown')
                || (evidence.outcome === 'succeeded' && previous.stage !== 'issued' && !(action.capability === 'codex-turn' && previous.outcome === 'unknown')))) {
          throw new Error('organization-execution: action/log mismatch')
        }
        actions.set(action.actionId, evidence)
      }
    } finally { await reader.close() }
  }
  /**
   * Compare the local binding store against independently durable JSONL facts on cold start and diagnostics.
   * @returns Completion or an explicit corruption error.
   */
  verifyBindings(): Promise<void> {
    const check = this.tail.then(() => this.verifyStoredBindings())
    this.tail = check.then(() => {}, () => {})
    return check
  }
  private async verifyStoredBindings(): Promise<void> {
    if (!this.state || this.closing) throw new Error('organization-execution: unavailable')
    const keys = new Set<string>(), sessions = new Set<string>()
    const bindings = this.state.get().bindings
    for (const binding of bindings) {
      const key = this.key(binding)
      if (keys.has(key) || sessions.has(binding.sessionId)) throw new Error('organization-execution: duplicate binding')
      keys.add(key); sessions.add(binding.sessionId)
      if (binding.state !== 'reserved') await this.verify(binding, false)
      else if (await this.isolated.sessionPersistence.stat(binding.sessionId)) await this.verify(binding, true)
    }
    for (const operation of this.state.get().operations) if (!keys.has(operation.key)) throw new Error('organization-execution: orphan operation')
    for (const header of await this.isolated.sessionPersistence.list()) if (!sessions.has(header.header.id)) throw new Error('organization-execution: orphan log')
  }
  private key(binding: z.output<typeof executionBindingSchema>): string { return JSON.stringify([binding.owner.serverId,
    binding.owner.accountId, binding.run.id]) }
  private async openCurrent(request: ExecutionRequest, authorize: () => Promise<ExecutionAuthority>,
    signal: AbortSignal): Promise<ExecutionResult> {
    const check = () => { signal.throwIfAborted(); if (!this.state || this.closing) throw new Error('organization-execution: unavailable') }
    check()
    const first = executionAuthoritySchema.parse(await authorize()); check()
    if (request.resume) {
      const binding = this.state?.get().bindings.find(b => b.run.id === request.runId
        && b.owner.serverId === first.serverId && b.owner.accountId === first.accountId)
      const validateResume = (authority: ExecutionAuthority) => {
        check()
        if (!binding || (!request.start && !request.reconcile) || (!request.reconcile && !authority.execution.eligible)
          || (!request.reconcile && !['running', 'paused', 'waiting-human'].includes(authority.execution.run.state))
          || !['executing', 'stopped'].includes(binding.state)
          || authority.serverId !== first.serverId || authority.accountId !== first.accountId || authority.generation !== first.generation
          || authority.execution.run.id !== request.runId || authority.execution.run.assignmentId !== request.assignmentId
          || authority.execution.run.planId !== request.planId || authority.execution.run.projectId !== request.projectId
          || authority.execution.run.organizationId !== request.organizationId
          || authority.execution.run.serverEpoch !== binding.run.serverEpoch
          || authority.execution.run.fencingEpoch !== binding.run.fencingEpoch
          || authority.execution.run.deviceId !== binding.run.deviceId
          || authority.execution.run.executionDelegationId !== binding.run.executionDelegationId
          || authority.task.revision !== binding.run.planRevision
          || (!request.reconcile && authority.execution.delegation.used >= authority.execution.delegation.budget)
          || executionInputsDigest(request.inputs) !== binding.run.configDigest) throw new Error('organization-execution: resume-qualification-required')
      }
      validateResume(first)
      if (!binding) throw new Error('organization-execution: unavailable')
      await this.verify(binding, false)
      validateResume(executionAuthoritySchema.parse(await authorize()))
      const { createdAt: _createdAt, state: _state, ...result } = binding
      return executionResultSchema.parse(result)
    }
    const validate = (a: ExecutionAuthority) => {
      const r = a.execution.run, original = a.context.owner
      if (!a.execution.eligible || r.state !== 'prepared' || r.id !== request.runId || r.assignmentId !== request.assignmentId
        || r.organizationId !== request.organizationId || r.projectId !== request.projectId || r.planId !== request.planId
        || r.planRevision !== a.task.revision || a.task.planId !== r.planId || a.task.id !== original.taskId
        || original.serverId !== a.serverId || original.accountId !== a.accountId
          || original.organizationId !== r.organizationId || original.planId !== r.planId
        || JSON.stringify(r.backend) !== JSON.stringify(request.inputs.backend)
        || r.configDigest !== executionInputsDigest(request.inputs) || request.inputs.capabilities.some(
        c => !a.execution.delegation.capabilities.includes(c))
        || a.generation !== first.generation || a.serverId !== first.serverId || a.accountId !== first.accountId) throw new Error('organization-execution: superseded')
    }
    validate(first)
    const data = executionBindingSchema.parse({ owner: first.context.owner, run: first.execution.run,
      contextSessionId: first.context.sessionId, snapshot: first.task, inputs: request.inputs })
    const key = this.key(data), digest = createHash('sha256').update(JSON.stringify(request)).digest('hex')
    const state = this.state
    if (!state) throw new Error('organization-execution: unavailable')
    let saved = state.get()
    const operation = saved.operations.find(x => x.operationId === request.operationId)
    if (operation && (operation.key !== key || operation.digest !== digest)) throw new Error('organization-execution: operation-conflict')
    let binding = saved.bindings.find(x => this.key(x) === key)
    if (binding && JSON.stringify(executionBindingSchema.parse({ owner: binding.owner, run: binding.run,
      contextSessionId: binding.contextSessionId, snapshot: binding.snapshot, inputs: binding.inputs })) !== JSON.stringify(data)) throw new Error('organization-execution: binding changed')
    binding ??= { ...data, sessionId: SessionId(`organization-execution:${randomUUID()}`), mode: 'prepared', state: 'reserved', createdAt: Date.now() }
    if (binding.state === 'executing' || binding.state === 'stopped') throw new Error('organization-execution: explicit-reconciliation-required')
    const selected = binding
    if (!operation) {
      saved = { bindings: saved.bindings.some(x => x.sessionId === selected.sessionId) ? saved.bindings : [...saved.bindings, selected],
        operations: [...saved.operations, { operationId: request.operationId, key, digest }] }
      await state.set(saved)
    }
    check()
    const store = this.isolated.sessionPersistence
    if (binding.state === 'reserved') {
      const existing = await store.stat(binding.sessionId)
      if (existing) await this.verify(binding, true)
      const handle = existing ? await store.open(binding.sessionId, 'write') : await store.create({ id: binding.sessionId,
        version: SESSION_FORMAT_VERSION, createdAt: binding.createdAt, isSeeded: false, delegationDepth: 0 })
      try {
        const current = await handle.read(), expected = this.events(binding)
        if (JSON.stringify(current.events) !== JSON.stringify(expected.slice(0, current.events.length))) throw new Error('organization-execution: corrupt prefix')
        await handle.append(expected.slice(current.events.length)); await handle.flush()
      } finally { await handle.close() }
    }
    await this.verify(binding, false); check()
    validate(executionAuthoritySchema.parse(await authorize())); check()
    if (binding.state !== 'ready') {
      binding = { ...binding, state: 'ready' }
      const ready = binding
      await state.set({ ...saved, bindings: saved.bindings.map(x => x.sessionId === ready.sessionId ? ready : x) })
    }
    validate(executionAuthoritySchema.parse(await authorize())); check()
    this.ctx.logger.info('organization component=execution operationId=%s runId=%s generation=%s result=prepared',
      request.operationId, request.runId, first.generation)
    return executionResultSchema.parse({ ...data, sessionId: binding.sessionId, mode: 'prepared' })
  }
}
