import { codeRecovery } from './code-recovery.js';
import { verifyCode } from './code-verifier.js';
import { WorkspaceManager, snapshot } from './workspace.js';
import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { Task, Accepted, TaskPackage } from '@merforge/contracts';
import {
  CodexExecutor,
  CODEX_ADAPTER_VERSION,
  type CodexOptions,
} from './executors/codex.js';
import { codeWorkspaces, type CodeWorkspaceConfig } from './code-workspace.js';
import { readPackage, readCodeRun, type WorkspaceRow } from './code-store.js';
import { hashObject, stableJson } from './code-hash.js';
import { RuntimeError } from './errors.js';
import type { Atomic } from './plans.js';
export type CodeExecutionOptions = CodexOptions & CodeWorkspaceConfig;
export function createCodeExecution(
  db: Database.Database,
  atomic: Atomic,
  options: CodeExecutionOptions | undefined,
  finish: (
    accepted: Accepted,
    status: 'verifying' | 'failed' | 'interrupted',
    error: string | null,
    artifact?: unknown,
  ) => void,
) {
  const work = options ? codeWorkspaces(db, atomic, options) : null;
  const recovery = options ? codeRecovery(db, atomic, options) : null;
  const executor = options ? new CodexExecutor(options) : null;
  const controllers = new Map<string, AbortController>();
  const emitFor = (
    pkg: TaskPackage,
    attemptId: string,
    type: string,
    errorCode?: string,
  ) => ({
    goalId: pkg.goalId,
    planId: pkg.planId,
    revision: pkg.revision,
    phaseId: pkg.phaseId,
    taskId: pkg.taskId,
    attemptId,
    type,
    createdAt: new Date().toISOString(),
    ...(errorCode ? { errorCode } : {}),
  });
  function gate(task: Task) {
    if (!options)
      throw new RuntimeError(
        'CONFLICT',
        'dispatch_rejected_codex_unconfigured',
      );
    const pkg = readPackage(db, task.id);
    const ws = db
      .prepare('SELECT * FROM code_workspaces WHERE id=?')
      .get(pkg.workspaceId) as WorkspaceRow;
    if (!options.repositories[ws.repository_key])
      throw new RuntimeError('CONFLICT', 'SOURCE_NOT_CONFIGURED');
    const latest = db
      .prepare(
        'SELECT a.id,a.status FROM attempts a WHERE a.task_id=? ORDER BY a.sequence DESC LIMIT 1',
      )
      .get(task.id) as { id: string; status: string } | undefined;
    if (
      latest &&
      ['failed', 'interrupted'].includes(latest.status) &&
      ws.path &&
      !db
        .prepare(
          'SELECT 1 FROM code_reconciliations WHERE attempt_id=? AND accepted=1',
        )
        .get(latest.id)
    )
      throw new RuntimeError('CONFLICT', 'EXPLICIT_CODE_RETRY_REQUIRED');
    if (ws.state !== 'planned' && ws.state !== 'ready')
      throw new RuntimeError('CONFLICT', 'WORKSPACE_RECONCILIATION_REQUIRED');
    return pkg;
  }
  function claim(task: Task, attemptId: string, predecessor: string | null) {
    const pkg = gate(task);
    const token = randomUUID();
    db.prepare(
      'INSERT INTO code_runs(attempt_id,task_id,workspace_id,package_hash,predecessor_attempt_id,dispatch_token,adapter_version,model) VALUES (?,?,?,?,?,?,?,?)',
    ).run(
      attemptId,
      task.id,
      pkg.workspaceId,
      hashObject(pkg),
      predecessor,
      token,
      CODEX_ADAPTER_VERSION,
      options?.model ?? null,
    );
    if (
      db
        .prepare(
          "UPDATE code_workspaces SET state='occupied',owner_token=? WHERE id=? AND state IN ('planned','ready')",
        )
        .run(token, pkg.workspaceId).changes !== 1
    )
      throw new RuntimeError('CONFLICT', 'WORKSPACE_CONFLICT');
  }
  function cancel(taskId: string, attemptId: string) {
    atomic((emit) => {
      const r = readCodeRun(db, attemptId);
      if (!r || r.taskId !== taskId)
        throw new RuntimeError('CONFLICT', 'CANCEL_IDENTITY_MISMATCH');
      const a = db
        .prepare('SELECT status FROM attempts WHERE id=?')
        .get(attemptId) as { status: string };
      if (r.cancelRequestedAt) return;
      if (a.status !== 'running' && a.status !== 'verifying')
        throw new RuntimeError('CONFLICT', 'CANCEL_NOT_RUNNING');
      db.prepare(
        'UPDATE code_runs SET cancel_requested_at=? WHERE attempt_id=?',
      ).run(new Date().toISOString(), attemptId);
      const stored = db
        .prepare('SELECT package_json FROM task_packages WHERE task_id=?')
        .get(taskId) as { package_json: string };
      emit(
        emitFor(
          JSON.parse(stored.package_json) as TaskPackage,
          attemptId,
          'cancel_requested',
        ),
      );
    });
    controllers.get(attemptId)?.abort();
    return { taskId, attemptId };
  }
  async function execute(task: Task, accepted: Accepted) {
    const attemptId = accepted.attemptId;
    let pkg: TaskPackage;
    try {
      pkg = readPackage(db, task.id);
    } catch {
      atomic(() => {
        db.prepare(
          "UPDATE code_workspaces SET state='quarantined' WHERE id=(SELECT workspace_id FROM code_runs WHERE attempt_id=?)",
        ).run(attemptId);
        db.prepare(
          "UPDATE code_runs SET error_code='PACKAGE_HASH_MISMATCH',stopped_at=? WHERE attempt_id=?",
        ).run(new Date().toISOString(), attemptId);
      });
      controllers.delete(attemptId);
      finish(accepted, 'failed', 'PACKAGE_HASH_MISMATCH');
      return;
    }
    const controller = controllers.get(attemptId) ?? new AbortController();
    controllers.set(attemptId, controller);
    let prepared:
      Awaited<ReturnType<NonNullable<typeof work>['prepare']>> | undefined;
    let stopped = true;
    try {
      if (readCodeRun(db, attemptId)!.cancelRequestedAt) controller.abort();
      if (controller.signal.aborted) {
        finish(accepted, 'interrupted', 'CANCELLED');
        atomic(() => {
          db.prepare(
            "UPDATE code_workspaces SET state='ready',owner_token=NULL WHERE id=?",
          ).run(pkg.workspaceId);
          db.prepare(
            'UPDATE code_runs SET stopped_at=? WHERE attempt_id=?',
          ).run(new Date().toISOString(), attemptId);
        });
        return;
      }
      prepared = await work!.prepare(pkg, attemptId);
      atomic((emit) => emit(emitFor(pkg, attemptId, 'executor_started')));
      await prepared.assertInput();
      stopped = false;
      const result = await executor!.execute(
        pkg,
        prepared.path,
        controller.signal,
        (root, all) =>
          atomic((emit) => {
            const row = readCodeRun(db, attemptId)!;
            db.prepare(
              'UPDATE code_runs SET pid=?,process_identity=? WHERE attempt_id=?',
            ).run(root.pid, JSON.stringify(all), attemptId);
            if (!row.pid) emit(emitFor(pkg, attemptId, 'process_dispatched'));
          }),
        (sessionId) =>
          atomic((emit) => {
            db.prepare(
              'UPDATE code_runs SET session_id=? WHERE attempt_id=?',
            ).run(sessionId, attemptId);
            emit(emitFor(pkg, attemptId, 'executor_first_event'));
          }),
      );
      stopped = result.stopped;
      work!.evidence(
        pkg,
        attemptId,
        'events',
        Buffer.from(stableJson(result.events)),
      );
      work!.evidence(
        pkg,
        attemptId,
        'diagnostics',
        Buffer.from(
          stableJson({
            ...result.diagnostics,
            processIdentities: result.identities,
            exitCode: result.exitCode,
            signal: result.signal,
            errorCode: result.errorCode,
            stopped,
          }),
        ),
      );
      atomic((emit) => {
        db.prepare(
          'UPDATE code_runs SET stopped_at=?,error_code=? WHERE attempt_id=?',
        ).run(
          stopped ? new Date().toISOString() : null,
          result.errorCode,
          attemptId,
        );
        emit(
          emitFor(
            pkg,
            attemptId,
            'process_exited',
            result.errorCode ?? undefined,
          ),
        );
      });
      if (!stopped) throw new Error('PROCESS_STOP_UNCONFIRMED');
      const output = await prepared.output();
      if (result.errorCode) {
        prepared.release(true);
        prepared = undefined;
        finish(
          accepted,
          result.errorCode === 'CANCELLED' ? 'interrupted' : 'failed',
          result.errorCode,
        );
        if (result.errorCode === 'CANCELLED')
          atomic((emit) => emit(emitFor(pkg, attemptId, 'cancel_confirmed')));
      } else {
        // Persist the artifact before the independent command Verifier runs;
        // summary.v1 must never complete a code task.
        finish(accepted, 'verifying', null, {
          schemaVersion: 'code-output.v1',
          workspaceId: pkg.workspaceId,
          snapshotHash: output.snapshot.hash,
          evidenceId: output.ref.id,
        });
        prepared.release(false);
        prepared = undefined;
      }
    } catch (e) {
      const error =
        e instanceof Error && /^[A-Z_]+$/.test(e.message)
          ? e.message
          : 'CODE_EXECUTION_FAILED';
      if (prepared) {
        try {
          prepared.release(true);
        } catch {
          /* persistent lease remains */
        }
      }
      atomic((emit) => {
        db.prepare(
          "UPDATE code_workspaces SET state='quarantined' WHERE id=?",
        ).run(pkg.workspaceId);
        db.prepare('UPDATE code_runs SET error_code=? WHERE attempt_id=?').run(
          error,
          attemptId,
        );
        emit(emitFor(pkg, attemptId, 'dispatch_rejected', error));
      });
      // Unknown live processes keep the attempt running and workspace quarantined.
      if (stopped)
        finish(
          accepted,
          controller.signal.aborted ? 'interrupted' : 'failed',
          controller.signal.aborted ? 'CANCELLED' : error,
        );
    } finally {
      controllers.delete(attemptId);
    }
  }
  async function verify(taskId: string, attemptId: string) {
    if (!work || !options) throw new Error('CODE_VERIFIER_UNAVAILABLE');
    const pkg = readPackage(db, taskId);
    const run = readCodeRun(db, attemptId)!;
    if (!run.stoppedAt || !run.inputArtifactId || !run.outputArtifactId)
      throw new Error('CODE_EVIDENCE_MISSING');
    const ws = db
      .prepare('SELECT * FROM code_workspaces WHERE id=?')
      .get(pkg.workspaceId) as WorkspaceRow;
    if (ws.state !== 'ready')
      throw new Error('WORKSPACE_RECONCILIATION_REQUIRED');
    const manager = new WorkspaceManager(options.managedRoot);
    const lease = manager.acquire(ws.id, run.dispatchToken);
    const controller = new AbortController();
    controllers.set(attemptId, controller);
    let unsafe = false;
    try {
      const prepared = await manager.prepare(
        ws.id,
        options.repositories[ws.repository_key]!,
        ws.base_commit,
        true,
      );
      if (run.cancelRequestedAt) controller.abort();
      const result = await verifyCode({
        pkg,
        path: prepared.path,
        before: work.readSnapshot(run.inputArtifactId, ws.id),
        output: work.readSnapshot(run.outputArtifactId, ws.id),
        signal: controller.signal,
        assertOwnership: () => {
          lease.assert();
          manager.assertMetadata(prepared.path, prepared.metadataHash);
        },
        onIdentity: (root, all) =>
          atomic(() => {
            db.prepare(
              'UPDATE code_runs SET pid=?,process_identity=?,stopped_at=NULL WHERE attempt_id=?',
            ).run(root.pid, JSON.stringify(all), attemptId);
          }),
        publish: (report) => {
          const reasons = (report as { reasons: string[] }).reasons;
          unsafe =
            reasons.includes('PROCESS_STOP_UNCONFIRMED') ||
            reasons.includes('PROCESS_INSPECTION_FAILED');
          work.evidence(
            pkg,
            attemptId,
            'diagnostics',
            Buffer.from(stableJson(report)),
          );
          atomic((emit) => {
            db.prepare(
              'UPDATE code_runs SET stopped_at=? WHERE attempt_id=?',
            ).run(unsafe ? null : new Date().toISOString(), attemptId);
            for (const check of (
              report as {
                checks: { exitCode: number | null; errorCode: string | null }[];
              }
            ).checks)
              emit(
                emitFor(
                  pkg,
                  attemptId,
                  'check_finished',
                  check.errorCode ??
                    (check.exitCode === 0 ? undefined : 'CHECK_FAILED'),
                ),
              );
          });
        },
      });
      if (result.verdict === 'PASS' && pkg.acceptance.allowedOutputs.length) {
        const verified = await snapshot(prepared.path, ws.base_commit);
        const ref = work.evidence(
          pkg,
          attemptId,
          'output',
          Buffer.from(stableJson(verified)),
        );
        atomic(() => {
          db.prepare(
            'UPDATE code_runs SET output_artifact_id=? WHERE attempt_id=?',
          ).run(ref.id, attemptId);
          db.prepare(
            'UPDATE code_workspaces SET last_output_id=? WHERE id=?',
          ).run(ref.id, ws.id);
        });
      }
      return result;
    } finally {
      controllers.delete(attemptId);
      if (unsafe)
        atomic(() => {
          db.prepare(
            "UPDATE code_workspaces SET state='quarantined' WHERE id=?",
          ).run(ws.id);
        });
      else lease.release();
    }
  }
  function recover() {
    // Startup only isolates; explicit reconciliation checks processes and files
    // before a later retry can release the surviving filesystem lease.
    db.prepare(
      "UPDATE code_workspaces SET state='quarantined' WHERE state='occupied'",
    ).run();
  }
  return {
    gate,
    register: (id: string) => controllers.set(id, new AbortController()),
    async reconcile(taskId: string, attemptId: string, stop: boolean) {
      if (!recovery || controllers.has(attemptId))
        throw new RuntimeError(
          'CONFLICT',
          'RECOVERY_NOT_AVAILABLE_WHILE_ACTIVE',
        );
      const report = await recovery.reconcile(taskId, attemptId, stop);
      const a = db
        .prepare('SELECT status FROM attempts WHERE id=?')
        .get(attemptId) as { status: string };
      if (a.status === 'running')
        finish(
          { goalId: readPackage(db, taskId).goalId, taskId, attemptId },
          'interrupted',
          'EXECUTION_INTERRUPTED',
        );
      return report;
    },
    async authorizeRetry(
      taskId: string,
      attemptId: string,
      hash: string | null,
    ) {
      if (!recovery || controllers.has(attemptId))
        throw new RuntimeError(
          'CONFLICT',
          'RECOVERY_NOT_AVAILABLE_WHILE_ACTIVE',
        );
      await recovery.authorizeRetry(taskId, attemptId, hash);
    },
    verify,
    claim,
    execute,
    cancel,
    recover,
    detail(taskId: string) {
      const pkg = readPackage(db, taskId);
      const workspace = db
        .prepare(
          'SELECT id,path,state,base_commit AS baseCommit,repository_key AS repositoryKey FROM code_workspaces WHERE id=?',
        )
        .get(pkg.workspaceId);
      const rows = db
        .prepare(
          'SELECT attempt_id FROM code_runs WHERE task_id=? ORDER BY rowid',
        )
        .all(taskId) as { attempt_id: string }[];
      const evidence = db
        .prepare(
          'SELECT f.id,f.attempt_id AS attemptId,f.kind,f.sha256,f.size FROM file_artifacts f JOIN code_runs r ON r.attempt_id=f.attempt_id WHERE r.task_id=? ORDER BY f.rowid',
        )
        .all(taskId);
      return {
        package: pkg,
        workspace,
        runs: rows.map((r) => readCodeRun(db, r.attempt_id)),
        evidence,
        resumeSupported: false,
      };
    },
    readEvidence(taskId: string, evidenceId: string) {
      if (!work) throw new RuntimeError('CONFLICT', 'CODE_UNCONFIGURED');
      const row = db
        .prepare(
          'SELECT f.id,f.attempt_id AS attemptId,f.relative_path AS relativePath,f.sha256,f.size FROM file_artifacts f JOIN code_runs r ON r.attempt_id=f.attempt_id WHERE f.id=? AND r.task_id=?',
        )
        .get(evidenceId, taskId) as
        | (import('./artifact-store.js').FileEvidence & { attemptId: string })
        | undefined;
      if (!row) throw new RuntimeError('NOT_FOUND', 'EVIDENCE_NOT_FOUND');
      const value = JSON.parse(work.store.read(row, row.attemptId).toString());
      if (value.schemaVersion === 'snapshot.v1')
        return {
          ...value,
          files: value.files.map(
            ({
              contentBase64,
              ...file
            }: {
              contentBase64: string;
              path: string;
            }) => file,
          ),
        };
      return value;
    },
    getRun: (id: string) => readCodeRun(db, id),
    getPackage: (id: string) => readPackage(db, id),
    cancelAll() {
      const rows = db
        .prepare(
          "SELECT r.attempt_id AS attemptId,r.task_id AS taskId FROM code_runs r JOIN attempts a ON a.id=r.attempt_id WHERE a.status IN ('running','verifying')",
        )
        .all() as { attemptId: string; taskId: string }[];
      for (const row of rows) cancel(row.taskId, row.attemptId);
    },
    get active() {
      return controllers.size;
    },
  };
}
