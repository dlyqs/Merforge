/** Run after the complete Desktop build; Node and Electron Node mode, no window. */
import { createRequire } from 'node:module'
import { kit, bootBuiltOrganization } from './organization-execution-built-kit.mjs'
import { executionScenario } from './organization-execution-fixture.mjs'
import { executionChild } from './organization-execution-child.mjs'

const require = createRequire(new URL('../../desktop/package.json', import.meta.url))
for (const executable of [process.execPath, require('electron')]) {
  const runtimeKit = { ...kit, bootOrganization: config => bootBuiltOrganization(config, executable) }
  await executionScenario(runtimeKit, root => executionChild(executable, root))
  for (const fault of ['revoked', 'lost-response', 'server-restart']) {
    await executionScenario(runtimeKit, root => executionChild(executable, root), fault)
  }
}
console.log('organization execution built smoke passed: Node + Electron private IPC, real HTTPS/tools/SQLite/JSONL, human wait, Host reopen, rework and parent delivery')
