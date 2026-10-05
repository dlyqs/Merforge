// @vitest-environment jsdom
/** Native settings feedback and explicit fixed actions, without opening a page. */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { CodexSetupSnapshot, CodexSetupAttemptId } from '@deepseek-ai/dsh-agent-codex/setup-types'
import { CodexCard, type CodexCardInjected } from '../src/client/CodexCard.tsx'
import type { CodexSetupState } from '../src/client/codex-source.ts'
import { en } from '../src/client/locales.ts'
afterEach(cleanup)
const snapshot: CodexSetupSnapshot = {
  revision: 1, runtime: { version: '0.153.4', status: 'ready' },
  account: { status: 'known', value: { kind: 'none', requiresOpenaiAuth: true } },
  catalog: { status: 'error', models: [], category: 'login-required' }, login: { status: 'idle' },
}
function props(state: CodexSetupState): InjectFace<CodexCardInjected> {
  return { useCodex: select => select(state), t: key => en[key], ensure: vi.fn(),
    detect: vi.fn(async () => {}), start: vi.fn(async () => {}), cancel: vi.fn(async () => {}),
    copy: vi.fn(async () => {}), openVerification: vi.fn(async () => {}) }
}
describe('Codex card', () => {
  it('keeps missing payload discoverable and distinguishes authentication from empty models', () => {
    const p = props({ busy: false, copied: false, view: { snapshot: { ...snapshot,
      runtime: { version: '0.153.4', status: 'error', category: 'payload' },
      catalog: { status: 'empty', models: [] },
    } } })
    const view = render(<CodexCard {...p} />)
    expect(screen.getByRole('heading', { name: en['codex.title'] })).toBeTruthy()
    expect(screen.getByText(en['codex.error.payload'])).toBeTruthy()
    expect(screen.getByRole<HTMLButtonElement>('button', { name: en['codex.start'] }).disabled).toBe(true)
    view.rerender(<CodexCard {...props({ busy: false, copied: false, view: { snapshot: {
      ...snapshot, account: { status: 'known', value: { kind: 'none', requiresOpenaiAuth: false } },
      catalog: { status: 'empty', models: [] },
    } } })} />)
    expect(screen.getByText(en['codex.account.notRequired'])).toBeTruthy()
    expect(screen.queryByRole('button', { name: en['codex.start'] })).toBeNull()
  })
  it('requires user clicks for sign-in, verification, copying, cancelling and detection', () => {
    const p = props({ busy: false, copied: false, view: { snapshot } })
    const view = render(<CodexCard {...p} />)
    expect(p.start).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: en['codex.start'] }))
    expect(p.start).toHaveBeenCalledOnce()
    view.rerender(<CodexCard {...p} useCodex={select => select({ busy: false, copied: false, view: {
      snapshot: { ...snapshot, login: { status: 'waiting' } },
      device: { attemptId: 'attempt' as CodexSetupAttemptId, userCode: 'CODE' },
    } })} />)
    expect(screen.getByLabelText<HTMLInputElement>(en['codex.code']).value).toBe('CODE')
    for (const [key, callback] of [['codex.copy', p.copy], ['codex.open', p.openVerification], ['codex.cancel', p.cancel]] as const) {
      fireEvent.click(screen.getByRole('button', { name: en[key] }))
      expect(callback).toHaveBeenCalledOnce()
    }
    expect(screen.getByRole<HTMLButtonElement>('button', { name: en['codex.detect'] }).disabled).toBe(true)
    view.rerender(<CodexCard {...p} />)
    fireEvent.click(screen.getByRole('button', { name: en['codex.detect'] }))
    expect(p.detect).toHaveBeenCalledOnce()
  })
  it('shows safe waiting state in other windows without a model list', () => {
    render(<CodexCard {...props({ busy: false, copied: false, view: { snapshot: {
      ...snapshot, login: { status: 'waiting' },
      account: { status: 'known', value: { kind: 'chatgpt', requiresOpenaiAuth: true } },
      catalog: { status: 'ready', models: [{ id: 'native', model: 'native', displayName: 'Native Model', isDefault: true, efforts: ['low', 'high'], defaultEffort: 'low' }] },
    } } })} />)
    expect(screen.getByText(en['codex.account.chatgpt'])).toBeTruthy()
    expect(screen.getByText(en['codex.ownerWaiting'])).toBeTruthy()
    expect(screen.queryByLabelText(en['codex.code'])).toBeNull()
    expect(screen.queryByRole('list')).toBeNull()
    expect(screen.queryByText('Native Model')).toBeNull()
    expect(screen.getByText(en['codex.models.ready'])).toBeTruthy()
  })
})
