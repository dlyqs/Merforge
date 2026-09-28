/** Compiler dependencies needed by Desktop package bundling. */
import { dirname, relative, resolve } from 'node:path'
import ts from 'typescript'
import { desktopWorkspacePackageDirectories } from '../apps/desktop/scripts/prepare-package-set.ts'

/**
 * Include referenced compiler projects that supply statically linked client modules.
 * @param root - Repository root containing Desktop and compiler aggregates.
 * @returns Package directories with portable separators for tsdown workspace globs.
 */
export function desktopBundleDirectories(root: string): string[] {
  const directories = new Set<string>()
  const visited = new Set<string>()
  const visit = (path: string): void => {
    if (visited.has(path)) return
    visited.add(path)
    const config = ts.getParsedCommandLineOfConfigFile(path, {}, {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic(diagnostic) {
        throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
      },
    })
    if (config === undefined) throw new Error(`desktop build: missing compiler project ${path}`)
    if (config.errors.length > 0) {
      throw new Error(config.errors.map(error => ts.flattenDiagnosticMessageText(error.messageText, '\n')).join('\n'))
    }
    const directory = relative(root, dirname(path)).replaceAll('\\', '/')
    if (directory.startsWith('packages/')) directories.add(directory)
    for (const reference of config.projectReferences ?? []) visit(resolve(ts.resolveProjectReferencePath(reference)))
  }
  for (const directory of desktopWorkspacePackageDirectories(root)) visit(resolve(root, directory, 'tsconfig.json'))
  return [...directories].sort()
}
