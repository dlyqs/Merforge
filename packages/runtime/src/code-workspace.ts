import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { TaskPackage } from '@merforge/contracts';
import { ArtifactStore, type FileEvidence } from './artifact-store.js';
import {
  WorkspaceManager,
  snapshot,
  validateInput,
  validateOutput,
  type WorkspaceSnapshot,
} from './workspace.js';
import { readCodeRun, type WorkspaceRow } from './code-store.js';
import type { Atomic } from './plans.js';
import { stableJson } from './code-hash.js';
export interface CodeWorkspaceConfig {
  managedRoot: string;
  artifactRoot: string;
  repositories: Record<string, string>;
}
export function codeWorkspaces(
  db: Database.Database,
  atomic: Atomic,
  config: CodeWorkspaceConfig,
) {
  const manager = new WorkspaceManager(config.managedRoot);
  const store = new ArtifactStore(config.artifactRoot);
  function event(
    pkg: TaskPackage,
    attemptId: string,
    type: string,
    errorCode?: string,
  ) {
    return {
      goalId: pkg.goalId,
      planId: pkg.planId,
      revision: pkg.revision,
      phaseId: pkg.phaseId,
      taskId: pkg.taskId,
      attemptId,
      type,
      createdAt: new Date().toISOString(),
      ...(errorCode ? { errorCode } : {}),
    };
  }
  function evidence(
    pkg: TaskPackage,
    attemptId: string,
    kind: 'input' | 'output' | 'events' | 'diagnostics',
    bytes: Buffer,
  ) {
    const ref = store.publish(attemptId, bytes);
    atomic((emit) => {
      db.prepare('INSERT INTO file_artifacts VALUES (?,?,?,?,?,?,?,?)').run(
        ref.id,
        attemptId,
        pkg.workspaceId,
        kind,
        ref.relativePath,
        ref.sha256,
        ref.size,
        new Date().toISOString(),
      );
      emit(event(pkg, attemptId, 'artifact_published'));
    });
    return ref;
  }
  function readSnapshot(id: string, workspaceId: string): WorkspaceSnapshot {
    const ref = db
      .prepare(
        'SELECT id,attempt_id AS attemptId,relative_path AS relativePath,sha256,size FROM file_artifacts WHERE id=? AND workspace_id=?',
      )
      .get(id, workspaceId) as
      (FileEvidence & { attemptId: string }) | undefined;
    if (!ref) throw new Error('ARTIFACT_MISSING');
    return JSON.parse(
      store.read(ref, ref.attemptId).toString(),
    ) as WorkspaceSnapshot;
  }
  async function prepare(pkg: TaskPackage, attemptId: string) {
    const run = readCodeRun(db, attemptId);
    if (!run || run.workspaceId !== pkg.workspaceId)
      throw new Error('RUN_IDENTITY_MISMATCH');
    const ws = db
      .prepare('SELECT * FROM code_workspaces WHERE id=?')
      .get(pkg.workspaceId) as WorkspaceRow;
    if (ws.state !== 'occupied' || ws.owner_token !== run.dispatchToken)
      throw new Error('WORKSPACE_OWNERSHIP_LOST');
    const lease = manager.acquire(ws.id, run.dispatchToken);
    let metadataHash: string | undefined;
    try {
      const source = config.repositories[ws.repository_key];
      if (!source) throw new Error('SOURCE_NOT_CONFIGURED');
      if (ws.path && ws.path !== manager.path(ws.id))
        throw new Error('WORKSPACE_PATH_MISMATCH');
      const prepared = await manager.prepare(
        ws.id,
        source,
        ws.base_commit,
        ws.path !== null,
      );
      metadataHash = prepared.metadataHash;
      lease.assert();
      const before = await snapshot(prepared.path, ws.base_commit);
      validateInput(before, pkg);
      const recovery = run.predecessorAttemptId
        ? (db
            .prepare(
              'SELECT snapshot_hash FROM code_reconciliations WHERE attempt_id=? AND accepted=1',
            )
            .get(run.predecessorAttemptId) as
            { snapshot_hash: string } | undefined)
        : undefined;
      if (recovery) {
        if (recovery.snapshot_hash !== before.hash)
          throw new Error('WORKSPACE_DRIFT');
      } else if (ws.last_output_id) {
        const previous = db
          .prepare(
            `SELECT a.status,v.verdict FROM file_artifacts f JOIN attempts a ON a.id=f.attempt_id JOIN verifications v ON v.attempt_id=a.id WHERE f.id=?`,
          )
          .get(ws.last_output_id) as
          { status: string; verdict: string } | undefined;
        if (previous?.status !== 'completed' || previous.verdict !== 'PASS')
          throw new Error('PREDECESSOR_NOT_VERIFIED');
        if (readSnapshot(ws.last_output_id, ws.id).hash !== before.hash)
          throw new Error('WORKSPACE_DRIFT');
      } else if (ws.path) {
        const first = db
          .prepare(
            "SELECT id FROM file_artifacts WHERE workspace_id=? AND kind='input' ORDER BY rowid LIMIT 1",
          )
          .get(ws.id) as { id: string } | undefined;
        if (!first || readSnapshot(first.id, ws.id).hash !== before.hash)
          throw new Error('WORKSPACE_DRIFT');
      }
      const input = evidence(
        pkg,
        attemptId,
        'input',
        Buffer.from(stableJson(before)),
      );
      atomic((emit) => {
        db.prepare(
          'UPDATE code_workspaces SET path=?,source_path=? WHERE id=? AND owner_token=?',
        ).run(prepared.path, prepared.source, ws.id, run.dispatchToken);
        db.prepare(
          'UPDATE code_runs SET input_artifact_id=? WHERE attempt_id=?',
        ).run(input.id, attemptId);
        emit(event(pkg, attemptId, 'workspace_prepared'));
        emit(event(pkg, attemptId, 'snapshot_recorded'));
      });
      return {
        path: prepared.path,
        before,
        async assertInput() {
          lease.assert();
          manager.path(ws.id);
          manager.assertMetadata(prepared.path, metadataHash!);
          if (
            (await snapshot(prepared.path, ws.base_commit)).hash !== before.hash
          )
            throw new Error('WORKSPACE_DRIFT');
        },
        async output() {
          lease.assert();
          manager.path(ws.id);
          manager.assertMetadata(prepared.path, metadataHash!);
          const after = await snapshot(prepared.path, ws.base_commit);
          if (
            (await snapshot(prepared.path, ws.base_commit)).hash !== after.hash
          )
            throw new Error('WORKSPACE_DRIFT');
          // Publish even out-of-scope output for investigation; never call it PASS.
          const ref = evidence(
            pkg,
            attemptId,
            'output',
            Buffer.from(stableJson(after)),
          );
          atomic((emit) => {
            db.prepare(
              'UPDATE code_runs SET output_artifact_id=? WHERE attempt_id=?',
            ).run(ref.id, attemptId);
            emit(event(pkg, attemptId, 'snapshot_recorded'));
          });
          validateOutput(before, after, pkg);
          return { ref, snapshot: after };
        },
        release(quarantine: boolean) {
          lease.assert();
          atomic((emit) => {
            db.prepare(
              'UPDATE code_workspaces SET state=?,owner_token=NULL WHERE id=? AND owner_token=?',
            ).run(
              quarantine ? 'quarantined' : 'ready',
              ws.id,
              run.dispatchToken,
            );
            emit(
              event(
                pkg,
                attemptId,
                quarantine ? 'workspace_quarantined' : 'workspace_released',
              ),
            );
          });
          if (!quarantine) lease.release();
        },
      };
    } catch (e) {
      atomic((emit) => {
        db.prepare(
          "UPDATE code_workspaces SET state='quarantined' WHERE id=?",
        ).run(ws.id);
        emit(
          event(
            pkg,
            attemptId,
            'workspace_conflict',
            e instanceof Error ? e.message : 'WORKSPACE_ERROR',
          ),
        );
      });
      // No Agent has started. Preserve files but no live writer needs this lease.
      lease.release();
      throw e;
    }
  }
  return { prepare, evidence, readSnapshot, store };
}
