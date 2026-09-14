
  CREATE TABLE goals (id TEXT PRIMARY KEY, objective TEXT NOT NULL, created_at TEXT NOT NULL);
  CREATE TABLE tasks (id TEXT PRIMARY KEY, goal_id TEXT NOT NULL REFERENCES goals(id), title TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('ready', 'completed')), created_at TEXT NOT NULL);
  CREATE INDEX tasks_goal_id ON tasks(goal_id);
  CREATE TABLE runs (id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), executor_id TEXT NOT NULL CHECK(executor_id = 'mock'), status TEXT NOT NULL CHECK(status = 'completed'), created_at TEXT NOT NULL);
  CREATE INDEX runs_task_id ON runs(task_id);
  CREATE TABLE evidence (id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id), kind TEXT NOT NULL CHECK(kind = 'mock'), summary TEXT NOT NULL, created_at TEXT NOT NULL);
  CREATE INDEX evidence_run_id ON evidence(run_id);
  CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, goal_id TEXT NOT NULL REFERENCES goals(id), task_id TEXT NOT NULL REFERENCES tasks(id), type TEXT NOT NULL CHECK(type IN ('goal_created', 'mock_completed')), created_at TEXT NOT NULL);
  CREATE INDEX events_goal_id ON events(goal_id);


  CREATE TABLE tasks_next (id TEXT PRIMARY KEY, goal_id TEXT NOT NULL REFERENCES goals(id), title TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('ready','running','waiting_human','verifying','completed','failed','interrupted')), executor_id TEXT NOT NULL DEFAULT 'mock' CHECK(executor_id IN ('mock','human')), acceptance_version TEXT NOT NULL DEFAULT 'summary.v1', created_at TEXT NOT NULL);
  INSERT INTO tasks_next (id,goal_id,title,status,created_at) SELECT id,goal_id,title,status,created_at FROM tasks;
  DROP TABLE tasks;
  ALTER TABLE tasks_next RENAME TO tasks;
  CREATE INDEX tasks_goal_id ON tasks(goal_id);
  CREATE TABLE attempts (id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), sequence INTEGER NOT NULL CHECK(sequence > 0), executor_id TEXT NOT NULL CHECK(executor_id IN ('mock','human')), status TEXT NOT NULL CHECK(status IN ('running','waiting_human','verifying','completed','failed','interrupted')), started_at TEXT NOT NULL, ended_at TEXT, error TEXT, UNIQUE(task_id,sequence), CHECK((status IN ('running','waiting_human','verifying') AND ended_at IS NULL) OR (status IN ('completed','failed','interrupted') AND ended_at IS NOT NULL)));
  CREATE UNIQUE INDEX one_active_attempt ON attempts(task_id) WHERE status IN ('running','waiting_human','verifying');
  CREATE TABLE events_next (id INTEGER PRIMARY KEY AUTOINCREMENT, goal_id TEXT NOT NULL REFERENCES goals(id), task_id TEXT NOT NULL REFERENCES tasks(id), attempt_id TEXT REFERENCES attempts(id), type TEXT NOT NULL, from_status TEXT, to_status TEXT, error_code TEXT, created_at TEXT NOT NULL);
  INSERT INTO events_next (id,goal_id,task_id,type,created_at) SELECT id,goal_id,task_id,type,created_at FROM events;
  DROP TABLE events;
  ALTER TABLE events_next RENAME TO events;
  CREATE INDEX events_goal_id ON events(goal_id);

CREATE TABLE artifacts (id TEXT PRIMARY KEY, attempt_id TEXT NOT NULL UNIQUE REFERENCES attempts(id), kind TEXT NOT NULL CHECK(kind IN ('mock','human')), payload TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE verifications (id TEXT PRIMARY KEY, attempt_id TEXT NOT NULL REFERENCES attempts(id), artifact_id TEXT NOT NULL REFERENCES artifacts(id), acceptance_version TEXT NOT NULL, verdict TEXT NOT NULL CHECK(verdict IN ('PASS','FAIL')), reasons TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(attempt_id, acceptance_version));
INSERT INTO goals VALUES ('00000000-0000-4000-8000-000000000001','M1 verified human fixture','2026-09-14T00:00:00.000Z');
INSERT INTO tasks VALUES ('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','human','completed','human','summary.v1','2026-09-14T00:00:00.000Z');
INSERT INTO attempts VALUES ('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000002',1,'human','completed','2026-09-14T00:00:00.000Z','2026-09-14T00:00:00.000Z',NULL);
INSERT INTO artifacts VALUES ('00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000003','human','{"summary":"legacy human"}','2026-09-14T00:00:00.000Z');
INSERT INTO verifications VALUES ('00000000-0000-4000-8000-000000000005','00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000004','summary.v1','PASS','["SUMMARY_VALID"]','2026-09-14T00:00:00.000Z');
INSERT INTO events(goal_id,task_id,attempt_id,type,from_status,to_status,created_at) VALUES ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003','verification_passed','verifying','completed','2026-09-14T00:00:00.000Z');
PRAGMA user_version=4;
