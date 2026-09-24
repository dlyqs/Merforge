/** The Desktop shell reads language settings through authenticated Web RPC. */
import { describe, expect, it, vi } from 'vitest'
import { connectDesktopLocale } from '../src/locale-backend.ts'

const url = 'http://127.0.0.1:19387/?token=fixture'

function transport(preference?: string) {
  const send = vi.fn<Parameters<typeof connectDesktopLocale>[1]>(async (_input, init) => {
    if (init?.method !== 'POST') return new Response('index')
    const { rpcId, method } = JSON.parse(init.body as string) as { rpcId: string; method: string }
    expect(method).toBe('settings/describe')
    return Response.json({ type: 'server-response', rpcId, result: { ok: true,
      value: { namespaces: [{ ns: 'locale', value: preference === undefined ? {} : { preference } }] } } })
  })
  return send
}

describe('desktop locale Web operations', () => {
  it('reads the explicit preference without querying credentials', async () => {
    const send = transport('zh')
    const backend = await connectDesktopLocale(url, send)
    expect(send).toHaveBeenCalledExactlyOnceWith(url, { credentials: 'include' })
    expect(await backend.readLocalePreference()).toBe('zh')
    expect(send).toHaveBeenCalledTimes(2)
    expect(send.mock.calls[1]![0]).toBe('http://127.0.0.1:19387/api/settings/describe')
    expect(send.mock.calls[1]![1]).toMatchObject({ credentials: 'include', redirect: 'error' })
  })

  it('returns null when no preference is saved', async () => {
    const backend = await connectDesktopLocale(url, transport())
    expect(await backend.readLocalePreference()).toBeNull()
  })

  it('rejects an unauthenticated Web launch', async () => {
    const send = vi.fn<Parameters<typeof connectDesktopLocale>[1]>(async () => new Response(null, { status: 401 }))
    await expect(connectDesktopLocale(url, send)).rejects.toThrow('Web authentication failed')
  })

  it('rejects an unmatched RPC response', async () => {
    const send = transport()
    const backend = await connectDesktopLocale(url, send)
    send.mockResolvedValueOnce(Response.json({ type: 'server-response', rpcId: 'other', result: { ok: true } }))
    await expect(backend.readLocalePreference()).rejects.toThrow('Web RPC failed')
  })
})
