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
  const bridge: ConversationBridge = async (command) => {
    const principal = current()
    if (command && (command.organizationId !== request.organizationId || command.projectId !== request.projectId
      || command.conversationId !== request.conversationId)) throw new Error('forbidden')
    const receipt = command ? await connection.planningCommand(command, initial.generation) : undefined
    current()
    const response = await connection.perform({ kind: 'planning-read', request: selector })
    current()
    if (response.generation !== initial.generation || !response.planning) throw new Error('superseded')
    return conversationAuthoritySchema.parse({ serverId: principal.serverId, accountId: principal.accountId,
      generation: initial.generation, view: response.planning,
      ...(receipt ? { receipt } : {}) })
  }
  const unsubscribe = connection.subscribe(() => { if (connection.snapshot().generation !== initial.generation) cancel.abort() })
  try {
    const first = await bridge()
    const duration = request.kind === 'send' ? first.view.policy.maxDurationMs + connection.timeoutMs : connection.timeoutMs
    const result = await host.organizationConversation(request, bridge, duration, signal)
    await bridge(); current()
    return { generation: initial.generation, result }
  } finally { unsubscribe(); cancel.abort() }
}
