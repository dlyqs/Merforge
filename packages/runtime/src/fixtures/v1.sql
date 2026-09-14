
  CREATE TABLE goals (id TEXT PRIMARY KEY, objective TEXT NOT NULL, created_at TEXT NOT NULL);
  CREATE TABLE tasks (id TEXT PRIMARY KEY, goal_id TEXT NOT NULL REFERENCES goals(id), title TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('ready', 'completed')), created_at TEXT NOT NULL);
  CREATE INDEX tasks_goal_id ON tasks(goal_id);
  CREATE TABLE runs (id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), executor_id TEXT NOT NULL CHECK(executor_id = 'mock'), status TEXT NOT NULL CHECK(status = 'completed'), created_at TEXT NOT NULL);
  CREATE INDEX runs_task_id ON runs(task_id);
  CREATE TABLE evidence (id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id), kind TEXT NOT NULL CHECK(kind = 'mock'), summary TEXT NOT NULL, created_at TEXT NOT NULL);
  CREATE INDEX evidence_run_id ON evidence(run_id);
  CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, goal_id TEXT NOT NULL REFERENCES goals(id), task_id TEXT NOT NULL REFERENCES tasks(id), type TEXT NOT NULL CHECK(type IN ('goal_created', 'mock_completed')), created_at TEXT NOT NULL);
  CREATE INDEX events_goal_id ON events(goal_id);

INSERT INTO goals VALUES ('00000000-0000-4000-8000-000000000001','Legacy mock','2026-09-14T00:00:00.000Z');
INSERT INTO tasks VALUES ('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','Legacy mock','completed','2026-09-14T00:00:00.000Z');
INSERT INTO runs VALUES ('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000002','mock','completed','2026-09-14T00:00:00.000Z');
INSERT INTO evidence VALUES ('00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000003','mock','Simulated legacy result','2026-09-14T00:00:00.000Z');
INSERT INTO events (goal_id,task_id,type,created_at) VALUES ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','mock_completed','2026-09-14T00:00:00.000Z');
PRAGMA user_version = 1;
