import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { goalDetailSchema } from '@merforge/contracts';
import { createRuntime } from './index.js';

describe('persistent prototype runtime', () => {
  it('persists the goal, run and evidence across database reopening', () => {
    const directory = mkdtempSync(join(tmpdir(), 'merforge-'));
    const path = join(directory, 'runtime.sqlite');
    let runtime = createRuntime(path);
    try {
      const goal = runtime.createGoal({
        objective: '  Prototype a refund workflow  ',
      });
      expect(goal.objective).toBe('Prototype a refund workflow');
      expect(goal.tasks[0]?.status).toBe('ready');
      runtime.close();
      runtime = createRuntime(path);
      const completed = runtime.runMock(goal.tasks[0]!.id);
      expect(goalDetailSchema.parse(completed).tasks[0]?.status).toBe(
        'completed',
      );
      runtime.close();
      runtime = createRuntime(path);
      const restored = runtime.getGoal(goal.id);
      expect(restored.runs).toHaveLength(1);
      expect(restored.evidence[0]?.kind).toBe('mock');
      expect(restored.events.map((event) => event.type)).toEqual([
        'goal_created',
        'mock_completed',
      ]);
      expect(() => runtime.runMock(goal.tasks[0]!.id)).toThrow(
        'already completed',
      );
      expect(runtime.getGoal(goal.id)).toEqual(restored);
    } finally {
      runtime.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('rejects invalid goals without leaving partial records', () => {
    const runtime = createRuntime(':memory:');
    try {
      expect(() => runtime.createGoal({ objective: ' ' })).toThrow();
      expect(runtime.listGoals()).toEqual([]);
      expect(() => runtime.runMock('missing')).toThrow('Task not found');
    } finally {
      runtime.close();
    }
  });
});
