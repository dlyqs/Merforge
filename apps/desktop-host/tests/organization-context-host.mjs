/** Test-only built Loader child for exercising the shipped private context IPC consumer. */
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { writeFile } from 'node:fs/promises'
import { Context } from '../../../vendor/cordis/lib/index.js'
import Loader from '../../../vendor/loader/lib/index.js'
import Include from '../../../vendor/include/lib/index.js'
import Storage from '../../../packages/storage/storage/lib/index.js'
import * as Json from '../../../packages/storage/storage-json/lib/index.js'
import * as Domain from '../../../packages/storage/storage-domain/lib/index.js'
import Sessions from '../../../packages/core/session/lib/index.js'
import Jsonl from '../../../packages/session/session-persistence-jsonl/lib/index.js'
import OrganizationContext from '../../../packages/workspace/organization-context/lib/index.js'
import { installOrganizationContextControl } from '../lib/types/organization-context.js'

const root = process.argv[2]
const ctx = new Context()
ctx.baseUrl = pathToFileURL(root).href + '/'
const modules = new Map([['storage', Storage], ['json', Json], ['domain', Domain],
  ['sessions', Sessions], ['jsonl', Jsonl], ['context', OrganizationContext]])
const config = join(root, 'context.yml')
await writeFile(config, JSON.stringify([{ name: 'storage' }, { name: 'json', config: { root: join(root, 'data') } },
  { name: 'domain', config: { backend: 'json' } }, { name: 'sessions' },
  { name: 'jsonl', config: { root: join(root, 'personal'), compression: 'none' } },
  { name: 'context', config: { root: join(root, 'contexts') } }]))
await ctx.plugin(Loader); ctx.loader.builtins.include = Include
ctx.loader.internal = { version: 'v2', async import(name) { return modules.get(name) } }
await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(config).href } })
await ctx.loader.await()
installOrganizationContextControl(ctx, {
  on: (event, listener) => process.on(event, listener), off: (event, listener) => process.off(event, listener),
  send: message => process.send(message),
})
let stopping
function stop() {
  return stopping ??= (async () => { await ctx.organizationContext.verifyBindings(); await ctx.fiber.dispose(); if (process.connected) process.disconnect() })()
}
process.on('message', message => { if (message.type === 'shutdown') void stop() })
process.once('disconnect', () => { void stop() })
process.send({ type: 'ready' })
