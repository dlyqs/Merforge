import { guardedPath } from './artifact-store.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type Database from 'better-sqlite3';
import { readFileSync, existsSync, unlinkSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { processTable, type ProcessIdentity } from './executors/process.js';
import { WorkspaceManager, snapshot, validateInput } from './workspace.js';
import { readPackage, readCodeRun, type WorkspaceRow } from './code-store.js';
import { codeWorkspaces, type CodeWorkspaceConfig } from './code-workspace.js';
import { stableJson } from './code-hash.js';
import { RuntimeError } from './errors.js';
import type { Atomic } from './plans.js';

export function codeRecovery(
  db: Database.Database,
  atomic: Atomic,
  config: CodeWorkspaceConfig,
) {
  const work = codeWorkspaces(db, atomic, config);
  const manager = new WorkspaceManager(config.managedRoot);
  const active = new Set<string>();
  function verifyEvidence(attemptId: string) {
    const refs = db
      .prepare(
        'SELECT id,attempt_id AS attemptId,relative_path AS relativePath,sha256,size FROM file_artifacts WHERE attempt_id=?',
      )
      .all(attemptId) as (import('./artifact-store.js').FileEvidence & {
      attemptId: string;
    })[];
    for (const ref of refs) work.store.read(ref, ref.attemptId);
  }
  async function reconcile(taskId: string, attemptId: string, stop: boolean) {
    if (active.has(taskId))
      throw new RuntimeError('CONFLICT', 'RECONCILIATION_ACTIVE');
    active.add(taskId);
    try {
      const pkg = readPackage(db, taskId);
      const run = readCodeRun(db, attemptId);
      const latest = db
        .prepare(
          'SELECT id,status FROM attempts WHERE task_id=? ORDER BY sequence DESC LIMIT 1',
        )
        .get(taskId) as { id: string; status: string };
      if (
        !run ||
        run.taskId !== taskId ||
        latest.id !== attemptId ||
        latest.status === 'completed'
      )
        throw new Error('RECOVERY_IDENTITY_MISMATCH');
      const ws = db
        .prepare('SELECT * FROM code_workspaces WHERE id=?')
        .get(pkg.workspaceId) as WorkspaceRow;
      const emitEvent = (type: string, errorCode?: string) =>
        atomic((emit) =>
          emit({
            goalId: pkg.goalId,
            planId: pkg.planId,
            revision: pkg.revision,
            phaseId: pkg.phaseId,
            taskId,
            attemptId,
            type,
            createdAt: new Date().toISOString(),
            ...(errorCode ? { errorCode } : {}),
          }),
        );
      emitEvent('recovery_started');
      const identities = JSON.parse(
        run.processIdentity ?? '[]',
      ) as ProcessIdentity[];
      // Missing dispatch identity after input publication is an ambiguous crash
      // window. Never infer that the process did not start from a missing PID.
      if (!run.stoppedAt && !identities.length && run.inputArtifactId)
        throw new Error('PROCESS_IDENTITY_UNAVAILABLE');
      const matching = async () =>
        (await processTable()).filter(
          (p) =>
            !p.state.startsWith('Z') &&
            identities.some(
              (old) => old.pid === p.pid && old.start === p.start,
            ),
        );
      let live = await matching();
      if (live.length && !stop) throw new Error('PROCESS_STILL_RUNNING');
      if (live.length) {
        // Freeze known parents, discover their descendants before terminating.
        for (const p of live) {
          try {
            process.kill(p.pid, 'SIGSTOP');
          } catch (e) {
            if ((e as NodeJS.ErrnoException).code !== 'ESRCH') throw e;
          }
        }
        const table = await processTable();
        let added = true;
        while (added) {
          added = false;
          for (const p of table)
            if (
              !identities.some((i) => i.pid === p.pid) &&
              identities.some(
                (i) =>
                  i.pid === p.ppid &&
                  table.some((t) => t.pid === i.pid && t.start === i.start),
              )
            ) {
              identities.push(p);
              added = true;
            }
        }
        atomic(() =>
          db
            .prepare(
              'UPDATE code_runs SET process_identity=? WHERE attempt_id=?',
            )
            .run(JSON.stringify(identities), attemptId),
        );
        for (const p of await matching()) {
          try {
            process.kill(p.pid, 'SIGKILL');
          } catch (e) {
            if ((e as NodeJS.ErrnoException).code !== 'ESRCH') throw e;
          }
        }
        for (let i = 0; i < 40 && (await matching()).length; i++)
          await delay(25);
        live = await matching();
      }
      if (live.length) throw new Error('PROCESS_STOP_UNCONFIRMED');
      // A daemon crash while a tree was live cannot prove that unobserved,
      // reparented descendants stopped. Require an explicit stop operation and
      // preserve the supported trusted/no-daemonization limitation.
      if (!run.stoppedAt && identities.length && !stop)
        throw new Error('PROCESS_TREE_REQUIRES_EXPLICIT_STOP');
      if (ws.path) {
        if (process.platform !== 'darwin')
          throw new Error('RECOVERY_PLATFORM_UNSUPPORTED');
        const { stdout } = await promisify(execFile)(
          '/usr/sbin/lsof',
          ['-a', '-u', String(process.getuid!()), '-d', 'cwd', '-Fpn'],
          { timeout: 10000, maxBuffer: 4 * 1024 * 1024 },
        );
        const paths = stdout
          .split('\n')
          .filter((line) => line.startsWith('n'))
          .map((line) => line.slice(1));
        if (
          paths.some(
            (path) => path === ws.path || path.startsWith(ws.path! + '/'),
          )
        )
          throw new Error('UNATTRIBUTED_WORKSPACE_PROCESS');
      }
      verifyEvidence(attemptId);
      const leasePath = guardedPath(manager.root, ws.id + '.lease');
      guardedPath(manager.root, ws.id + '.lease/owner.json');
      if (existsSync(leasePath)) {
        const owner = JSON.parse(
          readFileSync(join(leasePath, 'owner.json'), 'utf8'),
        );
        if (owner.token !== run.dispatchToken || owner.id !== ws.id)
          throw new Error('WORKSPACE_OWNERSHIP_LOST');
      }
      let observed = null;
      if (ws.path) {
        const prepared = await manager.prepare(
          ws.id,
          config.repositories[ws.repository_key]!,
          ws.base_commit,
          true,
        );
        observed = await snapshot(prepared.path, ws.base_commit);
        validateInput(observed, pkg);
        if (
          (await snapshot(prepared.path, ws.base_commit)).hash !== observed.hash
        )
          throw new Error('WORKSPACE_DRIFT');
        const ref = work.evidence(
          pkg,
          attemptId,
          'diagnostics',
          Buffer.from(stableJson(observed)),
        );
        atomic(() =>
          db
            .prepare(
              'INSERT INTO code_reconciliations(attempt_id,snapshot_hash,evidence_id,created_at) VALUES (?,?,?,?) ON CONFLICT(attempt_id) DO UPDATE SET snapshot_hash=excluded.snapshot_hash,evidence_id=excluded.evidence_id,created_at=excluded.created_at,accepted=0',
            )
            .run(attemptId, observed!.hash, ref.id, new Date().toISOString()),
        );
      }
      atomic(() => {
        db.prepare('UPDATE code_runs SET stopped_at=? WHERE attempt_id=?').run(
          new Date().toISOString(),
          attemptId,
        );
        db.prepare(
          "UPDATE code_workspaces SET state='quarantined',owner_token=? WHERE id=?",
        ).run(run.dispatchToken, ws.id);
      });
      emitEvent('process_reconciled');
      emitEvent('recovery_finished');
      return {
        taskId,
        attemptId,
        snapshotHash: observed?.hash ?? null,
        changedFromOutput:
          observed !== null && run.outputArtifactId !== null
            ? work.readSnapshot(run.outputArtifactId, ws.id).hash !==
              observed.hash
            : null,
        processStopped: true,
        resumeSupported: false,
        nextAction: 'retry-code with the reviewed snapshot hash',
        files:
          observed?.files.map(({ path, sha256, size }) => ({
            path,
            sha256,
            size,
          })) ?? [],
        diff: observed?.diff ?? '',
      };
    } catch (e) {
      throw new RuntimeError(
        'CONFLICT',
        e instanceof Error ? e.message : 'RECOVERY_FAILED',
      );
    } finally {
      active.delete(taskId);
    }
  }
  async function authorizeRetry(
    taskId: string,
    attemptId: string,
    hash: string | null,
  ) {
    const pkg = readPackage(db, taskId),
      run = readCodeRun(db, attemptId);
    if (!run || run.taskId !== taskId || !run.stoppedAt)
      throw new RuntimeError('CONFLICT', 'RECONCILIATION_REQUIRED');
    verifyEvidence(attemptId);
    const ws = db
      .prepare('SELECT * FROM code_workspaces WHERE id=?')
      .get(pkg.workspaceId) as WorkspaceRow;
    if (ws.path) {
      const record = db
        .prepare(
          'SELECT snapshot_hash FROM code_reconciliations WHERE attempt_id=?',
        )
        .get(attemptId) as { snapshot_hash: string } | undefined;
      if (
        !hash ||
        record?.snapshot_hash !== hash ||
        (await snapshot(manager.path(ws.id), ws.base_commit)).hash !== hash
      )
        throw new RuntimeError('CONFLICT', 'WORKSPACE_DRIFT');
    } else if (hash !== null)
      throw new RuntimeError('CONFLICT', 'RECOVERY_HASH_MISMATCH');
    const leasePath = guardedPath(manager.root, ws.id + '.lease');
    guardedPath(manager.root, ws.id + '.lease/owner.json');
    if (existsSync(leasePath)) {
      const owner = JSON.parse(
        readFileSync(join(leasePath, 'owner.json'), 'utf8'),
      );
      if (owner.token !== run.dispatchToken)
        throw new RuntimeError('CONFLICT', 'WORKSPACE_OWNERSHIP_LOST');
      unlinkSync(join(leasePath, 'owner.json'));
      rmdirSync(leasePath);
    }
    atomic((emit) => {
      db.prepare(
        'UPDATE code_reconciliations SET accepted=1 WHERE attempt_id=?',
      ).run(attemptId);
      db.prepare(
        "UPDATE code_workspaces SET state='ready',owner_token=NULL WHERE id=?",
      ).run(ws.id);
      emit({
        goalId: pkg.goalId,
        taskId,
        attemptId,
        type: 'retry_selected',
        createdAt: new Date().toISOString(),
      });
    });
  }
  return { reconcile, authorizeRetry };
}
