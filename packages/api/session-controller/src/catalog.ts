/** Shared projection of the live LLM registry into the browser model catalog. */

import type {} from '@deepseek-ai/dsh-agent-codex'
import type { Context } from '@deepseek-ai/cordis'
import type {
  ModelCatalog,
  ModelReasoning,
  ModelSelection,
} from './types.ts'

/**
 * Build the browser model catalog without requiring a Session.
 * @param ctx - Host context carrying the live LLM registry.
 * @param defaultSelection - deployment default used before a Session selects a model.
 * @returns successful non-empty provider groups and isolated provider failures.
 */
export async function buildModelCatalog(
  ctx: Context,
  defaultSelection: ModelSelection = ctx.agentDefaultModel.currentSelection(),
): Promise<ModelCatalog> {
  const providers = ctx.llm.listProviders()
  const catalog = await Promise.all(providers.map(async (provider) => {
    try {
      const models = await ctx.llm.listModels(provider.id)
      const entries = await Promise.all(models.map(async (model) => {
        const resolved = await ctx.llm.resolveModelInfo(provider.id, model.id)
        const reasoning: ModelReasoning | undefined = resolved.reasoning === undefined
          ? undefined
          : {
            efforts: resolved.reasoning.efforts.map(effort => ({
              id: effort.id,
              name: effort.name,
              ...(effort.description === undefined ? {} : { description: effort.description }),
            })),
            ...(resolved.reasoning.defaultEffort === undefined
              ? {}
              : { defaultEffort: resolved.reasoning.defaultEffort }),
          }
        return {
          id: model.id,
          name: model.name,
          ...(model.description === undefined ? {} : { description: model.description }),
          ...(reasoning === undefined ? {} : { reasoning }),
        }
      }))
      return {
        kind: 'group' as const,
        group: { id: provider.id, name: provider.name, models: entries },
      }
    } catch (error) {
      return {
        kind: 'failure' as const,
        failure: {
          id: provider.id,
          name: provider.name,
          message: error instanceof Error ? error.message : String(error),
        },
      }
    }
  }))
  const native = await Promise.all(ctx.agents.listDrivers().map(async (provider) => {
    try {
      const discovered = await provider.catalog()
      return { kind: 'group' as const, group: { id: provider.kind, backend: provider.kind, name: 'Codex',
        ...(discovered.runtimeVersion === undefined ? {} : { runtimeVersion: discovered.runtimeVersion }),
        models: discovered.models.map(model => ({ id: model.id, name: model.name,
          reasoning: { efforts: model.efforts.map(id => ({ id, name: id })), defaultEffort: model.defaultEffort } })) } }
    } catch (error: unknown) {
      const snapshot = ctx.get('codexSetup')?.snapshot()
      const setupReason = snapshot?.runtime.category ?? (snapshot?.account.status === 'error' ? snapshot.account.category : undefined) ?? snapshot?.catalog.category ?? 'catalog'
      void error
      return { kind: 'failure' as const, failure: { id: provider.kind, name: 'Codex', message: `codex-setup: ${setupReason}`, setupReason } }
    }
  }))
  return {
    default: { ...defaultSelection },
    routableProviders: [...providers.map(provider => provider.id), ...native.flatMap(entry => entry.kind === 'group' ? [entry.group.id] : [])],
    groups: [...catalog, ...native].flatMap(item => item.kind === 'group' ? [item.group] : [])
      .filter(group => group.models.length > 0),
    failures: [...catalog, ...native].flatMap(item => item.kind === 'failure' ? [item.failure] : []),
  }
}
