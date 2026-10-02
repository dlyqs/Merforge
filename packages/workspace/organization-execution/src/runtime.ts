/** Restricted organization composition using the standard Agent loop and tool registry. */
import { randomUUID } from 'node:crypto'
import { executionCommandSchema } from '@deepseek-ai/dsh-organization/execution'
import { inspectDirectory } from './recovery.ts'
import UserQuestions from '@deepseek-ai/dsh-user-questions'
import { Context } from '@deepseek-ai/cordis'
import Sessions from '@deepseek-ai/dsh-session'
import Agents from '@deepseek-ai/dsh-agent'
import Loop from '@deepseek-ai/dsh-agent-loop'
import * as Retry from '@deepseek-ai/dsh-llm-retry'
import Projections from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Tools, { defineTool } from '@deepseek-ai/dsh-tools'
import Llm, { createUserMessage, type LlmAdapter, type StreamChunk } from '@deepseek-ai/dsh-llm'
import Jsonl from '@deepseek-ai/dsh-session-persistence-jsonl'
import { LocalFileSystem } from '@deepseek-ai/dsh-fs-local'
import { ActionGuard, actionEvidenceSchema, type ExecutionBridge, type ActionEvidence } from './action-guard.ts'
import { acquireDirectory, BoundedFiles } from './resources.ts'
import type { ExecutionAuthority, ExecutionResult } from './protocol.ts'

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Local intent and settlement evidence for a single charged organization action. */
    'organization/execution-action': ActionEvidence
  }
}
function assertExecutionId(id: string): void {
  if (!/^organization-execution:[0-9a-f-]{36}$/.test(id)) throw new Error('organization-execution: isolated access forbidden')
}
class ExecutionSessions extends Sessions { protected override assertSessionId(id: string): void { assertExecutionId(id) } }
class ExecutionAgents extends Agents { protected override assertSessionId(id: string): void { assertExecutionId(id) } }
/** Deployment ceilings and the exact model route consumed by the isolated runtime. */
export interface RuntimeLimits {
  /** Maximum total charged attempts in this local interval. */
  maxActions: number
  /** Maximum model steps in this interval, including retries. */
  maxSteps: number
  /** Maximum interval duration, including waiting for authorization. */
  maxDurationMs: number
  /** Maximum bytes for a file read, write, or buffered model response. */
  maxBytes: number
  /** Interval for online revocation checks while an action is in flight. */
  recheckMs: number
}
/**
 * Execute one explicitly selected bounded interval in a fresh, isolated composition.
 * @param binding - Durable original task and employee configuration.
 * @param authority - Current identity and lease proof.
 * @param bridge - Correlated private native command/read channel.
 * @param adapter - Deployment-owned model adapter; never a personal Agent or preset.
 * @param root - Dedicated organization JSONL directory.
 * @param directory - Employee-selected local working directory.
 * @param limits - Explicit deployment and employee limit intersection.
 * @param signal - Native identity, window and request cancellation.
 * @param resumeBaseline - Explicitly reviewed directory digest required for continuation.
 * @returns Whether the drained interval completed or durably waits for a person.
 */
