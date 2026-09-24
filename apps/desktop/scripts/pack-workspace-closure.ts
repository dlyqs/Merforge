/** Pack only first-party packages reachable from the private Desktop Host. */

import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { pnpmInvocation } from '../../../scripts/pnpm-invocation.ts'
import { validateTarballPayload } from '../../../scripts/publication-payload.ts'
import { tarballFiles } from '../../../scripts/tarball.ts'
import { desktopWorkspacePackageDirectories } from './prepare-package-set.ts'

const REPOSITORY_ROOT = resolve(import.meta.dirname, '..', '..', '..')

function pack(directory: string, destination: string, validatePayload: boolean): Promise<void> {
  const manifest = JSON.parse(readFileSync(join(REPOSITORY_ROOT, directory, 'package.json'), 'utf8')) as {
    name: string
    version: string
  }
  const invocation = pnpmInvocation(['--dir', directory, 'pack', '--pack-destination', destination])
  return new Promise((resolvePack, rejectPack) => {
    const child = spawn(invocation.command, invocation.args, { cwd: REPOSITORY_ROOT, stdio: 'inherit' })
    child.once('error', rejectPack)
    child.once('close', (code, signal) => {
      if (code !== 0) {
        rejectPack(new Error(`desktop pack: ${directory} exited with ${String(code ?? signal)}`))
        return
      }
      const file = `${manifest.name.replace(/^@/u, '').replace('/', '-')}-${manifest.version}.tgz`
      try {
        const files = tarballFiles(join(destination, file))
        if (files.length === 0) throw new Error(`desktop pack: ${manifest.name} produced an empty tarball`)
        if (validatePayload) validateTarballPayload(files, manifest.name)
        resolvePack()
      } catch (error) { rejectPack(error) }
    })
  })
}

/**
 * Pack a selected set of workspace packages into a clean directory.
 * @param directories - Repository-relative package directories.
 * @param destination - Output directory for npm tarballs.
 * @param validatePayload - Apply the first-party source/map exclusion policy.
 * @returns Resolves after all tarballs have been checked.
 */
export async function packWorkspaceDirectories(
  directories: readonly string[], destination: string, validatePayload: boolean,
): Promise<void> {
  rmSync(destination, { recursive: true, force: true })
  mkdirSync(destination, { recursive: true })
  let cursor = 0
  await Promise.all(Array.from({ length: Math.min(6, directories.length) }, async () => {
    while (cursor < directories.length) {
      const directory = directories[cursor++]
      if (directory !== undefined) await pack(directory, destination, validatePayload)
    }
  }))
  console.log(`desktop pack: ${String(directories.length)} workspace packages`)
}

/**
 * Pack the reachable first-party packages for Desktop preparation.
 * @param destination - Output directory for npm tarballs.
 * @returns Resolves after the Desktop package closure has been packed.
 */
export async function packDesktopWorkspaceClosure(destination: string): Promise<void> {
  await packWorkspaceDirectories(desktopWorkspacePackageDirectories(), destination, true)
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { out: { type: 'string' } }, allowPositionals: false })
  if (values.out === undefined) throw new Error('desktop pack: --out is required')
  await packDesktopWorkspaceClosure(resolve(REPOSITORY_ROOT, values.out))
}
