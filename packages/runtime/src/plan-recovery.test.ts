import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { expect, it } from 'vitest';
import { createRuntime, type Runtime } from './index.js';
import { approved, definition } from './plan-test-helpers.js';

it('holds all dispatch and controls until every verification replay finishes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'merforge-plan-replay-'));
  const path = join(dir, 'db');
  let r = createRuntime(path);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    const d = structuredClone(definition);
    d.phases[0]!.tasks[0]!.executorId = 'human';
    const plans = [approved(r, d), approved(r, d)];
    for (const p of plans) {
      r.setPlanMode(p.id, { revision: 1, controlVersion: 0, mode: 'auto' });
      r.continuePlan(p.id, { revision: 1 });
      const a = r.getGoal(p.goalId).attempts[0]!;
      r.submitHuman(a.taskId, a.id, { summary: 'saved' });
    }
    r.close();
    let checks = 0;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    r = createRuntime(path, {
      verifier: {
        async verify() {
          if (++checks === 2) {
            entered();
            await gate;
          }
          return {
            acceptanceVersion: 'summary.v1',
            verdict: 'PASS',
            reasons: ['TEST'],
          };
        },
      },
    });
    await started;
    expect(() => r.continuePlan(plans[0]!.id, { revision: 1 })).toThrow(
      'recovery_in_progress',
    );
    expect(() => r.runTask(r.getGoal(plans[0]!.goalId).tasks[1]!.id)).toThrow(
      'recovery_in_progress',
    );
    expect(() =>
      r.setPlanMode(plans[0]!.id, {
        revision: 1,
        controlVersion: 2,
        mode: 'manual',
      }),
    ).toThrow('recovery_in_progress');
    for (const p of plans) expect(r.getGoal(p.goalId).attempts).toHaveLength(1);
    release();
    await r.waitForIdle();
    for (const p of plans) {
      expect(r.getPlan(p.id).status).toBe('completed');
      expect(r.getGoal(p.goalId).verifications).toHaveLength(4);
    }
    r.close();
    r = createRuntime(path);
    await r.waitForIdle();
    for (const p of plans) expect(r.getGoal(p.goalId).attempts).toHaveLength(4);
  } finally {
    release();
    r.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it('retains unapproved and unauthorized plans, blocks inconsistent authorization durably', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'merforge-plan-control-'));
  const path = join(dir, 'db');
  let r: Runtime = createRuntime(path);
  try {
    const pending = r.createPlan({
      objective: 'pending',
      revision: 1,
      definition,
    });
    const idle = approved(r);
    const bad = approved(r);
    const forged = approved(r);
    r.close();
    const raw = new Database(path);
    // Legal SQL values but impossible manual execution authority: no selected phase.
    raw.prepare('UPDATE plans SET authorized=1 WHERE id=?').run(bad.id);
    raw
      .prepare("UPDATE plans SET mode='auto',authorized=1 WHERE id=?")
      .run(forged.id);
    raw.close();
    for (let i = 0; i < 2; i++) {
      r = createRuntime(path);
      await r.waitForIdle();
      for (const p of [pending, idle, bad, forged])
        expect(r.getGoal(p.goalId).attempts).toHaveLength(0);
      expect(r.getPlan(forged.id).stopReason).toBe('recovery_blocked');
      expect(r.getPlan(bad.id)).toMatchObject({
        authorized: false,
        status: 'blocked',
        stopReason: 'recovery_blocked',
      });
      expect(() => r.continuePlan(bad.id, { revision: 1 })).toThrow(
        'recovery_blocked',
      );
      expect(
        r
          .getGoal(bad.goalId)
          .events.filter((e) => e.type === 'recovery_blocked'),
      ).toHaveLength(1);
      r.close();
    }
  } finally {
    r.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it('resumes approval and Human waits across restarts and stops at the persisted inclusive boundary', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'merforge-plan-waits-'));
  const path = join(dir, 'db');
  let r = createRuntime(path);
  try {
    const d = structuredClone(definition);
    d.phases[1]!.requiresApproval = true;
    d.phases[1]!.tasks[0]!.executorId = 'human';
    const p = approved(r, d);
    r.setPlanMode(p.id, {
      revision: 1,
      controlVersion: 0,
      mode: 'auto_until',
      stopPhaseId: p.phases[1]!.id,
    });
    r.continuePlan(p.id, { revision: 1 });
    await r.waitForIdle();
    const pending = r.getPlan(p.id);
    expect(pending.stopReason).toBe('approval_waiting');
    r.close();
    r = createRuntime(path);
    await r.waitForIdle();
    expect(r.getPlan(p.id)).toEqual(pending);
    r.decideApproval(p.id, pending.approvals.at(-1)!.id, {
      revision: 1,
      decision: 'approved',
      actor: 'local',
    });
    const human = r
      .getGoal(p.goalId)
      .attempts.find((a) => a.status === 'waiting_human')!;
    r.close();
    r = createRuntime(path);
    await r.waitForIdle();
    expect(r.getGoal(p.goalId).attempts.find((a) => a.id === human.id)).toEqual(
      human,
    );
    expect(r.getPlan(p.id)).toMatchObject({
      mode: 'auto_until',
      authorized: true,
      stopPhaseId: p.phases[1]!.id,
    });
    r.submitHuman(human.taskId, human.id, { summary: 'done' });
    await r.waitForIdle();
    r.close();
    r = createRuntime(path);
    await r.waitForIdle();
    expect(r.getPlan(p.id)).toMatchObject({
      mode: 'manual',
      authorized: false,
      stopReason: 'boundary_reached',
    });
    expect(r.getGoal(p.goalId).attempts).toHaveLength(3);
    r.continuePlan(p.id, { revision: 1 });
    await r.waitForIdle();
    expect(r.getPlan(p.id).status).toBe('completed');
  } finally {
    r.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
