import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  assertDesktopHostPackageFiles,
  desktopWorkspacePackageDirectories,
  selectDesktopPackageClosure,
  type PackedDesktopPackage,
} from '../scripts/prepare-package-set.ts'

function packed(name: string, manifest: Record<string, unknown> = {}): PackedDesktopPackage {
  return { tarball: `${name}.tgz`, manifest: { name, version: '1.0.0', ...manifest } }
}

describe('desktop package-set selection', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('does not select a packaging target when imported as a library', async () => {
    vi.stubEnv('DSH_DESKTOP_TARGET_PLATFORM', 'linux')
    vi.stubEnv('DSH_DESKTOP_TARGET_ARCH', 'x64')
    vi.resetModules()
    await expect(import('../scripts/prepare-package-set.ts')).resolves.toHaveProperty('prepareDesktopPackageSet')
  })

  it('packs only the Desktop Host workspace closure', () => {
    const directories = desktopWorkspacePackageDirectories()
    expect(directories).toContain('apps/desktop-host')
    expect(directories).toContain('packages/bundle/web-app')
    expect(directories).toContain('apps/web')
    expect(directories).toContain('packages/core/agent-codex')
    expect(directories).toContain('packages/subagent/codex-runtime')
    expect(directories).toContain('packages/workspace/organization-execution')
    expect(directories.every(directory => !directory.includes('\\'))).toBe(true)
    expect(directories.some(directory => directory.startsWith('vendor/') || directory.startsWith('native/'))).toBe(false)
    expect(directories).not.toContain('apps/cli')
    expect(directories).not.toContain('packages/bundle/headless')
    expect(directories).not.toContain('packages/bundle/sdk-app')
    expect(directories).not.toContain('packages/bundle/acp-app')
    expect(directories).not.toContain('packages/bundle/official-services')
  })

  it('includes only the available internal production closure', () => {
    const available = new Map<string, PackedDesktopPackage>([
      ['@deepseek-ai/dsh', packed('@deepseek-ai/dsh')],
      ['@deepseek-ai/dsh-desktop-host', packed('@deepseek-ai/dsh-desktop-host', {
        dependencies: { '@deepseek-ai/dsh-base': '^1.0.0', external: '^2.0.0' },
        optionalDependencies: { '@deepseek-ai/platform-package': '1.0.0', '@deepseek-ai/missing-platform': '1.0.0' },
      })],
      ['@deepseek-ai/dsh-base', packed('@deepseek-ai/dsh-base', {
        peerDependencies: { '@deepseek-ai/cordis': '^1.0.0' },
      })],
      ['@deepseek-ai/cordis', packed('@deepseek-ai/cordis')],
      ['@deepseek-ai/platform-package', packed('@deepseek-ai/platform-package')],
      ['@deepseek-ai/unused', packed('@deepseek-ai/unused')],
    ])
    expect(selectDesktopPackageClosure(available).map(entry => entry.manifest.name)).toEqual([
      '@deepseek-ai/cordis',
      '@deepseek-ai/dsh-base',
      '@deepseek-ai/dsh-desktop-host',
      '@deepseek-ai/platform-package',
    ])
  })

  it.each([
    '@deepseek-ai/dsh-base', '@deepseek-ai/cordis', '@deepseek-ai/node-addon-system',
  ])('rejects required prepared package %s absent from the packed release inputs', (dependency) => {
    const available = new Map<string, PackedDesktopPackage>([
      ['@deepseek-ai/dsh-desktop-host', packed('@deepseek-ai/dsh-desktop-host', {
        dependencies: { [dependency]: '^1.0.0' },
      })],
    ])
    expect(() => selectDesktopPackageClosure(available)).toThrow(/unpacked package/u)
    expect(() => selectDesktopPackageClosure(new Map([
      ['@deepseek-ai/dsh', packed('@deepseek-ai/dsh')],
    ]))).toThrow(/omit @deepseek-ai\/dsh-desktop-host/u)
  })

  it('rejects official service packages reintroduced through the Host closure', () => {
    const available = new Map<string, PackedDesktopPackage>([
      ['@deepseek-ai/dsh-desktop-host', packed('@deepseek-ai/dsh-desktop-host', {
        dependencies: { '@deepseek-ai/dsh-session-log-deepseek': '1.0.0' },
      })],
      ['@deepseek-ai/dsh-session-log-deepseek', packed('@deepseek-ai/dsh-session-log-deepseek')],
    ])
    expect(() => selectDesktopPackageClosure(available)).toThrow(/official service .* forbidden/u)
  })

  it.each(['@deepseek-ai/dsh-office-to-pdf', '@deepseek-ai/dsh-plugin-manager',
    '@deepseek-ai/dsh-ptc-runtime-node', '@deepseek-ai/dsh-tool-workflow'])
  ('rejects pruned features reintroduced through the Host closure: %s', (name) => {
    const available = new Map<string, PackedDesktopPackage>([
      ['@deepseek-ai/dsh-desktop-host', packed('@deepseek-ai/dsh-desktop-host', {
        dependencies: { [name]: '1.0.0' },
      })],
      [name, packed(name)],
    ])
    expect(() => selectDesktopPackageClosure(available)).toThrow(/pruned feature .* forbidden/u)
  })

  it('requires the Desktop Host entry', () => {
    const files = [
      'package/lib/index.js',
      'package/desktop.patch.yml',
    ]
    expect(() => {
      assertDesktopHostPackageFiles(files)
    }).not.toThrow()
    expect(() => {
      assertDesktopHostPackageFiles(files.slice(1))
    }).toThrow(/lib\/index\.js/u)
    expect(() => {
      assertDesktopHostPackageFiles(files.slice(0, 1))
    }).toThrow(/desktop\.patch\.yml/u)
  })
})
