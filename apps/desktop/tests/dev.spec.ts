/** The source launcher must reach the build before loading workspace artifacts. */
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'

it('starts the build in a checkout without built workspace dependencies', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-dev-bootstrap-'))
  onTestFinished(() => { rmSync(root, { recursive: true, force: true }) })
  const app = join(root, 'apps', 'desktop')
  mkdirSync(join(app, 'scripts'), { recursive: true })
  mkdirSync(join(app, 'src'))
  writeFileSync(join(root, 'package.json'), '{"type":"module"}\n')
  const source = resolve(import.meta.dirname, '..')
  for (const name of ['dev.ts', 'development-app.ts', 'desktop-build-paths.mjs']) {
    copyFileSync(join(source, 'scripts', name), join(app, 'scripts', name))
  }
  copyFileSync(join(source, 'src', 'host-protocol.ts'), join(app, 'src', 'host-protocol.ts'))
  const packageManager = join(root, 'package-manager.mjs')
  writeFileSync(packageManager, 'console.log("BUILD_STARTED", ...process.argv.slice(2)); process.exit(73)\n')
  // Use the real tsx launcher without the test runner's source-path aliases.
  const require = createRequire(import.meta.url)
  const result = spawnSync(process.execPath, [require.resolve('tsx/cli'), join(app, 'scripts', 'dev.ts')], {
    cwd: app,
    env: { ...process.env, npm_execpath: packageManager },
    encoding: 'utf8',
    timeout: 30_000,
  })
  expect(result.error).toBeUndefined()
  expect(result.stdout).toContain('BUILD_STARTED run build')
  expect(result.stderr).toContain('exited with 73')
  expect(result.status).toBe(1)
})
