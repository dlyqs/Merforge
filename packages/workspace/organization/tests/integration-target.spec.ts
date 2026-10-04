/** Native target reads against real Loader authority and two independent temporary Git directories. */
import { afterEach, expect, it } from 'vitest'
import { mkdir, writeFile, readFile, symlink, unlink, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { operationId } from './harness.ts'
import { integrationFixture } from './integration-harness.ts'
import { OrganizationIntegration } from '../../../../apps/desktop/src/organization-integration.ts'
import type { ConnectionAction, ConnectionResult, ConnectionSnapshot } from '../../../host/organization-connection/src/types.ts'
const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })
function nativeConnection(h: Awaited<ReturnType<typeof integrationFixture>>) {
  let generation = 0
  const connection = {
    timeoutMs: 10000,
    snapshot: (): ConnectionSnapshot => ({ identityGeneration: 1, generation, revision: 0, phase: 'ready', mode: 'organization',
      principal: h.owner.principal, organizationId: h.query.organizationId, organizations: [], members: [] }),
    perform: async (action: ConnectionAction): Promise<ConnectionResult> => {
      const result: ConnectionResult = { generation }
      if (action.kind === 'integration-read') await h.service.readIntegration(h.owner.token, action.request, (v) => { result.integration = v })
      else if (action.kind === 'delivery-download') await h.service.downloadArtifact(h.owner.token, action.request, (v) => { result.artifact = v })
      else throw new Error('unexpected action')
      return result
    },
    commitIntegration: async (input: unknown): Promise<ConnectionResult> => ({
      receipt: await h.service.integrationCommand(h.owner.token, input), generation: ++generation,
    }),
  }
  return { connection, invalidate: () => { generation++ } }
}
async function fixture(conflict = false) {
  const h = await integrationFixture(cleanup, true)
  const right = await h.prepareTask(h.right)
  const run = await h.execute(right.create)
  const { kind: _kind, configDigest: _digest, ...owner } = right.create
  await h.execute({ ...owner, runId: run.execution!.runId, kind: 'transition-run', state: 'cancelled', operationId: operationId() })
  const file = await h.publish({ ...right.selector, runId: run.execution!.runId, planRevision: 2 },
    conflict ? 'left.csv' : 'right.csv', conflict ? Buffer.from('conflicting output') : undefined)
  const bridge = nativeConnection(h)
  const makeTarget = async (name: string) => {
    const path = join(h.root, name); await mkdir(path)
    const git = (...args: string[]) => execFileSync('git', ['-C', path, ...args], { encoding: 'utf8' })
    git('init'); git('-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '--allow-empty', '-m', 'baseline')
    await writeFile(join(path, 'left.csv'), 'name,total\nleft.csv,42\n')
    await writeFile(join(path, 'right.csv'), 'name,total\nright.csv,42\n')
    await writeFile(join(path, 'unselected.csv'), 'private,unchanged\n')
    return { path, git }
  }
  return { ...h, ...bridge, makeTarget, file }
}
it('reads actual fan-in files, leaves unselected bytes unchanged and refuses another target after process restart', async () => {
  const h = await fixture(), a = await h.makeTarget('a'), b = await h.makeTarget('b')
  await writeFile(join(b.path, 'right.csv'), 'wrong')
  const native = new OrganizationIntegration()
  const rejected = await native.perform(h.connection, { kind: 'integration-verify', request: h.query }, async () => b.path, () => {})
  expect(rejected.receipt?.integration?.delivered).toBe(false)
  expect((await h.readIntegration()).latest?.observation.result).toBe('rejected')
  const verified = await native.perform(h.connection, { kind: 'integration-verify', request: h.query }, async () => a.path, () => {})
  const confirm = { kind: 'integration-confirm', request: { ...h.query, integrationId: verified.receipt!.integration!.integrationId, confirmed: true } }
  await expect(new OrganizationIntegration().perform(h.connection, confirm, async () => b.path, () => {})).rejects.toThrow('version-conflict')
  await native.perform(h.connection, confirm, async () => { throw new Error('must retain authorized target') }, () => {})
  expect((await h.readIntegration()).delivered).toBe(true)
  for (const target of [a, b]) expect(await readFile(join(target.path, 'unselected.csv'), 'utf8')).toBe('private,unchanged\n')
  expect(execFileSync(process.execPath, ['-e', 'process.stdout.write(require("node:fs").readFileSync(process.argv[1]))', join(a.path, 'right.csv')]).toString()).toBe('name,total\nright.csv,42\n')
  expect(await readFile(join(b.path, 'right.csv'), 'utf8')).toBe('wrong')
}, 20000)
it.each(['file', 'baseline'])('persists a rejected observation if the %s changes between verification and final confirmation', async (change) => {
  const h = await fixture(), target = await h.makeTarget('target'), native = new OrganizationIntegration()
  const verified = await native.perform(h.connection, { kind: 'integration-verify', request: h.query }, async () => target.path, () => {})
  if (change === 'file') await writeFile(join(target.path, 'left.csv'), 'changed')
  else target.git('-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '--allow-empty', '-m', 'changed')
  const result = await native.perform(h.connection, { kind: 'integration-confirm', request: { ...h.query,
    integrationId: verified.receipt!.integration!.integrationId, confirmed: true } }, async () => target.path, () => {})
  expect(result.receipt?.integration?.delivered).toBe(false)
  expect(await h.readIntegration()).toMatchObject({ delivered: false, latest: { observation: { result: 'rejected' } } })
}, 20000)
it('rejects symbolic target files and late directory permission after identity generation changes', async () => {
  const h = await fixture(), target = await h.makeTarget('target'), native = new OrganizationIntegration()
  await expect(native.perform(h.connection, { kind: 'integration-verify', request: h.query }, async () => {
    h.invalidate()
    return target.path
  }, () => {})).rejects.toThrow('superseded')
  await unlink(join(target.path, 'left.csv')); await symlink(join(target.path, 'right.csv'), join(target.path, 'left.csv'))
  await expect(native.perform(h.connection, { kind: 'integration-verify', request: h.query }, async () => target.path, () => {})).rejects.toThrow('invalid-input')
  expect((await h.readIntegration()).delivered).toBe(false)
}, 20000)

it('verifies Git add, modify and delete bytes against the declared baseline and rejects a later commit', async () => {
  const target = await mkdtemp(join(tmpdir(), 'integration-git-'))
  cleanup.push(() => rm(target, { recursive: true, force: true }))
  const git = (...args: string[]) => execFileSync('git', ['-C', target, ...args], { encoding: 'utf8' }).trim()
  git('init')
  await writeFile(join(target, 'modify.csv'), 'old content')
  await writeFile(join(target, 'delete.csv'), 'remove content')
  git('add', '.')
  git('-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'baseline')
  const digest = (text: string) => createHash('sha256').update(text).digest('hex')
  const change = { format: 1, baseCommit: git('rev-parse', 'HEAD'), baseTree: git('rev-parse', 'HEAD^{tree}'), patch: 'explicit selected files',
    files: [
      { path: 'modify.csv', operation: 'modify', oldSha256: digest('old content'), newSha256: digest('new content'), bytes: Buffer.from('new content').toString('base64') },
      { path: 'delete.csv', operation: 'delete', oldSha256: digest('remove content'), newSha256: null, bytes: null },
      { path: 'add.csv', operation: 'add', oldSha256: null, newSha256: digest('added'), bytes: Buffer.from('added').toString('base64') },
    ] }
  const h = await integrationFixture(cleanup, false, 'left', { path: 'change.json', kind: 'git-change', bytes: Buffer.from(JSON.stringify(change)) })
  await writeFile(join(target, 'modify.csv'), 'new content'); await writeFile(join(target, 'add.csv'), 'added')
  await unlink(join(target, 'delete.csv'))
  const { connection } = nativeConnection(h), native = new OrganizationIntegration()
  const result = await native.perform(connection, { kind: 'integration-verify', request: h.query }, async () => target, () => {})
  expect((await h.readIntegration()).latest?.observation).toMatchObject({ result: 'verified', baseCommit: change.baseCommit,
    files: [{ path: 'add.csv', sha256: digest('added') }, { path: 'delete.csv', sha256: null }, { path: 'modify.csv', sha256: digest('new content') }] })
  git('-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '--allow-empty', '-m', 'later')
  await native.perform(connection, { kind: 'integration-confirm', request: { ...h.query,
    integrationId: result.receipt!.integration!.integrationId, confirmed: true } }, async () => target, () => {})
  expect(await h.readIntegration()).toMatchObject({ delivered: false, latest: { observation: { result: 'rejected' } } })
}, 20000)

it('refuses conflicting accepted outputs for one target path without changing the target', async () => {
  const h = await fixture(true), target = await h.makeTarget('target'), native = new OrganizationIntegration()
  await expect(native.perform(h.connection, { kind: 'integration-verify', request: h.query }, async () => target.path, () => {})).rejects.toThrow('version-conflict')
  expect(await readFile(join(target.path, 'left.csv'), 'utf8')).toBe('name,total\nleft.csv,42\n')
  expect(h.db.prepare('SELECT count(*) AS n FROM organization_integrations').get()?.n).toBe(0)
}, 20000)
