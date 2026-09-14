import { execFile, fork } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { it, expect } from 'vitest';
import { codeDefinition } from '../../../packages/runtime/src/code-test-helpers.js';
import { git } from '../../../packages/runtime/src/workspace.js';
import {
  planDetailSchema,
  goalDetailSchema,
  codeDetailSchema,
  acceptedSchema,
} from '@merforge/contracts';
const exec = promisify(execFile);
it('CLI → HTTP code plan review, FAIL, evidence, reconciliation and frozen retry', async () => {
  const root = mkdtempSync(join(tmpdir(), 'merforge-code-cli-')),
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
  const d = codeDefinition((await git(source, 'rev-parse', 'HEAD')).trim());
  if (d.schemaVersion !== 'plan.v2') throw Error();
  d.phases[0]!.tasks[0]!.instructions = 'RETRY_SUCCESS';
  const config = join(root, 'config.json'),
    input = join(root, 'plan.json');
  writeFileSync(
    config,
    JSON.stringify({
      executable: fileURLToPath(
        new URL(
          '../../../packages/runtime/src/fixtures/codex.mjs',
          import.meta.url,
        ),
      ),
      repositories: { sample: source },
      managedRoot: join(root, 'managed'),
      artifactRoot: join(root, 'evidence'),
    }),
  );
  writeFileSync(
    input,
    JSON.stringify({ objective: 'code CLI', revision: 1, definition: d }),
  );
  const child = fork(
    new URL('./fixtures/daemon.ts', import.meta.url),
    [join(root, 'db'), '0'],
    {
      cwd: fileURLToPath(new URL('../', import.meta.url)),
      execArgv: ['--import', 'tsx'],
      silent: true,
      env: { ...process.env, MERFORGE_TEST_CODE_CONFIG: config },
    },
  );
  let logs = '';
  child.stderr!.on('data', (b) => (logs += b));
  child.stdout!.on('data', (b) => (logs += b));
  try {
    const ready = once(child, 'message');
    const died = once(child, 'exit').then(() => {
      throw Error(logs);
    });
    const [message] = (await Promise.race([ready, died])) as [{ url: string }];
    async function cli(...args: string[]) {
      const out = await exec(
        process.execPath,
        ['--import', 'tsx', 'src/main.ts', ...args],
        {
          cwd: fileURLToPath(new URL('../../cli/', import.meta.url)),
          env: { ...process.env, MERFORGE_API_URL: message.url },
          timeout: 15000,
        },
      );
      return JSON.parse(out.stdout) as unknown;
    }
    const p = planDetailSchema.parse(await cli('plan', 'create', input));
    await cli(
      'plan',
      'review',
      p.id,
      p.approvals[0]!.id,
      '--revision',
      '1',
      '--decision',
      'approved',
      '--actor',
      'test',
    );
    await cli('plan', 'continue', p.id, '--revision', '1');
    let g = goalDetailSchema.parse(await cli('inspect', p.goalId));
    await expect
      .poll(
        async () => {
          g = goalDetailSchema.parse(await cli('inspect', p.goalId));
          return g.tasks[0]!.status;
        },
        { timeout: 10000 },
      )
      .toBe('failed');
    const t = g.tasks[0]!,
      a = g.attempts[0]!;
    const code = codeDetailSchema.parse(await cli('code-inspect', t.id));
    expect(code.runs).toHaveLength(1);
    expect(
      await cli('code-evidence', t.id, code.evidence[0]!.id),
    ).toHaveProperty('hash');
    const response = await fetch(
      `${message.url}/api/tasks/${t.id}/code/evidence/00000000-0000-4000-8000-000000000000`,
    );
    expect(response.status).toBe(404);
    const report = (await cli('reconcile', t.id, a.id)) as {
      snapshotHash: string;
    };
    await expect(
      cli(
        'retry-code',
        t.id,
        a.id,
        '--revision',
        '2',
        '--snapshot',
        report.snapshotHash,
      ),
    ).rejects.toThrow();
    acceptedSchema.parse(
      await cli(
        'retry-code',
        t.id,
        a.id,
        '--revision',
        '1',
        '--snapshot',
        report.snapshotHash,
      ),
    );
    await expect
      .poll(
        async () => {
          g = goalDetailSchema.parse(await cli('inspect', p.goalId));
          return g.tasks[0]!.status;
        },
        { timeout: 10000 },
      )
      .toBe('completed');
    expect(g.verifications.map((v) => v.verdict)).toEqual(['FAIL', 'PASS']);
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill('SIGTERM');
      await exited;
    }
    rmSync(root, { recursive: true, force: true });
  }
}, 30000);
