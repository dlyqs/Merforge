/** Narrow the external JSON protocol and redact account information. */
import { brandString } from '@deepseek-ai/dsh-brand'
import type { CodexAccount, CodexAccountNotification, CodexDeviceCode, CodexLoginId, CodexEffort, CodexModel, CodexThread, CodexThreadId } from './types.ts'
import { CODEX_RUNTIME_VERSION } from './process.ts'

/**
 * Require a protocol JSON object without echoing its contents.
 * @param value - incoming JSON value.
 * @returns the object fields.
 */
export function protocolObject(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('codex-runtime: invalid protocol object')
  return value as Record<string, unknown>
}
/**
 * Require a non-empty native identifier or name.
 * @param value - incoming JSON field.
 * @returns the admitted string.
 */
export function protocolString(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error('codex-runtime: invalid protocol string')
  return value
}
/**
 * Require a supported effort from the fixed schema.
 * @param value - native effort field.
 * @returns the effort tag.
 */
export function protocolEffort(value: unknown): CodexEffort {
  switch (value) {
    case 'none': case 'minimal': case 'low': case 'medium': case 'high': case 'xhigh': case 'max': case 'ultra': return value
    default: throw new Error('codex-runtime: invalid effort')
  }
}
/**
 * Remove native account email, plan and authentication material.
 * @param value - account/read response.
 * @returns safe account availability.
 */
export function parseAccount(value: unknown): CodexAccount {
  const response = protocolObject(value)
  if (typeof response.requiresOpenaiAuth !== 'boolean') throw new Error('codex-runtime: invalid account state')
  const kind = response.account == null ? 'none' : protocolObject(response.account).type
  switch (kind) {
    case 'none': case 'apiKey': case 'chatgpt': case 'amazonBedrock': return { kind, requiresOpenaiAuth: response.requiresOpenaiAuth }
    default: throw new Error('codex-runtime: unknown account type')
  }
}
/**
 * Parse the visible native model page and effort choices.
 * @param value - model/list response.
 * @returns safe picker models and next pagination cursor.
 */
export function parseModels(value: unknown): { models: CodexModel[]; cursor: string | null } {
  const response = protocolObject(value)
  if (!Array.isArray(response.data)) throw new Error('codex-runtime: invalid model page')
  const models = response.data.map((value: unknown): CodexModel => {
    const model = protocolObject(value)
    if (typeof model.isDefault !== 'boolean' || typeof model.hidden !== 'boolean' || !Array.isArray(model.supportedReasoningEfforts)) throw new Error('codex-runtime: invalid model')
    const efforts = model.supportedReasoningEfforts.map((item: unknown) => protocolEffort(protocolObject(item).reasoningEffort))
    const defaultEffort = protocolEffort(model.defaultReasoningEffort)
    if (!efforts.includes(defaultEffort)) throw new Error('codex-runtime: unavailable default effort')
    return Object.freeze({ id: protocolString(model.id), model: protocolString(model.model),
      displayName: protocolString(model.displayName), isDefault: model.isDefault,
      efforts: Object.freeze(efforts), defaultEffort })
  })
  const cursor = response.nextCursor == null ? null : protocolString(response.nextCursor)
  return { models, cursor }
}
/**
 * Require a persistent legacy thread with complete typed turn history.
 * @param value - thread/start, thread/read or thread/resume response.
 * @returns Host-only thread fields and typed native history.
 */
export function parseThread(value: unknown): CodexThread {
  const response = protocolObject(value)
  if (response.turnsBackwardsCursor != null || response.itemsBackwardsCursor != null
    || response.initialTurnsPage != null) {
    throw new Error('codex-runtime: incomplete thread history')
  }
  const thread = protocolObject(response.thread)
  if (thread.ephemeral !== false || thread.cliVersion !== CODEX_RUNTIME_VERSION || thread.historyMode !== 'legacy' || !Array.isArray(thread.turns)) {
    throw new Error('codex-runtime: incompatible persistent thread')
  }
  const turns = thread.turns.map((value: unknown) => {
    const turn = protocolObject(value)
    protocolString(turn.id)
    if (!['completed', 'interrupted', 'failed', 'inProgress'].includes(protocolString(turn.status))
      || !Array.isArray(turn.items) || (turn.itemsView !== undefined && turn.itemsView !== 'full')) throw new Error('codex-runtime: incomplete turn history')
    turn.items.forEach((item: unknown) => { protocolObject(item) })
    return turn
  })
  return { id: brandString<CodexThreadId>(protocolString(thread.id)), cwd: protocolString(thread.cwd), model: protocolString(thread.model),
    ephemeral: false, runtimeVersion: CODEX_RUNTIME_VERSION, turns }
}

/**
 * Require the pinned official device verification endpoint.
 * @param value - native response URL.
 * @returns validated URL, retained only on Host.
 */
export function deviceVerificationUrl(value: unknown): string {
  const text = protocolString(value)
  const url = new URL(text)
  if (url.href !== 'https://auth.openai.com/codex/device'
    || url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') {
    throw new Error('codex-runtime: invalid verification endpoint')
  }
  return url.href
}
/**
 * Parse only the device-code response, excluding all other authentication methods.
 * @param value - account/login/start response.
 * @returns ephemeral grant owned by this connection.
 */
export function parseDeviceCode(value: unknown): CodexDeviceCode {
  const response = protocolObject(value)
  if (response.type !== 'chatgptDeviceCode') throw new Error('codex-runtime: unexpected login method')
  return { loginId: brandString<CodexLoginId>(protocolString(response.loginId)), userCode: protocolString(response.userCode),
    verificationUrl: deviceVerificationUrl(response.verificationUrl) }
}
/**
 * Crop a completed notification, preserving absent correlation without raw error text.
 * @param value - native notification parameters.
 * @returns safe completion observation.
 */
export function parseLoginCompleted(value: unknown): CodexAccountNotification {
  const response = protocolObject(value)
  if (typeof response.success !== 'boolean') throw new Error('codex-runtime: invalid login completion')
  return { type: 'completed', success: response.success,
    loginId: response.loginId == null ? null : brandString<CodexLoginId>(protocolString(response.loginId)) }
}
