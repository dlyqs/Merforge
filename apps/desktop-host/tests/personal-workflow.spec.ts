/** No-page Desktop workflow composition: human Remote choices, real tools and durable CSV delivery. */
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import Agents from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import Tools, { defineTool } from '@deepseek-ai/dsh-tools'
import Skills from '@deepseek-ai/dsh-skill'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Llm, { createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { setSandboxMode } from '@deepseek-ai/dsh-sandbox-policy'
import { setApprovalPolicy } from '@deepseek-ai/dsh-user-approval'
import Typert from '@deepseek-ai/dsh-typert-registry'
import Gateway from '@deepseek-ai/dsh-api-gateway'
import * as PersonalRuntime from '@deepseek-ai/dsh-personal-project/runtime'
import * as Method from '../../../packages/skill/skill-dev-workflow/src/index.ts'
import { createWorkflowHarness } from '../../../packages/workspace/personal-workflow/tests/harness.ts'
import { ids, phase, operation, proposal, phaseDefinition } from '../../../packages/workspace/personal-workflow/tests/fixture.ts'
import { MockAdapter, textResponse, toolCallResponse } from '../../../packages/core/agent-loop/tests/mock-adapter.ts'
import { createSessionTestController } from '../../../packages/api/session-controller/tests/test-remote.ts'

it('executes approved phases across automatically created conversations with one authorization and durable evidence', async () => {
  const root = await mkdtemp(join(tmpdir(), 'desktop-phase-relay-'))
  const fixture = { name: 'phase-tools', inject: ['tools'], apply(ctx: Context) {
    ctx.effect(() => ctx.tools.register(defineTool({ name: 'phase_output', description: 'Write and read the phase artifact',
      parameters: { index: { type: 'integer', required: true } },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      async execute({ index }) {
        await mkdir(join(root, 'out'), { recursive: true })
        const path = join(root, 'out', ids[index]!)
        await writeFile(path, `verified phase ${index}`)
        return readFile(path, 'utf8')
      },
    })))
  } }
  const { ctx, service } = await createWorkflowHarness(root, [
    ['systemPrompt', SystemPrompt], ['agents', Agents], ['tools', Tools], ['skills', Skills], ['llm', Llm],
    ['method', Method], ['personalRuntime', PersonalRuntime], ['phaseTools', fixture],
  ])
  try {
    const definition = phaseDefinition(3)
    await service.save({ definition, expectedRevision: 0, operationId: operation(1) })
    await service.approve({ taskId: ids[0]!, expectedRevision: 1, operationId: operation(2) })
    const model = new MockAdapter([1, 2, 3, 0].flatMap(index => [
      toolCallResponse(`phase-${index}`, 'phase_output', { index }),
      toolCallResponse(`complete-${index}`, 'workflow_complete', { summary: `Phase ${index} checked`, acceptance: ['Verified actual output'], callIds: [`phase-${index}`] }),
    ]))
    ctx.llm.registerAdapter(['phase-worker'], model)
    await ctx.plugin(AgentLoop, { agents: [] })
    await ctx.plugin(Typert)
    const controller = createSessionTestController(ctx, { defaultModelSelection: () => ({ provider: 'phase-worker', model: 'mock' }), cwd: root })
    await ctx.plugin(Gateway, {})
    const { sessionId } = await controller.create({ cwd: root })
    const source = ctx.agents.get(sessionId)!
    setSandboxMode(source.session, 'workspace-write')
    setApprovalPolicy(source.session, 'never')
    await ctx.typertGateway.invoke({ namespace: 'session', method: 'workflowClaim', args: { request: { sessionId, planId: ids[0]!, taskId: ids[1]!, expectedRevision: 1, operationId: operation(3),
      authorization: { mode: 'auto', startPhaseId: definition.phases[0]!.id, stopPhaseId: definition.phases.at(-1)!.id,
        relayEveryPhases: 1, maxActions: 10, maxTurns: 10, maxDurationMs: 100000 } } } })
    const run = controller.workflowRun(sessionId)!
    source.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Execute the authorized phases. Keep the exact LF output requirement across every conversation.' }] }))
    await source.whenIdle()
    await vi.waitFor(() => { expect(service.execution.forSession(sessionId)?.taskId).toBe(ids[0]); expect(service.execution.forSession(sessionId)?.status).toBe('completed') }, { timeout: 10000 })
    const completed = service.execution.forSession(sessionId)!
    await ctx.agents.get(completed.sessionId)!.whenIdle()
    expect(completed).toMatchObject({ id: run.id, authorization: run.authorization, ownerEpoch: 3, turnsUsed: 4, startedAt: run.startedAt })
    expect(completed.sessions).toHaveLength(3)
    for (const id of completed.sessions) {
      using observation = await ctx.sessionQuery.observeSession(id, { projectionMode: 'none' })
      const events = observation.events
      expect(events.findLast(event => event.type === 'sandbox/mode')?.data.mode).toBe('workspace-write')
      expect(events.findLast(event => event.type === 'approval/policy')?.data.policy).toBe('never')
    }
    expect(completed.handoffs.map(item => item.status)).toEqual(['transferred', 'transferred'])
    expect(completed.sequence?.completed.map(item => item.taskId)).toEqual([ids[1], ids[2], ids[3]])
    expect(model.requests).toHaveLength(8)
    expect(JSON.stringify(model.requests[2]?.messages)).toContain('exact LF output requirement')
    expect(JSON.stringify(model.requests[4]?.messages)).toContain('Phase 1 checked')
    for (const index of [1, 2, 3, 0]) expect(await readFile(join(root, 'out', ids[index]!), 'utf8')).toBe(`verified phase ${index}`)
    expect(service.list()[0]?.tasks.every(task => task.status === 'completed')).toBe(true)
    expect(service.execution.denial(source.session)).toBe('execution-owner-revoked')
    await ctx.fiber.dispose()
    const reopened = await createWorkflowHarness(root)
    try { expect(reopened.service.execution.forSession(sessionId)).toEqual(completed) } finally { await reopened.ctx.fiber.dispose() }
  } finally { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) }
}, 30000)

