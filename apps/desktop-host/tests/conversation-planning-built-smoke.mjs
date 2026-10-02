/** Published planning-to-delivery through private authority and employee Host processes; no windows. */
import { createRequire } from 'node:module'
import { kit } from './conversation-planning-built-kit.mjs'
import { bootBuiltOrganization } from './organization-execution-built-kit.mjs'
import { executionChild } from './organization-execution-child.mjs'
import { planningScenario } from './conversation-planning-fixture.mjs'
const require = createRequire(new URL('../../desktop/package.json', import.meta.url))
const executable = process.argv.includes('--electron') ? require('electron') : process.execPath
await planningScenario({ ...kit, bootOrganization: config => bootBuiltOrganization(config, executable) },
  root => executionChild(executable, root), root => executionChild(executable, root, false, './conversation-planning-host.mjs'))
console.log(`conversation planning built smoke passed: ${process.argv.includes('--electron') ? 'Electron Node' : 'Node'} private IPC/HTTPS, normal goal, plan revision, employee conversations, human wait, cold reopen, rework and verified CSV delivery`)
