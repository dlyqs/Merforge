import { execFile } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

const execute = promisify(execFile)
describe('published Codex runtime without a model or window', () => {
  it('runs persistent send/read/resume under plain Node and the real managed-range provider', async () => {
    const root = mkdtempSync(join(tmpdir(), 'merforge-codex-built-'))
    try {
      const { stdout, stderr } = await execute(process.execPath, [
        fileURLToPath(new URL('./fixtures/built-driver.mjs', import.meta.url)),
        new URL('../lib/index.js', import.meta.url).href,
        fileURLToPath(new URL('./fixtures/app-server.mjs', import.meta.url)), root,
      ], { timeout: 15000, env: { ...process.env, FIXTURE_SECRET_TOKEN: 'fixture-only', NODE_OPTIONS: '' } })
      expect(stderr).toBe('')
      expect(JSON.parse(stdout)).toEqual({ id: 'persistent-fixture', completed: 'completed', turns: 1, exited: [true, true] })
      const intent = JSON.parse(readFileSync(join(root, 'intent.json'), 'utf8')) as { inputId: string; params: object }
      const history = JSON.parse(readFileSync(join(root, 'fixture-history.json'), 'utf8')) as { turns: Array<{ items: object[] }> }
      expect(intent).toMatchObject({ inputId: 'built-input', params: { clientUserMessageId: 'built-input' } })
      expect(history.turns[0]?.items[0]).toMatchObject({ type: 'userMessage', clientId: intent.inputId })
      expect(JSON.parse(readFileSync(join(root, 'fixture-env.json'), 'utf8'))).toEqual({ scrubbed: true, explicit: true })
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
})
