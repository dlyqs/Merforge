/** Fixed official payload resolution and subprocess range disposal. */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'

/** Protocol baseline verified by the offline schema test. */
export const CODEX_RUNTIME_VERSION = '0.153.4' as const

/**
 * Resolve only the pinned package wrapper; no ambient PATH or shell expansion.
 * @returns Node executable, official wrapper, and fixed stdio arguments.
 */
export function codexAppServerArgv(): string[] {
  const path = createRequire(import.meta.url).resolve('@openai/codex/package.json')
  const manifest: unknown = JSON.parse(readFileSync(path, 'utf8'))
  if (manifest === null || typeof manifest !== 'object' || !('version' in manifest) || manifest.version !== CODEX_RUNTIME_VERSION
    || !('bin' in manifest) || manifest.bin === null || typeof manifest.bin !== 'object'
    || !('codex' in manifest.bin) || typeof manifest.bin.codex !== 'string') {
    throw new Error('codex-runtime: incompatible payload')
  }
  return [process.execPath, resolve(dirname(path), manifest.bin.codex), 'app-server', '--stdio']
}

/**
 * Close protocol dispatch before terminating and awaiting the complete owned range.
 * @param connection - caller-owned protocol listener disposer.
 * @param child - subprocess provider's managed-range handle.
 * @returns completion after range exit and process outcome settlement.
 */
export async function disposeCodexProcess(connection: { close(): void }, child: SubprocessHandle): Promise<void> {
  connection.close()
  try {
    child.stdin?.end()
  } catch (error) {
    // A concurrently closed stdin does not release the managed range.
    void error
  }
  child.terminate()
  await child.waitForExit()
  await child.done.catch((error: unknown) => { void error /* Spawn failures still require range disposal. */ })
}
