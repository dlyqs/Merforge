/** Codex native executor provider under the sole Agent/Session factory. */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { AgentBackendSelection, AgentDriverCatalog, AgentDriverProvider } from '@deepseek-ai/dsh-agent'
import { openCodexRuntime } from '@deepseek-ai/dsh-codex-runtime'
import type { CodexRuntimeLimits, CodexRuntimeSpec } from '@deepseek-ai/dsh-codex-runtime'
import type {} from '@deepseek-ai/dsh-subprocess'
import { CodexAgent } from './agent.ts'
import { codexBridgeProjection } from './projection.ts'
export type * from './types.ts'

/** Deployment-owned native process and protocol bounds. */
export interface Config extends CodexRuntimeLimits {}
/** Plugin name. */
export const name = 'agent-codex'
/** Services needed for the native bridge and durable transcript. */
export const inject = ['agents', 'sessions', 'sessionProjections', 'subprocess']
/** Native waits and retained queues remain configurable. */
export const Config: z<Partial<Config>, Config> = z.object({
  startupTimeoutMs: z.number().step(1).min(1).max(2147483647).default(30000),
  rpcTimeoutMs: z.number().step(1).min(1).max(2147483647).default(30000),
  turnTimeoutMs: z.number().step(1).min(1).max(2147483647).default(3600000),
  interruptTimeoutMs: z.number().step(1).min(1).max(2147483647).default(10000),
  disposeGraceMs: z.number().step(1).min(1).max(2147483647).default(3000),
  maxFrameBytes: z.number().step(1).min(1).max(2147483647).default(8388608),
  maxEarlyEvents: z.number().step(1).min(1).max(2147483647).default(1024),
  maxTurnBytes: z.number().step(1).min(1).max(2147483647).default(16777216),
  modelCacheMs: z.number().step(1).min(1).max(2147483647).default(60000),
  modelPageSize: z.number().step(1).min(1).max(2147483647).default(100),
  maxModelPages: z.number().step(1).min(1).max(2147483647).default(100),
})

/**
 * Register native discovery and scoped drivers without invoking any API model.
 * @param ctx - Host plugin context.
 * @param config - validated deployment limits.
 */
export function apply(ctx: Context, config: Config): void {
  let active = true
  const agents = new Set<CodexAgent>()
  const discoveries = new Set<{ abort: AbortController; done: Promise<void>; runtime?: Awaited<ReturnType<typeof openCodexRuntime>> }>()
  const spec = (cwd: string): CodexRuntimeSpec => ({ cwd, env: {}, limits: config, experimentalApi: true,
    spawn: request => ctx.subprocess.spawn(request),
    onDiagnostic: (diagnostic) => {
      ctx.logger.debug('component=codex event=%s category=%s status=%s runtimeVersion=0.153.4',
        diagnostic.stage, diagnostic.category ?? '', diagnostic.status ?? '')
    },
  })
  const discover = async (): Promise<AgentDriverCatalog> => {
    if (!active) throw new Error('codex-runtime: unavailable')
    const done = Promise.withResolvers<void>()
    const discovery: { abort: AbortController; done: Promise<void>; runtime?: Awaited<ReturnType<typeof openCodexRuntime>> } = {
      abort: new AbortController(), done: done.promise,
    }
    discoveries.add(discovery)
    try {
      const runtime = await openCodexRuntime(spec(process.cwd()), discovery.abort.signal)
      discovery.runtime = runtime
      discovery.abort.signal.throwIfAborted()
      const catalog = await runtime.catalog(true)
      discovery.abort.signal.throwIfAborted()
      if (catalog.account.requiresOpenaiAuth && catalog.account.kind === 'none') {
        throw new Error('codex-runtime: login required; sign in with the native Codex application, then refresh models')
      }
      return { models: catalog.models.map(model => ({
        id: model.model, name: model.displayName, efforts: model.efforts, defaultEffort: model.defaultEffort,
      })) }
    } finally {
      try { await discovery.runtime?.dispose() }
      finally { discoveries.delete(discovery); done.resolve() }
    }
  }
  const provider: AgentDriverProvider = {
    kind: 'codex',
    catalog: discover,
    async resolve(model, effort): Promise<AgentBackendSelection> {
      const catalog = await discover()
      const selected = catalog.models.find(entry => entry.id === model)
      if (selected === undefined) throw new Error('codex-runtime: unavailable model; refresh models')
      const resolvedEffort = effort ?? selected.defaultEffort
      if (!selected.efforts.includes(resolvedEffort)) throw new Error('codex-runtime: unavailable reasoning effort; refresh models')
      return { kind: 'codex', model, effort: resolvedEffort, runtimeVersion: '0.153.4' }
    },
    create(factoryCtx, id, options, session) {
      if (!active) throw new Error('codex-runtime: unavailable')
      const agent = new CodexAgent(factoryCtx, id, options, session, spec, () => active)
      agents.add(agent)
      agent.ctx.effect(() => () => { agents.delete(agent) }, 'codex-agent.roster')
      return agent
    },
  }
  ctx.sessionProjections.register(codexBridgeProjection)
  ctx.agents.registerDriver(provider)
  ctx.effect(() => async () => {
    active = false
    const pendingDiscoveries = [...discoveries]
    for (const discovery of pendingDiscoveries) discovery.abort.abort()
    for (const agent of agents) agent.cancel({ kind: 'disposed' })
    const drained = await Promise.allSettled([
      ...pendingDiscoveries.map(async (discovery) => {
        try { await discovery.runtime?.dispose() }
        finally { await discovery.done }
      }),
      ...[...agents].map(agent => agent.whenIdle()),
    ])
    const failures: unknown[] = []
    for (const result of drained) if (result.status === 'rejected') failures.push(result.reason)
    if (failures.length > 0) throw new AggregateError(failures, 'Codex provider cleanup failed')
  }, 'agent-codex.native-lifetime')
}
