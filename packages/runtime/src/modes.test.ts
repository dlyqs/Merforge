import { describe, it, expect } from 'vitest';
import { createRuntime, type Runtime } from './index.js';
import { definition, approved } from './plan-test-helpers.js';
import type { ModeCommand } from '@merforge/contracts';
function mode(
  r: Runtime,
  id: string,
  config: Omit<ModeCommand, 'revision' | 'controlVersion'>,
) {
  const p = r.getPlan(id);
  return r.setPlanMode(id, {
    revision: p.revision,
    controlVersion: p.controlVersion,
    ...config,
  });
}

describe('automatic modes and phase entry approval', () => {
  it.each(['auto', 'auto_until'] as const)(
    '%s requires explicit start and observes the inclusive boundary',
    async (selected) => {
      const r = createRuntime(':memory:');
      try {
        const p = approved(r);
        mode(
          r,
          p.id,
          selected === 'auto'
            ? { mode: selected }
            : { mode: selected, stopPhaseId: p.phases[1]!.id },
        );
        await r.waitForIdle();
        expect(r.getGoal(p.goalId).attempts).toHaveLength(0);
        r.continuePlan(p.id, { revision: 1 });
        await r.waitForIdle();
        const result = r.getPlan(p.id);
        expect(r.getGoal(p.goalId).attempts).toHaveLength(
          selected === 'auto' ? 4 : 3,
        );
        if (selected === 'auto_until') {
          expect(result).toMatchObject({
            mode: 'manual',
            authorized: false,
            startPhaseId: null,
            stopPhaseId: null,
            stopReason: 'boundary_reached',
          });
          expect(() => r.runMock(r.getGoal(p.goalId).tasks[3]!.id)).toThrow(
            'plan_gate_rejected',
          );
          r.continuePlan(p.id, { revision: 1 });
          await r.waitForIdle();
        }
        expect(r.getPlan(p.id).status).toBe('completed');
      } finally {
        r.close();
      }
    },
  );
  it('validates control version, reversed/foreign/stale boundaries and skipped predecessors', async () => {
    const r = createRuntime(':memory:');
    try {
      const p = approved(r),
        other = approved(r);
      expect(() =>
        mode(r, p.id, {
          mode: 'auto_until',
          startPhaseId: p.phases[1]!.id,
          stopPhaseId: p.phases[0]!.id,
        }),
      ).toThrow('invalid_boundary');
      expect(() =>
        mode(r, p.id, { mode: 'auto_until', stopPhaseId: other.phases[0]!.id }),
      ).toThrow('invalid_boundary');
      expect(() =>
        mode(r, p.id, {
          mode: 'auto_until',
          startPhaseId: p.phases[1]!.id,
          stopPhaseId: p.phases[2]!.id,
        }),
      ).toThrow('phase_dependency');
      mode(r, p.id, { mode: 'auto' });
      expect(() =>
        r.setPlanMode(p.id, { revision: 1, controlVersion: 0, mode: 'manual' }),
      ).toThrow('control_version_conflict');
      const revised = r.revisePlan(p.id, { revision: 1, definition });
      expect(() =>
        mode(r, p.id, { mode: 'auto_until', stopPhaseId: p.phases[0]!.id }),
      ).toThrow('invalid_boundary');
      expect(revised.authorized).toBe(false);
      r.decideApproval(p.id, revised.approvals.at(-1)!.id, {
        revision: 2,
        decision: 'approved',
        actor: 'local',
      });
      mode(r, p.id, { mode: 'auto_until', stopPhaseId: revised.phases[0]!.id });
      r.continuePlan(p.id, { revision: 2 });
      await r.waitForIdle();
      const count = r.getGoal(p.goalId).attempts.length;
      mode(r, p.id, {
        mode: 'auto_until',
        startPhaseId: revised.phases[0]!.id,
        stopPhaseId: revised.phases[0]!.id,
      });
      expect(r.getPlan(p.id)).toMatchObject({
        mode: 'manual',
        stopReason: 'boundary_reached',
        authorized: false,
      });
      expect(r.getGoal(p.goalId).attempts).toHaveLength(count);
    } finally {
      r.close();
    }
  });
  it('persists a single-stage override in auto, then resumes saved mode only on continue', async () => {
    const r = createRuntime(':memory:');
    try {
      const p = approved(r);
      mode(r, p.id, { mode: 'auto' });
      r.continuePlan(p.id, { revision: 1, phaseId: p.phases[0]!.id });
      await r.waitForIdle();
      expect(r.getPlan(p.id)).toMatchObject({
        mode: 'auto',
        authorized: false,
        stopReason: 'phase_boundary',
      });
      expect(r.getGoal(p.goalId).attempts).toHaveLength(2);
      r.continuePlan(p.id, { revision: 1 });
      await r.waitForIdle();
      expect(r.getPlan(p.id).status).toBe('completed');
    } finally {
      r.close();
    }
  });
  it.each(['manual', 'auto_until'] as const)(
    'mode change to %s during Human wait finishes only the permitted phase',
    async (selected) => {
      const d = structuredClone(definition);
      d.phases[1]!.tasks[0]!.executorId = 'human';
      const r = createRuntime(':memory:');
      try {
        const p = approved(r, d);
        mode(r, p.id, { mode: 'auto' });
        r.continuePlan(p.id, { revision: 1 });
        await r.waitForIdle();
        expect(r.getPlan(p.id).status).toBe('waiting');
        expect(() =>
          mode(r, p.id, {
            mode: 'auto_until',
            startPhaseId: p.phases[0]!.id,
            stopPhaseId: p.phases[0]!.id,
          }),
        ).toThrow('active_phase_boundary');
        mode(
          r,
          p.id,
          selected === 'manual'
            ? { mode: 'manual' }
            : { mode: 'auto_until', stopPhaseId: p.phases[1]!.id },
        );
        const a = r
          .getGoal(p.goalId)
          .attempts.find((a) => a.status === 'waiting_human')!;
        r.submitHuman(a.taskId, a.id, { summary: 'done' });
        await r.waitForIdle();
        expect(r.getGoal(p.goalId).attempts).toHaveLength(3);
        expect(r.getPlan(p.id)).toMatchObject({
          mode: 'manual',
          authorized: false,
        });
        expect(r.getPlan(p.id).approvals).toHaveLength(1);
      } finally {
        r.close();
      }
    },
  );
  it('retains authorization across approval rejection, explicit new request, duplicate decision and Human submission', async () => {
    const d = structuredClone(definition);
    d.phases[1]!.requiresApproval = true;
    d.phases[1]!.tasks[0]!.executorId = 'human';
    const r = createRuntime(':memory:');
    try {
      const p = approved(r, d);
      mode(r, p.id, { mode: 'auto_until', stopPhaseId: p.phases[1]!.id });
      expect(() =>
        r.requestPhaseApproval(p.id, p.phases[1]!.id, { revision: 1 }),
      ).toThrow('phase_approval_mismatch');
      r.continuePlan(p.id, { revision: 1 });
      await r.waitForIdle();
      expect(r.getGoal(p.goalId).attempts).toHaveLength(2);
      const a = r.getPlan(p.id).approvals.at(-1)!;
      expect(a.phaseId).toBe(p.phases[1]!.id);
      r.decideApproval(p.id, a.id, {
        revision: 1,
        decision: 'rejected',
        actor: 'local',
      });
      r.continuePlan(p.id, { revision: 1 });
      await r.waitForIdle();
      expect(r.getPlan(p.id).approvals).toHaveLength(2);
      expect(r.getPlan(p.id)).toMatchObject({
        status: 'blocked',
        stopReason: 'approval_rejected',
        authorized: true,
      });
      r.requestPhaseApproval(p.id, p.phases[1]!.id, { revision: 1 });
      const b = r.getPlan(p.id).approvals.at(-1)!;
      expect(() =>
        r.decideApproval(p.id, a.id, {
          revision: 1,
          decision: 'approved',
          actor: 'local',
        }),
      ).toThrow('stale_approval');
      r.decideApproval(p.id, b.id, {
        revision: 1,
        decision: 'approved',
        actor: 'local',
      });
      r.decideApproval(p.id, b.id, {
        revision: 1,
        decision: 'approved',
        actor: 'local',
      });
      await r.waitForIdle();
      expect(r.getGoal(p.goalId).attempts).toHaveLength(3);
      const human = r
        .getGoal(p.goalId)
        .attempts.find((a) => a.status === 'waiting_human')!;
      r.submitHuman(human.taskId, human.id, { summary: 'ok' });
      await r.waitForIdle();
      expect(r.getPlan(p.id)).toMatchObject({
        mode: 'manual',
        authorized: false,
        stopReason: 'boundary_reached',
      });
      expect(r.getGoal(p.goalId).attempts).toHaveLength(3);
      expect(r.getPlan(p.id).approvals.map((a) => a.decision)).toEqual([
        'approved',
        'rejected',
        'approved',
      ]);
    } finally {
      r.close();
    }
  });
  it('approval before start never grants execution and changing mode during approval wait remains bounded', async () => {
    const d = structuredClone(definition);
    d.phases[0]!.requiresApproval = true;
    const r = createRuntime(':memory:');
    try {
      const p = approved(r, d);
      r.requestPhaseApproval(p.id, p.phases[0]!.id, { revision: 1 });
      r.decideApproval(p.id, r.getPlan(p.id).approvals.at(-1)!.id, {
        revision: 1,
        decision: 'approved',
        actor: 'local',
      });
      await r.waitForIdle();
      expect(r.getGoal(p.goalId).attempts).toHaveLength(0);
      const q = approved(r, d);
      mode(r, q.id, { mode: 'auto' });
      r.continuePlan(q.id, { revision: 1 });
      mode(r, q.id, { mode: 'manual' });
      r.decideApproval(q.id, r.getPlan(q.id).approvals.at(-1)!.id, {
        revision: 1,
        decision: 'approved',
        actor: 'local',
      });
      await r.waitForIdle();
      expect(r.getGoal(q.goalId).attempts).toHaveLength(2);
      expect(r.getPlan(q.id).authorized).toBe(false);
    } finally {
      r.close();
    }
  });
});

