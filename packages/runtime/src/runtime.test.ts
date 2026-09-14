import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { goalDetailSchema } from '@merforge/contracts';
import { createRuntime, type RuntimeLog } from './index.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
describe('asynchronous runtime', () => {
  it('commits before dispatch, rejects duplicate claims, preserves failure and retries after reopen', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'merforge-'));
    const path = join(directory, 'runtime.sqlite');
    const gate = deferred<unknown>();
    const started = deferred<void>();
    const logs: RuntimeLog[] = [];
    let runtime = createRuntime(path, {
      logger: (entry) => logs.push(entry),
      executor: {
        id: 'mock',
        async execute(task) {
          const reader = new Database(path);
          try {
            expect(
              reader
                .prepare('SELECT status FROM tasks WHERE goal_id=?')
                .get(task.goalId),
            ).toEqual({ status: 'running' });
            reader.exec('BEGIN IMMEDIATE; ROLLBACK');
          } finally {
            reader.close();
          }
          started.resolve();
          return gate.promise;
        },
      },
    });
    try {
      const goal = runtime.createGoal({ objective: '  Prototype  ' });
      expect(goal.objective).toBe('Prototype');
      const accepted = runtime.runMock(goal.tasks[0]!.id);
      expect(runtime.getGoal(goal.id).tasks[0]?.status).toBe('running');
      expect(() => runtime.runMock(accepted.taskId)).toThrow(
        'transition rejected',
      );
      expect(() => createRuntime(path)).toThrow('ownership rejected');
      await started.promise;
      gate.reject(new Error('secret executor text must not appear in logs'));
      await runtime.waitForIdle();
      expect(runtime.getGoal(goal.id).attempts[0]).toMatchObject({
        status: 'failed',
        error: 'EXECUTOR_FAILED',
      });
      expect(logs).toContainEqual(
        expect.objectContaining({
          event: 'executor_failed',
          taskId: accepted.taskId,
          attemptId: accepted.attemptId,
          errorCode: 'EXECUTOR_FAILED',
        }),
      );
      expect(JSON.stringify(logs)).not.toContain('secret');
      runtime.close();
      runtime = createRuntime(path);
      const retry = runtime.retry(accepted.taskId);
      expect(retry.attemptId).not.toBe(accepted.attemptId);
      expect(retry.taskId).toBe(accepted.taskId);
      await runtime.waitForIdle();
      const detail = goalDetailSchema.parse(runtime.getGoal(goal.id));
      expect(detail.attempts.map((a) => a.status)).toEqual([
        'failed',
        'completed',
      ]);
      expect(detail.artifacts[0]?.kind).toBe('mock');
      runtime.close();
      runtime = createRuntime(path);
      expect(runtime.getGoal(goal.id)).toEqual(detail);
    } finally {
      runtime.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
  it('supports controlled mock failure and guards retry and invalid input', async () => {
    const runtime = createRuntime(':memory:');
    try {
      expect(() => runtime.createGoal({ objective: ' ' })).toThrow();
      expect(runtime.listGoals()).toEqual([]);
      expect(() => runtime.runMock('missing')).toThrow('Task not found');
      const goal = runtime.createGoal({ objective: 'failure' });
      const id = goal.tasks[0]!.id;
      expect(() => runtime.retry(id)).toThrow();
      expect(() => runtime.runMock(id, { delayMs: -1 })).toThrow();
      runtime.runMock(id, { outcome: 'failure' });
      await runtime.waitForIdle();
      expect(runtime.getGoal(goal.id).tasks[0]?.status).toBe('failed');
      expect(() => runtime.runMock(id)).toThrow();
      runtime.retry(id);
      expect(() => runtime.retry(id)).toThrow();
      await runtime.waitForIdle();
      expect(runtime.getGoal(goal.id).attempts).toHaveLength(2);
    } finally {
      runtime.close();
    }
  });
});
