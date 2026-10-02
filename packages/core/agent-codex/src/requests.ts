/** Current native callbacks use application permissions and the existing scoped human presenters. */
import { z } from 'zod'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-user-questions'
import type {} from '@deepseek-ai/dsh-user-approval'
import type { CodexServerRequest, CodexDynamicTool } from '@deepseek-ai/dsh-codex-runtime'

const names = new Set(['workflow_assess', 'workflow_propose', 'workflow_complete'])
const text = z.string().min(1)
const questionSchema = z.object({ questions: z.array(z.object({ id: text, header: z.string(), question: text,
  isSecret: z.literal(false).optional(), isOther: z.boolean().optional(),
  options: z.array(z.object({ label: text, description: z.string() })).nullable().optional(),
})).min(1), itemId: text, isBlocking: z.boolean() })

/**
 * Advertise only application task actions visible to this exact Agent.
 * @param ctx - scoped native Agent context.
 * @param agent - current conversation owner.
 * @returns pinned protocol function declarations, never native tool substitutes.
 */
export function workflowTools(ctx: Context, agent: Agent): CodexDynamicTool[] {
  return (ctx.get('tools')?.schemas(agent) ?? []).filter(tool => names.has(tool.name)).map(tool => ({
    type: 'function', name: tool.name, description: tool.name === 'workflow_complete'
      ? 'Report completion of the selected task with a summary, one result per acceptance criterion, and callIds: []. Codex owns verification; this records your report without independent application verification.'
      : tool.description, inputSchema: tool.parameters,
  }))
}

/**
 * Execute one validated native callback and persist its observed answer before replying.
 * @param ctx - scoped current Agent context.
 * @param agent - exact live owner, used by task and human services.
 * @param turn - enclosing application turn.
 * @param request - runtime-validated native thread/turn callback.
 * @param signal - lifetime revoked by stop, terminal, timeout or teardown.
 * @returns the pinned protocol response.
 */
export async function answerNativeRequest(ctx: Context, agent: Agent, turn: number,
  request: CodexServerRequest, signal: AbortSignal): Promise<unknown> {
  signal.throwIfAborted()
  const { requestId, threadId, turnId, method, params } = request
  const session = agent.session
  const data = { turn, requestId, threadId, turnId }
  // Secret input has no presenter/storage policy in this bridge.
  if (method === 'item/tool/requestUserInput') questionSchema.parse(params)
  session.append('codex/request', { ...data, method, params: z.json().parse(params) })
  let settled = false
  try {
    if (!await ctx.sessions.flush(session)) throw new Error('Native request is not durable')
    signal.throwIfAborted()
    let response: unknown
    switch (method) {
      case 'item/tool/call': {
        const call = z.object({ tool: text, callId: text, namespace: z.null().optional(), arguments: z.json() }).parse(params)
        const tools = ctx.get('tools')
        if (!names.has(call.tool) || tools === undefined || tools.get(call.tool, agent) === undefined) throw new Error('Native application tool unavailable')
        const callId = ToolCallId(`${threadId}:${turnId}:${call.callId}`)
        const result = await tools.execute({ agent, callId,
          name: call.tool, arguments: call.arguments, signal })
        response = { success: !result.isError, contentItems: result.content.map((part) => {
          if (part.type !== 'text') throw new Error('Native task bridge supports text results only')
          return { type: 'inputText', text: part.text }
        }) }
        break
      }
      case 'item/tool/requestUserInput': {
        const parsed = questionSchema.parse(params)
        if (new Set(parsed.questions.map(question => question.id)).size !== parsed.questions.length) throw new Error('Duplicate native question')
        const service = ctx.get('userQuestions')
        if (service === undefined) throw new Error('Native question presenter unavailable')
        const answer = await abortableQuestion(service.ask({ agent, signal, questions: parsed.questions.map(question => ({
          id: question.id, header: question.header, question: question.question,
          ...question.options == null ? {} : { options: question.options },
        })) }), signal)
        const items = z.array(z.object({ id: text, selected: z.array(z.string()), custom: z.string().optional() })).parse(answer.answers)
        if (items.length !== parsed.questions.length || new Set(items.map(item => item.id)).size !== items.length
          || items.some(item => !parsed.questions.some(question => question.id === item.id
            && item.selected.every(label => question.options?.some(option => option.label === label))))) throw new Error('Invalid native answer')
        response = { answers: Object.fromEntries(items.map(item => [item.id,
          { answers: [...item.selected, ...item.custom === undefined ? [] : [item.custom]] }])) }
        break
      }
      case 'item/commandExecution/requestApproval':
      case 'item/fileChange/requestApproval': {
        z.object({ itemId: text, startedAtMs: z.number().int() }).parse(params)
        const approval = ctx.get('approval')
        const outcome = approval === undefined ? 'unavailable' : await approval.request({ agent, signal,
          toolName: method === 'item/commandExecution/requestApproval' ? 'Codex command' : 'Codex file change',
          reason: JSON.stringify(params),
        })
        const decision = outcome === 'allowed-once' ? 'accept' : outcome === 'cancelled' ? 'cancel' : 'decline'
        if (method === 'item/commandExecution/requestApproval' && params.availableDecisions != null
          && !z.array(z.json()).parse(params.availableDecisions).includes(decision)) throw new Error('Native decision unavailable')
        response = { decision }
        break
      }
    }
    signal.throwIfAborted()
    session.append('codex/request-result', { ...data, status: 'answered', response: z.json().parse(response) })
    settled = true
    if (!await ctx.sessions.flush(session)) throw new Error('Native answer is not durable')
    signal.throwIfAborted()
    return response
  } catch (error) {
    if (!settled) session.append('codex/request-result', { ...data, status: signal.aborted ? 'cancelled' : 'rejected', response: null })
    await ctx.sessions.flush(session)
    throw error
  }
}

function abortableQuestion<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const aborted = () => { signal.removeEventListener('abort', aborted); reject(new Error('Native request revoked')) }
    if (signal.aborted) aborted()
    else signal.addEventListener('abort', aborted, { once: true })
    void pending.then(resolve, reject).finally(() => { signal.removeEventListener('abort', aborted) })
  })
}
