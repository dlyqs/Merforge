/** Local native dispatch journal and pure private transcript presentation. */
import { z } from 'zod'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { CodexThreadId, CodexTurnId, CodexInputId } from '@deepseek-ai/dsh-codex-runtime'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ExecutionReport } from './protocol.ts'
import { actionDigest } from './action-guard.ts'
const threadId = z.string().min(1).transform(brandString<CodexThreadId>)
const inputId = z.string().min(1).transform(brandString<CodexInputId>)
const turnId = z.string().min(1).transform(brandString<CodexTurnId>)
const item = z.record(z.string(), z.json())
/** Durable native association, input and observed protocol settlements; never shared organization history. */
export const nativeJournalSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('diagnostic'), category: z.literal('cleanup') }).strict(),
  z.object({ kind: z.literal('preparing'), cwd: z.string().min(1), directory: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('bound'), threadId, cwd: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('intent'), threadId, inputId, params: z.json() }).strict(),
  z.object({ kind: z.literal('receipt'), threadId, inputId, turnId }).strict(),
  z.object({ kind: z.literal('item'), threadId, turnId, item }).strict(),
  z.object({ kind: z.literal('result'), threadId, inputId, turnId: turnId.nullable(),
    status: z.enum(['completed', 'interrupted', 'failed', 'unknown']), finalText: z.string().nullable(),
    items: z.array(item), recovered: z.boolean(), usage: z.literal('unknown') }).strict(),
  z.object({ kind: z.literal('decision'), threadId, turnId, requestId: z.string().min(1), inboxId: z.uuid(),
    digest: z.string().regex(/^[a-f0-9]{64}$/), decision: z.enum(['accept', 'decline']) }).strict(),
  z.object({ kind: z.literal('human'), threadId, turnId, requestId: z.string().min(1),
    method: z.string().min(1), params: z.json(), digest: z.string().regex(/^[a-f0-9]{64}$/), inboxId: z.uuid() }).strict(),
])
/** Parsed private journal record. */
export type NativeJournal = z.output<typeof nativeJournalSchema>
declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Employee-only native thread and dispatch observations in an isolated Run log. */
    'organization/execution-native': NativeJournal
  }
}
/**
 * Validate native relationships independently of the binding store.
 * @param events - Complete isolated Run log.
 * @returns Current association and dispatch facts; an uncertain intent is never replayed.
 */
