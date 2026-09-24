/** Check the first-party dependency closure shipped inside Desktop. */

import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { desktopWorkspacePackageDirectories } from '../apps/desktop/scripts/prepare-package-set.ts'

const ALLOWED_EXPERIMENTAL = new Set([
  '@deepseek-ai/dsh-experimental-browser-use-chrome-devtools-mcp',
  '@deepseek-ai/dsh-experimental-browser-use-runtime',
  '@deepseek-ai/dsh-experimental-computer-use-cua-driver-native',
])
const FORBIDDEN_PRODUCT_NAMES = [
  /^@deepseek-ai\/dsh-(?:acp|headless|sdk-|official-services|session-log-deepseek|session-telemetry)/u,
  /^@deepseek-ai\/dsh-(?:deepseek-account|message-feedback|plugin-manager|office-to-pdf|ptc-runtime-node|workflow|tool-ralph)/u,
  /^@deepseek-ai\/dsh-client-ui-(?:brand-official|message-feedback|settings-account|plugin-manager|cordis|open-in-app|schedule)$/u,
]

/** Result of checking Desktop's runtime workspace dependencies. */
export interface ProductIsolationResult {
  readonly failures: string[]
  readonly packageCount: number
}

/**
 * Check Desktop's reachable first-party packages without building tarballs.
 * @param root - Repository root containing the workspace and package manifests.
 * @returns Reachable package count and forbidden distribution dependencies.
 */
export function verifyDefaultProductIsolation(root: string): ProductIsolationResult {
  const directories = desktopWorkspacePackageDirectories(root)
  const failures: string[] = []
  const required = new Set(['apps/desktop-host', 'apps/web', 'packages/bundle/base', 'packages/bundle/web-app'])
  for (const directory of directories) {
    required.delete(directory)
    const manifest = JSON.parse(readFileSync(join(root, directory, 'package.json'), 'utf8')) as { name?: string }
    const name = manifest.name
    if (typeof name !== 'string') {
      failures.push(`${directory}: missing package name`)
      continue
    }
    if (FORBIDDEN_PRODUCT_NAMES.some(pattern => pattern.test(name))) failures.push(`${directory}: ${name} is outside Desktop scope`)
    if (name.startsWith('@deepseek-ai/dsh-experimental-') && !ALLOWED_EXPERIMENTAL.has(name)) {
      failures.push(`${directory}: ${name} is not a selected Desktop provider`)
    }
  }
  for (const directory of required) failures.push(`Desktop closure omits ${directory}`)
  return { failures, packageCount: directories.length }
}

if (import.meta.main) {
  const result = verifyDefaultProductIsolation(resolve(import.meta.dirname, '..'))
  if (result.failures.length > 0) {
    for (const failure of result.failures) console.error(`verify-default-product-isolation: ${failure}`)
    process.exitCode = 1
  } else console.log(`verify-default-product-isolation: ${String(result.packageCount)} Desktop workspace packages`)
}
