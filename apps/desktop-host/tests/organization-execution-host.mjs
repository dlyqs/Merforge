/** Test-only Loader process: published IPC consumer, scripted model, real execution service and tools. */
import { kit } from './organization-execution-built-kit.mjs'
import { localExecution } from './organization-execution-fixture.mjs'
import { installOrganizationContextControl } from '../lib/types/organization-context.js'
import { installOrganizationExecutionControl } from '../lib/types/organization-execution.js'

const host = await localExecution({ ...kit, native: process.argv[3] === 'codex' }, process.argv[2])
const channel = { on: (event, listener) => process.on(event, listener), off: (event, listener) => process.off(event, listener),
  send: message => { if (process.connected) process.send(message) } }
installOrganizationContextControl(host.ctx, channel)
installOrganizationExecutionControl(host.ctx, channel)
let stopping
function stop() {
  return stopping ??= (async () => { await host.close(); if (process.connected) process.disconnect() })().catch(error => {
    console.error(error); process.exitCode = 1; if (process.connected) process.disconnect()
  })
}
process.on('message', message => { if (message.type === 'shutdown') void stop() })
process.once('disconnect', () => { void stop() })
process.send({ type: 'ready' })
