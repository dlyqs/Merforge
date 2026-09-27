/** Real private organization composition shared by HTTPS and native WorkGraph tests. */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { bootOrganization } from '../../../../apps/desktop-host/src/organization-boot.ts'
import { initialize, addMember, password } from '../../../workspace/organization/tests/harness.ts'
import { workgraphSaveSchema, workgraphGrantSchema, workgraphPageSchema } from '@deepseek-ai/dsh-organization/workgraph'
import { receiptSchema } from '@deepseek-ai/dsh-organization/protocol'
import { organizationRequest } from '../src/transport.ts'
import { expect } from 'vitest'

export { password }
export async function workgraphHarness() {
  const root = await mkdtemp(join(tmpdir(), 'organization-workgraph-https-'))
  const config = { api: { directory: join(root, 'service'), host: '127.0.0.1', port: 0, names: ['127.0.0.1'], eventPollMs: 20 } }
  const app = await bootOrganization(config)
  const close = async () => { await app.close(); await rm(root, { recursive: true, force: true }) }
  try {
    const owner = await initialize(app.authority)
    const member = await addMember(app.authority, owner.token, owner.organizationId, 'reader')
    const trust = { ...app.ready, origin: `https://127.0.0.1:${app.ready.port}`, timeoutMs: 5000, maxResponseBytes: 1048576 }
    const call = (path: string, body?: unknown, token = owner.token) => organizationRequest(trust, body === undefined ? 'GET' : 'POST', '/organization/v1' + path, body, token)
    const project = receiptSchema.parse((await call('/projects', { kind: 'create-project', operationId: randomUUID(), organizationId: owner.organizationId, name: 'Graph project' })).body)
    for (const membershipId of [owner.membershipId, member.membershipId]) expect((await call('/grants', {
      kind: 'set-grant', operationId: randomUUID(), organizationId: owner.organizationId, projectId: project.projectId,
      membershipId, actions: ['read', 'write'], expectedVersion: 0,
    })).status).toBe(200)
    const rootId = randomUUID(), x = randomUUID(), y = randomUUID(), phaseId = randomUUID()
    const task = (id: string, parentTaskId: string | null, goal: string) => ({ id, parentTaskId, goal, phaseId,
      scope: 'scope', acceptance: ['accepted'], artifacts: [], required: true, dependsOn: [], suggestedMembershipId: null })
    const save = workgraphSaveSchema.parse({ organizationId: owner.organizationId, projectId: project.projectId, planId: randomUUID(),
      operationId: randomUUID(), expectedRevision: 0, definition: { taskId: rootId, phases: [{ id: phaseId, title: 'Prepare' }], tasks: [
        task(rootId, null, 'HIDDEN_ROOT'), task(x, rootId, 'Visible task'), task(y, rootId, 'HIDDEN_TASK'),
      ] } })
    expect((await call('/workgraph/save', save)).status).toBe(200)
    const query = { organizationId: save.organizationId, projectId: save.projectId, planId: save.planId }
    const grant = workgraphGrantSchema.parse({ ...query, taskId: x, membershipId: member.membershipId, scope: 'subtree',
      actions: ['read'], expectedVersion: 0, operationId: randomUUID() })
    const receipt = receiptSchema.parse((await call('/workgraph/grant', grant)).body)
    const page = async (token = member.token) => workgraphPageSchema.parse((await call('/workgraph/tasks', query, token)).body)
    return { root, config, app, owner, member, trust, call, save, query, grant, receipt, page, close }
  } catch (error) { await close(); throw error }
}
