/** The user-installed CLI must expose every app-server field consumed by Merforge. */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { codexExecutableArgv } from '../src/process.ts'

const command = (() => {
  try { return codexExecutableArgv() }
  catch (error) { void error; return undefined /* Offline fixtures run without a local CLI. */ }
})()
interface Schema {
  properties?: Record<string, unknown>
  definitions?: Record<string, Schema>
}
it.runIf(command !== undefined)('supports the consumed persistent and device-auth protocol in the local CLI', () => {
  const root = mkdtempSync(join(tmpdir(), 'merforge-local-codex-protocol-'))
  try {
    const env = { PATH: process.env.PATH, HOME: root, CODEX_HOME: root }
    const generate = (directory: string, experimental: boolean) => execFileSync(command![0]!, [
      ...command!.slice(1), 'app-server', 'generate-json-schema', ...experimental ? ['--experimental'] : [], '--out', directory,
    ], { env, stdio: 'pipe', timeout: 30000 })
    generate(root, true)
    const consumed: Record<string, string[]> = {
      'v2/ThreadStartParams.json': ['model', 'cwd', 'ephemeral', 'historyMode', 'allowProviderModelFallback', 'dynamicTools', 'approvalPolicy'],
      'v2/ThreadResumeParams.json': ['threadId', 'model', 'cwd', 'approvalPolicy'],
      'v2/ThreadReadParams.json': ['threadId', 'includeTurns'],
      'v2/TurnStartParams.json': ['threadId', 'input', 'effort'],
      'v2/TurnInterruptParams.json': ['threadId', 'turnId'],
      'v2/ModelListParams.json': ['cursor', 'limit'],
    }
    for (const [file, fields] of Object.entries(consumed)) {
      const schema = JSON.parse(readFileSync(join(root, file), 'utf8')) as Schema
      expect(Object.keys(schema.properties ?? {}), file).toEqual(expect.arrayContaining(fields))
    }
    const thread = JSON.parse(readFileSync(join(root, 'v2/ThreadReadResponse.json'), 'utf8')) as Schema
    expect(Object.keys(thread.definitions?.Thread?.properties ?? {})).toEqual(expect.arrayContaining([
      'id', 'model', 'cwd', 'cliVersion', 'ephemeral', 'historyMode', 'turns',
    ]))
    const stable = join(root, 'stable')
    generate(stable, false)
    for (const [file, fields] of Object.entries({
      'v2/GetAccountResponse.json': ['account', 'requiresOpenaiAuth'],
      'v2/CancelLoginAccountParams.json': ['loginId'],
      'v2/AccountLoginCompletedNotification.json': ['loginId', 'success'],
    })) {
      const schema = JSON.parse(readFileSync(join(stable, file), 'utf8')) as Schema
      expect(Object.keys(schema.properties ?? {}), file).toEqual(expect.arrayContaining(fields))
    }
  } finally { rmSync(root, { recursive: true, force: true }) }
})