it('delivers CSV through reviewed fork/join tasks while handing one branch to a third conversation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'desktop-workflow-'))
  const cwd = join(root, 'work')
  await mkdir(cwd)
  const entered = Promise.withResolvers<undefined>()
  const overlap = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  let active = 0
  let peak = 0
  const files = ['delivery.txt', 'contract.json', 'export.mjs', 'rows.json', 'result.csv']
  const content = 'name,note\nAlice,"hello,world"\nBob,"say ""hi"""\n'
  const execute = promisify(execFile)
  const fixture = {
    name: 'csv-acceptance-tools', inject: ['tools'],
    apply(ctx: Context) {
      ctx.effect(() => ctx.tools.register(defineTool({
        name: 'csv_step', description: 'Create or independently verify a CSV delivery artifact',
        parameters: { index: { type: 'integer', required: true } },
        output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
        async execute({ index }) {
          if (index === 2 || index === 3) {
            active++; peak = Math.max(peak, active)
            if (index === 3) entered.resolve(undefined)
            if (active === 2) overlap.resolve(undefined)
            await release.promise
          }
          switch (index) {
            case 1: await writeFile(join(cwd, files[index]!), JSON.stringify({ columns: ['name', 'note'], newline: 'LF', quote: 'double' })); break
            case 2: await writeFile(join(cwd, files[index]!), `import { readFile, writeFile } from 'node:fs/promises';
const rows = JSON.parse(await readFile(new URL('./rows.json', import.meta.url), 'utf8'));
const quote = value => /[",\\n]/.test(value) ? '"' + value.replaceAll('"', '""') + '"' : value;
await writeFile(new URL('./result.csv', import.meta.url), 'name,note\\n' + rows.map(row => row.map(quote).join(',')).join('\\n') + '\\n');\n`); break
            case 3: await writeFile(join(cwd, files[index]!), JSON.stringify([['Alice', 'hello,world'], ['Bob', 'say "hi"']])); break
            case 4:
              await execute(process.execPath, [join(cwd, 'export.mjs')], { cwd })
              expect(await readFile(join(cwd, files[index]!), 'utf8')).toBe(content)
              break
            case 0:
              expect(await readFile(join(cwd, 'result.csv'), 'utf8')).toBe(content)
              await writeFile(join(cwd, files[index]!), 'CSV acceptance independently checked')
              break
            default: throw new Error('Unexpected CSV step')
          }
          if (index === 2 || index === 3) active--
          return `Verified ${files[index]}`
        },
      })))
    },
  }
  const { ctx, service } = await createWorkflowHarness(root, [
    ['systemPrompt', SystemPrompt], ['agents', Agents], ['tools', Tools], ['skills', Skills], ['llm', Llm],
    ['method', Method], ['personalRuntime', PersonalRuntime], ['csv', fixture],
  ])
  try {
    const request = proposal()
    const development = '10000000-0000-4000-8000-000000000002' as typeof phase
    const acceptance = '10000000-0000-4000-8000-000000000003' as typeof phase
    const definition = { ...request.definition, phases: [
      { id: phase, title: 'CSV contract' }, { id: development, title: 'Parallel implementation and data' }, { id: acceptance, title: 'Integration and delivery' },
    ], tasks: request.definition.tasks.map((task, index) => ({
      ...task, phaseId: index === 1 ? phase : index === 2 || index === 3 ? development : acceptance, artifacts: [files[index]!], acceptance: ['Verify CSV contract and output'],
    })) }
    const planner = new MockAdapter([
      toolCallResponse('clarify', 'workflow_assess', { modeRevision: 1, decision: 'clarify', explanation: 'Confirm columns and quoting' }),
      textResponse('Which columns and quoting rules?'),
      toolCallResponse('complex', 'workflow_assess', { modeRevision: 1, decision: 'complex', explanation: 'CSV contract, parallel exporter and data, then integration' }),
      toolCallResponse('proposal', 'workflow_propose', { ...request, definition, modeRevision: 1 }),
      textResponse('Await exact-version approval'),
    ])
    ctx.llm.registerAdapter(['planner'], planner)
    const steps = (index: number) => [
      toolCallResponse(`csv-${index}`, 'csv_step', { index }),
      toolCallResponse(`done-${index}`, 'workflow_complete', { summary: `Verified ${files[index]}`, acceptance: ['Verified CSV contract and output'], callIds: [`csv-${index}`] }),
    ]
    for (const index of [0, 1, 3, 4]) ctx.llm.registerAdapter([`worker${index}`], new MockAdapter(steps(index)))
    ctx.llm.registerAdapter(['worker2'], new MockAdapter([textResponse('Retain the approved CSV contract; implementation remains pending')]))
    const receiverModel = new MockAdapter(steps(2))
    ctx.llm.registerAdapter(['receiver'], receiverModel)
    await ctx.plugin(AgentLoop, { agents: [] })
    await ctx.plugin(Typert)
    const controller = createSessionTestController(ctx, { defaultModelSelection: () => ({ provider: 'receiver', model: 'mock' }), cwd })
    await ctx.plugin(Gateway, {})
    const invoke = (method: string, args: object) => ctx.typertGateway.invoke({ namespace: 'session', method, args })
    const create = (id: string, provider: string) => ctx.agentLoop.create(SessionId(id), { provider, model: 'mock' }, { cwd })
    const send = async (agent: Agent, text = 'Execute only my selected task and verify its artifact') => {
      agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] }))
      await agent.whenIdle()
    }
    const planning = await create('csv-planner', 'planner')
    await invoke('workflowSetMode', { request: { sessionId: planning.id, enabled: true, expectedRevision: 0, operationId: operation(20) } })
    await send(planning, 'Build a CSV exporter')
    expect(service.list()).toEqual([])
    await send(planning, 'Use name,note columns, LF and doubled quotes; prepare independent data and verify integration')
    expect(service.read({ taskId: ids[0]! })).toMatchObject({ revision: 1, approval: null, definition })
    await invoke('workflowApprove', { request: { taskId: ids[0], expectedRevision: 1, operationId: operation(21) } })
    const candidates = async (agent: Agent) => (await controller.workflowCandidates(agent.id)).flatMap(plan => plan.ready)
    const claim = (agent: Agent, index: number) => invoke('workflowClaim', { request: {
      sessionId: agent.id, planId: ids[0], taskId: ids[index], expectedRevision: 1, operationId: operation(30 + index),
      authorization: { mode: 'auto_until', stopPhaseId: definition.tasks[index]!.phaseId, maxActions: 5, maxTurns: index === 2 ? 1 : 3, maxDurationMs: 100000 },
    } })
    const api = await create('csv-api', 'worker1')
    expect(await candidates(api)).toEqual([ids[1]])
    await claim(api, 1); await send(api)
    const implementation = await create('csv-implementation', 'worker2')
    const data = await create('csv-data', 'worker3')
    const integration = await create('csv-integration', 'worker4')
    expect(await candidates(integration)).toEqual([ids[2], ids[3]])
    // The source remains idle before handoff; receiving the task is not a prompt.
    await claim(implementation, 2); await claim(data, 3)
    const dataWork = send(data)
    await entered.promise
    const before = controller.workflowRun(implementation.id)!
    const handoffRequest = { sessionId: implementation.id, runId: before.id, ownerEpoch: before.ownerEpoch, operationId: operation(40), context: 'Implement the approved CSV contract; test data is being prepared independently.' }
    await invoke('workflowHandoff', { request: handoffRequest })
    const transferred = controller.workflowRun(implementation.id)!
    expect(transferred).toMatchObject({ status: 'paused', ownerEpoch: 2, authorization: before.authorization, startedAt: before.startedAt })
    expect(await invoke('workflowHandoff', { request: handoffRequest })).toEqual(transferred)
    expect(controller.workflowRun(data.id)?.status).toBe('running')
    const receiver = ctx.agents.get(transferred.sessionId)!
    expect(receiverModel.requests).toEqual([])
    const denied = await ctx.tools.execute({ name: 'csv_step', arguments: { index: 2 }, agent: implementation, callId: ToolCallId('revoked'), signal: new AbortController().signal })
    expect(denied.isError).toBe(true)
    await invoke('workflowResume', { request: { sessionId: receiver.id, runId: before.id, ownerEpoch: 2, operationId: operation(41), reconciliation: '' } })
    const implementationWork = send(receiver)
    await overlap.promise
    expect(peak).toBe(2)
    expect(await candidates(integration)).toEqual([])
    release.resolve(undefined)
    await Promise.all([dataWork, implementationWork])
    expect(controller.workflowRun(receiver.id)?.status).toBe('completed')
    expect(controller.workflowRun(data.id)?.status).toBe('completed')
    expect(await candidates(integration)).toEqual([ids[4]])
    expect(controller.workflowRun(integration.id)).toBeNull()
    await claim(integration, 4); await send(integration)
    expect(await readFile(join(cwd, 'result.csv'), 'utf8')).toBe(content)
    expect(service.list()[0]?.ready).toEqual([ids[0]])
    const parent = await create('csv-delivery', 'worker0')
    await claim(parent, 0); await send(parent)
    expect(service.list()[0]?.runs).toHaveLength(5)
    expect(service.list()[0]?.runs.every(run => run.status === 'completed' && run.evidence[0]?.files.every(file => file.sha256 !== null))).toBe(true)
    expect(service.list()[0]?.ready).toEqual([])
    await ctx.sessions.flush(receiver.session)
    await using reader = await ctx.sessionPersistence.open(receiver.id, 'read')
    expect(JSON.stringify((await reader.read()).events)).toContain('personal-workflow-execution')
    expect(controller.workflowRun(receiver.id)?.sessions).toEqual([implementation.id, receiver.id])
    const delivered = service.list()
    await ctx.fiber.dispose()
    const reopened = await createWorkflowHarness(root)
    try { expect(reopened.service.list()).toEqual(delivered) } finally { await reopened.ctx.fiber.dispose() }
  } finally {
    release.resolve(undefined)
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  }
}, 30000)

