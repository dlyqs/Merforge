import type Database from 'better-sqlite3';

// Sixth, append-only migration. Rebuild only the three executor CHECKs while
// preserving released table definitions, indexes, triggers and historical rows.
export function codeMigration(db: Database.Database) {
  const triggers = db
    .prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger'")
    .all() as { name: string; sql: string }[];
  for (const t of triggers) db.exec(`DROP TRIGGER "${t.name}"`);
  for (const table of ['tasks', 'attempts', 'artifacts']) {
    const { sql } = db
      .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?")
      .get(table) as { sql: string };
    const indexes = db
      .prepare(
        "SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name=? AND sql IS NOT NULL",
      )
      .all(table) as { sql: string }[];
    const expanded = sql
      .replace(/'mock','human'/g, "'mock','human','codex'")
      .replace(
        new RegExp(`CREATE TABLE "?${table}"?`, 'i'),
        `CREATE TABLE ${table}_code_next`,
      );
    db.exec(expanded);
    db.exec(
      `INSERT INTO ${table}_code_next SELECT * FROM ${table}; DROP TABLE ${table}; ALTER TABLE ${table}_code_next RENAME TO ${table};`,
    );
    for (const i of indexes) db.exec(i.sql);
  }
  for (const t of triggers) db.exec(t.sql);
  db.exec(`
CREATE TABLE code_workspaces (
 id TEXT PRIMARY KEY, plan_id TEXT NOT NULL, revision INTEGER NOT NULL,
 repository_key TEXT NOT NULL, base_commit TEXT NOT NULL, source_path TEXT, path TEXT,
 state TEXT NOT NULL DEFAULT 'planned' CHECK(state IN ('planned','ready','occupied','quarantined')),
 owner_token TEXT, last_output_id TEXT,
 UNIQUE(plan_id,revision), UNIQUE(id,plan_id,revision),
 FOREIGN KEY(plan_id,revision) REFERENCES plan_revisions(plan_id,revision)
);
CREATE TABLE task_packages (
 task_id TEXT PRIMARY KEY REFERENCES tasks(id), plan_id TEXT NOT NULL, revision INTEGER NOT NULL,
 workspace_id TEXT NOT NULL, package_json TEXT NOT NULL, package_hash TEXT NOT NULL, acceptance_hash TEXT NOT NULL,
 UNIQUE(task_id,workspace_id,package_hash),
 FOREIGN KEY(workspace_id,plan_id,revision) REFERENCES code_workspaces(id,plan_id,revision)
);
CREATE TRIGGER package_identity BEFORE INSERT ON task_packages WHEN NOT EXISTS (
 SELECT 1 FROM tasks t JOIN phases f ON f.id=t.phase_id JOIN plans p ON p.id=f.plan_id
 WHERE t.id=NEW.task_id AND f.plan_id=NEW.plan_id AND f.revision=NEW.revision AND t.executor_id='codex'
 AND json_extract(NEW.package_json,'$.taskId')=t.id AND json_extract(NEW.package_json,'$.phaseId')=f.id
 AND json_extract(NEW.package_json,'$.goalId')=p.goal_id AND json_extract(NEW.package_json,'$.planId')=f.plan_id
 AND json_extract(NEW.package_json,'$.revision')=f.revision AND json_extract(NEW.package_json,'$.workspaceId')=NEW.workspace_id
 AND json_extract(NEW.package_json,'$.acceptanceHash')=NEW.acceptance_hash)
 BEGIN SELECT RAISE(ABORT,'package identity mismatch'); END;
CREATE TRIGGER package_frozen BEFORE UPDATE ON task_packages BEGIN SELECT RAISE(ABORT,'immutable package'); END;
CREATE TRIGGER package_delete_frozen BEFORE DELETE ON task_packages BEGIN SELECT RAISE(ABORT,'immutable package'); END;
CREATE TABLE code_runs (
 attempt_id TEXT PRIMARY KEY REFERENCES attempts(id), task_id TEXT NOT NULL, workspace_id TEXT NOT NULL, package_hash TEXT NOT NULL,
 predecessor_attempt_id TEXT REFERENCES attempts(id), dispatch_token TEXT NOT NULL UNIQUE,
 adapter_version TEXT NOT NULL, model TEXT, session_id TEXT, pid INTEGER, process_identity TEXT,
 cancel_requested_at TEXT, stopped_at TEXT, input_artifact_id TEXT, output_artifact_id TEXT, error_code TEXT,
 UNIQUE(attempt_id,workspace_id),
 FOREIGN KEY(task_id,workspace_id,package_hash) REFERENCES task_packages(task_id,workspace_id,package_hash),
 FOREIGN KEY(input_artifact_id,attempt_id,workspace_id) REFERENCES file_artifacts(id,attempt_id,workspace_id),
 FOREIGN KEY(output_artifact_id,attempt_id,workspace_id) REFERENCES file_artifacts(id,attempt_id,workspace_id)
);
CREATE TRIGGER code_run_identity BEFORE INSERT ON code_runs WHEN NOT EXISTS (
 SELECT 1 FROM attempts a WHERE a.id=NEW.attempt_id AND a.task_id=NEW.task_id AND a.executor_id='codex') OR
 (NEW.predecessor_attempt_id IS NOT NULL AND NOT EXISTS (
 SELECT 1 FROM attempts a WHERE a.id=NEW.predecessor_attempt_id AND a.task_id=NEW.task_id))
 BEGIN SELECT RAISE(ABORT,'run identity mismatch'); END;
CREATE TABLE file_artifacts (
 id TEXT PRIMARY KEY, attempt_id TEXT NOT NULL, workspace_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('input','output','events','diagnostics')), relative_path TEXT NOT NULL UNIQUE,
 sha256 TEXT NOT NULL, size INTEGER NOT NULL CHECK(size>=0), created_at TEXT NOT NULL,
 UNIQUE(id,attempt_id,workspace_id), FOREIGN KEY(attempt_id,workspace_id) REFERENCES code_runs(attempt_id,workspace_id)
);
CREATE TRIGGER file_artifact_frozen BEFORE UPDATE ON file_artifacts BEGIN SELECT RAISE(ABORT,'immutable evidence'); END;
CREATE TRIGGER code_run_frozen BEFORE UPDATE OF task_id,workspace_id,package_hash,predecessor_attempt_id,dispatch_token ON code_runs
 BEGIN SELECT RAISE(ABORT,'immutable run identity'); END;
CREATE TRIGGER verification_artifact_identity BEFORE INSERT ON verifications WHEN NOT EXISTS (
 SELECT 1 FROM artifacts f JOIN attempts a ON a.id=f.attempt_id JOIN tasks t ON t.id=a.task_id
 WHERE f.id=NEW.artifact_id AND f.attempt_id=NEW.attempt_id AND NEW.acceptance_version=t.acceptance_version)
 BEGIN SELECT RAISE(ABORT,'verification identity mismatch'); END;
CREATE TRIGGER workspace_identity_frozen BEFORE UPDATE OF plan_id,revision,repository_key,base_commit ON code_workspaces
 BEGIN SELECT RAISE(ABORT,'immutable workspace identity'); END;
`);
}