it('rechecks a mode update while verification is in flight and records correlated boundary events', async () => {
  let finish!: () => void, entered!: () => void;
  const started = new Promise<void>((r) => {
      entered = r;
    }),
    gate = new Promise<void>((r) => {
      finish = r;
    });
  let checks = 0;
  const logs: import('./index.js').RuntimeLog[] = [];
  const r = createRuntime(':memory:', {
    logger: (log) => logs.push(log),
    verifier: {
      async verify() {
        if (++checks === 1) {
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
  try {
    const p = approved(r);
    mode(r, p.id, { mode: 'auto' });
    r.continuePlan(p.id, { revision: 1 });
    await started;
    const task = r.getGoal(p.goalId).tasks[2]!;
    expect(() => r.runTask(task.id)).toThrow('plan_gate_rejected');
    expect(logs).toContainEqual(
      expect.objectContaining({
        event: 'plan_gate_rejected',
        planId: p.id,
        taskId: task.id,
        revision: 1,
      }),
    );
    mode(r, p.id, { mode: 'auto_until', stopPhaseId: p.phases[0]!.id });
    finish();
    await r.waitForIdle();
    expect(r.getGoal(p.goalId).attempts).toHaveLength(2);
    const events = r.getGoal(p.goalId).events;
    expect(events.filter((e) => e.type === 'boundary_reached')).toHaveLength(1);
    expect(events.find((e) => e.type === 'boundary_reached')).toMatchObject({
      planId: p.id,
      phaseId: p.phases[0]!.id,
      revision: 1,
      taskId: null,
    });
    expect(logs).toContainEqual(
      expect.objectContaining({
        event: 'boundary_reached',
        planId: p.id,
        phaseId: p.phases[0]!.id,
      }),
    );
  } finally {
    r.close();
  }
});
