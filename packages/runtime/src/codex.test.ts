import { fork } from 'node:child_process';
import { once } from 'node:events';
import { it, expect } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { CodexEvents } from './executors/codex.js';
import { processTable } from './executors/process.js';
import { createRuntime } from './index.js';
import { codeDefinition } from './code-test-helpers.js';
import { git } from './workspace.js';
const fixture = fileURLToPath(new URL('./fixtures/codex.mjs', import.meta.url));
async function setup(
  mode = 'SUCCESS',
  timeoutMs = 5000,
  configure?: (d: ReturnType<typeof codeDefinition>) => void,
) {
  const root = mkdtempSync(join(tmpdir(), 'merforge-codex-test-')),
    source = join(root, 'source');
  mkdirSync(source);
  await git(source, 'init', '-q');
  writeFileSync(join(source, 'sum.mjs'), 'export const sum=()=>0;');
  await git(source, 'add', '.');
  await git(
    source,
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@example.invalid',
    'commit',
    '-qm',
    'base',
  );
  const commit = (await git(source, 'rev-parse', 'HEAD')).trim();
  const definition = codeDefinition(commit);
  if (definition.schemaVersion !== 'plan.v2') throw new Error();
  definition.phases[0]!.tasks[0]!.instructions = mode;
  definition.phases[0]!.tasks[0]!.allowedPaths.push('child.json');
  configure?.(definition);
  const options = {
    codex: {
      executable: fixture,
      repositories: { sample: source },
      managedRoot: join(root, 'managed'),
      artifactRoot: join(root, 'evidence'),
      timeoutMs,
      maxOutputBytes: 4096,
    },
  };
  const r = createRuntime(join(root, 'db'), options);
  const p = r.createPlan({ objective: 'test', revision: 1, definition });
  r.decideApproval(p.id, p.approvals[0]!.id, {
    revision: 1,
    decision: 'approved',
    actor: 'test',
  });
  const task = r.getGoal(p.goalId).tasks[0]!;
  const cleanup = async () => {
    await r.close();
    rmSync(root, { recursive: true, force: true });
  };
  return { root, r, p, task, options, cleanup };
}
it('parses split UTF-8 JSONL, tolerates unknown metadata, rejects malformed, truncated and missing terminals', () => {
  const events = new CodexEvents();
  const bytes = Buffer.from(
    '{"type":"thread.started","thread_id":"00000000-0000-4000-8000-000000000099"}\n{"type":"item.completed","item":{"type":"agent_message","text":"中文"}}\n{"type":"turn.completed"}\n',
  );
  for (const b of bytes) events.feed(Buffer.from([b]));
  events.finish();
  expect(events.terminal).toBe('completed');
  expect(JSON.stringify(events.events)).not.toContain('中文');
  expect(() => {
    const p = new CodexEvents();
    p.feed(Buffer.from('{bad}\n'));
  }).toThrow('EVENT_MALFORMED');
  expect(() => {
    const p = new CodexEvents();
    p.feed(Buffer.from('{}'));
    p.finish();
  }).toThrow('EVENT_TRUNCATED');
  expect(() => new CodexEvents().finish()).toThrow('EVENT_TERMINAL_MISSING');
});
it('dispatches a frozen package after approval and persists real-shaped evidence without summary PASS', async () => {
  const { r, p, task, cleanup } = await setup();
  try {
    r.continuePlan(p.id, { revision: 1 });
    await r.waitForIdle();
    const goal = r.getGoal(p.goalId);
    expect(goal.tasks[0]!.status).toBe('completed');
    expect(goal.verifications).toHaveLength(1);
    const run = r.getCodeRun(goal.attempts[0]!.id)!;
    expect(run.sessionId).toBe('00000000-0000-4000-8000-000000000099');
    expect(run.pid).toBeGreaterThan(0);
    expect(run.stoppedAt).toBeTruthy();
    expect(run.outputArtifactId).toBeTruthy();
    await r.verifyAttempt(run.attemptId);
    expect(r.getGoal(p.goalId).tasks[0]!.status).toBe('completed');
    expect(() =>
      r.revisePlan(p.id, { revision: 1, definition: codeDefinition() }),
    ).toThrow('plan_frozen');
  } finally {
    await cleanup();
  }
});
it.each([
  ['NONZERO', 'PROCESS_NONZERO_EXIT'],
  ['AUTH', 'AUTHENTICATION_FAILED'],
  ['MALFORMED', 'EVENT_MALFORMED'],
  ['TRUNCATED', 'EVENT_TRUNCATED'],
  ['UNKNOWN', 'EVENT_TERMINAL_MISSING'],
  ['OUTPUT_LIMIT', 'OUTPUT_LIMIT'],
  ['WAIT', 'EXECUTION_TIMEOUT'],
])('rejects %s execution without a PASS', async (mode, reason) => {
  const { r, p, cleanup } = await setup(mode, mode === 'WAIT' ? 250 : 5000);
  try {
    r.continuePlan(p.id, { revision: 1 });
    await r.waitForIdle();
    const g = r.getGoal(p.goalId);
    expect(g.tasks[0]!.status).toBe('failed');
    expect(g.attempts[0]!.error).toBe(reason);
    expect(g.verifications).toEqual([]);
  } finally {
    await cleanup();
  }
});
it('persists idempotent cancellation and stops an independently grouped descendant before releasing database ownership', async () => {
  const { r, p, task, root, options, cleanup } = await setup('WAIT_TREE');
  try {
    r.continuePlan(p.id, { revision: 1 });
    const id = r.getGoal(p.goalId).attempts[0]!.id;
    const file = join(
      root,
      'managed',
      r.getTaskPackage(task.id).workspaceId,
      'child.json',
    );
    await expect
      .poll(() => existsSync(file), { timeout: 4000, interval: 30 })
      .toBe(true);
    const child = JSON.parse(readFileSync(file, 'utf8')).pid as number;
    await expect
      .poll(
        () =>
          JSON.parse(r.getCodeRun(id)!.processIdentity ?? '[]').some(
            (p: { pid: number }) => p.pid === child,
          ),
        { timeout: 3000, interval: 30 },
      )
      .toBe(true);
    r.cancelTask(task.id, id);
    r.cancelTask(task.id, id);
    await r.waitForIdle();
    expect(r.getGoal(p.goalId).tasks[0]!.status).toBe('interrupted');
    expect(r.getCodeRun(id)!.cancelRequestedAt).toBeTruthy();
    expect(r.getCodeRun(id)!.stoppedAt).toBeTruthy();
    expect(
      (await processTable()).filter(
        (p) => p.pid === child && !p.state.startsWith('Z'),
      ),
    ).toEqual([]);
    await r.close();
    const reopened = createRuntime(join(root, 'db'), options);
    expect(reopened.getGoal(p.goalId).attempts).toHaveLength(1);
    await reopened.close();
  } finally {
    await cleanup();
  }
});
it('awaits managed shutdown and keeps a successful code artifact verifying after restart', async () => {
  const { r, p, root, options, cleanup } = await setup();
  try {
    r.continuePlan(p.id, { revision: 1 });
    await r.waitForIdle();
    await r.close();
    const next = createRuntime(join(root, 'db'), options);
    await next.waitForIdle();
    expect(next.getGoal(p.goalId).tasks[0]!.status).toBe('completed');
    await next.close();
  } finally {
    await cleanup();
  }
});
it('cancels before dispatch without spawning and awaits an in-flight process tree on close', async () => {
  const queued = await setup('WAIT');
  try {
    queued.r.continuePlan(queued.p.id, { revision: 1 });
    const id = queued.r.getGoal(queued.p.goalId).attempts[0]!.id;
    queued.r.cancelTask(queued.task.id, id);
    await queued.r.waitForIdle();
    expect(queued.r.getCodeRun(id)!.pid).toBeNull();
    expect(queued.r.getGoal(queued.p.goalId).tasks[0]!.status).toBe(
      'interrupted',
    );
  } finally {
    await queued.cleanup();
  }
  const active = await setup('WAIT_TREE');
  try {
    active.r.continuePlan(active.p.id, { revision: 1 });
    const id = active.r.getGoal(active.p.goalId).attempts[0]!.id;
    const file = join(
      active.root,
      'managed',
      active.r.getTaskPackage(active.task.id).workspaceId,
      'child.json',
    );
    await expect
      .poll(() => existsSync(file), { timeout: 4000, interval: 30 })
      .toBe(true);
    const child = JSON.parse(readFileSync(file, 'utf8')).pid as number;
    await expect
      .poll(
        () =>
          JSON.parse(active.r.getCodeRun(id)!.processIdentity ?? '[]').some(
            (p: { pid: number }) => p.pid === child,
          ),
        { timeout: 3000, interval: 30 },
      )
      .toBe(true);
    const closing = active.r.close();
    expect(() => active.r.runTask(active.task.id)).toThrow('closing');
    await closing;
    expect(
      (await processTable()).filter(
        (p) => p.pid === child && !p.state.startsWith('Z'),
      ),
    ).toEqual([]);
    const next = createRuntime(join(active.root, 'db'), active.options);
    expect(next.getGoal(active.p.goalId).tasks[0]!.status).toBe('interrupted');
    await next.close();
  } finally {
    await active.cleanup();
  }
});
it('rejects package drift between claim and dispatch without starting a process', async () => {
  const { r, p, task, root, cleanup } = await setup();
  const { default: Database } = await import('better-sqlite3');
  const db = new Database(join(root, 'db'));
  try {
    r.continuePlan(p.id, { revision: 1 });
    db.prepare('UPDATE tasks SET title=? WHERE id=?').run(
      'external drift',
      task.id,
    );
    await r.waitForIdle();
    const goal = r.getGoal(p.goalId);
    expect(goal.attempts[0]!.error).toBe('PACKAGE_HASH_MISMATCH');
    expect(r.getCodeRun(goal.attempts[0]!.id)!.pid).toBeNull();
  } finally {
    db.close();
    await cleanup();
  }
});

