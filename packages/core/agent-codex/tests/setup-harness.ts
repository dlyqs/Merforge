/** Loader composition and real subprocess/transport; external peer only is simulated. */
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { vi } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { CodexSetupOwnerId } from '../src/setup-types.ts'
import { fixture } from './harness.ts'
export const owner = brandString<CodexSetupOwnerId>('11111111-1111-4111-8111-111111111111')
export const other = brandString<CodexSetupOwnerId>('22222222-2222-4222-8222-222222222222')
export async function setup(mode: Record<string, boolean | string> = {}, loginTimeoutMs = 300000) {
  const { ctx, root } = await fixture(false, false, 300000, loginTimeoutMs)
  await writeFile(join(root, 'setup-mode.json'), JSON.stringify(mode))
  vi.spyOn(ctx.subprocess, 'spawn').mockRestore()
  const spawn = ctx.subprocess.spawn.bind(ctx.subprocess)
  const children: ReturnType<typeof spawn>[] = []
  vi.spyOn(ctx.subprocess, 'spawn').mockImplementation((spec) => {
    const child = spawn({ ...spec, cwd: root, env: { HOME: root, CODEX_HOME: root },
      argv: [process.execPath, fileURLToPath(new URL('./fixtures/setup-peer.mjs', import.meta.url))] })
    children.push(child); return child
  })
  return { ctx, root, children, service: ctx.codexSetup,
    command: (value: object) => writeFile(join(root, 'fixture-command.json'), JSON.stringify(value)),
    calls: async () => (await readFile(join(root, 'calls.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line) as string) }
}
