import Database from 'better-sqlite3';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { taskStatusSchema, goalDetailSchema } from '@merforge/contracts';
import { canTransition } from './state-machine.js';
import { createRuntime } from './index.js';

describe('state and persistence contracts', () => {
  it('enumerates every permitted edge; completion cannot be claimed directly', () => {
    const edges = [
      'ready:running',
      'ready:waiting_human',
      'running:verifying',
      'running:failed',
      'running:interrupted',
      'waiting_human:verifying',
      'verifying:completed',
      'verifying:failed',
      'failed:running',
      'failed:waiting_human',
      'interrupted:running',
      'interrupted:waiting_human',
    ];
    for (const from of taskStatusSchema.options)
      for (const to of taskStatusSchema.options) {
        expect(canTransition(from, to)).toBe(edges.includes(`${from}:${to}`));
      }
  });
  it('migrates a replayable v1 fixture and preserves legacy simulated records', () => {
    const directory = mkdtempSync(join(tmpdir(), 'merforge-migration-'));
    const path = join(directory, 'runtime.sqlite');
    try {
      const old = new Database(path);
      old.exec(
        readFileSync(new URL('./fixtures/v1.sql', import.meta.url), 'utf8'),
      );
      old.close();
      for (let i = 0; i < 2; i++) {
        const runtime = createRuntime(path);
        try {
          const detail = goalDetailSchema.parse(
            runtime.getGoal('00000000-0000-4000-8000-000000000001'),
          );
          expect(detail.tasks[0]?.status).toBe('completed');
          expect(detail.runs).toHaveLength(1);
          expect(detail.evidence[0]?.kind).toBe('mock');
          expect(detail.attempts).toEqual([]);
          expect(detail.verifications).toEqual([]);
        } finally {
          runtime.close();
        }
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
  it('rolls back a failed migration without changing the old schema or user_version', () => {
    const directory = mkdtempSync(join(tmpdir(), 'merforge-bad-migration-'));
    const path = join(directory, 'runtime.sqlite');
    const old = new Database(path);
    try {
      old.pragma('foreign_keys = OFF');
      old.exec(
        readFileSync(new URL('./fixtures/v1.sql', import.meta.url), 'utf8'),
      );
      old.exec("UPDATE tasks SET goal_id='missing'");
      expect(() => createRuntime(path)).toThrow(
        'Migration foreign key violation',
      );
      expect(old.pragma('user_version', { simple: true })).toBe(1);
      expect(
        old
          .prepare("SELECT name FROM sqlite_master WHERE name='attempts'")
          .get(),
      ).toBeUndefined();
      expect(old.prepare('SELECT count(*) AS n FROM evidence').get()).toEqual({
        n: 1,
      });
    } finally {
      old.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
  it('enforces unique sequence, one active attempt and atomic rollback', () => {
    const directory = mkdtempSync(join(tmpdir(), 'merforge-constraints-'));
    const path = join(directory, 'runtime.sqlite');
    const runtime = createRuntime(path);
    const goal = runtime.createGoal({ objective: 'constraints' });
    const sqlite = new Database(path);
    try {
      const insert = sqlite.prepare(
        "INSERT INTO attempts (id, task_id, sequence, executor_id, status, started_at) VALUES (?, ?, ?, 'mock', 'running', ?)",
      );
      insert.run('first', goal.tasks[0]!.id, 1, goal.createdAt);
      expect(() =>
        insert.run('second', goal.tasks[0]!.id, 2, goal.createdAt),
      ).toThrow('UNIQUE');
      sqlite
        .prepare("UPDATE attempts SET status='failed', ended_at=?")
        .run(goal.createdAt);
      expect(() =>
        insert.run('same-sequence', goal.tasks[0]!.id, 1, goal.createdAt),
      ).toThrow('UNIQUE');
      sqlite.exec(
        "CREATE TRIGGER reject_event BEFORE INSERT ON events BEGIN SELECT RAISE(ABORT, 'event rejected'); END",
      );
      expect(() => runtime.createGoal({ objective: 'must roll back' })).toThrow(
        'event rejected',
      );
      expect(runtime.listGoals()).toHaveLength(1);
      expect(sqlite.prepare('SELECT count(*) AS n FROM tasks').get()).toEqual({
        n: 1,
      });
    } finally {
      sqlite.close();
      runtime.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
