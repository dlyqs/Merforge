/** Filesystem ownership for the Electron-managed desktop installation. */

import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

/** Stable desktop installation paths under the Merforge home. */
export interface DesktopPaths {
  readonly profile: string
  readonly lock: string
}

/**
 * Resolve the Merforge data root without reading the legacy DSH_HOME setting.
 * @param env - Process environment with an optional Merforge override.
 * @returns Absolute data directory for this product.
 */
export function resolveMerforgeHome(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.MERFORGE_HOME?.trim()
  return resolve(configured === undefined || configured === '' ? join(homedir(), '.merforge') : configured)
}

/**
 * Resolve every Electron-owned path under the new product data root.
 * @param dshHome - Merforge home passed to the internal Harness runtime.
 * @returns immutable desktop path set.
 */
export function resolveDesktopPaths(dshHome: string = resolveMerforgeHome()): DesktopPaths {
  return {
    profile: join(dshHome, 'profiles', 'desktop'),
    lock: join(dshHome, 'profiles', 'desktop', 'lock'),
  }
}
