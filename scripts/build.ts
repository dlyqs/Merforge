/** Build repository or Desktop artifacts and record their public client environment. */

import { spawnSync } from 'node:child_process'
import { readdirSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
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
import { faceConfigs, type CompilerFace } from './ts-project.ts'

/**
 * Select package compiler configs from the corresponding repository aggregate.
 * @param root - Repository directory containing the compiler aggregates.
 * @param directories - Repository-relative Desktop dependency directories.
 * @param face - Compiler phase whose source files are ready to compile.
 * @returns Explicit compiler configs belonging to the selected phase and packages.
 */
export function desktopProjects(root: string, directories: readonly string[], face: CompilerFace): string[] {
  const selected = new Set(directories.map(directory => resolve(root, directory)))
  return [...faceConfigs(root, face).byPath.keys()].filter(path => selected.has(dirname(resolve(path))))
}

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

/**
 * Build workspace exports before bundling the Electron shell that embeds them.
 * @param args - Build options, including the Desktop package selection and client profile.
 * @returns Completion after all artifacts and the client build record are written.
 */
export function buildRepository(args: string[]): void {
  const { values } = parseArgs({
    args,
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
      ...readdirSync(resolve(root, 'vendor'), { withFileTypes: true })
        .filter(entry => entry.isDirectory()).map(entry => `vendor/${entry.name}/tsconfig.json`),
      ...desktopProjects(root, directories, 'host'),
      'apps/desktop/tsconfig.host.json',
    ], buildEnvironment)
    const selectedEnvironment = { ...buildEnvironment, DSH_DESKTOP_BUILD_ONLY: '1' }
    runScript('bundle:lib:host', selectedEnvironment)
    runTypeScriptProjects(desktopProjects(root, directories, 'client').map(path =>
      resolve(path) === resolve(root, 'apps/web/tsconfig.json') ? 'apps/web/tsconfig.desktop.json' : path), buildEnvironment)
    runScript('bundle:lib:client', selectedEnvironment)
  } else {
    runScript('build:lib', buildEnvironment)
  }
  runScript('build:web', values.desktop === true ? { ...buildEnvironment, DSH_DESKTOP_BUILD_ONLY: '1' } : buildEnvironment)
  runScript('build:desktop', buildEnvironment)
  const record = writeClientBuildRecord(root, clientEnvironment)
  console.log(
    `build: recorded ${String(record.artifacts.fileCount)} client artifact(s) with ${String(Object.keys(record.environment).length)} public value(s)`,
  )
}

if (import.meta.main) buildRepository(process.argv.slice(2))
