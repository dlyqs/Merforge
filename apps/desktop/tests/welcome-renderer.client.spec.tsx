// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { Welcome } from '../src/client/WelcomePage.tsx'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveDesktopLocale } from '../src/locale.ts'
import type { WelcomeSaveResult } from '../src/welcome-api.ts'

afterEach(cleanup)

function mount(language = 'zh-CN') {
  cleanup()
  const api = {
    ...resolveDesktopLocale(language),
    saveApiKey: vi.fn<(value: string) => Promise<WelcomeSaveResult>>().mockResolvedValue({ ok: true }),
    skip: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  }
  const mounted = render(<Welcome api={api} />)
  const input = document.querySelector<HTMLInputElement>('#key-input')!
  const button = (id: string) => document.querySelector<HTMLButtonElement>(id)!
  const enterKey = (value: string) => { fireEvent.change(input, { target: { value } }) }
  const submit = () => { fireEvent.submit(document.querySelector('form')!) }
  const copy = () => [document.title, document.querySelector('h1')!.textContent,
    document.querySelector('#key-title')!.textContent, document.querySelector('#key-description')!.textContent,
    `${input.placeholder} [password]`,
    ...[...document.querySelectorAll('button')].map(item => `${item.textContent}${item.disabled ? ' [disabled]' : ''}`),
    '',
  ].join('\n')
  return { api, input, button, enterKey, submit, copy, unmount: mounted.unmount }
}

describe('desktop API-key welcome', () => {
  it.each(['zh-CN', 'en'])('renders localized %s key setup without account entry', async (language) => {
    const view = mount(language)
    expect(document.documentElement.lang).toBe(language)
    expect(view.input.type).toBe('password')
    expect(document.querySelector('#sign-in')).toBeNull()
    await expect(view.copy()).toMatchFileSnapshot(`./expected/welcome/${language}.expected.txt`)
  })

  it('sends one trimmed key and blocks concurrent actions until it settles', async () => {
    const view = mount()
    const saved = Promise.withResolvers<WelcomeSaveResult>()
    view.api.saveApiKey.mockReturnValue(saved.promise)
    view.enterKey('  sk-desktop-example  ')
    view.submit()
    view.submit()
    fireEvent.click(view.button('#skip-key'))
    expect(view.api.saveApiKey).toHaveBeenCalledExactlyOnceWith('sk-desktop-example')
    expect(view.api.skip).not.toHaveBeenCalled()
    expect(view.button('#save-key').disabled).toBe(true)
    await act(async () => { saved.resolve({ ok: true }); await saved.promise })
    expect(view.input.value).toBe('')
  })

  it.each(['', 'bad key', '密钥', 'DEEPSEEK_API_KEY=sk-example', '"sk-example"', '`sk-example`'])(
    'rejects invalid input before writing a credential: %s', (value) => {
      const view = mount()
      view.enterKey(value)
      view.submit()
      expect(view.api.saveApiKey).not.toHaveBeenCalled()
      expect(document.querySelector<HTMLElement>('#key-error')!.hidden).toBe(false)
      expect(view.input.getAttribute('aria-invalid')).toBe('true')
    },
  )

  it('keeps the draft after a failed write and allows retry', async () => {
    const view = mount()
    view.api.saveApiKey.mockResolvedValueOnce({ ok: false })
    view.enterKey('sk-retry')
    view.submit()
    await vi.waitFor(() => { expect(view.button('#save-key').disabled).toBe(false) })
    expect(view.input.value).toBe('sk-retry')
    expect(document.querySelector('#key-error')!.textContent).toBe(view.api.messages.welcomeKeyFailed)
    view.submit()
    await vi.waitFor(() => { expect(view.input.value).toBe('') })
  })

  it('skips without writing a credential', async () => {
    const view = mount()
    view.enterKey('sk-not-saved')
    fireEvent.click(view.button('#skip-key'))
    await vi.waitFor(() => { expect(view.api.skip).toHaveBeenCalledOnce() })
    expect(view.api.saveApiKey).not.toHaveBeenCalled()
  })
})