export function nativeJournal(events: readonly SessionEvent[]): {
  status: NonNullable<ExecutionReport['native']>['status']
  preparing: Extract<NativeJournal, { kind: 'preparing' }> | undefined
  bound: Extract<NativeJournal, { kind: 'bound' }> | undefined
  intent: Extract<NativeJournal, { kind: 'intent' }> | undefined
  receipt: Extract<NativeJournal, { kind: 'receipt' }> | undefined
  result: Extract<NativeJournal, { kind: 'result' }> | undefined
} {
  let status: NonNullable<ExecutionReport['native']>['status'] = 'unbound'
  let preparing: Extract<NativeJournal, { kind: 'preparing' }> | undefined
  let bound: Extract<NativeJournal, { kind: 'bound' }> | undefined
  let intent: Extract<NativeJournal, { kind: 'intent' }> | undefined
  let receipt: Extract<NativeJournal, { kind: 'receipt' }> | undefined
  const humans = new Map<string, string>()
  const decisions = new Set<string>()
  const inputs = new Set<string>()
  let result: Extract<NativeJournal, { kind: 'result' }> | undefined
  for (const event of events) {
    if (event.type !== 'organization/execution-native') continue
    const data = nativeJournalSchema.parse(event.data)
    if (data.kind === 'diagnostic') continue
    if (data.kind === 'preparing') {
      if (status !== 'unbound') throw new Error('organization-execution: native-log-mismatch')
      preparing = data; status = 'preparing'; continue
    }
    if (data.kind === 'bound') {
      if (status !== 'preparing' || bound || preparing?.cwd !== data.cwd) throw new Error('organization-execution: native-log-mismatch')
      bound = data; status = 'ready'; continue
    }
    if (!bound || data.threadId !== bound.threadId) throw new Error('organization-execution: native-log-mismatch')
    switch (data.kind) {
      case 'intent':
        if (!['ready', 'completed', 'interrupted', 'failed'].includes(status)) throw new Error('organization-execution: native-log-mismatch')
        if (inputs.has(data.inputId)) throw new Error('organization-execution: native-log-mismatch')
        inputs.add(data.inputId); intent = data; receipt = undefined; result = undefined; status = 'sending'; break
      case 'receipt':
        if (status !== 'sending' || receipt || intent?.inputId !== data.inputId) throw new Error('organization-execution: native-log-mismatch')
        receipt = data; status = 'running'; break
      case 'result':
        if (intent?.inputId !== data.inputId || receipt && receipt.turnId !== data.turnId
          || result && (result.status !== 'unknown' || !data.recovered)) throw new Error('organization-execution: native-log-mismatch')
        result = data; status = data.status; break
      case 'decision':
        if (decisions.has(data.inboxId) || humans.get(data.inboxId) !== data.digest) throw new Error('organization-execution: native-log-mismatch')
        decisions.add(data.inboxId)
        if (receipt?.turnId !== data.turnId) throw new Error('organization-execution: native-log-mismatch')
        break
      case 'human':
        if (humans.has(data.inboxId)) throw new Error('organization-execution: native-log-mismatch')
        humans.set(data.inboxId, data.digest)
        if (receipt?.turnId !== data.turnId) throw new Error('organization-execution: native-log-mismatch')
        break
      case 'item':
        if (receipt?.turnId !== data.turnId) throw new Error('organization-execution: native-log-mismatch')
        break
      default: return assertNever(data)
    }
  }
  return { status, preparing, bound, intent, receipt, result }
}
/**
 * Fingerprint the exact reviewed local native journal, without reading task files.
 * @param events - Independently durable local Run events.
 * @returns Review token for explicit recovery or continuation.
 */
export function nativeBaseline(events: readonly SessionEvent[]): string { return actionDigest(events) }
/**
 * Present known native items using text fields; discard protocol identifiers and unknown payloads.
 * @param value - Validated native JSON item.
 * @returns Private text entry, or no presentation for unsupported items.
 */
export function nativeItemEntry(value: Record<string, unknown>): ExecutionReport['entries'][number] | undefined {
  if (value.type === 'agentMessage' && typeof value.text === 'string') return { role: 'assistant', text: value.text }
  if (value.type === 'commandExecution') {
    const text = [value.command, value.aggregatedOutput].filter((part): part is string => typeof part === 'string').join('\n')
    if (text) return { role: 'tool', text }
  }
  if (value.type === 'fileChange' && Array.isArray(value.changes)) {
    const paths = value.changes.flatMap((change: unknown) => {
      const parsed = z.object({ path: z.string() }).safeParse(change)
      return parsed.success ? [parsed.data.path] : []
    })
    if (paths.length) return { role: 'tool', text: paths.join('\n') }
  }
  return undefined
}

/**
 * Present a cancelled native callback for private human review without exposing protocol fields.
 * @param params - Host-only native request JSON.
 * @param digest - Exact request fingerprint retained in the shared approval.
 * @returns Text details suitable for the employee-only transcript.
 */
export function nativeRequestEntry(params: unknown, digest: string): ExecutionReport['entries'][number] {
  const data = z.object({ command: z.string().nullable().optional(), reason: z.string().nullable().optional(),
    questions: z.array(z.object({ question: z.string() })).optional(),
    arguments: z.object({ prompt: z.string() }).optional(),
  }).loose().parse(params)
  return { role: 'tool', text: [digest, data.command, data.reason, data.arguments?.prompt,
    ...(data.questions?.map(question => question.question) ?? [])].filter((text): text is string => typeof text === 'string').join('\n') }
}

function assertNever(value: never): never { throw new Error(`organization-execution: unknown journal record ${String(value)}`) }