it.each(['fail', 'timeout', 'missing', 'tamper', 'cancel'])(
  'independent verifier rejects %s and never completes from an agent claim',
  async (mode) => {
    const x = await setup('SUCCESS', 5000, (d) => {
      if (d.schemaVersion !== 'plan.v2') throw new Error();
      const c = d.phases[0]!.tasks[0]!.acceptance.checks[0]!;
      c.argv =
        mode === 'missing'
          ? ['/nonexistent/merforge-tool']
          : [
              'node',
              '-e',
              mode === 'fail'
                ? 'process.exit(3)'
                : mode === 'tamper'
                  ? "require('fs').writeFileSync('sum.mjs','tampered')"
                  : 'setInterval(()=>{},1000)',
            ];
      c.timeoutMs = mode === 'cancel' ? 5000 : 200;
    });
    try {
      x.r.continuePlan(x.p.id, { revision: 1 });
      const id = x.r.getGoal(x.p.goalId).attempts[0]!.id;
      if (mode === 'cancel') {
        await expect
          .poll(() => x.r.getGoal(x.p.goalId).tasks[0]!.status, {
            timeout: 5000,
          })
          .toBe('verifying');
        await expect
          .poll(() => x.r.getCodeRun(id)!.stoppedAt, { timeout: 5000 })
          .toBeNull();
        x.r.cancelTask(x.task.id, id);
      }
      await x.r.waitForIdle();
      const g = x.r.getGoal(x.p.goalId);
      expect(g.tasks[0]!.status).toBe(
        mode === 'cancel' ? 'interrupted' : 'failed',
      );
      expect(g.verifications[0]!.verdict).toBe('FAIL');
      await x.r.verifyAttempt(id);
      expect(x.r.getGoal(x.p.goalId).verifications).toHaveLength(1);
    } finally {
      await x.cleanup();
    }
  },
);

