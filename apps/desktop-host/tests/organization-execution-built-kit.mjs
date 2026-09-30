/** Published exports only; no source loaders. */
import { Context } from '../../../vendor/cordis/lib/index.js'
import Loader from '../../../vendor/loader/lib/index.js'
import Include from '../../../vendor/include/lib/index.js'
import Storage from '../../../packages/storage/storage/lib/index.js'
import * as Json from '../../../packages/storage/storage-json/lib/index.js'
import * as Domain from '../../../packages/storage/storage-domain/lib/index.js'
import Sessions from '../../../packages/core/session/lib/index.js'
import Agents from '../../../packages/core/agent/lib/index.js'
import Jsonl from '../../../packages/session/session-persistence-jsonl/lib/index.js'
import OrganizationContext from '../../../packages/workspace/organization-context/lib/index.js'
import { OrganizationConnection } from '../../../packages/host/organization-connection/lib/index.js'
import { LlmAdapter } from '../../../packages/llm/llm/lib/index.js'
import OrganizationExecution, { executionInputsDigest, executionRequestSchema } from '../../../packages/workspace/organization-execution/lib/index.js'
import { openOrganizationExecution, readOrganizationExecution } from '../../desktop/lib/types/organization-execution.js'
import { OrganizationIntegration } from '../../desktop/lib/types/organization-integration.js'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, symlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DesktopOrganizationProcess } from '../../desktop/lib/types/organization-process.js'
import { organizationRequest } from '../../../packages/api/organization-api/lib/types/transport.js'

/** Start the shipped private process; all post-initialization observations use HTTPS. */
export async function bootBuiltOrganization(config, executable = process.execPath) {
  const runtime = await mkdtemp(join(tmpdir(), 'execution-authority-'))
  const controller = new DesktopOrganizationProcess(executable, runtime, 20000)
  try {
    await mkdir(join(runtime, 'node_modules', '@deepseek-ai'), { recursive: true })
    await symlink(resolve(import.meta.dirname, '..'), join(runtime, 'node_modules', '@deepseek-ai', 'dsh-desktop-host'), 'junction')
    const ready = await controller.start(config)
    assert.equal(ready.phase, 'ready')
    const trust = { ...ready, origin: `https://127.0.0.1:${ready.port}`, timeoutMs: 5000, maxResponseBytes: 1048576 }
    async function call(path, input, token) {
      const response = await organizationRequest(trust, 'POST', '/organization/v1' + path, input, token)
      assert.equal(response.status, 200)
      return response.body
    }
    return { ready, authority: {
      initialize: input => controller.control('initialize', input),
      login: input => call('/login', input),
      readIntegration: async (token, input, consume) => consume(await call('/integration/read', input, token)),
      downloadArtifact: async (token, input, consume) => consume(await call('/delivery/download', input, token)),
    }, async close() { try { await controller.stop() } finally { await rm(runtime, { recursive: true, force: true }) } } }
  } catch (error) {
    try { await controller.stop() } finally { await rm(runtime, { recursive: true, force: true }) }
    throw error
  }
}
const bootOrganization = bootBuiltOrganization
export const kit = { Context, Loader, Include, LlmAdapter, OrganizationExecution, OrganizationConnection, executionInputsDigest, executionRequestSchema, bootOrganization, openOrganizationExecution, readOrganizationExecution, OrganizationIntegration, modules: new Map([['storage', Storage], ['json', Json], ['domain', Domain], ['sessions', Sessions], ['agents', Agents], ['jsonl', Jsonl], ['context', OrganizationContext]]) }
