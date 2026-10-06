/** Extract actual npm tarballs and test their exports; native account and windows are never opened. */
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createRequire } from 'node:module'
import { mkdtemp, mkdir, readFile, readdir, realpath, symlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const execute = promisify(execFile)
const repository = resolve(import.meta.dirname, '../../..')
const desktop = createRequire(new URL('../../desktop/package.json', import.meta.url))
const pnpm = join(dirname(desktop.resolve('pnpm')), 'bin/pnpm.mjs')
const root = await realpath(await mkdtemp(join(tmpdir(), 'merforge-codex-packed-')))
const packages = ['packages/subagent/codex-runtime', 'packages/core/agent-codex']
try {
  const packed = new Set()
  for (const directory of packages) {
    const manifest = JSON.parse(await readFile(join(repository, directory, 'package.json'), 'utf8'))
    packed.add(manifest.name)
    const destination = join(root, 'node_modules', manifest.name)
    await mkdir(destination, { recursive: true })
    await execute(process.execPath, [pnpm, '--dir', directory, 'pack', '--pack-destination', root], { cwd: repository, timeout: 30000 })
    const file = `${manifest.name.replace(/^@/, '').replace('/', '-')}-${manifest.version}.tgz`
    const tarball = join(root, file)
    const { stdout } = await execute('tar', ['-tzf', tarball])
    const files = stdout.trim().split(/\r?\n/)
    assert.ok(files.includes('package/lib/index.js'))
    assert.equal(files.some(file => /(?:\/src\/|\.map$|\/tests\/)/.test(file)), false)
    await execute('tar', ['-xzf', tarball, '-C', destination, '--strip-components=1'])
    const extracted = JSON.parse(await readFile(join(destination, 'package.json'), 'utf8'))
    assert.equal(extracted.name, manifest.name)
    assert.equal(extracted.version, manifest.version)
  }
  // Unchanged dependencies use the installed graph; only the two new exports come from tarballs.
  for (const directory of packages) {
    const manifest = JSON.parse(await readFile(join(repository, directory, 'package.json'), 'utf8'))
    const resolver = createRequire(join(repository, directory, 'package.json'))
    for (const name of Object.keys({ ...manifest.dependencies, ...manifest.peerDependencies })) {
      if (packed.has(name)) continue
      const destination = join(root, 'node_modules', name)
      await mkdir(dirname(destination), { recursive: true })
      try { await symlink(dirname(resolver.resolve(`${name}/package.json`)), destination, 'junction') }
      catch (error) { if (error.code !== 'EEXIST') throw error }
    }
  }
  await mkdir(join(root, 'resolver'), { recursive: true })
  const resolverPath = join(root, 'resolver/package.json')
  const resolver = createRequire(resolverPath)
  for (const name of packed) {
    assert.ok(resolver.resolve(name).startsWith(root))
    const installed = JSON.parse(await readFile(resolver.resolve(`${name}/package.json`), 'utf8'))
    for (const entry of Object.values(installed.exports)) {
      for (const path of typeof entry === 'string' ? [entry] : Object.values(entry)) {
        await readFile(join(dirname(resolver.resolve(`${name}/package.json`)), path))
      }
    }
  }
  assert.equal((await readdir(root)).filter(name => name.endsWith('.tgz')).length, 2)
  for (const executable of [process.execPath, desktop('electron')]) {
    for (const script of ['codex-built-smoke.mjs', 'codex-setup-built-smoke.mjs']) {
      const { stdout } = await execute(executable, [fileURLToPath(new URL(script, import.meta.url))], {
        cwd: repository, timeout: 30000,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', MERFORGE_CODEX_PACKED_RESOLVER: resolverPath },
      })
      assert.ok(stdout.includes(script === 'codex-built-smoke.mjs' ? 'codex built smoke:' : 'codex setup built smoke:'))
    }
  }
  console.log(`codex packed smoke passed: ${process.platform}/${process.arch}, npm tarball exports, Node + Electron Node mode, local executable argv, new-user sign-in/cancel/catalog, two turns and human replies`)
} finally { await rm(root, { recursive: true, force: true }) }
