import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { describe, expect, it } from 'vitest'
import { openCodexRuntime, type CodexRuntimeSpec, type CodexInputId } from '../src/index.ts'

const fixture = fileURLToPath(new URL('./fixtures/app-server.mjs', import.meta.url))

describe('offline app-server over the real subprocess owner', () => {
  it('persists two turns, reopens the same thread, scrubs ambient credentials and reaches process quiescence', async () => {
    const root = mkdtempSync(join(tmpdir(), 'merforge-codex-process-'))
    const ctx = new Context()
    const previous = process.env.FIXTURE_SECRET_TOKEN
    process.env.FIXTURE_SECRET_TOKEN = 'fixture-only-secret'
    try {
      await ctx.plugin(LocalSubprocessRuntime)
      const children: ReturnType<typeof ctx.subprocess.spawn>[] = []
      const spec: CodexRuntimeSpec = { cwd: root, env: { HOME: root, CODEX_HOME: root, FIXTURE_EXPLICIT: 'retained' },
        experimentalApi: true,
        limits: { startupTimeoutMs: 5000, rpcTimeoutMs: 1000, turnTimeoutMs: 1000, interruptTimeoutMs: 100,
          disposeGraceMs: 10, maxFrameBytes: 65536, maxEarlyEvents: 10, maxTurnBytes: 65536,
          modelCacheMs: 100, modelPageSize: 10, maxModelPages: 2 },
        spawn: (spec) => {
          const child = ctx.subprocess.spawn({ ...spec, argv: [process.execPath, fixture] })
          children.push(child)
          return child
        } }
      const selection = { mode: 'native', model: 'fixture', effort: 'medium' } as const
      const runtime = await openCodexRuntime(spec)
      let id
      try {
        id = (await runtime.startThread(selection)).id
        for (let turn = 1; turn <= 2; turn++) {
          const receipt = await runtime.send({ inputId: brandString<CodexInputId>(`input-${turn}`), texts: [`round ${turn}`],
            persistIntent: async () => {} })
          expect(await receipt.terminal).toMatchObject({ status: 'completed', finalText: 'offline fixture answer' })
        }
      } finally { await runtime.dispose() }
      const reopened = await openCodexRuntime(spec)
      try {
        const thread = await reopened.resumeThread(id, selection)
        expect(thread.turns).toHaveLength(2)
        expect(thread.turns.flatMap(turn => turn.items)).toHaveLength(4)
        expect(await reopened.readThread(id)).toMatchObject({ id })
      } finally { await reopened.dispose() }
      expect(JSON.parse(readFileSync(join(root, 'fixture-env.json'), 'utf8'))).toEqual({ scrubbed: true, explicit: true })
      for (const child of children) {
        expect(await child.waitForExit()).toBe(true)
        expect(Object.keys(await child.done).sort()).toEqual(['exitCode', 'signal'])
        expect(child.stdout?.listenerCount('data')).toBe(0)
      }
    } finally {
      if (previous === undefined) delete process.env.FIXTURE_SECRET_TOKEN
      else process.env.FIXTURE_SECRET_TOKEN = previous
      await ctx.fiber.dispose()
      rmSync(root, { recursive: true, force: true })
    }
  })
})
