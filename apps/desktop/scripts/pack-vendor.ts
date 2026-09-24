/** Pack vendored Cordis dependencies for Desktop's local runtime installer. */

import { globSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { packWorkspaceDirectories } from './pack-workspace-closure.ts'

const REPOSITORY_ROOT = resolve(import.meta.dirname, '..', '..', '..')

/**
 * Pack every vendored workspace package that Desktop may resolve.
 * @param destination - Output directory for vendor tarballs.
 * @returns Resolves after all vendor tarballs have been checked.
 */
export async function packDesktopVendor(destination: string): Promise<void> {
  const directories = globSync('vendor/*/package.json', { cwd: REPOSITORY_ROOT }).sort()
    .map(path => path.slice(0, -'/package.json'.length))
  await packWorkspaceDirectories(directories, destination, false)
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { out: { type: 'string' } }, allowPositionals: false })
  if (values.out === undefined) throw new Error('desktop vendor pack: --out is required')
  await packDesktopVendor(resolve(REPOSITORY_ROOT, values.out))
}
