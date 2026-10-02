/** Test-only private IPC child using the published planning consumer, with no window. */
import { kit } from './conversation-planning-built-kit.mjs'
import { localPlanning } from './conversation-planning-fixture.mjs'
import { installOrganizationConversationControl } from '../lib/types/organization-conversation.js'
const host = await localPlanning(kit, process.argv[2])
// The IPC installer dispatches directly to the service, so own the model seam for this child.
import { scriptedPlanningFetch } from './conversation-planning-fixture.mjs'
globalThis.fetch = scriptedPlanningFetch(process.argv[2])
installOrganizationConversationControl(host.ctx, {
  on: (event, listener) => process.on(event, listener), off: (event, listener) => process.off(event, listener),
  send: message => { if (process.connected) process.send(message) },
})
let stopping
function stop() {
  return stopping ??= host.close().then(() => { if (process.connected) process.disconnect() }).catch(error => {
    console.error(error); process.exitCode = 1; if (process.connected) process.disconnect()
  })
}
process.on('message', message => { if (message.type === 'shutdown') void stop() })
process.once('disconnect', () => { void stop() })
process.send({ type: 'ready' })