it('requires reviewed reconciliation hash for retry, preserves failure evidence and rejects later drift', async () => {
  const x = await setup('RETRY_SUCCESS');
  try {
    x.r.continuePlan(x.p.id, { revision: 1 });
    await x.r.waitForIdle();
    const a = x.r.getGoal(x.p.goalId).attempts[0]!;
    expect(a.status).toBe('failed');
    expect(() => x.r.retry(x.task.id)).toThrow('EXPLICIT_CODE_RETRY_REQUIRED');
    const report = await x.r.reconcileCode(x.task.id, a.id, false);
    await expect(
      x.r.retryCode(x.task.id, {
        attemptId: a.id,
        snapshotHash: '0'.repeat(64),
        revision: 1,
      }),
    ).rejects.toThrow('WORKSPACE_DRIFT');
    const next = await x.r.retryCode(x.task.id, {
      attemptId: a.id,
      snapshotHash: report.snapshotHash,
      revision: 1,
    });
    await x.r.waitForIdle();
    const g = x.r.getGoal(x.p.goalId);
    expect(g.tasks[0]!.status).toBe('completed');
    expect(g.verifications.map((v) => v.verdict)).toEqual(['FAIL', 'PASS']);
    expect(x.r.getCodeRun(next.attemptId)!.predecessorAttemptId).toBe(a.id);
  } finally {
    await x.cleanup();
  }
});

