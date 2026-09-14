import type { TaskPackage, VerificationResult } from '@merforge/contracts';
import { realpathSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { managedProcess, type ProcessIdentity } from './executors/process.js';
import {
  snapshot,
  validateOutput,
  covers,
  type WorkspaceSnapshot,
} from './workspace.js';
import { hashObject } from './code-hash.js';

export async function verifyCode(input: {
  pkg: TaskPackage;
  path: string;
  before: WorkspaceSnapshot;
  output: WorkspaceSnapshot;
  signal: AbortSignal;
  assertOwnership: () => void;
  onIdentity: (root: ProcessIdentity, all: ProcessIdentity[]) => void;
  publish: (report: unknown) => void;
}): Promise<VerificationResult> {
  const { pkg, path, before, output } = input;
  const checks: unknown[] = [];
  const reasons: string[] = [];
  const startedAt = new Date().toISOString();
  try {
    input.assertOwnership();
    if (hashObject(pkg.acceptance) !== pkg.acceptanceHash)
      throw new Error('ACCEPTANCE_TAMPERED');
    if ((await snapshot(path, output.baseCommit)).hash !== output.hash)
      throw new Error('WORKSPACE_DRIFT');
    validateOutput(before, output, pkg);
    if (!pkg.acceptance.allowEmptyDiff && before.hash === output.hash)
      throw new Error('EMPTY_DIFF');
    for (const check of pkg.acceptance.checks) {
      input.assertOwnership();
      const cwd = realpathSync(resolve(path, check.cwd));
      if (relative(path, cwd).startsWith('..'))
        throw new Error('CHECK_CWD_REJECTED');
      let bytes = 0;
      const chunks: Buffer[] = [];
      const start = new Date().toISOString();
      const result = await managedProcess({
        executable: check.argv[0]!,
        argv: check.argv.slice(1),
        cwd,
        stdin: '',
        env: { PATH: process.env.PATH, LANG: 'C', TMPDIR: process.env.TMPDIR },
        signal: input.signal,
        timeoutMs: check.timeoutMs,
        onIdentity: input.onIdentity,
        onData: (_stream, chunk) => {
          bytes += chunk.length;
          if (bytes > check.maxOutputBytes)
            throw new Error('CHECK_OUTPUT_LIMIT');
          chunks.push(chunk);
        },
      });
      // Raw command output may include arbitrary secrets. Store a digest and byte
      // count; the reviewed argv and exit code provide reproducible diagnostics.
      checks.push({
        id: check.id,
        cwd: check.cwd,
        argv: check.argv,
        startedAt: start,
        endedAt: new Date().toISOString(),
        exitCode: result.exitCode,
        errorCode: result.errorCode,
        processIdentities: result.identities,
        output: {
          bytes,
          sha256: hashObject(Buffer.concat(chunks).toString('base64')),
          rawStored: false,
        },
      });
      if (!result.stopped) throw new Error('PROCESS_STOP_UNCONFIRMED');
      if (result.errorCode) throw new Error(result.errorCode);
      if (result.exitCode !== 0) reasons.push('CHECK_FAILED:' + check.id);
    }
    input.assertOwnership();
    const after = await snapshot(path, output.baseCommit);
    const protectedView = (s: WorkspaceSnapshot) =>
      s.files.filter(
        (f) =>
          !pkg.acceptance.allowedOutputs.some((p) => covers(p, f.path)) ||
          pkg.acceptance.protectedFiles.some((p) => p.path === f.path) ||
          output.files.some((p) => p.path === f.path),
      );
    if (hashObject(protectedView(after)) !== hashObject(protectedView(output)))
      throw new Error('VERIFICATION_WORKSPACE_DRIFT');
    if (input.signal.aborted) throw new Error('CANCELLED');
  } catch (e) {
    reasons.push(
      e instanceof Error && /^[A-Z_:a-z0-9-]+$/.test(e.message)
        ? e.message
        : 'CODE_VERIFIER_ERROR',
    );
  }
  input.publish({
    schemaVersion: 'code-verification.v1',
    taskId: pkg.taskId,
    acceptanceHash: pkg.acceptanceHash,
    snapshotHash: output.hash,
    startedAt,
    endedAt: new Date().toISOString(),
    checks,
    reasons,
  });
  return {
    acceptanceVersion: 'commands.v1',
    verdict: reasons.length ? 'FAIL' : 'PASS',
    reasons: reasons.length ? reasons : ['ALL_COMMANDS_PASSED'],
  };
}
