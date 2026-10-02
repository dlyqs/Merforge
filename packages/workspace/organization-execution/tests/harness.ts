import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import Subprocess from '@deepseek-ai/dsh-subprocess-local'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import Storage from '@deepseek-ai/dsh-storage'
import * as JsonStorage from '@deepseek-ai/dsh-storage-json'
import * as Domain from '@deepseek-ai/dsh-storage-domain'
import Sessions from '@deepseek-ai/dsh-session'
import Query from '@deepseek-ai/dsh-session-query'
import Projections from '@deepseek-ai/dsh-session-projection'
import Invariants from '@deepseek-ai/dsh-invariants'
import * as ExecutionInvariant from '../src/invariant.ts'
import Agents from '@deepseek-ai/dsh-agent'
import Jsonl from '@deepseek-ai/dsh-session-persistence-jsonl'
import { afterEach, expect, vi } from 'vitest'
import OrganizationContext from '@deepseek-ai/dsh-organization-context'
import OrganizationExecution, { executionAuthoritySchema, executionRequestSchema, executionInputsDigest } from '../src/index.ts'

const roots: string[] = []
const contexts: Context[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
export async function boot(root?: string, executionLimits?: import('../src/runtime.ts').RuntimeLimits, models?: import('zod').z.output<typeof import('../src/model.ts').localModelSchema>[], codex?: import('@deepseek-ai/dsh-codex-runtime').CodexRuntimeLimits) {
  root ??= await mkdtemp(join(tmpdir(), 'organization-context-'))
  if (!roots.includes(root)) roots.push(root)
  const ctx = new Context(); contexts.push(ctx)
  ctx.baseUrl = pathToFileURL(root).href + '/'
  const modules = new Map<string, unknown>([['subprocess', Subprocess], ['storage', Storage], ['json', JsonStorage], ['domain', Domain],
    ['sessions', Sessions], ['projections', Projections], ['query', Query], ['invariants', Invariants], ['execution-invariant', ExecutionInvariant], ['agents', Agents], ['jsonl', Jsonl], ['organization-context', OrganizationContext], ['organization-execution', OrganizationExecution]])
  const config = [{ name: 'storage' }, { name: 'json', config: { root: join(root, 'data') } },
    { name: 'domain', config: { backend: 'json' } }, { name: 'sessions' }, { name: 'agents' }, { name: 'projections' }, { name: 'query' }, { name: 'invariants' },
    { name: 'jsonl', config: { root: join(root, 'personal'), compression: 'none' } },
    { name: 'organization-context', config: { root: join(root, 'organization') } }, { name: 'organization-execution', config: { root: join(root, 'execution'), executionLimits, models, codex } }, { name: 'execution-invariant' }]
  if (codex) config.unshift({ name: 'subprocess' })
  const configPath = join(root, 'cordis.yml'); await writeFile(configPath, JSON.stringify(config))
  await ctx.plugin(Loader); ctx.loader.builtins.include = Include
  ctx.loader.internal = { version: 'v2', async import(specifier: string) { return modules.get(specifier) } } as never
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  expect([...ctx.loader.entries()].filter(entry => !entry.fiber && !entry.disabled)).toEqual([])
  return { ctx, root, service: ctx.organizationExecution }
}
export function fixture() {
  const request = executionRequestSchema.parse({ organizationId: randomUUID(), projectId: randomUUID(), planId: randomUUID(),
    assignmentId: randomUUID(), runId: randomUUID(), operationId: randomUUID(), inputs: {
      model: 'approved-model', capabilities: ['model'], materials: ['Allowed input'], messages: ['Explicit employee request'] } })
  const task = { id: randomUUID(), planId: request.planId, revision: 1, parentTaskId: null, phaseId: randomUUID(), phaseTitle: 'Work',
    goal: 'Authorized task', scope: 'Scope', acceptance: ['Review'], artifacts: [], required: true, dependsOn: [], suggestedMembershipId: null,
    assignable: true, hasUndisclosedPrerequisite: false }
  const owner = { serverId: randomUUID(), accountId: randomUUID(), organizationId: request.organizationId,
    planId: request.planId, taskId: task.id, version: 1 }
  const run = { organizationId: request.organizationId, projectId: request.projectId, planId: request.planId,
    assignmentId: request.assignmentId,
    planRevision: 1, deviceId: randomUUID(), executionDelegationId: randomUUID(), serverEpoch: randomUUID(), fencingEpoch: 1,
    configDigest: executionInputsDigest(request.inputs), id: request.runId, state: 'prepared', createdRevision: 1, version: 1 }
  const authority = executionAuthoritySchema.parse({ serverId: owner.serverId, accountId: owner.accountId,
    organizationId: owner.organizationId,
    generation: 1, requestId: randomUUID(), task,
    context: { sessionId: `organization-context:${randomUUID()}`, owner, snapshot: task, mode: 'pre-execution' },
    execution: { run, delegation: { organizationId: request.organizationId, projectId: request.projectId, planId: request.planId,
      assignmentId: request.assignmentId, planRevision: 1, deviceId: run.deviceId, delegationId: randomUUID(), capabilities: ['model'],
      budget: 3, expiresAt: Date.now() + 10000, configDigest: run.configDigest, id: run.executionDelegationId, used: 0,
      state: 'active', createdRevision: 1, version: 1 }, modelPolicy: [], assigneeId: randomUUID(), approvedBy: randomUUID(), humanRequests: [], actions: [], eligible: true, serverTime: Date.now() } })
  return { request, authority }
}
export const signal = () => new AbortController().signal
