import { fork } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createRuntime } from './index.js';

it.each([
  'window',
  'claimed',
  'before-boundary',
  'before-manual',
  'before-single',
  'until',
  'manual',
  'single',
])(
  'SIGKILL at %s recovers only safe authorized work and never crosses a boundary',
  async (scenario) => {
    const dir = mkdtempSync(join(tmpdir(), 'merforge-plan-kill-'));
    const path = join(dir, 'db');
    const child = fork(
      new URL('./fixtures/plan-crash.mjs', import.meta.url),
      [path, scenario],
      { silent: true },
    );
    let stderr = '';
    child.stderr!.on('data', (chunk) => {
      stderr += String(chunk);
    });
    try {
      const [code, signal] = await once(child, 'exit');
      expect({ code, signal }, stderr).toEqual({
        code: null,
        signal: 'SIGKILL',
      });
      for (let i = 0; i < 2; i++) {
        const r = createRuntime(path);
        try {
          await r.waitForIdle();
          let detail = r.getGoal(r.listGoals()[0]!.id);
          if (scenario === 'claimed' && i === 0) {
            expect(detail.attempts).toHaveLength(1);
            expect(detail.attempts[0]!.status).toBe('interrupted');
            expect(detail.plan).toMatchObject({
              mode: 'auto_until',
              authorized: true,
              stopPhaseId: detail.plan!.phases[0]!.id,
            });
            r.retry(detail.attempts[0]!.taskId);
            await r.waitForIdle();
            detail = r.getGoal(detail.id);
          }
          expect(detail.attempts).toHaveLength(
            scenario === 'window' ? 4 : scenario === 'claimed' ? 3 : 2,
          );
          if (scenario !== 'window') {
            expect(detail.plan!.authorized).toBe(false);
            const outside = detail.tasks
              .filter((t) => t.phaseId !== detail.plan!.phases[0]!.id)
              .map((t) => t.id);
            expect(
              detail.attempts.filter((a) => outside.includes(a.taskId)),
            ).toHaveLength(0);
          }
          if (scenario === 'window')
            expect(
              detail.events.filter((e) => e.type === 'execution_resumed'),
            ).toHaveLength(1);
          expect(detail.verifications).toHaveLength(
            scenario === 'window' ? 4 : 2,
          );
          expect(
            detail.events.filter((e) => e.type === 'boundary_reached'),
          ).toHaveLength(
            ['until', 'before-boundary', 'claimed'].includes(scenario) ? 1 : 0,
          );
        } finally {
          r.close();
        }
      }
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        const exited = once(child, 'exit');
        child.kill('SIGKILL');
        await exited;
      }
      rmSync(dir, { recursive: true, force: true });
    }
  },
  15000,
);
