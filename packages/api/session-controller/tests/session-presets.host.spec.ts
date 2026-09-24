/** Session creation and adoption rules for Agent preset identity. */

import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent, AgentFactory } from '@deepseek-ai/dsh-agent'
import { agentPresetProjectionDefinition } from '@deepseek-ai/dsh-agent-preset-registry'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { afterEach, describe, expect, it } from 'vitest'
import { createSessionTestRemote } from './test-remote.ts'

/** Booted contexts and their temp roots, torn down after each test. */
const contexts: Context[] = []
const tempDirs: string[] = []
afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function stubAgent(session: Session): Agent {
  return { id: session.id, session, status: 'idle' } as unknown as Agent
}

function roster(ids: readonly string[]): unknown {
  const presetOf = (id: string): object => ({
    id,
    trust: 'system',
  })
  return {
    defaultId: ids[0],
    resolve: (id?: string) => {
      const wanted = id ?? ids[0] ?? ''
      if (!ids.includes(wanted)) {
        return Promise.reject(new RemoteError(
          'agent-preset/not-found',
          `agent-presets: preset "${wanted}" not found (available: ${ids.join(', ') || 'none'})`,
          { agentPreset: wanted, available: ids },
        ))
      }
      return Promise.resolve(presetOf(wanted))
    },
    mount: (_ctx: Context, id?: string) => Promise.resolve(presetOf(id ?? ids[0] ?? '')),
  }
}

async function harness(presets?: readonly string[]) {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-session-preset-')))
  tempDirs.push(cwd)
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  if (presets !== undefined) {
    ctx.provide('agentPresets', roster(presets) as never)
  }

  const factory: AgentFactory = {
    async createAgent(_ownerCtx, options) {
      const session = ctx.sessions.create(
        options.sessionId,
        options.meta === undefined ? {} : { meta: options.meta },
      )
      const agent = stubAgent(session)
      ;(agent as { ctx?: Context }).ctx = ctx
      await options.setup?.(ctx, agent)
      const unregister = await ctx.agents.register(agent)
      return { agent, dispose: async () => { await unregister() } }
    },
    async resume() {
      throw new Error('test harness has no persisted sessions')
    },
  }
  ctx.agents.setFactory(factory)
  const remote = createSessionTestRemote(ctx, {
    defaultModelSelection: () => ({ provider: 'test', model: 'test-model' }),
    cwd,
  })
  if (presets !== undefined) ctx.sessionProjections.register(agentPresetProjectionDefinition)
  return { ctx, remote }
}

describe('session.create Agent preset identity', () => {
  it('records standard for an explicit or omitted mode, regardless of the registry default', async () => {
    const { ctx, remote } = await harness(['minimal', 'standard'])
    for (const [id, agentPreset] of [['explicit', 'standard'], ['implicit', undefined]] as const) {
      const result = await remote.create({ sessionId: SessionId(id), ...(agentPreset ? { agentPreset } : {}) })
      expect(result.ok).toBe(true)
      expect(ctx.sessions.get(SessionId(id))?.header.agentPreset).toBe('standard')
    }
  })

  it.each(['minimal', 'ptc', 'cordis', 'custom'])('rejects the removed %s mode before creating a Session', async (agentPreset) => {
    const { ctx, remote } = await harness(['standard', agentPreset])
    const response = await remote.create({ sessionId: SessionId('removed'), agentPreset })
    expect(response).toMatchObject({ ok: false, error: { code: 'agent-preset/not-found' } })
    expect(ctx.sessions.get(SessionId('removed'))).toBeUndefined()
  })

  it('does not adopt an existing Session through a removed mode', async () => {
    const { remote } = await harness(['standard', 'minimal'])
    await remote.create({ sessionId: SessionId('existing') })
    const result = await remote.create({ sessionId: SessionId('existing'), agentPreset: 'minimal' })
    expect(result).toMatchObject({ ok: false, error: { code: 'agent-preset/not-found' } })
    await expect(remote.create({ sessionId: SessionId('existing') }))
      .resolves.toMatchObject({ ok: true, value: { agentPreset: 'standard' } })
  })

  it('leaves the header preset-less when no roster is composed', async () => {
    const { ctx, remote } = await harness()

    await remote.create({ sessionId: SessionId('s6') })

    expect(ctx.sessions.get(SessionId('s6'))?.header.agentPreset).toBeUndefined()
  })

  it('explains why a preset-less Session cannot be adopted under one', async () => {
    const { remote } = await harness()
    await remote.create({ sessionId: SessionId('s7') })

    const response = await remote.create({ sessionId: SessionId('s7'), agentPreset: 'standard' })

    expect(response).toMatchObject({
      ok: false,
      error: {
        code: 'agent-preset/conflict',
        details: {
          sessionId: 's7',
          requestedPreset: 'standard',
        },
      },
    })
    if (response.ok) throw new Error('unreachable')
    expect('existingPreset' in response.error.details).toBe(false)
    expect(response.error.message).toContain('records no agent preset')
  })
})
