import { it, expect } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  renameSync,
  unlinkSync,
  symlinkSync,
  rmSync,
  readFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  git,
  snapshot,
  WorkspaceManager,
  validateOutput,
} from './workspace.js';
import { ArtifactStore } from './artifact-store.js';
import { taskPackageSchema } from '@merforge/contracts';
import { codeDefinition } from './code-test-helpers.js';
import { hashObject } from './code-hash.js';

export async function sampleRepo(root: string) {
  const source = join(root, 'source');
  mkdirSync(source);
  await git(source, 'init', '-q');
  writeFileSync(
    join(source, 'sum.mjs'),
    'export function sum(a,b){throw new Error("TODO")}\n',
  );
  writeFileSync(join(source, 'old.txt'), 'old');
  writeFileSync(join(source, 'delete.txt'), 'delete');
  await git(source, 'add', '.');
  await git(
    source,
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@example.invalid',
    'commit',
    '-qm',
    'baseline',
  );
  return { source, commit: (await git(source, 'rev-parse', 'HEAD')).trim() };
}
it('owns worktrees across manager instances and captures added, deleted, renamed and binary files', async () => {
  const root = mkdtempSync(join(tmpdir(), 'merforge-workspace-'));
  try {
    const repo = await sampleRepo(root);
    const a = new WorkspaceManager(join(root, 'managed'));
    const b = new WorkspaceManager(join(root, 'managed'));
    const id = randomUUID();
    const lease = a.acquire(id, 'owner');
    expect(() => b.acquire(id, 'other-db')).toThrow('WORKSPACE_CONFLICT');
    const w = await a.prepare(id, repo.source, repo.commit, false);
    const before = await snapshot(w.path, repo.commit);
    renameSync(join(w.path, 'old.txt'), join(w.path, 'new.txt'));
    unlinkSync(join(w.path, 'delete.txt'));
    writeFileSync(join(w.path, 'binary.bin'), Buffer.from([0, 255, 1]));
    const after = await snapshot(w.path, repo.commit);
    expect(after.hash).not.toBe(before.hash);
    expect(after.files.map((f) => f.path)).toEqual([
      'binary.bin',
      'new.txt',
      'sum.mjs',
    ]);
    expect(after.files[0]!.contentBase64).toBe('AP8B');
    expect(after.diff).toContain('deleted file');
    const store = new ArtifactStore(join(root, 'evidence'));
    const attempt = randomUUID();
    const ref = store.publish(attempt, Buffer.from(JSON.stringify(after)));
    expect(JSON.parse(store.read(ref, attempt).toString()).hash).toBe(
      after.hash,
    );
    expect(() => store.read(ref, randomUUID())).toThrow('ARTIFACT_OWNER');
    writeFileSync(join(store.root, ref.relativePath), 'corrupt');
    expect(() => store.read(ref, attempt)).toThrow('ARTIFACT_HASH');
    lease.release();
    b.acquire(id, 'next').release();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
it('rejects dirty source, symlink escape, unknown worktrees and changes outside package scope', async () => {
  const root = mkdtempSync(join(tmpdir(), 'merforge-workspace-'));
  try {
    const repo = await sampleRepo(root);
    const manager = new WorkspaceManager(join(root, 'managed'));
    const id = randomUUID();
    writeFileSync(join(repo.source, 'dirty'), 'x');
    await expect(
      manager.prepare(id, repo.source, repo.commit, false),
    ).rejects.toThrow('SOURCE_DIRTY');
    unlinkSync(join(repo.source, 'dirty'));
    const w = await manager.prepare(id, repo.source, repo.commit, false);
    await expect(
      manager.prepare(id, repo.source, repo.commit, false),
    ).rejects.toThrow('WORKSPACE_UNKNOWN');
    const before = await snapshot(w.path, repo.commit);
    symlinkSync('/tmp', join(w.path, 'escape'));
    await expect(snapshot(w.path, repo.commit)).rejects.toThrow(
      'LINK_REJECTED',
    );
    unlinkSync(join(w.path, 'escape'));
    writeFileSync(join(w.path, 'old.txt'), 'unauthorized');
    const after = await snapshot(w.path, repo.commit);
    const d = codeDefinition();
    if (d.schemaVersion !== 'plan.v2') throw new Error();
    const task = d.phases[0]!.tasks[0]!;
    const pkg = taskPackageSchema.parse({
      ...task,
      schemaVersion: 'task-package.v1',
      goalId: randomUUID(),
      planId: randomUUID(),
      revision: 1,
      phaseId: randomUUID(),
      taskId: randomUUID(),
      workspaceId: id,
      objective: 'sample',
      acceptanceHash: hashObject(task.acceptance),
    });
    expect(() => validateOutput(before, after, pkg)).toThrow('SCOPE_VIOLATION');
    const store = new ArtifactStore(join(root, 'evidence'));
    const attempt = randomUUID();
    symlinkSync(root, join(store.root, attempt));
    expect(() => store.publish(attempt, Buffer.from('x'))).toThrow(
      'LINK_REJECTED',
    );
    expect(() => manager.path('../escape')).toThrow();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
