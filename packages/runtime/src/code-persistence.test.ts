import { it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { planDefinitionSchema, relativePathSchema } from '@merforge/contracts';
import { createRuntime } from './index.js';
import { readPackage } from './code-store.js';
import { hashObject } from './code-hash.js';
import { codeDefinition } from './code-test-helpers.js';

it('validates versioned code definitions and rejects traversal, mutable policy and unsupported checks', () => {
  const d = codeDefinition();
  expect(planDefinitionSchema.parse(d)).toEqual(d);
  for (const path of ['../x', '/tmp/x', 'a/../x', '.git/config', 'a\\b'])
    expect(relativePathSchema.safeParse(path).success).toBe(false);
  expect(
    planDefinitionSchema.safeParse({ ...d, schemaVersion: 'plan.v1' }).success,
  ).toBe(false);
  expect(hashObject({ b: 1, a: 2 })).toBe(hashObject({ a: 2, b: 1 }));
});
it('binds immutable packages to revisions and rejects unconfigured dispatch without any attempt', () => {
  const root = mkdtempSync(join(tmpdir(), 'merforge-code-contract-'));
  const file = join(root, 'db');
  const r = createRuntime(file);
  const db = new Database(file);
  db.pragma('foreign_keys=ON');
  try {
    const p = r.createPlan({
      objective: 'code',
      revision: 1,
      definition: codeDefinition(),
    });
    const task = r.getGoal(p.goalId).tasks[0]!;
    const pkg = readPackage(db, task.id);
    expect(pkg.revision).toBe(1);
    expect(pkg.acceptanceHash).toBe(hashObject(pkg.acceptance));
    expect(() =>
      db.prepare('UPDATE task_packages SET package_hash=?').run('0'.repeat(64)),
    ).toThrow('immutable package');
    r.decideApproval(p.id, p.approvals[0]!.id, {
      revision: 1,
      decision: 'approved',
      actor: 'test',
    });
    expect(() => r.continuePlan(p.id, { revision: 1 })).toThrow(
      'codex_unconfigured',
    );
    expect(r.getGoal(p.goalId).attempts).toHaveLength(0);
    const rev = r.revisePlan(p.id, {
      revision: 1,
      definition: codeDefinition(),
    });
    expect(rev.review).toBe('pending');
    expect(readPackage(db, task.id)).toEqual(pkg);
    const next = r.getGoal(p.goalId).tasks.find((t) => t.id !== task.id)!;
    expect(readPackage(db, next.id).workspaceId).not.toBe(pkg.workspaceId);
    db.prepare('UPDATE tasks SET title=? WHERE id=?').run('tampered', next.id);
    expect(() => readPackage(db, next.id)).toThrow('PACKAGE_HASH_MISMATCH');
    expect(db.pragma('foreign_key_check')).toEqual([]);
  } finally {
    db.close();
    r.close();
    rmSync(root, { recursive: true, force: true });
  }
});
it('enforces run/evidence ownership and retains frozen code revisions after an attempt', () => {
  const root = mkdtempSync(join(tmpdir(), 'merforge-code-fk-'));
  const file = join(root, 'db');
  const r = createRuntime(file);
  const db = new Database(file);
  db.pragma('foreign_keys=ON');
  try {
    const p = r.createPlan({
      objective: 'code',
      revision: 1,
      definition: codeDefinition(),
    });
    const task = r.getGoal(p.goalId).tasks[0]!;
    const pkg = readPackage(db, task.id);
    const insert = db.prepare(
      "INSERT INTO attempts(id,task_id,sequence,executor_id,status,started_at,ended_at) VALUES (?,? ,?,'codex','failed','now','now')",
    );
    insert.run('a', task.id, 1);
    insert.run('b', task.id, 2);
    const run = db.prepare(
      'INSERT INTO code_runs(attempt_id,task_id,workspace_id,package_hash,dispatch_token,adapter_version,predecessor_attempt_id) VALUES (?,?,?,?,?,?,?)',
    );
    run.run(
      'a',
      task.id,
      pkg.workspaceId,
      hashObject(pkg),
      'token-a',
      'probe',
      null,
    );
    expect(() =>
      run.run('b', task.id, pkg.workspaceId, 'wrong', 'token-b', 'probe', 'a'),
    ).toThrow('FOREIGN KEY');
    run.run(
      'b',
      task.id,
      pkg.workspaceId,
      hashObject(pkg),
      'token-b',
      'probe',
      'a',
    );
    db.prepare('INSERT INTO file_artifacts VALUES (?,?,?,?,?,?,?,?)').run(
      'artifact',
      'a',
      pkg.workspaceId,
      'output',
      'a/output',
      'hash',
      0,
      'now',
    );
    expect(() =>
      db
        .prepare('UPDATE code_runs SET output_artifact_id=? WHERE attempt_id=?')
        .run('artifact', 'b'),
    ).toThrow('FOREIGN KEY');
    expect(() =>
      r.revisePlan(p.id, { revision: 1, definition: codeDefinition() }),
    ).toThrow('plan_frozen');
    expect(db.pragma('foreign_key_check')).toEqual([]);
  } finally {
    db.close();
    r.close();
    rmSync(root, { recursive: true, force: true });
  }
});
