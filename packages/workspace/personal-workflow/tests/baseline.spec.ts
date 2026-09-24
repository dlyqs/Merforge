/** Filesystem observations distinguish sibling changes from unknown workspace edits. */
import { mkdtemp, writeFile, rm, symlink } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { observeWorkspace, sameWorkspace } from '../src/workspace-baseline.ts'
const exec = promisify(execFile)
it('checks Git content changes while permitting only attributed sibling artifacts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workflow-baseline-'))
  try {
    await exec('git', ['init', root])
    await writeFile(join(root, 'source.txt'), 'initial'); await writeFile(join(root, 'mine.txt'), 'my output')
    await exec('git', ['-C', root, 'add', '.'])
    await exec('git', ['-C', root, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'base'])
    const before = await observeWorkspace(root, ['mine.txt'], 10000)
    await writeFile(join(root, 'sibling.txt'), 'parallel output')
    const sibling = await observeWorkspace(root, ['mine.txt'], 10000)
    expect(sameWorkspace(before, sibling, ['sibling.txt'])).toBe(true)
    expect(sameWorkspace(before, sibling)).toBe(false)
    await writeFile(join(root, 'source.txt'), 'unattributed source edit')
    expect(sameWorkspace(sibling, await observeWorkspace(root, ['mine.txt'], 10000), ['sibling.txt'])).toBe(false)
    await writeFile(join(root, 'mine.txt'), 'changed my own output')
    expect(sameWorkspace(before, await observeWorkspace(root, ['mine.txt'], 10000), ['mine.txt', 'source.txt', 'sibling.txt'])).toBe(false)
  } finally { await rm(root, { recursive: true, force: true }) }
})
it('refuses unbounded or escaping artifact observations and requires non-Git artifact references', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workflow-artifacts-'))
  try {
    await writeFile(join(root, 'large.txt'), '12345')
    await expect(observeWorkspace(root, ['large.txt'], 4)).rejects.toThrow('byte limit')
    await symlink('..', join(root, 'outside'))
    await expect(observeWorkspace(root, ['outside'], 100)).rejects.toThrow('outside')
    await expect(observeWorkspace(root, [], 100)).rejects.toThrow('require declared')
    expect((await observeWorkspace(root, ['planned.txt'], 100)).files[0]?.sha256).toBeNull()
  } finally { await rm(root, { recursive: true, force: true }) }
})
