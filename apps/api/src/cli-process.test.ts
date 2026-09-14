import { execFile, fork, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { setTimeout } from 'node:timers/promises';
import { expect, it } from 'vitest';
import { acceptedSchema, goalDetailSchema } from '@merforge/contracts';

const exec = promisify(execFile);
const apiDir = fileURLToPath(new URL('../', import.meta.url));
const cliDir = fileURLToPath(new URL('../../cli/', import.meta.url));

it('CLI → HTTP → SQLite covers M1 A/B/C and different-port ownership', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'merforge-cli-http-'));
  const children: ChildProcess[] = [];
  const logs: string[] = [];
  let url = '';
  function spawnDaemon() {
    const child = fork(
      new URL('./fixtures/daemon.ts', import.meta.url),
      [join(dir, 'runtime.sqlite'), '0'],
      { cwd: apiDir, execArgv: ['--import', 'tsx'], silent: true },
    );
    children.push(child);
    child.stdout!.on('data', (chunk) => logs.push(String(chunk)));
    child.stderr!.on('data', (chunk) => logs.push(String(chunk)));
    return child;
  }
  async function start() {
    const child = spawnDaemon();
    const ready = once(child, 'message').then(
      ([message]) => message as { url: string },
    );
    const died = once(child, 'exit').then(([code]) => {
      throw new Error(`Daemon exited ${code}: ${logs.join('')}`);
    });
    url = (await Promise.race([ready, died])).url;
    return child;
  }
  async function stop(child: ChildProcess, signal: 'SIGKILL' | 'SIGTERM') {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, 'exit');
    child.kill(signal);
    await exited;
  }
  async function cli(...args: string[]) {
    const { stdout } = await exec(
      process.execPath,
      ['--import', 'tsx', 'src/main.ts', ...args],
      {
        cwd: cliDir,
        env: { ...process.env, MERFORGE_API_URL: url },
        timeout: 10000,
      },
    );
    return JSON.parse(stdout) as unknown;
  }
  async function inspect(id: string) {
    return goalDetailSchema.parse(await cli('inspect', id));
  }
  async function waitFor(id: string, status: string) {
    const deadline = Date.now() + 8000;
    do {
      const detail = await inspect(id);
      if (detail.tasks[0]?.status === status) return detail;
      await setTimeout(30);
    } while (Date.now() < deadline);
    throw new Error(`Goal ${id}: did not reach ${status}`);
  }
  try {
    let daemon = await start();
    // A: simulated failure and explicit retry retain both attempts.
    const mock = goalDetailSchema.parse(await cli('create', 'scenario A'));
    const a1 = acceptedSchema.parse(
      await cli('mock-run', mock.tasks[0]!.id, '--outcome', 'failure'),
    );
    await waitFor(mock.id, 'failed');
    const a2 = acceptedSchema.parse(await cli('retry', a1.taskId));
    const done = await waitFor(mock.id, 'completed');
    expect(done.attempts.map((a) => a.status)).toEqual(['failed', 'completed']);
    expect(done.evidence[0]?.kind).toBe('mock');
    expect(a2.taskId).toBe(a1.taskId);
    // Different ephemeral port would be available; ownership must reject first.
    const competitor = spawnDaemon();
    expect((await once(competitor, 'exit'))[0]).not.toBe(0);
    expect(logs.join('')).toContain('ownership_rejected');
    // B: waiting survives real daemon restart, then FAIL → retry → PASS.
    const human = goalDetailSchema.parse(
      await cli('create', 'scenario B', '--executor', 'human'),
    );
    const b1 = acceptedSchema.parse(await cli('run', human.tasks[0]!.id));
    await stop(daemon, 'SIGTERM');
    daemon = await start();
    expect((await inspect(human.id)).tasks[0]?.status).toBe('waiting_human');
    await cli('submit', b1.taskId, b1.attemptId, '--artifact', '{}');
    await waitFor(human.id, 'failed');
    const b2 = acceptedSchema.parse(await cli('retry', b1.taskId));
    await expect(
      cli(
        'submit',
        b1.taskId,
        b1.attemptId,
        '--artifact',
        '{"summary":"late"}',
      ),
    ).rejects.toThrow(b1.attemptId);
    await cli(
      'submit',
      b2.taskId,
      b2.attemptId,
      '--artifact',
      '{"summary":"valid"}',
    );
    expect(
      (await waitFor(human.id, 'completed')).verifications.map(
        (v) => v.verdict,
      ),
    ).toEqual(['FAIL', 'PASS']);
    // C: no completion on crash; only explicit retry creates new work.
    const crash = goalDetailSchema.parse(await cli('create', 'scenario C'));
    const c1 = acceptedSchema.parse(
      await cli('run', crash.tasks[0]!.id, '--delay-ms', '60000'),
    );
    expect((await inspect(crash.id)).tasks[0]?.status).toBe('running');
    await stop(daemon, 'SIGKILL');
    daemon = await start();
    const recovered = await inspect(crash.id);
    expect(recovered.attempts[0]).toMatchObject({
      id: c1.attemptId,
      status: 'interrupted',
    });
    await cli('retry', c1.taskId);
    expect(
      (await waitFor(crash.id, 'completed')).attempts.map((a) => a.status),
    ).toEqual(['interrupted', 'completed']);
    expect((await inspect(mock.id)).attempts).toEqual(done.attempts);
    await stop(daemon, 'SIGTERM');
    const entries = logs
      .join('')
      .split('\n')
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as Record<string, unknown>];
        } catch {
          return [];
        }
      });
    for (const [event, accepted] of [
      ['executor_failed', a1],
      ['verification_failed', b1],
      ['attempt_interrupted', c1],
    ] as const) {
      expect(entries).toContainEqual(
        expect.objectContaining({ event, ...accepted }),
      );
    }
  } finally {
    await Promise.all(children.map((child) => stop(child, 'SIGKILL')));
    rmSync(dir, { recursive: true, force: true });
  }
}, 60000);
