/** Read the shared UI language preference through the authenticated local Host RPC API. */

import { randomUUID } from 'node:crypto'

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Read the saved language preference for the Desktop shell.
 * @param authenticatedUrl - URL supplied by the running Desktop Host.
 * @param send - Electron session fetch, retaining the Web authentication cookie.
 * @returns A reader for the shared language preference.
 */
export async function connectDesktopLocale(
  authenticatedUrl: string,
  send: (input: string, init?: RequestInit) => Promise<Response>,
): Promise<{ readLocalePreference(): Promise<string | null> }> {
  const origin = new URL(authenticatedUrl).origin
  const authenticated = await send(authenticatedUrl, { credentials: 'include' })
  await authenticated.body?.cancel()
  if (!authenticated.ok) throw new Error('desktop locale: Web authentication failed')
  return {
    async readLocalePreference() {
      const rpcId = randomUUID()
      const method = 'settings/describe'
      const response = await send(new URL(`/api/${method}`, origin).href, {
        method: 'POST', credentials: 'include', redirect: 'error',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId, method, payload: { args: {} } }),
      })
      if (!response.ok) throw new Error('desktop locale: Web request failed')
      const envelope: unknown = await response.json()
      if (!record(envelope) || envelope.type !== 'server-response' || envelope.rpcId !== rpcId
        || !record(envelope.result) || envelope.result.ok !== true
        || !record(envelope.result.value) || !Array.isArray(envelope.result.value.namespaces)) {
        throw new Error('desktop locale: Web RPC failed')
      }
      const locale: unknown = envelope.result.value.namespaces.find((item: unknown) => record(item) && item.ns === 'locale')
      if (!record(locale) || !record(locale.value)
        || (locale.value.preference !== undefined && typeof locale.value.preference !== 'string')) {
        throw new Error('desktop locale: invalid preference')
      }
      return locale.value.preference ?? null
    },
  }
}
