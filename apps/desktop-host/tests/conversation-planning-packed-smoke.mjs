/** Verify Desktop dependency reachability and actual packed planning resources after the full build. */
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createRequire } from 'node:module'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
const execute = promisify(execFile), repository = resolve(import.meta.dirname, '../../..')
const require = createRequire(new URL('../../desktop/package.json', import.meta.url))
const pnpm = join(dirname(require.resolve('pnpm')), 'bin/pnpm.mjs')
const root = await mkdtemp(join(tmpdir(), 'planning-packed-'))
const expected = new Map([
  ['@deepseek-ai/dsh-organization-conversation', ['lib/index.js', 'lib/types/protocol.js']],
  ['@deepseek-ai/dsh-skill-dev-workflow', ['lib/index.js', 'assets/SKILL.md']],
  ['@deepseek-ai/dsh-client-ui-organization', ['lib/index.js', 'lib/client.js']],
  ['@deepseek-ai/dsh-client-ui-personal-workflow', ['lib/index.js', 'lib/client.js']],
])
const manifests = new Map()
async function visit(path) {
  const manifest = JSON.parse(await readFile(path, 'utf8'))
  if (manifests.has(manifest.name)) return
  manifests.set(manifest.name, { path, manifest })
  const resolver = createRequire(path)
  for (const name of Object.keys({ ...manifest.dependencies, ...manifest.peerDependencies })) {
    if (name.startsWith('@deepseek-ai/')) await visit(resolver.resolve(`${name}/package.json`))
  }
}
try {
  await visit(join(repository, 'apps/desktop-host/package.json'))
  for (const [name, required] of expected) {
    const entry = manifests.get(name)
    assert.ok(entry, `Desktop closure omits ${name}`)
    const directory = dirname(entry.path)
    await execute(process.execPath, [pnpm, '--dir', directory, 'pack', '--pack-destination', root], { cwd: repository, timeout: 30000 })
    const tarball = join(root, `${name.replace(/^@/, '').replace('/', '-')}-${entry.manifest.version}.tgz`)
    const { stdout } = await execute('tar', ['-tzf', tarball])
    const files = new Set(stdout.trim().split(/\r?\n/))
    for (const path of required) assert.ok(files.has(`package/${path}`), `${name} omits ${path}`)
    const exported = value => typeof value === 'string' ? [value] : Object.values(value).flatMap(exported)
    // Source wildcard aliases are repository-only; published runtime/type leaves must exist.
    const leaves = Object.entries(entry.manifest.exports).filter(([key]) => !key.startsWith('./src/')).map(([, value]) => value)
    for (const path of leaves.flatMap(exported)) assert.ok(files.has(`package/${path.replace(/^\.\//, '')}`), `${name} missing export ${path}`)
    if (name.endsWith('skill-dev-workflow')) {
      const { stdout: method } = await execute('tar', ['-xOzf', tarball, 'package/assets/SKILL.md'])
      assert.ok(method.includes('workflow_assess')); assert.ok(method.includes('workflow_propose'))
    }
  }
  console.log('conversation planning packed smoke passed: Desktop closure, four npm tarballs, export files, method resource and Client bundles')
} finally { await rm(root, { recursive: true, force: true }) }
