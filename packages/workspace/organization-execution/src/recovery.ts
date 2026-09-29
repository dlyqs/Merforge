/** Read-only local evidence inspection; no unresolved action is replayed. */
import { createHash } from 'node:crypto'
import { lstat, readdir, readFile, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ExecutionReport, ExecutionReadAuthority } from './protocol.ts'
import { actionEvidenceSchema, actionDigest, type ActionEvidence } from './action-guard.ts'

type Recovery = NonNullable<ExecutionReport['recovery']>
/**
 * Fingerprint an explicitly selected bounded directory, refusing links and oversized input.
 * @param directory - Employee-selected directory.
 * @param maxBytes - Deployment bound on inspected bytes and retained path metadata.
 * @returns Exact observed tree digest and file fingerprints for independent action checks.
 */
export async function inspectDirectory(directory: string, maxBytes: number):
Promise<{ digest: string; files: Map<string, { bytes: number; sha256: string }> }> {
  const root = await realpath(directory), files = new Map<string, { bytes: number; sha256: string }>()
  const directories: string[] = []
  let bytes = 0
  const visit = async (relative: string): Promise<void> => {
    const path = join(root, relative), info = await lstat(path)
    bytes += Buffer.byteLength(relative) + 64
    if (bytes > maxBytes) throw new Error('organization-execution: baseline-size-limit')
    if (info.isSymbolicLink() || info.isFile() && info.nlink !== 1) throw new Error('organization-execution: linked-path-denied')
    if (info.isDirectory()) {
      directories.push(relative)
      for (const name of (await readdir(path)).sort()) await visit(relative ? `${relative}/${name}` : name)
    } else if (info.isFile()) {
      bytes += info.size
      if (bytes > maxBytes) throw new Error('organization-execution: baseline-size-limit')
      const content = await readFile(path)
      if (content.length !== info.size) throw new Error('organization-execution: baseline-changed')
      files.set(relative, { bytes: content.length, sha256: createHash('sha256').update(content).digest('hex') })
    } else throw new Error('organization-execution: regular-file-required')
  }
  await visit('')
  return { digest: actionDigest({ root, directories, files: [...files] }), files }
}
/**
 * Compare server facts, complete local journal and independently observed file contents.
 * @param events - Original employee's durable execution log.
 * @param authority - Fresh authorized Run read.
 * @param files - Independently read local files, or no observation when inspection failed.
 * @returns Displayable decisions and historical settlements; unknowns remain charged.
 */
export function inspectActions(events: readonly SessionEvent[], authority: ExecutionReadAuthority,
  files?: Map<string, { bytes: number; sha256: string }>): { actions: Recovery['actions']; settlements: ActionEvidence[] } {
  const journal = new Map<string, ActionEvidence>()
  for (const event of events) if (event.type === 'organization/execution-action') {
    const record = actionEvidenceSchema.parse(event.data)
    journal.set(record.action.actionId, record)
  }
  const settlements: ActionEvidence[] = []
  const actions = authority.execution.actions.map((action) => {
    const base = { actionId: action.actionId }
    if (!['reserved', 'unknown'].includes(action.state)) return { ...base, status: 'confirmed' as const, reason: 'durable-result' as const }
    const record = journal.get(action.actionId)
    if (!record) return { ...base, status: 'unknown' as const, reason: 'missing-evidence' as const }
    if (record.stage === 'reserved' || record.stage === 'settled' && record.outcome === 'not-issued') {
      settlements.push({ ...record, stage: 'settled', outcome: 'not-issued', evidenceDigest: actionDigest({ outcome: 'not-issued' }) })
      return { ...base, status: 'not-issued' as const, reason: 'journal-before-issue' as const }
    }
    if (record.file) {
      const observed = files?.get(record.file.path)
      if (observed?.sha256 !== record.file.sha256 || observed.bytes !== record.file.bytes) {
        return { ...base, status: 'unknown' as const, reason: 'file-changed' as const }
      }
      settlements.push({ ...record, stage: 'settled', outcome: 'succeeded', evidenceDigest: actionDigest(observed) })
      return { ...base, status: 'confirmed' as const, reason: 'file-matches' as const }
    }
    if (record.stage === 'settled' && (record.outcome === 'succeeded' || record.outcome === 'failed')) {
      settlements.push(record)
      return { ...base, status: 'confirmed' as const, reason: 'durable-result' as const }
    }
    return { ...base, status: 'unknown' as const, reason: 'unobservable' as const }
  })
  return { actions, settlements }
}
