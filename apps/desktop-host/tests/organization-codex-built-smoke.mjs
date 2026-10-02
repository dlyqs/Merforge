/** Published private IPC/HTTPS/native executor smoke after Desktop build; no window or live account. */
import { createRequire } from 'node:module'
import { kit, bootBuiltOrganization } from './organization-execution-built-kit.mjs'
import { executionScenario } from './organization-execution-fixture.mjs'
import { executionChild } from './organization-execution-child.mjs'
const require = createRequire(new URL('../../desktop/package.json', import.meta.url))
for (const executable of [process.execPath, require('electron')]) {
  await executionScenario({ ...kit, native: true, bootOrganization: config => bootBuiltOrganization(config, executable) },
    root => executionChild(executable, root, true))
}
console.log('organization Codex built smoke passed: Node + Electron Node mode, private IPC/HTTPS/SQLite/JSONL, native turns, human wait, cold reopen, submission and acceptance')
