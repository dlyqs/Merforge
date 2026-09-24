import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { composeEntries, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'

const base = fileURLToPath(new URL('../../../packages/bundle/base/cordis.patch.yml', import.meta.url))
const web = fileURLToPath(new URL('../../../packages/bundle/web-app/cordis.patch.yml', import.meta.url))
const desktop = fileURLToPath(new URL('../../desktop-host/desktop.patch.yml', import.meta.url))
const standard = fileURLToPath(new URL('../../../packages/bundle/web-app/presets/standard.patch.yml', import.meta.url))

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
    for (const id of ['session-persistence-jsonl', 'credentials', 'webserver', 'connection', 'ui-conversation',
      'personal-project', 'personal-project-runtime', 'ui-personal']) {
      expect(rows.find(row => row.id === id)?.disabled, id).not.toBe(true)
    }
    expect(rows.find(row => row.id === 'web-startup')?.disabled).toBe(true)
    expect(rows.find(row => row.id === 'webserver')?.config).toMatchObject({ host: '127.0.0.1', port: 19387 })
    expect(rows.find(row => row.id === 'web-runtime')?.config).toMatchObject({ openBrowser: false, printUrl: false })
  })

  it('keeps coding tools and opt-in browser and computer providers without pruned tools', () => {
    const rows = composeEntries([base, web, standard, desktop].map(file => loadOverlayPatches('desktop', file)))
    const removed = ['plugin-manager', 'tool-plugin-manager', 'open-in-app', 'ui-open-in-app',
      'ui-plugin-manager', 'ui-cordis', 'office-to-pdf', 'ui-workflow-run', 'ui-schedule',
      'ptc-runtime', 'workflow-ptc', 'tool-workflow', 'tool-ralph', 'cordis-inspect-providers']
    for (const id of removed) expect(rows.find(row => row.id === id), id).toBeUndefined()
    for (const id of ['ui-sidebar-browser', 'ui-sidebar-documentpreview', 'ui-sidebar-terminal',
      'ui-sidebar-files', 'browser-use', 'computer-use']) {
      expect(rows.find(row => row.id === id)?.disabled, id).not.toBe(true)
    }
    for (const id of ['browser-use-chrome-devtools', 'computer-use-cua-driver']) {
      expect(rows.find(row => row.id === id)?.disabled, id).toBe(true)
    }
    const plugins = (rows.find(row => row.id === 'preset-standard')?.config as { plugins: { id: string }[] }).plugins
    for (const id of ['tool-bash', 'tool-pwsh', 'tool-fs', 'tool-fs-search', 'tool-jobs', 'tool-skill',
      'tool-subagent', 'tool-subagent-fork', 'tool-ask-user', 'tool-todo', 'tool-web', 'tool-goal', 'planning']) {
      expect(plugins.some(row => row.id === id), id).toBe(true)
    }
    for (const id of ['workflow-ptc', 'tool-workflow', 'tool-ralph', 'tool-cordis', 'tool-plugin-manager']) {
      expect(plugins.some(row => row.id === id), id).toBe(false)
    }
    const manifest = JSON.parse(readFileSync(new URL('../../desktop-host/package.json', import.meta.url), 'utf8')) as {
      dependencies: Record<string, string>
    }
    for (const name of ['dsh-browser-use', 'dsh-experimental-browser-use-chrome-devtools-mcp',
      'dsh-computer-use', 'dsh-experimental-computer-use-cua-driver-native']) {
      expect(manifest.dependencies).toHaveProperty(`@deepseek-ai/${name}`)
    }
  })
})
