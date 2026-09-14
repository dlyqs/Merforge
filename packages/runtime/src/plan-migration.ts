// Fifth migration. The first four released migrations remain unchanged.
export const planMigration = `
CREATE TABLE plans (
 id TEXT PRIMARY KEY, goal_id TEXT NOT NULL UNIQUE REFERENCES goals(id), revision INTEGER NOT NULL CHECK(revision>0),
 review TEXT NOT NULL CHECK(review IN ('pending','approved','rejected')),
 status TEXT NOT NULL CHECK(status IN ('idle','running','waiting','blocked','completed')), stop_reason TEXT,
 mode TEXT NOT NULL DEFAULT 'manual' CHECK(mode IN ('manual','auto','auto_until')),
 control_version INTEGER NOT NULL DEFAULT 0 CHECK(control_version>=0), authorized INTEGER NOT NULL DEFAULT 0 CHECK(authorized IN (0,1)),
 start_phase_id TEXT, stop_phase_id TEXT, active_phase_id TEXT, limit_phase_id TEXT,
 FOREIGN KEY(id,revision) REFERENCES plan_revisions(plan_id,revision) DEFERRABLE INITIALLY DEFERRED,
 FOREIGN KEY(start_phase_id,id,revision) REFERENCES phases(id,plan_id,revision) DEFERRABLE INITIALLY DEFERRED,
 FOREIGN KEY(stop_phase_id,id,revision) REFERENCES phases(id,plan_id,revision) DEFERRABLE INITIALLY DEFERRED,
 FOREIGN KEY(active_phase_id,id,revision) REFERENCES phases(id,plan_id,revision) DEFERRABLE INITIALLY DEFERRED,
 FOREIGN KEY(limit_phase_id,id,revision) REFERENCES phases(id,plan_id,revision) DEFERRABLE INITIALLY DEFERRED,
 CHECK((mode='auto_until' AND start_phase_id IS NOT NULL AND stop_phase_id IS NOT NULL) OR (mode IN ('manual','auto') AND start_phase_id IS NULL AND stop_phase_id IS NULL))
);
CREATE TABLE plan_revisions (
 plan_id TEXT NOT NULL REFERENCES plans(id), revision INTEGER NOT NULL CHECK(revision>0),
 definition TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(plan_id,revision)
);
CREATE TABLE phases (
 id TEXT PRIMARY KEY, plan_id TEXT NOT NULL, revision INTEGER NOT NULL,
 position INTEGER NOT NULL CHECK(position>0), title TEXT NOT NULL,
 requires_approval INTEGER NOT NULL CHECK(requires_approval IN (0,1)),
 status TEXT NOT NULL CHECK(status IN ('pending','in_progress','completed','blocked')),
 UNIQUE(plan_id,revision,position), UNIQUE(id,plan_id,revision),
 FOREIGN KEY(plan_id,revision) REFERENCES plan_revisions(plan_id,revision)
);
ALTER TABLE tasks ADD COLUMN phase_id TEXT REFERENCES phases(id);
ALTER TABLE tasks ADD COLUMN position INTEGER CHECK(position>0);
CREATE UNIQUE INDEX phase_task_position ON tasks(phase_id,position);
CREATE TRIGGER task_phase_insert BEFORE INSERT ON tasks WHEN
 (NEW.phase_id IS NULL) != (NEW.position IS NULL) OR
 (NEW.phase_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM phases f JOIN plans p ON p.id=f.plan_id WHERE f.id=NEW.phase_id AND p.goal_id=NEW.goal_id))
 BEGIN SELECT RAISE(ABORT,'invalid task phase'); END;
CREATE TRIGGER task_phase_immutable BEFORE UPDATE OF phase_id,position,goal_id ON tasks
 WHEN NEW.phase_id IS NOT OLD.phase_id OR NEW.position IS NOT OLD.position OR NEW.goal_id IS NOT OLD.goal_id
 BEGIN SELECT RAISE(ABORT,'immutable task membership'); END;
CREATE TABLE approvals (
 id TEXT PRIMARY KEY, plan_id TEXT NOT NULL, revision INTEGER NOT NULL, phase_id TEXT,
 kind TEXT NOT NULL CHECK(kind IN ('review','phase_entry')), decision TEXT NOT NULL CHECK(decision IN ('pending','approved','rejected')),
 actor TEXT, created_at TEXT NOT NULL, decided_at TEXT,
 FOREIGN KEY(plan_id,revision) REFERENCES plan_revisions(plan_id,revision),
 FOREIGN KEY(phase_id,plan_id,revision) REFERENCES phases(id,plan_id,revision),
 CHECK((kind='review' AND phase_id IS NULL) OR (kind='phase_entry' AND phase_id IS NOT NULL)),
 CHECK((decision='pending' AND actor IS NULL AND decided_at IS NULL) OR (decision!='pending' AND actor IS NOT NULL AND decided_at IS NOT NULL))
);
CREATE UNIQUE INDEX review_per_revision ON approvals(plan_id,revision) WHERE kind='review';
CREATE UNIQUE INDEX pending_phase_approval ON approvals(phase_id) WHERE decision='pending';
CREATE TRIGGER immutable_revision BEFORE UPDATE ON plan_revisions BEGIN SELECT RAISE(ABORT,'immutable revision'); END;
CREATE TRIGGER immutable_revision_delete BEFORE DELETE ON plan_revisions BEGIN SELECT RAISE(ABORT,'immutable revision'); END;
CREATE TRIGGER valid_plan_boundary BEFORE UPDATE OF mode,start_phase_id,stop_phase_id ON plans WHEN NEW.mode='auto_until' AND
 NOT EXISTS (SELECT 1 FROM phases a JOIN phases b ON b.plan_id=a.plan_id AND b.revision=a.revision
 WHERE a.id=NEW.start_phase_id AND b.id=NEW.stop_phase_id AND a.plan_id=NEW.id AND a.revision=NEW.revision AND a.position<=b.position)
 BEGIN SELECT RAISE(ABORT,'invalid plan boundary'); END;
CREATE TRIGGER one_plan_attempt BEFORE INSERT ON attempts WHEN NEW.status IN ('running','waiting_human','verifying') AND EXISTS (
 SELECT 1 FROM tasks t JOIN phases f ON f.id=t.phase_id JOIN phases other ON other.plan_id=f.plan_id
 JOIN tasks ot ON ot.phase_id=other.id JOIN attempts a ON a.task_id=ot.id
 WHERE t.id=NEW.task_id AND a.status IN ('running','waiting_human','verifying'))
 BEGIN SELECT RAISE(ABORT,'active plan attempt'); END;
CREATE TABLE events_next (
 id INTEGER PRIMARY KEY AUTOINCREMENT, goal_id TEXT NOT NULL REFERENCES goals(id), task_id TEXT REFERENCES tasks(id), attempt_id TEXT REFERENCES attempts(id),
 type TEXT NOT NULL, from_status TEXT, to_status TEXT, error_code TEXT, created_at TEXT NOT NULL,
 plan_id TEXT REFERENCES plans(id), revision INTEGER, phase_id TEXT REFERENCES phases(id), approval_id TEXT REFERENCES approvals(id), control_version INTEGER,
 FOREIGN KEY(plan_id,revision) REFERENCES plan_revisions(plan_id,revision)
);
INSERT INTO events_next(id,goal_id,task_id,attempt_id,type,from_status,to_status,error_code,created_at)
 SELECT id,goal_id,task_id,attempt_id,type,from_status,to_status,error_code,created_at FROM events;
DROP TABLE events;
ALTER TABLE events_next RENAME TO events;
CREATE INDEX events_goal_id ON events(goal_id);
`;