it.each(['project', 'bot'] as const)('keeps ordinary %s conversations usable with enhancement off and simple goals enabled', async (entry) => {
  const root = await mkdtemp(join(tmpdir(), 'desktop-simple-'))
  const { ctx, service } = await createWorkflowHarness(root, [
    ['systemPrompt', SystemPrompt], ['agents', Agents], ['tools', Tools], ['skills', Skills], ['llm', Llm], ['method', Method], ['personalRuntime', PersonalRuntime],
  ])
  try {
    await service.setPreferences({ enabled: false, granularity: 'balanced', expectedRevision: 0 })
    const model = new MockAdapter([
      textResponse('name,note'),
      toolCallResponse('simple', 'workflow_assess', { modeRevision: 1, decision: 'simple', explanation: 'A single CSV header needs no plan' }),
      textResponse('name,note'),
    ])
    ctx.llm.registerAdapter(['simple'], model)
    await ctx.plugin(AgentLoop, { agents: [] })
    await ctx.plugin(Typert)
    const controller = createSessionTestController(ctx, { defaultModelSelection: () => ({ provider: 'simple', model: 'mock' }), cwd: root })
    expect(controller.workflowPreferences()).toEqual({ enabled: false, granularity: 'balanced', revision: 1 })
    await expect(controller.workflowSetPreferences({ enabled: false, granularity: 'fine', expectedRevision: 1 })).resolves.toEqual({ enabled: false, granularity: 'fine', revision: 2 })
    const affiliation = entry === 'project'
      ? { projectId: (await ctx.personalProjects.createProject({ name: 'CSV project', description: '', path: root })).id }
      : { botId: (await ctx.personalProjects.createBot({ name: 'CSV bot', identity: '', direction: '', allowedSkills: ['dev-workflow'] })).id }
    const sessionId = SessionId(`simple-${entry}`)
    await controller.create({ sessionId, cwd: root, ...affiliation })
    const agent = ctx.agents.get(sessionId)!
    for (const enabled of [false, true]) {
      if (enabled) await controller.workflowSetMode({ sessionId, enabled, expectedRevision: 0, operationId: operation(1) })
      agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Give me only a CSV header with name and note columns' }] }))
      await agent.whenIdle()
      expect(service.list()).toEqual([])
      expect(controller.workflowRun(sessionId)).toBeNull()
    }
    expect(model.requests).toHaveLength(3)
    expect(model.requests[0]?.tools?.some(tool => tool.name.startsWith('workflow_')) ?? false).toBe(false)
    await ctx.sessions.flush(agent.session)
    await using reader = await ctx.sessionPersistence.open(sessionId, 'read')
    const events = (await reader.read()).events
    expect(events.some(event => event.type === 'personal-workflow/assessment' && event.data.decision === 'simple')).toBe(true)
    expect(ctx.personalProjects.affiliation(agent.session).current).toMatchObject(affiliation)
  } finally { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) }
}, 30000)
