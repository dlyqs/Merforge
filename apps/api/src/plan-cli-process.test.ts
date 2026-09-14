import { execFile, fork, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { setTimeout } from 'node:timers/promises';
import { expect, it } from 'vitest';
import {
  planDetailSchema,
  goalDetailSchema,
  type GoalDetail,
} from '@merforge/contracts';

const exec = promisify(execFile);
const apiDir = fileURLToPath(new URL('../', import.meta.url));
const cliDir = fileURLToPath(new URL('../../cli/', import.meta.url));

it('M2 A–D through CLI/HTTP: reviewed manual, bounded waits/restarts, failure/crash/retry and stale review', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'merforge-cli-http-'));
  const children: ChildProcess[] = [];
  const logs: string[] = [];
  let url = '';
  function spawnDaemon(mode = '') {
    const child = fork(
      new URL('./fixtures/daemon.ts', import.meta.url),
      [join(dir, 'runtime.sqlite'), '0', mode],
      { cwd: apiDir, execArgv: ['--import', 'tsx'], silent: true },
    );
    children.push(child);
    child.stdout!.on('data', (chunk) => logs.push(String(chunk)));
    child.stderr!.on('data', (chunk) => logs.push(String(chunk)));
    return child;
  }
  async function start(mode = '') {
    const child = spawnDaemon(mode);
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
  async function waitFor(id: string, predicate: (g: GoalDetail) => boolean) {
    const deadline = Date.now() + 8000;
    do {
      const detail = await inspect(id);
      if (predicate(detail)) return detail;
      await setTimeout(30);
    } while (Date.now() < deadline);
    throw new Error(`Goal ${id}: timed out`);
  }
  const sample = fileURLToPath(
    new URL('../../../examples/serial-plan.json', import.meta.url),
  );
  async function create() {
    return planDetailSchema.parse(await cli('plan', 'create', sample));
  }
  async function review(
    p: ReturnType<typeof planDetailSchema.parse>,
    approval = p.approvals.at(-1)!,
  ) {
    return cli(
      'plan',
      'review',
      p.id,
      approval.id,
      '--revision',
      String(p.revision),
      '--decision',
      'approved',
      '--actor',
      'local',
    );
  }
  async function setMode(id: string, mode: string, stop?: string) {
    const p = planDetailSchema.parse(await cli('plan', 'inspect', id));
    return cli(
      'plan',
      'mode',
      id,
      mode,
      '--revision',
      String(p.revision),
      '--control-version',
      String(p.controlVersion),
      ...(stop ? ['--stop', stop] : []),
    );
  }
  async function continuePlan(id: string, revision = '1') {
    return cli('plan', 'continue', id, '--revision', revision);
  }
  try {
    let daemon = await start();
    // A: exact checked-in three-phase example, two tasks in phase one.
    const a = await create();
    await expect(continuePlan(a.id)).rejects.toThrow('plan_gate_rejected');
    await review(a);
    expect((await inspect(a.goalId)).attempts).toHaveLength(0);
    await cli(
      'plan',
      'continue',
      a.id,
      '--revision',
      '1',
      '--phase',
      a.phases[0]!.id,
    );
    const adone = await waitFor(
      a.goalId,
      (g) => g.plan?.stopReason === 'phase_boundary',
    );
    expect(adone.attempts).toHaveLength(2);
    expect(adone.plan!.phases[1]!.status).toBe('pending');
    // B: both approval wait and Human wait survive real SIGKILL restarts.
    const b = await create();
    await review(b);
    await setMode(b.id, 'auto_until', b.phases[1]!.id);
    await continuePlan(b.id);
    const waiting = await waitFor(
      b.goalId,
      (g) => g.plan?.stopReason === 'approval_waiting',
    );
    await stop(daemon, 'SIGKILL');
    daemon = await start();
    expect((await inspect(b.goalId)).plan).toEqual(waiting.plan);
    await cli(
      'plan',
      'request-approval',
      b.id,
      b.phases[1]!.id,
      '--revision',
      '1',
    );
    await review(waiting.plan!);
    const h = await waitFor(b.goalId, (g) =>
      g.attempts.some((t) => t.status === 'waiting_human'),
    );
    const human = h.attempts.find((t) => t.status === 'waiting_human')!;
    await stop(daemon, 'SIGKILL');
    daemon = await start();
    expect((await inspect(b.goalId)).attempts).toEqual(h.attempts);
    await cli(
      'submit',
      human.taskId,
      human.id,
      '--artifact',
      '{"summary":"valid"}',
    );
    const boundary = await waitFor(
      b.goalId,
      (g) => g.plan?.stopReason === 'boundary_reached',
    );
    expect(boundary.attempts).toHaveLength(4);
    expect(boundary.plan).toMatchObject({
      mode: 'manual',
      authorized: false,
      startPhaseId: null,
      stopPhaseId: null,
    });
    await expect(
      cli('run', boundary.tasks.find((t) => t.phaseId === b.phases[2]!.id)!.id),
    ).rejects.toThrow('plan_gate_rejected');
    await continuePlan(b.id);
    await waitFor(b.goalId, (g) => g.plan?.status === 'completed');
    // C: controlled Mock failure, then a delayed retry is killed during execution.
    const c = await create();
    await review(c);
    await setMode(c.id, 'auto');
    await stop(daemon, 'SIGTERM');
    daemon = await start('fail-first');
    await continuePlan(c.id);
    const failed = await waitFor(
      c.goalId,
      (g) => g.plan?.stopReason === 'task_blocked',
    );
    expect(failed.attempts).toHaveLength(1);
    const task = failed.attempts[0]!.taskId;
    await cli('retry', task, '--delay-ms', '60000');
    expect(
      (await inspect(c.goalId)).attempts.find((t) => t.status === 'running'),
    ).toBeDefined();
    await stop(daemon, 'SIGKILL');
    daemon = await start();
    const interrupted = await inspect(c.goalId);
    expect(interrupted.attempts.map((t) => t.status)).toEqual([
      'failed',
      'interrupted',
    ]);
    expect(interrupted.plan).toMatchObject({
      mode: 'auto',
      authorized: true,
      stopReason: 'task_blocked',
    });
    await cli('retry', task);
    const cw = await waitFor(
      c.goalId,
      (g) => g.plan?.stopReason === 'approval_waiting',
    );
    await review(cw.plan!);
    const ch = await waitFor(c.goalId, (g) =>
      g.attempts.some((t) => t.status === 'waiting_human'),
    );
    const ca = ch.attempts.find((t) => t.status === 'waiting_human')!;
    await cli('submit', ca.taskId, ca.id, '--artifact', '{"summary":"valid"}');
    const cd = await waitFor(c.goalId, (g) => g.plan?.status === 'completed');
    expect(cd.attempts).toHaveLength(7);
    expect(cd.verifications).toHaveLength(5);
    // D: revision binding is explicit in the CLI; stale clients never approve new content.
    const d = await create();
    await review(d);
    const file = join(dir, 'definition.json');
    writeFileSync(
      file,
      JSON.stringify(JSON.parse(readFileSync(sample, 'utf8')).definition),
    );
    const revised = planDetailSchema.parse(
      await cli('plan', 'revise', d.id, file, '--revision', '1'),
    );
    expect(revised.review).toBe('pending');
    await expect(review(d)).rejects.toThrow('revision_conflict');
    await expect(continuePlan(d.id, '2')).rejects.toThrow('plan_gate_rejected');
    const dg = await inspect(d.goalId);
    for (const operation of ['run', 'mock-run', 'retry'])
      await expect(cli(operation, dg.tasks[0]!.id)).rejects.toThrow(
        'plan_gate_rejected',
      );
    await review(revised);
    expect((await inspect(d.goalId)).attempts).toHaveLength(0);
    await continuePlan(d.id, '2');
    expect(
      (await waitFor(d.goalId, (g) => g.plan?.stopReason === 'phase_boundary'))
        .attempts,
    ).toHaveLength(2);
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
    for (const event of [
      'plan_recovery_started',
      'plan_recovery_finished',
      'boundary_reached',
      'approval_decided',
      'executor_failed',
      'attempt_interrupted',
    ]) {
      expect(entries).toContainEqual(
        expect.objectContaining({
          event,
          planId: expect.any(String),
          revision: 1,
        }),
      );
    }
  } finally {
    await Promise.all(children.map((child) => stop(child, 'SIGKILL')));
    rmSync(dir, { recursive: true, force: true });
  }
}, 120000);
