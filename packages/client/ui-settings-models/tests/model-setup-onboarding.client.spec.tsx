// @vitest-environment jsdom
/** First-use choices and preference-only persistence, without a page or account. */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ComponentProps } from 'react'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { ModelSetupOnboarding } from '../src/client/ModelSetupOnboarding.tsx'
import { en } from '../src/client/locales.ts'
afterEach(cleanup)
type Props = ComponentProps<typeof ModelSetupOnboarding>
function props(overrides: Partial<Props> = {}): Props {
  const unused = (() => undefined) as never
  return {
    stepId: 'model-setup', complete: vi.fn(), openSection: vi.fn(), acknowledge: vi.fn(async () => true),
    usePreference: select => select({ status: 'ready', value: {}, revision: 1, writable: true, mode: 'host', base: {}, user: {} }),
    useCodex: select => select({ busy: false, copied: false }),
    useSessions: select => select({ phase: 'ready', ids: [], byId: {}, projectionsBySession: {} }),
    useSessionStatus: unused, useSessionRetainInfo: unused, usePanelInfo: unused, useWorkspaces: unused, useResource: unused,
    ensure: vi.fn(), detect: vi.fn(async () => {}), start: vi.fn(async () => {}), cancel: vi.fn(async () => {}),
    openVerification: vi.fn(async () => {}), copy: vi.fn(async () => {}), t: key => en[key],
    ...overrides,
  }
}
describe('Desktop first-use model setup', () => {
  it.each([['setup.codex', 'codex'], ['setup.api', 'api']] as const)('opens the selected %s path after saving only the completion preference', async (key, target) => {
    const p = props()
    render(<ModelSetupOnboarding {...p} />)
    expect(p.start).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: en[key] }))
    await waitFor(() => { expect(p.openSection).toHaveBeenCalledWith('models', target) })
    expect(p.acknowledge).toHaveBeenCalledOnce()
    expect(p.complete).toHaveBeenCalledOnce()
    expect(p.start).not.toHaveBeenCalled()
  })
  it('allows deferral, and an acknowledged profile renders no recurring dialog', async () => {
    const p = props()
    const view = render(<ModelSetupOnboarding {...p} />)
    fireEvent.click(screen.getByRole('button', { name: en['setup.later'] }))
    await waitFor(() => { expect(p.complete).toHaveBeenCalledOnce() })
    view.rerender(<ModelSetupOnboarding {...p} usePreference={select => select({ status: 'ready', value: { modelSetupVersion: 'v1' }, mode: 'host', base: {}, user: {}, writable: true, revision: 1 })} />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
  it('offers Continue with native models without using API credentials or selecting a backend', async () => {
    const p = props({ useCodex: select => select({ busy: false, copied: false, view: { snapshot: {
      revision: 1, runtime: { version: '0.153.4', status: 'ready' }, account: { status: 'known', value: { kind: 'chatgpt', requiresOpenaiAuth: true } },
      catalog: { status: 'ready', models: [{ id: 'fixture', model: 'fixture', displayName: 'Fixture', isDefault: true, efforts: ['medium'], defaultEffort: 'medium' }] }, login: { status: 'idle' },
    } } }) })
    render(<ModelSetupOnboarding {...p} />)
    fireEvent.click(screen.getByRole('button', { name: en['setup.continue'] }))
    await waitFor(() => { expect(p.complete).toHaveBeenCalledOnce() })
    expect(p.openSection).not.toHaveBeenCalled()
    expect(p.start).not.toHaveBeenCalled()
  })
  it('keeps configuration failures retryable and lets Later leave even when preferences are unavailable', async () => {
    const p = props({ acknowledge: vi.fn(async () => false) })
    render(<ModelSetupOnboarding {...p} />)
    fireEvent.click(screen.getByRole('button', { name: en['setup.codex'] }))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(p.complete).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: en['setup.later'] }))
    await waitFor(() => { expect(p.complete).toHaveBeenCalledOnce() })
  })
  it('suppresses first-use choices for an existing nonblank Session without changing preferences', () => {
    const id = SessionId('existing-session')
    const p = props({ useSessions: select => select({ phase: 'ready', ids: [id], projectionsBySession: {}, byId: {
      [id]: { id, displayTitle: 'Existing', blank: false, running: false, retainedBy: {}, updatedAt: 1 },
    } }) })
    render(<ModelSetupOnboarding {...p} />)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(p.complete).toHaveBeenCalledOnce()
    expect(p.ensure).not.toHaveBeenCalled()
    expect(p.acknowledge).not.toHaveBeenCalled()
  })
})
