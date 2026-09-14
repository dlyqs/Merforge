import { describe, it, expect } from 'vitest';
import { createRuntime } from './index.js';
import { definition, approved } from './plan-test-helpers.js';
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { resolve, promise };
}

describe('manual serial scheduler', () => {
  it('serializes verification and repeated controls, freezes content and stops at a persisted phase', async () => {
    const gate = deferred<unknown>(),
      entered = deferred<void>();
    const seen: string[] = [];
    const r = createRuntime(':memory:', {
      executor: {
        id: 'mock',
        async execute(task) {
          seen.push(task.title);
          if (seen.length === 1) {
            entered.resolve();
            return gate.promise;
          }
          return { summary: 'ok' };
        },
      },
    });
    try {
      const p = approved(r);
      expect(() =>
        r.continuePlan(p.id, { revision: 1, phaseId: p.phases[1]!.id }),
      ).toThrow('phase_dependency');
      r.continuePlan(p.id, { revision: 1 });
      r.continuePlan(p.id, { revision: 1 });
      await entered.promise;
      expect(r.getGoal(p.goalId).attempts).toHaveLength(1);
      expect(() => r.revisePlan(p.id, { revision: 1, definition })).toThrow(
        'plan_frozen',
      );
      for (const t of r.getGoal(p.goalId).tasks)
        expect(() => r.runTask(t.id)).toThrow();
      gate.resolve({ summary: 'ok' });
      await r.waitForIdle();
      expect(seen).toEqual(['a', 'b']);
      expect(r.getGoal(p.goalId).attempts).toHaveLength(2);
      expect(r.getPlan(p.id)).toMatchObject({
        authorized: false,
        status: 'idle',
        stopReason: 'phase_boundary',
        activePhaseId: null,
      });
      expect(r.getPlan(p.id).phases.map((f) => f.status)).toEqual([
        'completed',
        'pending',
        'pending',
      ]);
      r.continuePlan(p.id, { revision: 1 });
      await r.waitForIdle();
      expect(seen).toEqual(['a', 'b', 'c']);
      r.continuePlan(p.id, { revision: 1 });
      await r.waitForIdle();
      expect(r.getPlan(p.id).status).toBe('completed');
      r.continuePlan(p.id, { revision: 1 });
      await r.waitForIdle();
      expect(r.getGoal(p.goalId).attempts).toHaveLength(4);
    } finally {
      r.close();
    }
  });
  it('blocks on executor failure and only explicit retry advances the same stage', async () => {
    let calls = 0;
    const r = createRuntime(':memory:', {
      executor: {
        id: 'mock',
        async execute() {
          if (++calls === 1) throw Error('failure');
          return { summary: 'ok' };
        },
      },
    });
    try {
      const p = approved(r);
      r.continuePlan(p.id, { revision: 1 });
      await r.waitForIdle();
      expect(r.getPlan(p.id).status).toBe('blocked');
      r.continuePlan(p.id, { revision: 1 });
      await r.waitForIdle();
      expect(calls).toBe(1);
      const t = r.getGoal(p.goalId).tasks[0]!;
      r.retry(t.id);
      expect(() => r.retry(t.id)).toThrow();
      await r.waitForIdle();
      expect(r.getGoal(p.goalId).attempts.map((a) => a.status)).toContain(
        'failed',
      );
      expect(r.getPlan(p.id).phases[0]!.status).toBe('completed');
      expect(calls).toBe(3);
    } finally {
      r.close();
    }
  });
  it.each(['FAIL', 'ERROR', 'PASS'] as const)(
    'Human artifact verification %s controls subsequent dispatch',
    async (verdict) => {
      const d = structuredClone(definition);
      d.phases[0]!.tasks[0]!.executorId = 'human';
      const r = createRuntime(':memory:', {
        verifier: {
          async verify() {
            if (verdict === 'ERROR') throw Error();
            return {
              acceptanceVersion: 'summary.v1',
              verdict,
              reasons: ['TEST'],
            };
          },
        },
      });
      try {
        const p = approved(r, d);
        r.continuePlan(p.id, { revision: 1 });
        await r.waitForIdle();
        expect(r.getGoal(p.goalId).attempts).toHaveLength(1);
        const a = r.getGoal(p.goalId).attempts[0]!;
        r.submitHuman(a.taskId, a.id, { summary: 'human' });
        await r.waitForIdle();
        expect(r.getGoal(p.goalId).attempts).toHaveLength(
          verdict === 'PASS' ? 2 : 1,
        );
        expect(r.getPlan(p.id).phases[0]!.status).toBe(
          verdict === 'PASS' ? 'completed' : 'blocked',
        );
      } finally {
        r.close();
      }
    },
  );
});

it('blocks the serial successor when M1 restart marks its predecessor interrupted', async () => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'merforge-plan-interrupted-')),
    path = join(dir, 'db.sqlite');
  const gate = deferred<unknown>(),
    started = deferred<void>();
  const old = createRuntime(path, {
    executor: {
      id: 'mock',
      async execute() {
        started.resolve();
        return gate.promise;
      },
    },
  });
  let current: ReturnType<typeof createRuntime> | undefined;
  try {
    const p = approved(old);
    old.continuePlan(p.id, { revision: 1 });
    await started.promise;
    old.close();
    current = createRuntime(path);
    await current.waitForIdle();
    expect(current.getGoal(p.goalId).attempts.map((a) => a.status)).toEqual([
      'interrupted',
    ]);
    expect(current.getPlan(p.id).status).toBe('blocked');
    current.continuePlan(p.id, { revision: 1 });
    await current.waitForIdle();
    expect(current.getGoal(p.goalId).attempts).toHaveLength(1);
    current.retry(current.getGoal(p.goalId).tasks[0]!.id);
    await current.waitForIdle();
    expect(current.getGoal(p.goalId).attempts).toHaveLength(3);
    expect(current.getPlan(p.id).phases.map((p) => p.status)).toEqual([
      'completed',
      'pending',
      'pending',
    ]);
  } finally {
    gate.resolve({ summary: 'late' });
    await old.waitForIdle();
    old.close();
    current?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
