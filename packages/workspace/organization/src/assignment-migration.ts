/** Upgrade organization history to assignment-based execution and optional Run delivery. */
import type { DatabaseSync } from 'node:sqlite'

/**
 * Preserve artifacts, submissions and approval references while retiring device qualifications.
 * @param db - Owning startup transaction; the caller validates every foreign key before commit.
 */
export function migrateAssignmentExecution(db: DatabaseSync): void {
  const legacy = db.prepare("SELECT 1 FROM organization_devices WHERE state='active' UNION ALL SELECT 1 FROM assignment_delegations WHERE state='active' UNION ALL SELECT 1 FROM assignment_leases WHERE state='held' LIMIT 1").get()
  if (legacy) {
    const revision = db.prepare("INSERT INTO organization_events (kind,actorId,organizationId,at) VALUES ('simplify-task-workflow',NULL,NULL,?) RETURNING revision").get(Date.now())?.revision
    if (typeof revision !== 'number') throw new Error('organization: missing migration revision')
    db.prepare("UPDATE assignment_leases SET state='invalidated',version=? WHERE state='held'").run(revision)
    db.prepare("UPDATE assignment_delegations SET state='invalidated',version=? WHERE state='active'").run(revision)
    db.prepare("UPDATE organization_devices SET state='revoked',version=? WHERE state='active'").run(revision)
  }
  db.exec(`CREATE TABLE organization_artifacts_v21 (id TEXT PRIMARY KEY, assignmentId TEXT NOT NULL REFERENCES task_assignments(id),
    runId TEXT REFERENCES execution_runs(id), data TEXT NOT NULL, bytes BLOB NOT NULL) STRICT;
    INSERT INTO organization_artifacts_v21 SELECT * FROM organization_artifacts;
    DROP TABLE organization_artifacts;
    ALTER TABLE organization_artifacts_v21 RENAME TO organization_artifacts;
    CREATE TABLE organization_submissions_v21 (id TEXT PRIMARY KEY, assignmentId TEXT NOT NULL REFERENCES task_assignments(id),
    runId TEXT REFERENCES execution_runs(id), data TEXT NOT NULL) STRICT;
    INSERT INTO organization_submissions_v21 SELECT * FROM organization_submissions;
    DROP TABLE organization_submissions;
    ALTER TABLE organization_submissions_v21 RENAME TO organization_submissions;`)
}
