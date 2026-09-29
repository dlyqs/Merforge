/** Local directory ownership and resource checks for the closed organization tool set. */
import { createHash } from 'node:crypto'
import { lstat, realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep, dirname, win32 } from 'node:path'
import type { FileSystem } from '@deepseek-ai/dsh-fs'
import type { ActionGuard } from './action-guard.ts'

const owned = new Set<string>()
function contains(root: string, path: string): boolean {
  const r = relative(root, path)
  return r === '' || (!isAbsolute(r) && r !== '..' && !r.startsWith(`..${sep}`))
}
/**
 * Exclusively acquire a canonical directory, rejecting overlapping parent/child Runs.
 * @param directory - Explicit employee-selected absolute local directory.
 * @returns Canonical root and idempotent release callback.
 */
export async function acquireDirectory(directory: string): Promise<{ root: string; release: () => void }> {
  if (!isAbsolute(directory)) throw new Error('organization-execution: absolute-directory-required')
  const root = await realpath(directory)
  if (!(await lstat(root)).isDirectory()) throw new Error('organization-execution: directory-required')
  for (const existing of owned) if (contains(existing, root) || contains(root, existing)) throw new Error('organization-execution: directory-busy')
  owned.add(root)
  let released = false
  return { root, release: () => { if (!released) { released = true; owned.delete(root) } } }
}
/** Closed filesystem consumer; no shell, background jobs or arbitrary provider dispatch. */
export class BoundedFiles {
  constructor(private readonly fs: FileSystem, private readonly guard: ActionGuard, private readonly root: string,
    private readonly maxBytes: number, private readonly signal: AbortSignal) {}
  private async target(path: string, writing: boolean) {
    if (!path || path.includes('\0') || path.includes('\\') || path.includes(':') || isAbsolute(path) || win32.isAbsolute(path)
      || path.split('/').some(part => part === '..' || part === '' || part === '.')) throw new Error('organization-execution: invalid-relative-path')
    let cursor = this.root
    const components = path.split('/')
    for (const [index, component] of components.entries()) {
      cursor = resolve(cursor, component)
      const info = await lstat(cursor).catch((error: unknown) => {
        if (writing && index === components.length - 1 && error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined
        throw error
      })
      if (info?.isSymbolicLink() || (info?.isFile() && info.nlink !== 1)) throw new Error('organization-execution: linked-path-denied')
      if (index < components.length - 1 && !info?.isDirectory()) throw new Error('organization-execution: directory-required')
      if (index === components.length - 1 && info && !info.isFile()) throw new Error('organization-execution: regular-file-required')
    }
    const parent = await realpath(dirname(cursor))
    if (!contains(this.root, parent) || await realpath(this.root) !== this.root) throw new Error('organization-execution: path-escape')
    const target = await this.fs.resolve(path, { cwd: this.root, signal: this.signal })
    if (!contains(this.root, this.fs.processPath(target))) throw new Error('organization-execution: path-escape')
    return target
  }
  /**
   * Read a bounded UTF-8 file through the real filesystem after online permission.
   * @param path - Relative employee-workspace path.
   * @returns File contents; no absolute path is shared.
   */
  read(path: string): Promise<string> {
    return this.guard.perform('fs-read', { path }, async (issue) => {
      await this.target(path, false)
      const check = await issue()
      const target = await this.target(path, false)
      check()
      const bytes = await this.fs.readBytes(target, this.signal, this.maxBytes)
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    }, () => 'succeeded')
  }
  /**
   * Atomically write one selected file with final path and cancellation checks.
   * @param path - Relative employee-workspace path.
   * @param content - Complete UTF-8 replacement, bounded before any permission or write.
   * @returns Content evidence for the action journal.
   */
  write(path: string, content: string): Promise<{ bytes: number; sha256: string }> {
    const bytes = Buffer.byteLength(content)
    if (bytes > this.maxBytes) return Promise.reject(new Error('organization-execution: file-size-limit'))
    return this.guard.perform('fs-write', { path, content }, async (issue) => {
      await this.target(path, true)
      const check = await issue()
      const target = await this.target(path, true)
      check()
      await this.fs.writeText(target, content, undefined, this.signal)
      return { bytes, sha256: createHash('sha256').update(content).digest('hex') }
    }, () => 'succeeded')
  }
}
