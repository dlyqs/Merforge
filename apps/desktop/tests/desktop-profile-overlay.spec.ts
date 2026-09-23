import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { composeEntries, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'

const base = fileURLToPath(new URL('../../../packages/bundle/base/cordis.patch.yml', import.meta.url))
const web = fileURLToPath(new URL('../../../packages/bundle/web-app/cordis.patch.yml', import.meta.url))
const desktop = fileURLToPath(new URL('../../desktop-host/desktop.patch.yml', import.meta.url))

describe('Desktop product overlay', () => {
  it('omits official upload, account, feedback, and brand entries from Desktop composition', () => {
    const rows = composeEntries([base, web, desktop].map(file => loadOverlayPatches('desktop', file)))
    for (const id of [
      'session-log-deepseek', 'session-telemetry-otel', 'deepseek-account',
      'command-feedback', 'message-feedback', 'ui-message-feedback',
      'ui-settings-account', 'account-controller', 'ui-brand-official',
    ]) {
      expect(rows.find(row => row.id === id), id).toBeUndefined()
    }
    for (const id of ['session-persistence-jsonl', 'credentials', 'webserver', 'connection', 'ui-conversation']) {
      expect(rows.find(row => row.id === id)?.disabled, id).not.toBe(true)
    }
    expect(rows.find(row => row.id === 'web-startup')?.disabled).toBe(true)
    expect(rows.find(row => row.id === 'webserver')?.config).toMatchObject({ host: '127.0.0.1', port: 19387 })
    expect(rows.find(row => row.id === 'web-runtime')?.config).toMatchObject({ openBrowser: false, printUrl: false })
  })
})
