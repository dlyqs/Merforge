import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import Storage from '@deepseek-ai/dsh-storage'
import * as JsonStorage from '@deepseek-ai/dsh-storage-json'
import * as Domain from '@deepseek-ai/dsh-storage-domain'
import SessionStore from '@deepseek-ai/dsh-session'
import Jsonl from '@deepseek-ai/dsh-session-persistence-jsonl'
import Projections from '@deepseek-ai/dsh-session-projection'
import Query from '@deepseek-ai/dsh-session-query'
import Workspace from '@deepseek-ai/dsh-workspace'
import Personal from '@deepseek-ai/dsh-personal-project'
import Workflow from '../src/index.ts'
import { expect } from 'vitest'


export async function createWorkflowHarness(root: string, extras: readonly (readonly [string, unknown])[] = []) {
  const ctx = new Context()
  ctx.baseUrl = pathToFileURL(root).href + '/'
  const modules = new Map<string, unknown>([
    ['storage', Storage], ['json', JsonStorage], ['domain', Domain], ['sessions', SessionStore],
    ['jsonl', Jsonl], ['projections', Projections], ['query', Query], ['workspace', Workspace],
    ['personal', Personal], ['workflow', Workflow], ...extras,
  ])
  const config = [
    { name: 'storage' }, { name: 'json', config: { root: join(root, 'data') } },
    { name: 'domain', config: { backend: 'json' } }, { name: 'sessions' },
    { name: 'jsonl', config: { root: join(root, 'sessions'), compression: 'none' } },
    { name: 'projections' }, { name: 'query' }, { name: 'workspace' }, { name: 'personal' }, { name: 'workflow' }, ...extras.map(([name]) => ({ name })),
  ]
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, JSON.stringify(config))
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  ctx.loader.internal = { version: 'v2', async import(specifier: string) { return modules.get(specifier) } } as never
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  expect([...ctx.loader.entries()].filter(entry => entry.fiber === undefined && !entry.disabled)).toEqual([])
  return { ctx, root, service: ctx.personalWorkflow }
}