it('SIGKILL after file modification keeps isolation, explicitly stops the tree and retries from reconciled files', async () => {
  const x = await setup('CRASH_RETRY');
  await x.r.close();
  const definition = codeDefinition(
    (
      await git(x.options.codex.repositories.sample, 'rev-parse', 'HEAD')
    ).trim(),
  );
  if (definition.schemaVersion !== 'plan.v2') throw new Error();
  definition.phases[0]!.tasks[0]!.instructions = 'CRASH_RETRY';
  const db = join(x.root, 'crash-db');
  const child = fork(
    fileURLToPath(new URL('./fixtures/code-crash.mjs', import.meta.url)),
    [],
    { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] },
  );
  let r: ReturnType<typeof createRuntime> | undefined;
  try {
    const msg = once(child, 'message');
    child.send({ db, options: x.options, definition });
    const [ids] = (await msg) as [
      { planId: string; goalId: string; taskId: string },
    ];
    const { default: Database } = await import('better-sqlite3');
    const read = new Database(db);
    const pkg = JSON.parse(
      (
        read
          .prepare('SELECT package_json FROM task_packages WHERE task_id=?')
          .get(ids.taskId) as { package_json: string }
      ).package_json,
    );
    await expect
      .poll(
        () =>
          readFileSync(
            join(x.root, 'managed', pkg.workspaceId, 'sum.mjs'),
            'utf8',
          ),
        { timeout: 5000 },
      )
      .toContain('()=>1');
    const exit = once(child, 'exit');
    child.kill('SIGKILL');
    await exit;
    read.close();
    r = createRuntime(db, x.options);
    await r.waitForIdle();
    const a = r.getGoal(ids.goalId).attempts[0]!;
    expect(a.status).toBe('running');
    await expect(r.reconcileCode(ids.taskId, a.id, false)).rejects.toThrow(
      'PROCESS_STILL_RUNNING',
    );
    const report = await r.reconcileCode(ids.taskId, a.id, true);
    expect(r.getGoal(ids.goalId).tasks[0]!.status).toBe('interrupted');
    await r.retryCode(ids.taskId, {
      attemptId: a.id,
      snapshotHash: report.snapshotHash,
      revision: 1,
    });
    await r.waitForIdle();
    expect(r.getGoal(ids.goalId).tasks[0]!.status).toBe('completed');
    expect(r.getGoal(ids.goalId).attempts).toHaveLength(2);
  } finally {
    if (child.exitCode === null && child.signalCode === null)
      child.kill('SIGKILL');
    await r?.close();
    await x.cleanup();
  }
}, 20000);

