/** Native authorization and identity cancellation for private local context reads. */
import { assertContextSnapshotAccess, contextRequestSchema, type ContextRequest, type ContextAuthority, type ContextResult } from '@deepseek-ai/dsh-organization-context/protocol'
import type { OrganizationConnection } from '@deepseek-ai/dsh-organization-connection'

/** Fixed personal Host capability; no arbitrary IPC action forwarding. */
export interface ContextHost {
  /**
   * Open an isolated pre-execution binding.
   * @param request - Native-validated task selector.
   * @param authorize - Online recheck owned by the native connection.
   * @param timeoutMs - Native request deadline.
   * @param signal - Connection identity lifetime.
   * @returns Durable read-only context.
   */
  openOrganizationContext(request: ContextRequest, authorize: (revision?: ContextAuthority['task']['revision']) => Promise<ContextAuthority>, timeoutMs: number, signal: AbortSignal): Promise<ContextResult>
}
/**
 * Authenticate all Host task reads and discard late responses after native identity changes.
 * @param connection - Native bearer owner.
 * @param host - Current private personal Host.
 * @param input - Untrusted Renderer selector.
 * @param assertCurrent - Owning top-frame and Host-lifetime check.
 * @returns Generation-scoped pre-execution view.
 */
export async function openOrganizationContext(
  connection: OrganizationConnection, host: ContextHost, input: unknown, assertCurrent: () => void,
): Promise<{ generation: number; result: ContextResult }> {
  assertCurrent()
  const request = contextRequestSchema.parse(input)
  const generation = connection.snapshot().generation
  const authorize = async (revision?: ContextAuthority['task']['revision']): Promise<ContextAuthority> => {
    assertCurrent()
    const state = connection.snapshot()
    if (state.generation !== generation || state.phase !== 'ready' || state.mode !== 'organization'
        || state.organizationId !== request.organizationId) throw new Error('superseded')
    const { operationId: _operationId, ...selector } = request
    const result = await connection.perform({ kind: 'workgraph-tasks', request: { ...selector, revision } })
    const read = result.workgraph
    assertCurrent()
    if (!read || read.result.kind !== 'tasks' || read.generation !== generation
        || connection.snapshot().generation !== generation) throw new Error('superseded')
    const task = read.result.value.items.find(value => value.id === request.taskId && value.planId === request.planId)
    if (!task) throw new Error('forbidden')
    return { ...read.principal, organizationId: read.organizationId, requestId: read.requestId, generation, task }
  }
  const cancel = new AbortController()
  const unsubscribe = connection.subscribe(() => { if (connection.snapshot().generation !== generation) cancel.abort() })
  try {
    const result = await host.openOrganizationContext(request, authorize, connection.timeoutMs, cancel.signal)
    const final = await authorize(result.snapshot.revision)
    assertContextSnapshotAccess(result.snapshot, final.task)
    cancel.signal.throwIfAborted()
    assertCurrent()
    return { generation, result }
  } finally { unsubscribe() }
}
