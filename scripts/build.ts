/** Build repository or Desktop artifacts and record their public client environment. */

import { spawnSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import {
  CLIENT_BUILD_RECORD_PATH,
  CLIENT_BUILD_PROFILE_SELECTOR,
  clientBuildProcessEnvironment,
  repositoryClientBuildEnvironment,
  resolveClientBuildEnvironment,
  writeClientBuildRecord,
} from './client-build-environment.ts'
import { pnpmInvocation } from './pnpm-invocation.ts'
import { desktopWorkspacePackageDirectories } from '../apps/desktop/scripts/prepare-package-set.ts'

/** Run one package script through the package manager that invoked this build. */
function runScript(script: string, environment: NodeJS.ProcessEnv): void {
  const invocation = pnpmInvocation(['run', script], environment)
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: resolve(import.meta.dirname, '..'),
    env: environment,
    stdio: 'inherit',
  })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    throw new Error(`build: ${script} exited with ${String(result.status ?? result.signal)}`)
  }
}

function runTypeScriptProjects(projects: readonly string[], environment: NodeJS.ProcessEnv): void {
  const result = spawnSync(process.execPath, [
    '--max-old-space-size=4096', './node_modules/typescript/bin/tsc', '-b', ...projects,
  ], { cwd: resolve(import.meta.dirname, '..'), env: environment, stdio: 'inherit' })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) throw new Error(`build: selected TypeScript projects exited with ${String(result.status ?? result.signal)}`)
}

/** Run the full build selected by `--profile` or `DSH_BUILD_CLIENT_PROFILE`. */
function main(): void {
  const { values } = parseArgs({
    options: { profile: { type: 'string' }, desktop: { type: 'boolean' } },
    allowPositionals: false,
  })
  const root = resolve(import.meta.dirname, '..')
  const repositoryEnvironment = repositoryClientBuildEnvironment(root, process.env)
  const profile = values.profile ?? process.env[CLIENT_BUILD_PROFILE_SELECTOR]
  const clientEnvironment = resolveClientBuildEnvironment(repositoryEnvironment, profile)
  const buildEnvironment = clientBuildProcessEnvironment(process.env, clientEnvironment)

  rmSync(resolve(root, CLIENT_BUILD_RECORD_PATH), { force: true })
  runScript('build:native-system', buildEnvironment)
  if (values.desktop === true) {
    const directories = desktopWorkspacePackageDirectories()
    runTypeScriptProjects([
      'packages/typert/generator/tsconfig.json',
      ...directories.map(directory => `${directory}/tsconfig.json`),
      'apps/desktop/tsconfig.json',
    ], buildEnvironment)
    const selectedEnvironment = { ...buildEnvironment, DSH_DESKTOP_BUILD_ONLY: '1' }
    runScript('bundle:lib:host', selectedEnvironment)
    runScript('bundle:lib:client', selectedEnvironment)
  } else {
    runScript('build:lib', buildEnvironment)
  }
  runScript('build:web', buildEnvironment)
  const record = writeClientBuildRecord(root, clientEnvironment)
  console.log(
    `build: recorded ${String(record.artifacts.fileCount)} client artifact(s) with ${String(Object.keys(record.environment).length)} public value(s)`,
  )
}

if (import.meta.main) main()
