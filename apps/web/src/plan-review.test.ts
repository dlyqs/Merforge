import { expect, it } from 'vitest';
import type { PlanDetail } from '@merforge/contracts';
import { reviewDecision } from './plan-review';

it('never advances a pinned review revision when polling returns a newer plan', () => {
  const id = '00000000-0000-4000-8000-000000000001';
  const p: PlanDetail = {
    id,
    goalId: id,
    revision: 1,
    review: 'pending',
    status: 'idle',
    stopReason: null,
    mode: 'manual',
    controlVersion: 0,
    authorized: false,
    startPhaseId: null,
    stopPhaseId: null,
    activePhaseId: null,
    limitPhaseId: null,
    revisions: [],
    phases: [],
    approvals: [
      {
        id,
        planId: id,
        revision: 1,
        phaseId: null,
        kind: 'review',
        decision: 'pending',
        actor: null,
        createdAt: '2026-09-14T00:00:00.000Z',
        decidedAt: null,
      },
    ],
  };
  expect(reviewDecision(p, p, id, 'local', 'approved')).toEqual({
    revision: 1,
    actor: 'local',
    decision: 'approved',
  });
  const newer = { ...p, revision: 2 };
  expect(() => reviewDecision(p, newer, id, 'local', 'approved')).toThrow(
    '版本已变化',
  );
  expect(() => reviewDecision(newer, newer, id, 'local', 'approved')).toThrow(
    '审批已变化',
  );
  expect(() =>
    reviewDecision(
      p,
      { ...p, approvals: [{ ...p.approvals[0]!, decision: 'approved' }] },
      id,
      'local',
      'approved',
    ),
  ).toThrow('审批已变化');
});
