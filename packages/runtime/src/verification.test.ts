import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { goalDetailSchema, type VerificationResult } from '@merforge/contracts';
import { createRuntime, SubmissionVerifier, type RuntimeLog } from './index.js';

const pass: VerificationResult = {
  acceptanceVersion: 'summary.v1',
  verdict: 'PASS',
  reasons: ['SUMMARY_NON_EMPTY'],
};

describe('independent verification and human attempts', () => {
  it.each([
    [{ summary: 'done' }, 'PASS'],
    [{ summary: '  done  ' }, 'PASS'],
    [{}, 'FAIL'],
    [{ summary: 42 }, 'FAIL'],
    [{ summary: '' }, 'FAIL'],
    [{ summary: '   ' }, 'FAIL'],
    [null, 'FAIL'],
    [[], 'FAIL'],
    ['text', 'FAIL'],
  ])(
    'persists and verifies JSON artifact %j as %s',
    async (payload, verdict) => {
      const logs: RuntimeLog[] = [];
      const runtime = createRuntime(':memory:', {
        logger: (entry) => logs.push(entry),
      });
      try {
        const goal = runtime.createGoal({
          objective: 'private goal text',
          executorId: 'human',
        });
        const taskId = goal.tasks[0]!.id;
        expect(goal.tasks[0]?.acceptanceVersion).toBe('summary.v1');
        expect(() => runtime.runMock(taskId)).toThrow();
        const accepted = runtime.runTask(taskId);
        expect(runtime.getGoal(goal.id).tasks[0]?.status).toBe('waiting_human');
        expect(() => runtime.runTask(taskId)).toThrow();
        await expect(
          runtime.verifyAttempt(accepted.attemptId),
        ).rejects.toThrow();
        runtime.submitHuman(taskId, accepted.attemptId, payload);
        expect(runtime.getGoal(goal.id).tasks[0]?.status).toBe('verifying');
        expect(() =>
          runtime.submitHuman(taskId, accepted.attemptId, {
            summary: 'replacement',
          }),
        ).toThrow();
        await runtime.waitForIdle();
        const detail = goalDetailSchema.parse(runtime.getGoal(goal.id));
        expect(detail.tasks[0]?.status).toBe(
          verdict === 'PASS' ? 'completed' : 'failed',
        );
        expect(detail.verifications[0]).toMatchObject({
          verdict,
          acceptanceVersion: 'summary.v1',
          attemptId: accepted.attemptId,
        });
        expect(detail.artifacts[0]?.payload).toEqual(payload);
        expect(detail.artifacts[0]?.kind).toBe('human');
        expect(detail.evidence).toEqual([]);
        expect(detail.attempts[0]?.endedAt).not.toBeNull();
        expect(logs).toContainEqual(
          expect.objectContaining({
            event:
              verdict === 'PASS'
                ? 'verification_passed'
                : 'verification_failed',
            taskId,
            attemptId: accepted.attemptId,
          }),
        );
        expect(JSON.stringify(logs)).not.toContain('private goal text');
        const replay = await runtime.verifyAttempt(accepted.attemptId);
        expect(replay?.id).toBe(detail.verifications[0]?.id);
        expect(runtime.getGoal(goal.id)).toEqual(detail);
      } finally {
        runtime.close();
      }
    },
  );
  it('retains waiting work and invalid submissions across reopen, rejects stale and foreign attempts', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'merforge-human-'));
    const path = join(directory, 'runtime.sqlite');
    let runtime = createRuntime(path);
    try {
      const goal = runtime.createGoal({
        objective: 'human',
        executorId: 'human',
      });
      const taskId = goal.tasks[0]!.id;
      const first = runtime.runTask(taskId);
      runtime.close();
      runtime = createRuntime(path);
      expect(runtime.getGoal(goal.id).tasks[0]?.status).toBe('waiting_human');
      const other = runtime.createGoal({
        objective: 'other',
        executorId: 'human',
      });
      const otherAttempt = runtime.runTask(other.tasks[0]!.id);
      expect(() =>
        runtime.submitHuman(taskId, otherAttempt.attemptId, {
          summary: 'wrong task',
        }),
      ).toThrow();
      expect(() =>
        runtime.submitHuman(taskId, first.attemptId, undefined),
      ).toThrow('Artifact must be JSON');
      runtime.submitHuman(taskId, first.attemptId, { summary: 12 });
      await runtime.waitForIdle();
      runtime.close();
      runtime = createRuntime(path);
      const second = runtime.retry(taskId);
      expect(second.attemptId).not.toBe(first.attemptId);
      expect(() =>
        runtime.submitHuman(taskId, first.attemptId, { summary: 'late' }),
      ).toThrow();
      const original = { summary: 'valid secret submission' };
      runtime.submitHuman(taskId, second.attemptId, original);
      original.summary = '';
      await runtime.waitForIdle();
      const detail = runtime.getGoal(goal.id);
      expect(detail.attempts.map((a) => a.sequence)).toEqual([1, 2]);
      expect(detail.verifications.map((v) => v.verdict)).toEqual([
        'FAIL',
        'PASS',
      ]);
      expect(detail.artifacts[0]?.payload).toEqual({ summary: 12 });
      expect(detail.artifacts[1]?.payload).toEqual({
        summary: 'valid secret submission',
      });
      expect(detail.tasks[0]?.status).toBe('completed');
      expect(() => runtime.retry(taskId)).toThrow();
    } finally {
      runtime.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
  it('cannot complete before verification, runs outside transactions, and deduplicates concurrent replay', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'merforge-verify-'));
    const path = join(directory, 'runtime.sqlite');
    let release!: (value: VerificationResult) => void;
    let started!: () => void;
    const gate = new Promise<VerificationResult>((resolve) => {
      release = resolve;
    });
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    const runtime = createRuntime(path, {
      verifier: {
        async verify() {
          const writer = new Database(path);
          try {
            writer.exec('BEGIN IMMEDIATE; ROLLBACK');
          } finally {
            writer.close();
          }
          started();
          return gate;
        },
      },
    });
    try {
      const goal = runtime.createGoal({
        objective: 'delayed verifier',
        executorId: 'human',
      });
      const accepted = runtime.runTask(goal.tasks[0]!.id);
      runtime.submitHuman(accepted.taskId, accepted.attemptId, {
        summary: 'valid',
      });
      await entered;
      expect(runtime.getGoal(goal.id).tasks[0]?.status).toBe('verifying');
      expect(runtime.getGoal(goal.id).verifications).toEqual([]);
      const replay = runtime.verifyAttempt(accepted.attemptId);
      release(pass);
      await Promise.all([replay, runtime.waitForIdle()]);
      const detail = runtime.getGoal(goal.id);
      expect(detail.tasks[0]?.status).toBe('completed');
      expect(detail.verifications).toHaveLength(1);
      expect(
        detail.events.filter((e) => e.type === 'verification_passed'),
      ).toHaveLength(1);
    } finally {
      runtime.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
  it('routes malformed mock output through the same FAIL path and preserves its marker', async () => {
    const runtime = createRuntime(':memory:', {
      executor: {
        id: 'mock',
        async execute() {
          return { summary: false };
        },
      },
    });
    try {
      const goal = runtime.createGoal({ objective: 'invalid mock' });
      runtime.runMock(goal.tasks[0]!.id);
      await runtime.waitForIdle();
      const detail = runtime.getGoal(goal.id);
      expect(detail.tasks[0]?.status).toBe('failed');
      expect(detail.artifacts[0]?.kind).toBe('mock');
      expect(detail.verifications[0]?.verdict).toBe('FAIL');
      expect(detail.evidence).toEqual([]);
    } finally {
      runtime.close();
    }
  });
  it('fails closed for an unknown contract version and verifier errors', async () => {
    expect(
      (await new SubmissionVerifier().verify({ summary: 'valid' }, 'future.v2'))
        .verdict,
    ).toBe('FAIL');
    for (const verify of [
      async () => {
        throw new Error('secret');
      },
      async () => ({ ...pass, acceptanceVersion: 'wrong.v2' }),
    ]) {
      const runtime = createRuntime(':memory:', { verifier: { verify } });
      try {
        const goal = runtime.createGoal({ objective: 'verifier error' });
        runtime.runMock(goal.tasks[0]!.id);
        await runtime.waitForIdle();
        expect(runtime.getGoal(goal.id).verifications[0]).toMatchObject({
          verdict: 'FAIL',
          reasons: ['VERIFIER_ERROR'],
        });
      } finally {
        runtime.close();
      }
    }
  });
  it('rolls back artifact and state if a business event cannot be persisted', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'merforge-rollback-'));
    const path = join(directory, 'runtime.sqlite');
    const runtime = createRuntime(path);
    const sqlite = new Database(path);
    try {
      const goal = runtime.createGoal({
        objective: 'rollback',
        executorId: 'human',
      });
      const accepted = runtime.runTask(goal.tasks[0]!.id);
      const before = runtime.getGoal(goal.id);
      sqlite.exec(
        "CREATE TRIGGER reject_submission BEFORE INSERT ON events WHEN NEW.type='human_submission_received' BEGIN SELECT RAISE(ABORT, 'event rejected'); END",
      );
      expect(() =>
        runtime.submitHuman(accepted.taskId, accepted.attemptId, {
          summary: 'ok',
        }),
      ).toThrow('event rejected');
      expect(runtime.getGoal(goal.id)).toEqual(before);
    } finally {
      sqlite.close();
      runtime.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
