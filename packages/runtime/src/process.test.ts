import { fork, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { goalDetailSchema } from '@merforge/contracts';

it('kernel ownership excludes a second process and recovers after SIGKILL', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'merforge-process-'));
  const children: ChildProcess[] = [];
  function start() {
    const child = fork(
      new URL('./fixtures/owner-process.mjs', import.meta.url),
      [join(dir, 'runtime.sqlite')],
      { silent: true },
    );
    children.push(child);
    return child;
  }
  try {
    const first = start();
    const [message] = await once(first, 'message');
    const running = goalDetailSchema.parse(message);
    expect(running.tasks[0]?.status).toBe('running');
    const second = start();
    let stderr = '';
    second.stderr!.on('data', (chunk) => {
      stderr += String(chunk);
    });
    expect((await once(second, 'exit'))[0]).not.toBe(0);
    expect(stderr).toContain('ownership rejected');
    const stopped = once(first, 'exit');
    first.kill('SIGKILL');
    await stopped;
    const restarted = start();
    const [recovered] = await once(restarted, 'message');
    const detail = goalDetailSchema.parse(recovered);
    expect(detail.tasks[0]?.status).toBe('interrupted');
    expect(detail.attempts[0]?.id).toBe(running.attempts[0]?.id);
    expect(
      detail.events.filter((e) => e.type === 'attempt_interrupted'),
    ).toHaveLength(1);
  } finally {
    await Promise.all(
      children.map(async (child) => {
        if (child.exitCode === null && child.signalCode === null) {
          const stopped = once(child, 'exit');
          child.kill('SIGKILL');
          await stopped;
        }
      }),
    );
    rmSync(dir, { recursive: true, force: true });
  }
}, 15000);
