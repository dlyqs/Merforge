/** Desktop compilation separates Host emission from consumers of generated Remote declarations. */
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterEach, expect, it, vi } from 'vitest'
import { buildRepository, desktopProjects } from './build.ts'
import { desktopBundleDirectories } from './desktop-build-projects.ts'
import { writeClientBuildRecord } from './client-build-environment.ts'

vi.mock('node:child_process', async original => ({ ...await original<typeof import('node:child_process')>(), spawnSync: vi.fn() }))
vi.mock('node:fs', async original => ({ ...await original<typeof import('node:fs')>(), rmSync: vi.fn() }))
vi.mock('./client-build-environment.ts', async original => ({
  ...await original<typeof import('./client-build-environment.ts')>(),
  repositoryClientBuildEnvironment: vi.fn(() => ({})), writeClientBuildRecord: vi.fn(),
}))
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks() })

it.each([{ args: [] }, { args: ['--desktop'] }])('rebuilds the Electron shell from completed workspace exports for options $args', ({ args }) => {
  vi.stubEnv('npm_execpath', 'fixture-pnpm.cjs')
  let workspaceParser = 'previous', shellParser = 'previous'
  const stages: string[] = []
  vi.mocked(spawnSync).mockImplementation((_command, invocation) => {
    if (!Array.isArray(invocation)) throw new Error('missing build arguments')
    const script: unknown = invocation[invocation.indexOf('run') + 1]
    if (typeof script !== 'string') throw new Error('missing build script')
    stages.push(invocation.includes('run') ? script : 'tsc')
    if (script === 'bundle:lib:host' || script === 'build:lib') workspaceParser = 'current'
    if (script === 'build:desktop') shellParser = workspaceParser
    return { pid: 0, output: [null, null, null], stdout: null, stderr: null, status: 0, signal: null }
  })
  vi.mocked(writeClientBuildRecord).mockImplementation(() => {
    expect(shellParser).toBe('current')
    return { formatVersion: 1, environment: {}, artifacts: { fileCount: 0, sha256: '0'.repeat(64) } }
  })
  buildRepository(args)
  expect(stages.at(-1)).toBe('build:desktop')
  expect(stages.filter(stage => stage === 'build:desktop')).toHaveLength(1)
  expect(writeClientBuildRecord).toHaveBeenCalledOnce()
})

it('leaves no successful build record when Electron bundling fails', () => {
  vi.stubEnv('npm_execpath', 'fixture-pnpm.cjs')
  vi.mocked(spawnSync).mockImplementation((_command, invocation) => ({
    pid: 0, output: [null, null, null], stdout: null, stderr: null,
    status: Array.isArray(invocation) && invocation.includes('build:desktop') ? 1 : 0, signal: null,
  }))
  expect(() => { buildRepository([]) }).toThrow('build:desktop exited with 1')
  expect(writeClientBuildRecord).not.toHaveBeenCalled()
})

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
