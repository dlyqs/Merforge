/** Native, read-only target verification; local directories never cross organization transport. */
import { createHash, randomUUID } from 'node:crypto'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { constants } from 'node:fs'
import { lstat, open, realpath } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { integrationNativeSchema, integrationObservationSchema, gitChangeSchema } from '@deepseek-ai/dsh-organization/delivery'
import type { z } from 'zod'
import type { OrganizationConnection } from '@deepseek-ai/dsh-organization-connection'
import type { ConnectionResult } from '@deepseek-ai/dsh-organization-connection/types'
const exec = promisify(execFile)
type Observation = z.output<typeof integrationObservationSchema>
type NativeConnection = Pick<OrganizationConnection, 'snapshot' | 'perform' | 'commitIntegration' | 'timeoutMs'>
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
async function git(directory: string, args: string[], timeout: number, maxBuffer = 4096): Promise<Buffer> {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/KEY|SECRET|TOKEN|PASSWORD|^GIT_/i.test(key)))
  const result = await exec('git', ['--no-optional-locks', '--literal-pathspecs', '-C', directory, ...args], { env, timeout, maxBuffer, encoding: 'buffer', windowsHide: true })
  return result.stdout
}
async function originalHash(directory: string, commit: string, path: string, timeout: number): Promise<string | null> {
  const entry = (await git(directory, ['ls-tree', '-z', commit, '--', path], timeout)).toString()
  if (!entry) return null
  const match = /^(100644|100755) blob ([a-f0-9]+)\t/.exec(entry)
  const objectId = match?.[2]
  if (!objectId) throw new Error('invalid-input')
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/KEY|SECRET|TOKEN|PASSWORD|^GIT_/i.test(key)))
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['--no-optional-locks', '--literal-pathspecs', '-C', directory, 'cat-file', 'blob', objectId], {
      env, timeout, killSignal: 'SIGKILL', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'],
    })
    const digest = createHash('sha256')
    child.stdout.on('data', (chunk: Buffer) => { digest.update(chunk) })
    child.on('error', reject)
    child.on('close', (code, signal) => { if (code === 0 && !signal) resolve(digest.digest('hex')); else reject(new Error('version-conflict')) })
  })
}
async function baseline(directory: string, timeout: number) {
  const root = (await git(directory, ['rev-parse', '--show-toplevel'], timeout)).toString().trim()
  if (await realpath(root) !== directory) throw new Error('invalid-input')
  const baseCommit = (await git(directory, ['rev-parse', 'HEAD'], timeout)).toString().trim()
  const baseTree = (await git(directory, ['rev-parse', 'HEAD^{tree}'], timeout)).toString().trim()
  return { baseCommit, baseTree }
}
async function fileEvidence(directory: string, path: string, expectedSize: number | null): Promise<Observation['files'][number]> {
  const parts = path.split('/')
  let selected = directory
  try {
    for (const [i, part] of parts.entries()) {
      selected = join(selected, part)
      const stat = await lstat(selected)
      if (stat.isSymbolicLink() || (i < parts.length - 1 ? !stat.isDirectory() : !stat.isFile())) throw new Error('invalid-input')
    }
    const handle = await open(selected, constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      const before = await handle.stat()
      if (!before.isFile()) throw new Error('invalid-input')
      // A length mismatch needs no unbounded read of an unrelated target file.
      if (before.size !== expectedSize) return { path, sha256: null, size: before.size }
      const digest = createHash('sha256')
      let length = 0
      for await (const chunk of handle.createReadStream({ autoClose: false })) {
        if (!(chunk instanceof Buffer)) throw new Error('invalid-input')
        length += chunk.length
        if (length > before.size) throw new Error('version-conflict')
        digest.update(chunk)
      }
      const after = await handle.stat()
      const selectedNow = await lstat(selected)
      if (selectedNow.isSymbolicLink() || selectedNow.ino !== before.ino || selectedNow.dev !== before.dev) throw new Error('version-conflict')
      if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw new Error('version-conflict')
      return { path, sha256: digest.digest('hex'), size: length }
    } finally { await handle.close() }
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return { path, sha256: null, size: null }
    throw error
  }
}
/** Target permissions last only for the current native process; restart requires a fresh dialog and verification. */
export class OrganizationIntegration {
  private targets = new Map<string, { directory: string; identity: string }>()
  /**
   * Ask for a directory, re-read selected files, then persist or confirm exact target evidence.
   * @param connection - Native authenticated fixed transport.
   * @param input - Strict Renderer task selection and explicit confirmation.
   * @param chooseDirectory - Owning window's native directory permission dialog.
   * @param assertCurrent - Owning top frame and lifetime assertion.
   * @returns Authority receipt after actual reads and a fresh online check.
   */
  async perform(connection: NativeConnection, input: unknown, chooseDirectory: () => Promise<string | undefined>,
    assertCurrent: () => void): Promise<ConnectionResult> {
    const action = integrationNativeSchema.parse(input)
    const { organizationId, projectId, planId, taskId, planRevision } = action.request
    const query = { organizationId, projectId, planId, taskId, planRevision }
    const initial = connection.snapshot()
    const identity = `${initial.principal?.serverId}:${initial.principal?.accountId}:${organizationId}`
    const current = () => {
      assertCurrent()
      const state = connection.snapshot()
      if (state.generation !== initial.generation || state.phase !== 'ready' || state.mode !== 'organization'
        || state.organizationId !== organizationId || !state.principal) throw new Error('superseded')
    }
    current()
    const view = (await connection.perform({ kind: 'integration-read', request: query })).integration
    current()
    if (!view?.inputsReady || !view.dependenciesReady) throw new Error('version-conflict')
    const previous = action.kind === 'integration-confirm' ? view.latest : null
    if (action.kind === 'integration-confirm' && (!view.canConfirm || !previous || previous.id !== action.request.integrationId
      || previous.observation.result !== 'verified')) throw new Error('forbidden')
    let targetRef: string, directory: string
    if (previous) {
      targetRef = previous.observation.targetRef
      const target = this.targets.get(targetRef)
      if (!target || target.identity !== identity) throw new Error('version-conflict')
      directory = target.directory
    } else {
      const chosen = await chooseDirectory(); current()
      if (!chosen) throw new Error('invalid-input')
      if ((await lstat(resolve(chosen))).isSymbolicLink()) throw new Error('invalid-input')
      directory = await realpath(chosen); current()
      targetRef = randomUUID()
    }
    const expected = new Map<string, { sha256: string | null; size: number | null }>()
    const changes: z.output<typeof gitChangeSchema>[] = []
    for (const item of view.inputs) for (const evidence of item.artifacts) {
      const result = await connection.perform({ kind: 'delivery-download', request: { organizationId, projectId, planId,
        assignmentId: item.assignmentId, artifactId: evidence.artifactId } }); current()
      if (!result.artifact) throw new Error('forbidden')
      const { artifact, bytes } = result.artifact, data = Buffer.from(bytes, 'base64')
      if (hash(data) !== evidence.sha256 || artifact.sha256 !== evidence.sha256 || data.length !== artifact.size) throw new Error('invalid-input')
      const add = (path: string, sha256: string | null, size: number | null) => {
        const prior = expected.get(path)
        if (prior && (prior.sha256 !== sha256 || prior.size !== size)) throw new Error('version-conflict')
        expected.set(path, { sha256, size })
      }
      if (artifact.kind === 'git-change') {
        const change = gitChangeSchema.parse(JSON.parse(data.toString('utf8'))); changes.push(change)
        for (const file of change.files) add(file.path, file.newSha256, file.bytes === null ? null : Buffer.from(file.bytes, 'base64').length)
      } else add(artifact.path, evidence.sha256, artifact.size)
    }
    // Use the connection's configured request deadline for local Git subprocesses as well.
    const timeout = connection.timeoutMs
    const base = await baseline(directory, timeout); current()
    let verified = true
    for (const change of changes) {
      if (change.baseCommit !== base.baseCommit || change.baseTree !== base.baseTree) verified = false
      for (const file of change.files) {
        if (await originalHash(directory, base.baseCommit, file.path, timeout) !== file.oldSha256) verified = false
        current()
      }
    }
    const files: Observation['files'] = []
    for (const [path, value] of [...expected].sort(([a],[b]) => a.localeCompare(b))) {
      files.push(await fileEvidence(directory, path, value.size)); current()
    }
    if (files.some(f => f.sha256 !== expected.get(f.path)?.sha256 || f.size !== expected.get(f.path)?.size)) verified = false
    const after = await baseline(directory, timeout); current()
    if (JSON.stringify(base) !== JSON.stringify(after)) throw new Error('version-conflict')
    const observation = integrationObservationSchema.parse({ targetRef, ...base, files, verifiedAt: Date.now(), result: verified ? 'verified' : 'rejected' })
    let changed = false
    if (previous) {
      const { verifiedAt: _old, ...before } = previous.observation, { verifiedAt: _now, ...now } = observation
      if (JSON.stringify(before) !== JSON.stringify(now) || !verified) {
        this.targets.delete(targetRef); observation.result = 'rejected'; changed = true
      }
    }
    const fresh = (await connection.perform({ kind: 'integration-read', request: query })).integration; current()
    if (!fresh || JSON.stringify(fresh.inputs) !== JSON.stringify(view.inputs)) throw new Error('version-conflict')
    this.targets.set(targetRef, { directory, identity })
    return connection.commitIntegration(previous && !changed ? { ...query, kind: 'confirm-integration', operationId: randomUUID(),
      integrationId: previous.id, observation, confirmed: true } : { ...query, kind: 'verify-integration', operationId: randomUUID(), inputs: view.inputs, observation })
  }
}