it('blocks retry after external drift and refuses absent process identity or missing evidence', async () => {
  const x = await setup('RETRY_SUCCESS');
  const { default: Database } = await import('better-sqlite3');
  const db = new Database(join(x.root, 'db'));
  try {
    x.r.continuePlan(x.p.id, { revision: 1 });
    await x.r.waitForIdle();
    const a = x.r.getGoal(x.p.goalId).attempts[0]!;
    const run = x.r.getCodeRun(a.id)!;
    const report = await x.r.reconcileCode(x.task.id, a.id, false);
    writeFileSync(
      join(x.root, 'managed', run.workspaceId, 'sum.mjs'),
      'export const sum=()=>99;',
    );
    await expect(
      x.r.retryCode(x.task.id, {
        attemptId: a.id,
        revision: 1,
        snapshotHash: report.snapshotHash,
      }),
    ).rejects.toThrow('WORKSPACE_DRIFT');
    db.prepare(
      'UPDATE code_runs SET stopped_at=NULL,process_identity=NULL WHERE attempt_id=?',
    ).run(a.id);
    await expect(x.r.reconcileCode(x.task.id, a.id, true)).rejects.toThrow(
      'PROCESS_IDENTITY_UNAVAILABLE',
    );
    db.prepare('UPDATE code_runs SET stopped_at=? WHERE attempt_id=?').run(
      run.stoppedAt,
      a.id,
    );
    const ref = db
      .prepare('SELECT relative_path FROM file_artifacts WHERE id=?')
      .get(run.outputArtifactId) as { relative_path: string };
    rmSync(join(x.root, 'evidence', ref.relative_path));
    await expect(x.r.reconcileCode(x.task.id, a.id, false)).rejects.toThrow();
    expect(x.r.getGoal(x.p.goalId).attempts).toHaveLength(1);
  } finally {
    db.close();
    await x.cleanup();
  }
});

it('SIGKILL during command verification never replays over a live checker or reports PASS', async () => {
  const x = await setup();
  await x.r.close();
  const definition = codeDefinition(
    (
      await git(x.options.codex.repositories.sample, 'rev-parse', 'HEAD')
    ).trim(),
  );
  if (definition.schemaVersion !== 'plan.v2') throw new Error();
  const acceptance = definition.phases[0]!.tasks[0]!.acceptance;
  acceptance.allowedOutputs = ['checking'];
  acceptance.checks[0]!.argv = [
    'node',
    '-e',
    "require('fs').writeFileSync('checking','started');setInterval(()=>{},1000)",
  ];
  acceptance.checks[0]!.timeoutMs = 10000;
  const dbPath = join(x.root, 'verify-crash-db');
  const child = fork(
    fileURLToPath(new URL('./fixtures/code-crash.mjs', import.meta.url)),
    [],
    { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] },
  );
  let r: ReturnType<typeof createRuntime> | undefined;
  try {
    const msg = once(child, 'message');
    child.send({ db: dbPath, options: x.options, definition });
    const [ids] = (await msg) as [
      { planId: string; goalId: string; taskId: string },
    ];
    const { default: Database } = await import('better-sqlite3');
    const read = new Database(dbPath);
    const pkg = JSON.parse(
      (
        read
          .prepare('SELECT package_json FROM task_packages WHERE task_id=?')
          .get(ids.taskId) as { package_json: string }
      ).package_json,
    );
    await expect
      .poll(
        () => existsSync(join(x.root, 'managed', pkg.workspaceId, 'checking')),
        { timeout: 5000 },
      )
      .toBe(true);
    await expect
      .poll(
        () =>
          (
            read
              .prepare('SELECT stopped_at FROM code_runs WHERE task_id=?')
              .get(ids.taskId) as { stopped_at: string | null }
          ).stopped_at,
        { timeout: 5000 },
      )
      .toBeNull();
    const exited = once(child, 'exit');
    child.kill('SIGKILL');
    await exited;
    read.close();
    r = createRuntime(dbPath, x.options);
    await r.waitForIdle();
    const g = r.getGoal(ids.goalId),
      a = g.attempts[0]!;
    expect(a.status).toBe('failed');
    expect(g.verifications[0]!.verdict).toBe('FAIL');
    expect(g.verifications[0]!.reasons).toContain('CODE_EVIDENCE_MISSING');
    await r.reconcileCode(ids.taskId, a.id, true);
    expect(r.getCodeRun(a.id)!.stoppedAt).toBeTruthy();
    expect(r.getGoal(ids.goalId).attempts).toHaveLength(1);
  } finally {
    if (child.exitCode === null && child.signalCode === null)
      child.kill('SIGKILL');
    await r?.close();
    await x.cleanup();
  }
}, 20000);
