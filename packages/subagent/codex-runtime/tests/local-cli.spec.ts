/** Local executable discovery never resolves an application-owned Codex package. */
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { codexExecutableArgv, codexAppServerArgv } from '../src/process.ts'

const files = vi.hoisted(() => ({ stat: vi.fn(), access: vi.fn(), realpath: vi.fn(), read: vi.fn() }))
vi.mock('node:fs', async original => ({
  ...await original<typeof import('node:fs')>(),
  statSync: files.stat, accessSync: files.access, realpathSync: files.realpath, readFileSync: files.read,
}))
afterEach(() => { vi.resetAllMocks() })

function installed(path: string) {
  files.stat.mockImplementation((candidate: string) => {
    if (candidate === path) return { isFile: () => true }
    throw Object.assign(new Error('missing'), { code: 'ENOENT' })
  })
  files.realpath.mockImplementation((candidate: string) => candidate)
}

it('prefers an absolute executable from the requested PATH and rechecks each call', () => {
  const directory = process.platform === 'win32' ? 'C:\\tools' : '/user/tools'
  const path = join(directory, process.platform === 'win32' ? 'codex.exe' : 'codex')
  installed(path)
  expect(codexAppServerArgv({ PATH: directory })).toEqual([path, 'app-server', '--stdio'])
  files.stat.mockImplementation(() => { throw Object.assign(new Error('missing'), { code: 'ENOENT' }) })
  expect(() => codexAppServerArgv({ PATH: directory })).toThrow('local CLI not found')
})

it.runIf(process.platform !== 'win32')('runs a local npm Node wrapper without relying on env node', () => {
  installed('/user/bin/codex')
  files.realpath.mockReturnValue('/user/npm/bin/codex.js')
  files.read.mockReturnValue('#!/usr/bin/env node\n')
  expect(codexExecutableArgv({ PATH: '/user/bin' })).toEqual([process.execPath, '/user/npm/bin/codex.js'])
})

it.runIf(process.platform === 'darwin')('finds Homebrew Codex when a GUI launch has a minimal PATH', () => {
  installed('/opt/homebrew/bin/codex')
  expect(codexExecutableArgv({ PATH: '/usr/bin:/bin' })).toEqual(['/opt/homebrew/bin/codex'])
})

it('reports missing local CLI without using a bundled fallback', () => {
  files.stat.mockImplementation(() => { throw Object.assign(new Error('missing'), { code: 'ENOENT' }) })
  expect(() => codexExecutableArgv({ PATH: '' })).toThrow('local CLI not found')
})

it('preserves unexpected filesystem failures', () => {
  files.stat.mockImplementation(() => { throw new Error('unreadable filesystem') })
  expect(() => codexExecutableArgv({ PATH: '' })).toThrow('unreadable filesystem')
})
