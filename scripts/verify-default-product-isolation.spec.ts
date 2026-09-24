import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { verifyDefaultProductIsolation } from './verify-default-product-isolation.ts'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function write(root: string, path: string, value: object | string): void {
  const file = join(root, path)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, typeof value === 'string' ? value : `${JSON.stringify(value)}\n`)
}

function fixture(extraDependency?: string): string {
  const root = mkdtempSync(join(tmpdir(), 'desktop-isolation-'))
  roots.push(root)
  write(root, 'pnpm-workspace.yaml', 'packages:\n  - apps/*\n  - packages/*/*\n')
  write(root, 'apps/desktop-host/package.json', {
    name: '@deepseek-ai/dsh-desktop-host', dependencies: {
      '@deepseek-ai/dsh-base': 'workspace:*',
      '@deepseek-ai/dsh-web-app': 'workspace:*',
      ...extraDependency === undefined ? {} : { [extraDependency]: 'workspace:*' },
    },
  })
  write(root, 'packages/bundle/base/package.json', { name: '@deepseek-ai/dsh-base' })
  write(root, 'packages/bundle/web-app/package.json', {
    name: '@deepseek-ai/dsh-web-app', dependencies: { '@deepseek-ai/dsh-web-frontend': 'workspace:*' },
  })
  write(root, 'apps/web/package.json', { name: '@deepseek-ai/dsh-web-frontend' })
  return root
}

it('accepts the current Desktop package closure', () => {
  expect(verifyDefaultProductIsolation(resolve(import.meta.dirname, '..')).failures).toEqual([])
})

it('rejects a non-Desktop distribution package reached through the Host', () => {
  const root = fixture('@deepseek-ai/dsh-sdk-client')
  write(root, 'packages/sdk/client/package.json', { name: '@deepseek-ai/dsh-sdk-client' })
  expect(verifyDefaultProductIsolation(root).failures.join('\n')).toContain('outside Desktop scope')
})

it('rejects an unselected experimental provider reached through the Host', () => {
  const root = fixture('@deepseek-ai/dsh-experimental-new-provider')
  write(root, 'packages/experimental/new-provider/package.json', {
    name: '@deepseek-ai/dsh-experimental-new-provider',
  })
  expect(verifyDefaultProductIsolation(root).failures.join('\n')).toContain('not a selected Desktop provider')
})
