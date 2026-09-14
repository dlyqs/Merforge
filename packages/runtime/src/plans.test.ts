import { describe, it, expect } from 'vitest';
import { planDetailSchema, goalDetailSchema } from '@merforge/contracts';
import { createRuntime } from './index.js';
const definition = {
  schemaVersion: 'plan.v1' as const,
  phases: [
    {
      title: 'first',
      requiresApproval: false,
      tasks: [
        {
          title: 'task',
          executorId: 'mock' as const,
          acceptanceVersion: 'summary.v1' as const,
        },
      ],
    },
  ],
};

describe('versioned plan review', () => {
  it('creates atomically without a default task and preserves review snapshots', async () => {
    const r = createRuntime(':memory:');
    try {
      expect(() =>
        r.createPlan({
          objective: 'bad',
          revision: 1,
          definition: { ...definition, phases: [] },
        }),
      ).toThrow();
      expect(r.listGoals()).toHaveLength(0);
      const p = planDetailSchema.parse(
        r.createPlan({ objective: 'plan', revision: 1, definition }),
      );
      const goal = goalDetailSchema.parse(r.getGoal(p.goalId));
      expect(goal.tasks).toHaveLength(1);
      expect(goal.events.every((e) => e.taskId === null)).toBe(true);
      const task = goal.tasks[0]!;
      for (const run of [r.runTask, r.runMock, r.retry])
        expect(() => run(task.id)).toThrow('plan_gate_rejected');
      const decision = {
        revision: 1,
        decision: 'approved' as const,
        actor: 'local',
      };
      r.decideApproval(p.id, p.approvals[0]!.id, decision);
      expect(r.decideApproval(p.id, p.approvals[0]!.id, decision).review).toBe(
        'approved',
      );
      expect(() =>
        r.decideApproval(p.id, p.approvals[0]!.id, {
          ...decision,
          decision: 'rejected',
        }),
      ).toThrow('approval_conflict');
      await r.waitForIdle();
      expect(r.getGoal(p.goalId).attempts).toHaveLength(0);
      const next = r.revisePlan(p.id, { revision: 1, definition });
      expect(next.revision).toBe(2);
      expect(next.review).toBe('pending');
      expect(next.revisions).toHaveLength(2);
      expect(next.approvals.map((a) => a.decision)).toEqual([
        'approved',
        'pending',
      ]);
      expect(() =>
        r.decideApproval(p.id, p.approvals[0]!.id, decision),
      ).toThrow('revision_conflict');
      expect(() =>
        r.decideApproval(p.id, p.approvals[0]!.id, {
          ...decision,
          revision: 2,
        }),
      ).toThrow('approval_mismatch');
      expect(() => r.revisePlan(p.id, { revision: 1, definition })).toThrow(
        'revision_conflict',
      );
      const other = r.createPlan({
        objective: 'other',
        revision: 1,
        definition,
      });
      expect(() =>
        r.decideApproval(other.id, next.approvals[1]!.id, decision),
      ).toThrow('approval_mismatch');
      const legacy = r.createGoal({ objective: 'legacy' });
      r.runTask(legacy.tasks[0]!.id);
      await r.waitForIdle();
      expect(r.getGoal(legacy.id).tasks[0]!.status).toBe('completed');
    } finally {
      r.close();
    }
  });
});
