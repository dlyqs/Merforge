/** Read-only local workspace observations for evidence and transfer checks. */
import { realpathSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile, readdir, realpath, stat } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import type { ArtifactFingerprint, WorkspaceBaseline } from './execution-types.ts'
const exec = promisify(execFile)

/** Observe declared task and prerequisite paths without following links outside the cwd.
 * @param cwd - Existing explicit execution directory.
 * @param paths - Declared artifacts and prerequisite artifacts.
 * @param maxBytes - Maximum cumulative file bytes read for this observation.
 * @returns Canonical directory, Git baseline and content fingerprints.
 */
export async function observeWorkspace(cwd: string, paths: readonly string[], maxBytes: number): Promise<WorkspaceBaseline> {
  if (!isAbsolute(cwd)) throw new Error('personal-workflow: execution directory must be absolute')
  const root = await realpath(cwd)
  if (!(await stat(root)).isDirectory()) throw new Error('personal-workflow: execution directory is not a directory')
  const files: ArtifactFingerprint[] = []
  let bytes = 0
  const visiting = new Set<string>()
  const within = (path: string): void => {
    const part = relative(root, path)
    if (part === '..' || part.startsWith(`..${sep}`) || isAbsolute(part)) throw new Error('personal-workflow: artifact outside execution directory')
  }
  const walk = async (path: string): Promise<void> => {
    within(path)
    let canonical: string
    try { canonical = await realpath(path) }
    catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
      let ancestor = dirname(path)
      while (true) {
        try { within(await realpath(ancestor)); break }
        catch (parentError) {
          if (!(parentError instanceof Error && 'code' in parentError && parentError.code === 'ENOENT')) throw parentError
          ancestor = dirname(ancestor)
        }
      }
      files.push({ path: relative(root, path), sha256: null }); return
    }
    within(canonical)
    const info = await stat(canonical)
    if (info.isDirectory()) {
      if (visiting.has(canonical)) throw new Error('personal-workflow: cyclic artifact directory')
      visiting.add(canonical)
      const entries = (await readdir(canonical)).sort()
      files.push({ path: relative(root, path) || '.', sha256: hash(JSON.stringify(entries)) })
      for (const entry of entries) await walk(resolve(path, entry))
      visiting.delete(canonical)
    } else if (info.isFile()) {
      bytes += info.size
      if (bytes > maxBytes) throw new Error('personal-workflow: artifact observation exceeds configured byte limit')
      const content = await readFile(canonical)
      if (content.length !== info.size) throw new Error('personal-workflow: artifact changed during observation')
      files.push({ path: relative(root, path), sha256: hash(content) })
    } else throw new Error('personal-workflow: artifact is not a regular file or directory')
  }
  for (const path of [...new Set(paths)].sort()) await walk(resolve(root, path))
  let gitHead: string | null = null
  let gitDirty: string | null = null
  const gitFiles: ArtifactFingerprint[] = []
  try { gitHead = (await exec('git', ['--no-optional-locks', '-c', 'core.fsmonitor=false', '-C', root, 'rev-parse', '--verify', 'HEAD'])).stdout.trim() }
  catch (error) {
    // Non-Git and unborn directories use their declared artifact observations.
    if (!(error instanceof Error && 'code' in error)) throw error
  }
  if (gitHead !== null) {
    const [status, tracked, untracked] = await Promise.all([
      exec('git', ['--no-optional-locks', '-c', 'core.fsmonitor=false', '-C', root, 'status', '--porcelain=v1', '-z']),
      exec('git', ['--no-optional-locks', '-c', 'core.fsmonitor=false', '-C', root, 'diff', '--no-ext-diff', '--no-textconv', 'HEAD', '--name-only', '-z', '--relative']),
      exec('git', ['--no-optional-locks', '-c', 'core.fsmonitor=false', '-C', root, 'ls-files', '--others', '--exclude-standard', '-z']),
    ])
    const declared = files.splice(0)
    for (const path of [...new Set((tracked.stdout + untracked.stdout).split('\0').filter(Boolean))].sort()) {
      await walk(resolve(root, path))
    }
    gitFiles.push(...files.splice(0)); files.push(...declared)
    gitDirty = hash(status.stdout + JSON.stringify(gitFiles))
  }
  if (gitHead === null && files.length === 0) throw new Error('personal-workflow: non-Git tasks require declared artifact paths')
  return { cwd: root, gitHead, gitDirty, gitFiles, files }
}
function hash(value: string | Uint8Array): string { return createHash('sha256').update(value).digest('hex') }

/** Compare only this task's observed paths; unrelated sibling outputs do not invalidate it.
 * @param before - Last settled task baseline.
 * @param after - Current task observation.
 * @param siblingArtifacts - Other tasks' declared outputs whose changes can be attributed to those tasks.
 * @returns Whether the directory, commit and associated artifacts still match.
 */
export function sameWorkspace(before: WorkspaceBaseline, after: WorkspaceBaseline, siblingArtifacts: readonly string[] = []): boolean {
  if (before.cwd !== after.cwd || before.gitHead !== after.gitHead
    || JSON.stringify(before.files) !== JSON.stringify(after.files)) return false
  if (before.gitDirty === after.gitDirty) return true
  const previous = new Map(before.gitFiles.map(file => [file.path, file.sha256]))
  const next = new Map(after.gitFiles.map(file => [file.path, file.sha256]))
  const changed = [...new Set([...previous.keys(), ...next.keys()])].filter(path => previous.get(path) !== next.get(path))
  return changed.length > 0 && changed.every(path => siblingArtifacts.some((artifact) => {
    const part = relative(resolve(before.cwd, artifact), resolve(before.cwd, path))
    return part === '' || (part !== '..' && !part.startsWith(`..${sep}`) && !isAbsolute(part))
  }))
}

/** Compare existing directory aliases using their actual filesystem location.
 * @param left - Session or task directory.
 * @param right - Canonical observed directory.
 * @returns Whether both resolve to the same local directory.
 */
export function sameDirectory(left: string | undefined, right: string): boolean {
  if (!left) return false
  try { return realpathSync(left) === realpathSync(right) }
  catch (error) { if (error instanceof Error && 'code' in error) return false; throw error }
}
