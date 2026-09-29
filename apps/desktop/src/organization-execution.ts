/** Electron owns all online execution preparation reads and their window lifetime. */
import { executionRequestSchema, type ExecutionRequest, type ExecutionAuthority, type ExecutionResult } from '@deepseek-ai/dsh-organization-execution/protocol'
import type { OrganizationConnection } from '@deepseek-ai/dsh-organization-connection'
import { openOrganizationContext, type ContextHost } from './organization-context.ts'
/** Private Host operation; no public remote receives the authorization callback. */
export interface ExecutionHost extends ContextHost {
  /**
   * Reserve and persist an isolated prepared execution Session.
   * @param request - Strict local configuration and exact Run selector.
   * @param authorize - Native online recheck.
   * @param timeoutMs - Native request deadline.
   * @param signal - Window and identity cancellation.
   * @returns Local prepared context with all real effects disabled.
   */
  openOrganizationExecution(request: ExecutionRequest, authorize: () => Promise<ExecutionAuthority>, timeoutMs: number,
    signal: AbortSignal): Promise<ExecutionResult>
}
/**
 * Resolve the original context and exact current task without exposing bearer credentials.
 * @param connection - Native connection and device owner.
 * @param host - Initiating private Host.
 * @param input - Untrusted Renderer selector and explicit non-secret inputs.
 * @param assertCurrent - Owning top-frame and Host-lifetime check.
 * @param lifetime - Initiating renderer lifetime; destruction aborts pending Host work.
 * @returns Prepared local Session after final online qualification.
 */
export async function openOrganizationExecution(connection: OrganizationConnection, host: ExecutionHost, input: unknown,
  assertCurrent: () => void, lifetime?: AbortSignal): Promise<{ generation: number; result: ExecutionResult }> {
  assertCurrent()
  const request = executionRequestSchema.parse(input)
  const generation = connection.snapshot().generation
  const current = () => {
    lifetime?.throwIfAborted()
    assertCurrent()
    const state = connection.snapshot()
    if (state.generation !== generation || state.phase !== 'ready' || state.mode !== 'organization' || state.organizationId !== request.organizationId) throw new Error('superseded')
  }
  const authorize = async (): Promise<ExecutionAuthority> => {
    current()
    const { inputs: _inputs, operationId: _operation, ...selector } = request
    const response = await connection.perform({ kind: 'execution-read', request: selector })
    current()
    const execution = response.execution
    if (!execution?.eligible || execution.run.state !== 'prepared' || response.generation !== generation) throw new Error('forbidden')
    const preparation = await connection.perform({ kind: 'assignment-preparation', request: {
      organizationId: request.organizationId, projectId: request.projectId, planId: request.planId, assignmentId: request.assignmentId } })
    current()
    if (preparation.assignment?.result.kind !== 'preparation') throw new Error('forbidden')
    const taskId = preparation.assignment.result.value.assignment.taskId
    const context = await openOrganizationContext(connection, host, { organizationId: request.organizationId, projectId: request.projectId,
      planId: request.planId, taskId, operationId: request.operationId }, current)
    current()
    const tasks = await connection.perform({ kind: 'workgraph-tasks', request: { organizationId: request.organizationId,
      projectId: request.projectId, planId: request.planId, taskId, revision: execution.run.planRevision } })
    current()
    const read = tasks.workgraph
    if (!read || read.generation !== generation || read.result.kind !== 'tasks') throw new Error('forbidden')
    const task = read.result.value.items.find(t => t.id === taskId)
    if (!task) throw new Error('forbidden')
    return { ...read.principal, organizationId: request.organizationId, requestId: read.requestId, generation, task,
      context: context.result, execution }
  }
  const cancel = new AbortController()
  const abort = () => { cancel.abort() }
  lifetime?.throwIfAborted()
  lifetime?.addEventListener('abort', abort, { once: true })
  const unsubscribe = connection.subscribe(() => { if (connection.snapshot().generation !== generation) cancel.abort() })
  try {
    const result = await host.openOrganizationExecution(request, authorize, connection.timeoutMs, cancel.signal)
    await authorize(); cancel.signal.throwIfAborted(); current()
    return { generation, result }
  } finally { unsubscribe(); lifetime?.removeEventListener('abort', abort) }
}
