/** User-installed Codex executable resolution and subprocess range disposal. */
import { accessSync, constants, readFileSync, realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, isAbsolute, join } from 'node:path'
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'

/**
 * Resolve the user's CLI on PATH, then conventional GUI installation directories.
 * npm wrappers run with the Host Node executable; Windows command shims never run through a shell.
 * @param env - explicit environment overrides applied over the Host environment.
 * @returns executable and optional Node wrapper argument, without app-server arguments.
 */
export function codexExecutableArgv(env: Readonly<Record<string, string>> = {}): string[] {
  const environment = { ...process.env, ...env }
  const path = Object.entries(env).find(([key]) => key.toUpperCase() === 'PATH')?.[1]
    ?? Object.entries(process.env).find(([key]) => key.toUpperCase() === 'PATH')?.[1] ?? ''
  const home = homedir()
  const directories = [...path.split(delimiter).filter(isAbsolute),
    ...process.platform === 'darwin' ? ['/opt/homebrew/bin', '/usr/local/bin'] : [],
    ...process.platform === 'win32' ? [join(environment.APPDATA ?? join(home, 'AppData', 'Roaming'), 'npm'),
      join(home, '.cargo', 'bin')] : [join(home, '.local', 'bin'), join(home, '.cargo', 'bin')]]
  const names = process.platform === 'win32' ? ['codex.exe', 'codex.cmd'] : ['codex']
  for (const directory of new Set(directories)) {
    for (const name of names) {
      const candidate = join(directory, name)
      try {
        if (!statSync(candidate).isFile()) continue
        accessSync(candidate, process.platform === 'win32' ? constants.F_OK : constants.X_OK)
      } catch (error) {
        if (error instanceof Error && 'code' in error && ['ENOENT', 'ENOTDIR', 'EACCES'].includes(String(error.code))) continue
        throw error
      }
      if (name.endsWith('.cmd')) {
        const wrapper = join(directory, 'node_modules', '@openai', 'codex', 'bin', 'codex.js')
        if (!statSync(wrapper).isFile()) throw new Error('codex-runtime: invalid local npm wrapper')
        return [process.execPath, wrapper]
      }
      const executable = realpathSync(candidate)
      if (/\.[cm]?js$/u.test(executable) && readFileSync(executable, 'utf8').startsWith('#!')) {
        return [process.execPath, executable]
      }
      return [executable]
    }
  }
  throw new Error('codex-runtime: local CLI not found')
}

/**
 * Resolve the user-installed CLI afresh for every managed connection; no bundled fallback.
 * @param env - explicit environment overrides applied over the Host environment.
 * @returns local executable and fixed stdio arguments.
 */
export function codexAppServerArgv(env: Readonly<Record<string, string>> = {}): string[] {
  return [...codexExecutableArgv(env), 'app-server', '--stdio']
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