export async function runExecution(binding: ExecutionResult, authority: ExecutionAuthority, bridge: ExecutionBridge,
  adapter: LlmAdapter, root: string, directory: string, limits: RuntimeLimits, signal: AbortSignal, resumeBaseline?: string): Promise<'completed' | 'waiting-human'> {
  if (binding.inputs.capabilities.includes('shell')) throw new Error('organization-execution: shell-confinement-unavailable')
  if (!binding.inputs.capabilities.includes('model')) throw new Error('organization-execution: model-capability-required')
  const lock = await acquireDirectory(directory), ctx = new Context(), cancel = new AbortController()
  const abort = () => { cancel.abort(signal.reason) }
  signal.addEventListener('abort', abort, { once: true })
  let timer: ReturnType<typeof setTimeout> | undefined
  let poll: ReturnType<typeof setTimeout> | undefined
  let checkPending: Promise<void> = Promise.resolve()
  let guard: ActionGuard | undefined
  try {
    signal.throwIfAborted()
    if (resumeBaseline && (await inspectDirectory(lock.root, limits.maxBytes)).digest !== resumeBaseline) throw new Error('organization-execution: baseline-changed')
    await ctx.plugin(ExecutionSessions)
    await ctx.plugin(ExecutionAgents)
    await ctx.plugin(Projections)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(UserQuestions)
    await ctx.plugin(Tools, { mode: 'native' })
    await ctx.plugin(Llm)
    await ctx.plugin(Jsonl, { root, compression: 'none', namespace: 'organization-execution' })
    await ctx.plugin(LocalFileSystem, { cwd: lock.root })
    await ctx.plugin(Retry)
    await ctx.plugin(Loop, { agents: [], maxParallelToolCalls: 1 })
    ctx.llm.registerAdapter(['organization'], adapter)
    const handle = await ctx.agents.resume({ resumeSessionId: binding.sessionId,
      agentOptions: { provider: 'organization', model: binding.inputs.model }, signal: cancel.signal })
    const agent = handle.agent
    const outcome = { completed: false }
    ctx.on('session/event', (session, event) => {
      if (session.id === binding.sessionId && event.type === 'turn/end') outcome.completed = event.data.reason.kind === 'completed'
    })
    const record = async (evidence: ActionEvidence) => {
      agent.session.append('organization/execution-action', actionEvidenceSchema.parse(evidence))
      if (!await ctx.sessions.flush(agent.session)) throw new Error('organization-execution: journal-not-durable')
      ctx.logger.info('organization component=action runId=%s actionId=%s operation=%s result=%s',
        binding.run.id, evidence.action.actionId, evidence.stage, evidence.outcome ?? 'pending')
    }
    guard = new ActionGuard(binding, authority, bridge, record, cancel.signal, limits)
    const admitted = guard
    const files = new BoundedFiles(ctx.fs, admitted, lock.root, limits.maxBytes, cancel.signal)
    if (binding.inputs.capabilities.includes('fs-read')) ctx.tools.register(defineTool({
      name: 'read_file', description: 'Read one UTF-8 file relative to the selected task directory.',
      parameters: { path: { type: 'string', required: true } }, output: { schema: { type: 'string' }, render: (_args, text) => [{ type: 'text', text }] },
      execute: args => files.read(args.path),
    }))
    if (binding.inputs.capabilities.includes('fs-write')) ctx.tools.register(defineTool({
      name: 'write_file', description: 'Replace one UTF-8 file relative to the selected task directory.',
      parameters: { path: { type: 'string', required: true }, content: { type: 'string', required: true } },
      output: { schema: { type: 'string' }, render: (_args, text) => [{ type: 'text', text }] },
      execute: async args => JSON.stringify(await files.write(args.path, args.content)),
    }))
    ctx.on('user-questions/request', async (request, next) => {
      if (request.agent !== agent) return next()
      await admitted.checkOnline()
      const view = (await bridge()).execution
      const handlerId = request.questions[0]?.id === 'issuer' ? view.approvedBy : view.assigneeId
      if (!handlerId) throw new Error('organization-execution: handler-required')
      const { id, state: _state, version: _version, createdRevision: _created,
        configDigest: _digest, backend: _backend, startedAt: _startedAt, stopReason: _stopReason, ...selector } = binding.run
      await bridge(executionCommandSchema.parse({ ...selector, runId: id, operationId: randomUUID(),
        kind: 'request-execution-human', requestId: randomUUID(), handlerId, requestKind: 'work-question',
        prompt: request.questions.map(q => q.question).join('\n'), actionId: null, requestDigest: null, expiresAt: view.delegation.expiresAt }))
      throw new Error('organization-execution: waiting-human')
    })
    ctx.tools.register(defineTool({ name: 'request_human',
      description: 'Ask the employee or task issuer for missing work information or a manual test. Execution waits for their answer and explicit employee continuation. Share only the necessary question.',
      parameters: { prompt: { type: 'string', required: true }, recipient: { type: 'string', enum: ['employee', 'issuer'], required: true } },
      output: { schema: { type: 'string' }, render: (_args, text) => [{ type: 'text', text }] },
      execute: async args => JSON.stringify(await ctx.userQuestions.ask({ agent, signal: cancel.signal,
        questions: [{ id: args.recipient, question: args.prompt }] })),
    }))
    let steps = 0
    ctx.on('llm/stream', (options, next) => (async function* () {
      if (++steps > limits.maxSteps) throw new Error('organization-execution: step-limit')
      const { signal: _signal, ...request } = options
      const chunks = await admitted.perform('model', request, async (issue) => {
        const output: StreamChunk[] = []; let bytes = 2
        if (bytes > limits.maxBytes) throw new Error('organization-execution: response-size-limit')
        const check = await issue()
        check()
        for await (const chunk of next()) {
          bytes += Buffer.byteLength(JSON.stringify(chunk)) + (output.length ? 1 : 0)
          if (bytes > limits.maxBytes) throw new Error('organization-execution: response-size-limit')
          output.push(chunk)
        }
        return output
      }, output => output.some(chunk => chunk.type === 'finish' && ['stop', 'tool-calls', 'max-tokens'].includes(chunk.reason.kind)) ? 'succeeded' : 'failed')
      yield* chunks
    })())
    const stop = () => { agent.cancel({ kind: 'user' }) }
    cancel.signal.addEventListener('abort', stop, { once: true })
    timer = setTimeout(() => { cancel.abort(new Error('organization-execution: duration-limit')) }, limits.maxDurationMs)
    const recheck = () => {
      checkPending = admitted.checkOnline().catch((error: unknown) => { cancel.abort(error) }).then(() => {
        if (!cancel.signal.aborted) poll = setTimeout(recheck, limits.recheckMs)
      })
    }
    poll = setTimeout(recheck, limits.recheckMs)
    try {
      await admitted.checkOnline()
      // This input enters the normal durable user/message path before any model request.
      agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: JSON.stringify({
        task: binding.snapshot, materials: binding.inputs.materials, messages: binding.inputs.messages,
        ...(resumeBaseline ? { continuation: 'Continue from the durable history. Do not repeat completed side effects.',
          humanAnswers: authority.execution.humanRequests.filter(h => ['answered', 'approved', 'denied'].includes(h.state)) } : {}),
      }) }] }))
      await agent.whenIdle()
      if ((await bridge()).execution.run.state === 'waiting-human') {
        if (!await ctx.sessions.flush(agent.session)) throw new Error('organization-execution: log-not-durable')
        return 'waiting-human'
      }
      cancel.signal.throwIfAborted()
      if (!outcome.completed) throw new Error('organization-execution: turn-not-completed')
      if (!await ctx.sessions.flush(agent.session)) throw new Error('organization-execution: log-not-durable')
      return 'completed'
    } finally {
      cancel.signal.removeEventListener('abort', stop)
      await handle.dispose()
    }
  } finally {
    cancel.abort()
    clearTimeout(timer); clearTimeout(poll)
    signal.removeEventListener('abort', abort)
    await checkPending
    await ctx.fiber.dispose()
    await guard?.drain()
    lock.release()
  }
}
