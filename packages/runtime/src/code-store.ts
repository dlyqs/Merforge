import type Database from 'better-sqlite3';
import {
  taskPackageSchema,
  codeRunSchema,
  type TaskPackage,
} from '@merforge/contracts';
import { hashObject } from './code-hash.js';
import { RuntimeError } from './errors.js';
export interface WorkspaceRow {
  id: string;
  plan_id: string;
  revision: number;
  repository_key: string;
  base_commit: string;
  source_path: string | null;
  path: string | null;
  state: 'planned' | 'ready' | 'occupied' | 'quarantined';
  owner_token: string | null;
  last_output_id: string | null;
}
export function readPackage(
  db: Database.Database,
  taskId: string,
): TaskPackage {
  const row = db
    .prepare(
      'SELECT package_json,package_hash,acceptance_hash FROM task_packages WHERE task_id=?',
    )
    .get(taskId) as
    | { package_json: string; package_hash: string; acceptance_hash: string }
    | undefined;
  if (!row) throw new RuntimeError('CONFLICT', 'PACKAGE_MISSING');
  const pkg = taskPackageSchema.parse(JSON.parse(row.package_json));
  const member = db
    .prepare(
      'SELECT t.title,t.executor_id,t.acceptance_version,t.phase_id,f.plan_id,f.revision,p.goal_id,p.review,p.revision AS current_revision FROM tasks t JOIN phases f ON f.id=t.phase_id JOIN plans p ON p.id=f.plan_id WHERE t.id=?',
    )
    .get(taskId) as Record<string, unknown>;
  if (
    hashObject(pkg) !== row.package_hash ||
    hashObject(pkg.acceptance) !== pkg.acceptanceHash ||
    pkg.acceptanceHash !== row.acceptance_hash ||
    pkg.taskId !== taskId ||
    pkg.title !== member.title ||
    pkg.executorId !== member.executor_id ||
    pkg.acceptanceVersion !== member.acceptance_version ||
    pkg.phaseId !== member.phase_id ||
    pkg.planId !== member.plan_id ||
    pkg.revision !== member.revision ||
    pkg.goalId !== member.goal_id
  )
    throw new RuntimeError('CONFLICT', 'PACKAGE_HASH_MISMATCH');
  return pkg;
}
export function readCodeRun(db: Database.Database, attemptId: string) {
  const row = db
    .prepare(
      `SELECT attempt_id AS attemptId,task_id AS taskId,workspace_id AS workspaceId,package_hash AS packageHash,
    predecessor_attempt_id AS predecessorAttemptId,dispatch_token AS dispatchToken,adapter_version AS adapterVersion,model,session_id AS sessionId,
    pid,process_identity AS processIdentity,cancel_requested_at AS cancelRequestedAt,stopped_at AS stoppedAt,
    input_artifact_id AS inputArtifactId,output_artifact_id AS outputArtifactId,error_code AS errorCode FROM code_runs WHERE attempt_id=?`,
    )
    .get(attemptId);
  return row ? codeRunSchema.parse(row) : null;
}
