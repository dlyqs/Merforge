import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { expect, it } from 'vitest';
import { createRuntime, type RuntimeLog } from './index.js';

it('recovers running, ready, waiting and persisted verification; rejects late results and is idempotent', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'merforge-recovery-'));
  const path = join(dir, 'runtime.sqlite');
  let release!: (value: unknown) => void;
  let entered!: () => void;
  const started = new Promise<void>((r) => {
    entered = r;
  });
  const gate = new Promise<unknown>((r) => {
    release = r;
  });
  const logs: RuntimeLog[] = [];
  const old = createRuntime(path, {
    logger: (e) => logs.push(e),
    executor: {
      id: 'mock',
      async execute() {
        entered();
        return gate;
      },
    },
  });
  let current: ReturnType<typeof createRuntime> | undefined;
  try {
    const ready = old.createGoal({ objective: 'ready' });
    const running = old.createGoal({ objective: 'running' });
    const first = old.runTask(running.tasks[0]!.id);
    const human = old.createGoal({ objective: 'waiting', executorId: 'human' });
    old.runTask(human.tasks[0]!.id);
    const verifying = old.createGoal({
      objective: 'persisted',
      executorId: 'human',
    });
    const submission = old.runTask(verifying.tasks[0]!.id);
    await started;
    old.submitHuman(submission.taskId, submission.attemptId, {
      summary: 'saved',
    });
    // Close before the queued verifier begins; only the artifact is durable.
    old.close();
    current = createRuntime(path, { logger: (e) => logs.push(e) });
    await current.waitForIdle();
    expect(current.getGoal(ready.id).tasks[0]?.status).toBe('ready');
    expect(current.getGoal(human.id).tasks[0]?.status).toBe('waiting_human');
    expect(current.getGoal(verifying.id).tasks[0]?.status).toBe('completed');
    expect(current.getGoal(running.id).attempts[0]?.status).toBe('interrupted');
    current.retry(first.taskId);
    await current.waitForIdle();
    const before = current.getGoal(running.id);
    release({ summary: 'late' });
    await old.waitForIdle();
    expect(current.getGoal(running.id)).toEqual(before);
    expect(logs).toContainEqual(
      expect.objectContaining({ event: 'stale_result_rejected', ...first }),
    );
    expect(logs).toContainEqual(
      expect.objectContaining({
        event: 'attempt_interrupted',
        ...first,
        errorCode: 'EXECUTION_INTERRUPTED',
      }),
    );
    current.close();
    current = createRuntime(path);
    await current.waitForIdle();
    expect(current.getGoal(running.id)).toEqual(before);
    expect(current.getGoal(verifying.id).verifications).toHaveLength(1);
  } finally {
    release({});
    old.close();
    current?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it('rejects aliases while owned, releases after close, and fails missing recovery artifacts explicitly', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'merforge-owner-'));
  const path = join(dir, 'runtime.sqlite');
  let runtime = createRuntime(path);
  try {
    symlinkSync(path, join(dir, 'alias.sqlite'));
    expect(() => createRuntime(join(dir, 'alias.sqlite'))).toThrow(
      'ownership rejected',
    );
    const goal = runtime.createGoal({
      objective: 'missing',
      executorId: 'human',
    });
    const attempt = runtime.runTask(goal.tasks[0]!.id);
    runtime.close();
    const raw = new Database(path);
    raw.exec(
      "UPDATE tasks SET status='verifying'; UPDATE attempts SET status='verifying'",
    );
    raw.close();
    runtime = createRuntime(path);
    await runtime.waitForIdle();
    expect(runtime.getGoal(goal.id).attempts[0]).toMatchObject({
      id: attempt.attemptId,
      status: 'failed',
      error: 'MISSING_ARTIFACT',
    });
    const before = runtime.getGoal(goal.id);
    runtime.close();
    runtime = createRuntime(path);
    await runtime.waitForIdle();
    expect(runtime.getGoal(goal.id)).toEqual(before);
  } finally {
    runtime.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
