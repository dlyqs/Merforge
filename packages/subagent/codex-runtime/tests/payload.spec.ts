/** Package-file failures reject before spawning or consulting an ambient CLI. */
import { afterEach, expect, it, vi } from 'vitest'
import { codexAppServerArgv } from '../src/process.ts'

const files = vi.hoisted(() => ({ resolve: vi.fn(), read: vi.fn() }))
vi.mock('node:module', () => ({
  createRequire: () => ({ resolve: files.resolve }),
}))
vi.mock('node:fs', async original => ({
  ...await original<typeof import('node:fs')>(),
  readFileSync: files.read,
}))
afterEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs() })

it('resolves the fixed package wrapper with an empty PATH', () => {
  vi.stubEnv('PATH', '')
  files.resolve.mockReturnValue('/fixture/codex/package.json')
  files.read.mockReturnValue(JSON.stringify({ version: '0.153.4', bin: { codex: 'bin/codex.js' } }))
  expect(codexAppServerArgv()).toEqual([process.execPath, '/fixture/codex/bin/codex.js', 'app-server', '--stdio'])
  expect(files.resolve).toHaveBeenCalledExactlyOnceWith('@openai/codex/package.json')
})

it('refuses a missing payload without looking for a PATH executable', () => {
  files.resolve.mockImplementation(() => { throw new Error('package missing') })
  expect(codexAppServerArgv).toThrow('package missing')
  expect(files.resolve).toHaveBeenCalledTimes(1)
  expect(files.read).not.toHaveBeenCalled()
})

it.each([
  { version: '0.153.3', bin: { codex: 'bin/codex.js' } },
  { version: '0.153.4' },
  { version: '0.153.4', bin: { codex: null } },
])('refuses incompatible installed payload metadata %j', (manifest) => {
  files.resolve.mockReturnValue('/fixture/codex/package.json')
  files.read.mockReturnValue(JSON.stringify(manifest))
  expect(codexAppServerArgv).toThrow('codex-runtime: incompatible payload')
})
