/** Desktop compilation separates Host emission from consumers of generated Remote declarations. */
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { desktopProjects } from './build.ts'
import { desktopBundleDirectories } from './desktop-build-projects.ts'

it('bundles shared client dependencies while leaving applications to their own builders', () => {
  const directories = desktopBundleDirectories(resolve(import.meta.dirname, '..'))
  expect(directories).toContain('packages/client/web')
  expect(directories).toContain('packages/client/store')
  expect(directories).toContain('packages/client/ui-primitives')
  expect(directories.every(directory => directory.startsWith('packages/') && !directory.includes('\\'))).toBe(true)
})

it('selects phase-specific leaf configs for Desktop dependencies', () => {
  const root = resolve(import.meta.dirname, '..')
  const directories = ['packages/api/job-controller', 'packages/client/ui-settings', 'packages/core/agent']
  const host = desktopProjects(root, directories, 'host').map(path => resolve(path))
  const client = desktopProjects(root, directories, 'client').map(path => resolve(path))
  for (const directory of directories.slice(0, 2)) {
    expect(host).toContain(resolve(root, directory, 'tsconfig.host.json'))
    expect(host).not.toContain(resolve(root, directory, 'tsconfig.client.json'))
    expect(client).toContain(resolve(root, directory, 'tsconfig.client.json'))
    expect(client).not.toContain(resolve(root, directory, 'tsconfig.host.json'))
    expect([...host, ...client]).not.toContain(resolve(root, directory, 'tsconfig.json'))
  }
  expect(host).toContain(resolve(root, 'packages/core/agent/tsconfig.json'))
})
