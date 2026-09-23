/** Desktop-owned profile boot, independent of the public dsh executable. */

import { writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { FiberState, type Context } from '@deepseek-ai/cordis'
import {
  boot, createRuntimeResolution, installFailLoud, loadOverlayPatches,
  PluginPackages, readProfilePatches, type Profile, type ProfileContext,
} from '@deepseek-ai/dsh-app-boot'
import { provideCmdline } from '@deepseek-ai/dsh-cmdline'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { installProxyFromEnvironment } from '@deepseek-ai/dsh-http-proxy'
import { DSH_LAUNCH_ENVIRONMENT_KEY, type LaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'

const ROOT_CONFIG = '[]\n'

/** Boot inputs owned by the Electron Host. */
export interface DesktopProfileOptions {
  readonly profile: Profile
  readonly installAnchor: string
  readonly overlay: string
  readonly environment: LaunchEnvironmentSnapshot
  readonly args: readonly string[]
  readonly packageManager?: ProfileContext['packageManager']
}

/** Active Host tree and its idempotent bounded shutdown. */
export interface DesktopApplication {
  readonly ctx: Context
  readonly shutdown: { shutdown(code: number): Promise<void> }
}

/**
 * Start the Desktop profile from an already loaded application directory.
 * @param options - Product profile, installation, and deployment overlay.
 * @returns Active Cordis tree with one shutdown owner.
 */
export async function bootDesktopProfile(options: DesktopProfileOptions): Promise<DesktopApplication> {
  const disposeProxy = await installProxyFromEnvironment(options.environment,
    (message) => { process.stderr.write(`desktop: ${message}\n`) })
  let current: Context | undefined
  let disposal: Promise<void> | undefined
  const dispose = (): Promise<void> => disposal ??= (async () => {
    const failures: unknown[] = []
    for (const release of [() => current?.fiber.dispose(), disposeProxy]) {
      try { await release() } catch (error) { failures.push(error) }
    }
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1) throw new AggregateError(failures, 'desktop: profile cleanup failed')
  })()
  try {
    const resolution = await createRuntimeResolution({ installAnchor: options.installAnchor, profile: options.profile })
    const rootConfig = join(options.profile.dir, 'cordis.yml')
    writeFileSync(rootConfig, ROOT_CONFIG)
    const profileContext: ProfileContext = {
      name: 'desktop',
      ...(options.packageManager === undefined ? {} : { packageManager: options.packageManager }),
      dir: options.profile.dir,
      patchPath: options.profile.patchPath,
      installAnchor: options.installAnchor,
      startedBundles: options.profile.layers.map(layer => layer.packageName),
      cwd: process.cwd(),
      home: resolveDshHome(),
      overlays: loadOverlayPatches('desktop', resolve(options.overlay)),
      telemetryDisabledEnv: process.env.DSH_TELEMETRY_DISABLED,
    }
    let ready = false
    const readyListeners = new Set<() => void>()
    const shutdown = { shutdown: async (code: number): Promise<void> => {
      await dispose()
      process.exitCode = code
    } }
    installFailLoud('desktop', process, async () => { await current?.fiber.dispose() })
    const ctx = await boot('desktop', rootConfig, readProfilePatches('desktop', profileContext, options.profile), async (host) => {
      current = host
      host.provide('profileContext', profileContext)
      host.provide(DSH_LAUNCH_ENVIRONMENT_KEY, options.environment)
      await host.plugin(PluginPackages, { resolution })
      provideCmdline(host, {
        args: options.args,
        exit: (code) => { void shutdown.shutdown(code) },
        ready: { onReady(listener) {
          if (ready) { listener(); return () => {} }
          readyListeners.add(listener)
          return () => { readyListeners.delete(listener) }
        } },
      })
    })
    current = ctx
    if (ctx.fiber.state === FiberState.ACTIVE && ctx.get('loader') !== undefined) {
      ready = true
      for (const listener of readyListeners) listener()
      readyListeners.clear()
    }
    return { ctx, shutdown }
  } catch (error) {
    try { await dispose() } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'desktop: profile startup and cleanup failed')
    }
    throw error
  }
}
