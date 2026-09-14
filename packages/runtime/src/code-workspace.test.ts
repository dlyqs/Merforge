import { it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { createRuntime } from './index.js';
import { codeDefinition } from './code-test-helpers.js';
import { readPackage } from './code-store.js';
import { hashObject } from './code-hash.js';
import { codeWorkspaces } from './code-workspace.js';
import { git } from './workspace.js';
it('binds input/output evidence to attempts, rejects drift and missing evidence, and leaves orphan files non-authoritative', async () => {
  const root = mkdtempSync(join(tmpdir(), 'merforge-code-workspace-'));
  const source = join(root, 'source');
  mkdirSync(source);
  await git(source, 'init', '-q');
  writeFileSync(join(source, 'sum.mjs'), 'export const sum=(a,b)=>a+b;');
  await git(source, 'add', '.');
  await git(
    source,
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@example.invalid',
    'commit',
    '-qm',
    'base',
  );
  const commit = (await git(source, 'rev-parse', 'HEAD')).trim();
  const r = createRuntime(join(root, 'db'));
  const db = new Database(join(root, 'db'));
  db.pragma('foreign_keys=ON');
  try {
    const p = r.createPlan({
      objective: 'code',
      revision: 1,
      definition: codeDefinition(commit),
    });
    const task = r.getGoal(p.goalId).tasks[0]!;
    const pkg = readPackage(db, task.id);
    const work = codeWorkspaces(
      db,
      (fn) => db.transaction(() => fn(() => {}))(),
      {
        repositories: { sample: source },
        managedRoot: join(root, 'managed'),
        artifactRoot: join(root, 'evidence'),
      },
    );
    const start = (seq: number) => {
      const id = randomUUID(),
        token = randomUUID();
      db.prepare(
        "INSERT INTO attempts(id,task_id,sequence,executor_id,status,started_at,ended_at) VALUES (?, ?,?,'codex','failed','now','now')",
      ).run(id, task.id, seq);
      db.prepare(
        'INSERT INTO code_runs(attempt_id,task_id,workspace_id,package_hash,dispatch_token,adapter_version) VALUES (?,?,?,?,?,?)',
      ).run(id, task.id, pkg.workspaceId, hashObject(pkg), token, 'test');
      db.prepare(
        "UPDATE code_workspaces SET state='occupied',owner_token=? WHERE id=?",
      ).run(token, pkg.workspaceId);
      return id;
    };
    const first = start(1);
    const prepared = await work.prepare(pkg, first);
    const result = await prepared.output();
    expect(work.readSnapshot(result.ref.id, pkg.workspaceId).hash).toBe(
      prepared.before.hash,
    );
    prepared.release(false);
    expect(() => work.readSnapshot(randomUUID(), pkg.workspaceId)).toThrow(
      'ARTIFACT_MISSING',
    );
    const orphan = work.store.publish(first, Buffer.from('{}'));
    expect(() => work.readSnapshot(orphan.id, pkg.workspaceId)).toThrow(
      'ARTIFACT_MISSING',
    );
    writeFileSync(join(prepared.path, 'sum.mjs'), 'external edit');
    await expect(work.prepare(pkg, start(2))).rejects.toThrow(
      'WORKSPACE_DRIFT',
    );
    expect(db.prepare('SELECT state FROM code_workspaces').get()).toEqual({
      state: 'quarantined',
    });
  } finally {
    db.close();
    r.close();
    rmSync(root, { recursive: true, force: true });
  }
});
