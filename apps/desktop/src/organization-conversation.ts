/** Native project planning and top-frame lifetime checks; no Renderer model proxy. */
import { conversationAuthoritySchema, conversationRequestSchema, type ConversationRequest, type ConversationBridge,
  type ConversationResult } from '@deepseek-ai/dsh-organization-conversation/protocol'
import type { OrganizationConnection } from '@deepseek-ai/dsh-organization-connection'
/** Private Host capability, available only through the owned child process channel. */
export interface ConversationHost {
  /**
   * Dispatch one fixed local conversation operation and drain its cancellation.
   * @param request - Strict project-bound input.
   * @param authorize - Fresh native online planning authorization.
   * @param timeoutMs - Native interval deadline.
   * @param signal - Native identity and owning window lifetime.
   * @returns Bounded private transcript under current project read.
   */
  organizationConversation(request: ConversationRequest, authorize: ConversationBridge, timeoutMs: number,
    signal: AbortSignal): Promise<ConversationResult>
}
/**
 * Route a fixed project operation through the native bearer owner and private Host.
 * @param connection - Native organization identity and HTTPS transport owner.
 * @param host - Initiating private Host child.
 * @param input - Untrusted Renderer operation; arbitrary URL, identity and Session fields are refused.
 * @param assertCurrent - Current top-frame and Host lifetime check.
 * @param lifetime - Initiating window lifetime.
 * @returns Generation-scoped private project conversation result.
 */
export async function organizationConversation(connection: OrganizationConnection, host: ConversationHost, input: unknown,
  assertCurrent: () => void, lifetime: AbortSignal): Promise<{ generation: number; result: ConversationResult }> {
  assertCurrent()
  const request = conversationRequestSchema.parse(input), initial = connection.snapshot()
  const cancel = new AbortController(), signal = AbortSignal.any([lifetime, cancel.signal])
  const current = () => {
    signal.throwIfAborted(); assertCurrent()
    const state = connection.snapshot()
    if (state.generation !== initial.generation || state.phase !== 'ready' || state.mode !== 'organization'
      || state.organizationId !== request.organizationId || !state.principal) throw new Error('superseded')
    return state.principal
  }
  const selector = { organizationId: request.organizationId, projectId: request.projectId, conversationId: request.conversationId }
  const draft = { sent: false }
  const bridge: ConversationBridge = async (command) => {
    const principal = current()
    if (command && (command.organizationId !== request.organizationId || command.projectId !== request.projectId
      || command.conversationId !== request.conversationId)) throw new Error('forbidden')
    let assignment
    if (request.assignment) {
      const prepared = await connection.perform({ kind: 'assignment-preparation', request: { organizationId: request.organizationId,
        projectId: request.projectId, ...request.assignment } })
      current()
      if (prepared.assignment?.result.kind !== 'preparation') throw new Error('forbidden')
      assignment = prepared.assignment.result.value.assignment
      const member = connection.snapshot().organizations.find(o => o.id === request.organizationId)?.membershipId
      if (assignment.assigneeId !== member) throw new Error('forbidden')
      if (request.kind === 'send' && (assignment.state !== 'pending' && assignment.state !== 'accepted'
        || request.target && (request.target.planId !== assignment.planId || request.target.taskId !== assignment.taskId)))
        throw new Error('version-conflict')
      if (command && (command.kind === 'read-planning-plan' && (command.planId !== assignment.planId || command.taskId !== assignment.taskId)
        || command.kind === 'save-planning-draft' && (command.planId !== assignment.planId || command.definition.taskId !== assignment.taskId)))
        throw new Error('forbidden')
    }
    if (command?.kind === 'save-planning-draft') draft.sent = true
    const plan = command?.kind === 'read-planning-plan' ? (await connection.perform({ kind: 'planning-plan', request: command })).planningPlan : undefined
    const candidates = command?.kind === 'read-planning-members' ? (await connection.perform({ kind: 'planning-candidates', request: { organizationId: command.organizationId, projectId: command.projectId, search: command.search, offset: command.offset } })).candidates : undefined
    const receipt = command && command.kind !== 'read-planning-plan' && command.kind !== 'read-planning-members' ? await connection.planningCommand(command, initial.generation) : undefined
    current()
    const response = await connection.perform({ kind: 'planning-read', request: selector })
    current()
    if (response.generation !== initial.generation || !response.planning) throw new Error('superseded')
    return conversationAuthoritySchema.parse({ serverId: principal.serverId, accountId: principal.accountId,
      generation: initial.generation, view: response.planning,
      ...(assignment ? { assignment } : {}),
      ...(receipt ? { receipt } : {}), ...(plan ? { plan } : {}), ...(candidates ? { candidates } : {}) })
  }
  const unsubscribe = connection.subscribe(() => { if (connection.snapshot().generation !== initial.generation) cancel.abort() })
  try {
    const first = await bridge()
    const duration = request.kind === 'send' ? first.view.policy.maxDurationMs + connection.timeoutMs : connection.timeoutMs
    const result = await host.organizationConversation(request, bridge, duration, signal)
    await bridge(); current()
    return { generation: initial.generation, result }
  } catch (error) {
    if (!draft.sent || lifetime.aborted || connection.snapshot().generation === initial.generation) throw error
    // A committed draft can invalidate the initiating stream. Recover only a read, never another send.
    await new Promise<void>((resolve, reject) => {
      const done = (failure?: Error) => { clearTimeout(timer); off(); lifetime.removeEventListener('abort', abort); if (failure) reject(failure); else resolve() }
      const check = () => {
        const state = connection.snapshot()
        if (state.principal?.serverId !== initial.principal?.serverId || state.principal?.accountId !== initial.principal?.accountId
          || state.organizationId !== request.organizationId || state.mode !== 'organization' || ['offline', 'disconnected', 'signed-out'].includes(state.phase)) done(new Error('superseded'))
        else if (state.phase === 'ready') done()
      }
      const abort = () => { done(new Error('superseded')) }
      const off = connection.subscribe(check), timer = setTimeout(() => { done(new Error('superseded')) }, connection.timeoutMs)
      lifetime.addEventListener('abort', abort, { once: true }); check()
    })
    return await organizationConversation(connection, host, { kind: 'read', ...selector, ...(request.assignment ? { assignment: request.assignment } : {}), operationId: request.operationId }, assertCurrent, lifetime)
  } finally { unsubscribe(); cancel.abort() }
}
