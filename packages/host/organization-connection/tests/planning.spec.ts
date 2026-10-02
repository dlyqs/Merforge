/** Planning uncertainty survives native restart; only receipt lookup can settle a lost response. */
import { afterEach, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { planningCommandSchema } from '@deepseek-ai/dsh-organization/planning'
import * as transport from '@deepseek-ai/dsh-organization-api/transport'
import { workgraphHarness, password } from '../../../api/organization-api/tests/workgraph-harness.ts'
import { OrganizationConnection } from '../src/index.ts'
const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => { vi.restoreAllMocks(); for (const close of cleanup.splice(0).reverse()) await close() })
it('restores an unknown charged reserve from the native journal without resubmitting it', async () => {
  const h = await workgraphHarness(); cleanup.push(h.close)
  const path = join(h.root, 'planning-trust.json')
  const connection = new OrganizationConnection({ trustPath: path }); cleanup.push(() => connection.close())
  await connection.perform({ kind: 'probe', origin: h.trust.origin })
  await connection.perform({ kind: 'trust', fingerprint: h.trust.fingerprint })
  await connection.perform({ kind: 'login', username: 'reader', password })
  await connection.perform({ kind: 'select', organizationId: h.owner.organizationId })
  const query = { organizationId: h.query.organizationId, projectId: h.query.projectId, conversationId: randomUUID() }
  await connection.planningCommand(planningCommandSchema.parse({ ...query, kind: 'open-planning', operationId: randomUUID(),
    selection: { model: 'deepseek-flash', endpoint: 'https://api.deepseek.com/anthropic/v1' } }), connection.snapshot().generation)
  const command = planningCommandSchema.parse({ ...query, kind: 'reserve-planning-request', operationId: randomUUID(),
    requestDigest: 'c'.repeat(64), inputBytes: 200, outputBytes: 200 })
  const original = transport.organizationRequest; let writes = 0
  const lost = vi.spyOn(transport, 'organizationRequest').mockImplementation(async (...args) => {
    const response = await original(...args)
    if (args[2] === '/organization/v1/planning/command') { writes++; throw new Error('lost after commit') }
    return response
  })
  await expect(connection.planningCommand(command, connection.snapshot().generation)).rejects.toThrow('unavailable')
  await expect(connection.planningCommand(command, connection.snapshot().generation)).rejects.toThrow()
  expect(connection.snapshot().pendingOperation).toBe(command.operationId)
  expect(writes).toBe(1)
  await connection.close(); lost.mockRestore()
  const journal = await readFile(path + '.pending', 'utf8')
  expect(journal).toContain(command.operationId); expect(journal).not.toContain(h.member.token)
  const reopened = new OrganizationConnection({ trustPath: path }); cleanup.push(() => reopened.close())
  await reopened.perform({ kind: 'login', username: 'reader', password })
  expect((await reopened.perform({ kind: 'reconcile' })).receipt).toMatchObject({ operationId: command.operationId,
    planning: { conversationId: query.conversationId } })
  await reopened.perform({ kind: 'select', organizationId: h.owner.organizationId })
  expect((await reopened.perform({ kind: 'planning-read', request: query })).planning?.grant?.usedRequests).toBe(1)
  expect(writes).toBe(1)
  await expect(reopened.perform({ kind: 'planning-command', command })).rejects.toThrow()
}, 20000)
