/** Live-model corpus through real organization planning; keyless runs explicitly skip. No windows. */
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, it } from 'vitest'
import Organization, { createOrganizationToken } from '@deepseek-ai/dsh-organization'
import { conversationRequestSchema } from '@deepseek-ai/dsh-organization-conversation/protocol'
import { kit } from '../../desktop-host/tests/conversation-planning-source-kit.ts'
import { localPlanning } from '../../desktop-host/tests/conversation-planning-fixture.mjs'
import { until } from '../../desktop-host/tests/organization-execution-fixture.mjs'

it.skipIf(!process.env.DEEPSEEK_API_KEY)('classifies normal goals, clarifies one goal, modifies its saved plan and continues an assignment without creating another tree', async () => {
  const root = await mkdtemp(join(tmpdir(), 'planning-live-'))
  const base = (process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/anthropic').replace(/\/$/, '')
  const selection = { model: process.env.DEEPSEEK_MODEL ?? 'deepseek-chat', endpoint: base.endsWith('/v1') ? base : `${base}/v1` }
  const config = { authority: { planning: { ...Organization.Config.parse({ path: join(root, 'server', 'organization.sqlite') }).planning, models: [selection] } },
    api: { directory: join(root, 'server'), host: '127.0.0.1', port: 0, names: ['127.0.0.1'] } }
  let app: Awaited<ReturnType<typeof kit.bootOrganization>> | undefined
  const client = new kit.OrganizationConnection({ trustPath: join(root, 'native.json') })
  let host: Awaited<ReturnType<typeof localPlanning>> | undefined
  try {
    app = await kit.bootOrganization(config)
    const password = 'isolated planning corpus password'
    const owner = await app.authority.initialize({ operationId: randomUUID(), username: 'owner', password,
      organizationName: 'Synthetic CSV corpus', recoveryToken: createOrganizationToken() })
    await client.perform({ kind: 'probe', origin: `https://127.0.0.1:${app.ready.port}` })
    await client.perform({ kind: 'trust', fingerprint: app.ready.fingerprint })
    await client.perform({ kind: 'login', username: 'owner', password })
    await client.perform({ kind: 'select', organizationId: owner.organizationId })
    const project = await client.perform({ kind: 'command', command: { kind: 'create-project', organizationId: owner.organizationId,
      operationId: randomUUID(), name: 'Synthetic CSV only' } })
    host = await localPlanning({ ...kit, planningRoute: { ...selection, credential: 'DEEPSEEK_API_KEY',
      maxTokens: 8192, contextWindow: 1000000, idleTimeoutMs: 60000 } }, join(root, 'host'))
    const local = host
    const request = { kind: 'open', operationId: randomUUID(), organizationId: owner.organizationId,
      projectId: project.receipt!.projectId!, conversationId: randomUUID() }
    const perform = async (value: object) => {
      await until(() => client.snapshot().phase === 'ready')
      return kit.organizationConversation(client, local, conversationRequestSchema.parse(value), () => {}, new AbortController().signal)
    }
    await perform(request)
    const send = (text: string, continuation: object = {}) => perform({ ...request, kind: 'send', operationId: randomUUID(),
      route: 'new_goal', selection, text, ...continuation })
    const question = await send('What does CSV stand for? Just explain it in one sentence.')
    expect(question.result.goals.at(-1)?.proposal).toBeUndefined()
    const simple = await send('Suggest one concise filename for a CSV report; no files or project work are needed.')
    expect(simple.result.goals.at(-1)?.classification).toBe('simple')
    expect(simple.result.goals.at(-1)?.proposal).toBeUndefined()
    const vague = await send('Help our team prepare a data report. We have not chosen the data source, audience, or outputs yet.')
    expect(vague.result.goals.at(-1)?.classification).toBe('clarify')
    const goalId = vague.result.goals.at(-1)!.id
    const complex = await send('Use these synthetic rows: Alice with note hello,world; Bob with note say "hi". Deliver result.csv in UTF-8 with name,note headers and correct CSV quoting, and an independently reviewable contract.json describing columns and encoding. Both artifacts are required for final delivery. The audience is our two-person QA team. Plan the work for human review; do not execute.', { route: 'clarification', goalId })
    const planned = complex.result.goals.at(-1)!
    expect(complex.result.goals).toHaveLength(3)
    expect(planned.classification).toBe('complex')
    expect(planned.proposal?.status).toBe('shared')
    const proposal = planned.proposal!
    expect(proposal.definition!.tasks.filter(t => t.parentTaskId !== null && t.required).length).toBeGreaterThanOrEqual(2)
    const modified = await send('Update the existing plan so every artifact acceptance checklist also explicitly requires independent UTF-8 validation. Keep the same task identities, scope, and required outputs.', { route: 'modify', goalId })
    const revised = modified.result.goals.at(-1)!.proposal!
    expect(revised.planId).toBe(proposal.planId)
    expect(revised.revision).toBeGreaterThan(proposal.revision)
    const query = await send('Summarize the current task status without changing the plan.', { route: 'query', goalId })
    expect(query.result.goals.at(-1)?.proposal).toEqual(revised)
    const leaf = revised.definition!.tasks.find(task => !revised.definition!.tasks.some(child => child.parentTaskId === task.id))!
    await until(() => client.snapshot().phase === 'ready')
    const approved = await client.perform({ kind: 'assignment-command', request: { kind: 'approve-assignment', operationId: randomUUID(),
      organizationId: request.organizationId, projectId: request.projectId, planId: revised.planId,
      taskId: leaf.id, planRevision: revised.revision, assigneeId: owner.membershipId } })
    const assignmentId = approved.receipt!.assignmentId!
    const bound = { ...request, operationId: randomUUID(), conversationId: assignmentId,
      assignment: { planId: revised.planId, assignmentId } }
    await perform(bound)
    const continued = await perform({ ...bound, kind: 'send', operationId: randomUUID(), selection, route: 'query', goalId: assignmentId,
      text: 'Explain my assigned task and its acceptance checklist; do not change it.' })
    expect(continued.result.goals).toHaveLength(1)
    expect(continued.result.assignment?.state).toBe('pending')
    const login = await app.authority.login({ username: 'owner', password })
    await app.authority.readPlanning(login.token, { organizationId: request.organizationId, projectId: request.projectId,
      conversationId: request.conversationId }, (view) => {
      expect(view.plans).toHaveLength(1); expect(view.grant!.usedRequests).toBeGreaterThan(0)
    })
  } finally {
    try { await host?.close() } finally { await client.close(); await app?.close(); await rm(root, { recursive: true, force: true }) }
  }
}, 360000)
