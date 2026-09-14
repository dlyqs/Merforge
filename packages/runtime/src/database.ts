import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  drizzle,
  type BetterSQLite3Database,
} from 'drizzle-orm/better-sqlite3';

// Ordered, append-only migrations. Never edit an already released migration.
const migrations = [
  `
  CREATE TABLE goals (id TEXT PRIMARY KEY, objective TEXT NOT NULL, created_at TEXT NOT NULL);
  CREATE TABLE tasks (id TEXT PRIMARY KEY, goal_id TEXT NOT NULL REFERENCES goals(id), title TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('ready', 'completed')), created_at TEXT NOT NULL);
  CREATE INDEX tasks_goal_id ON tasks(goal_id);
  CREATE TABLE runs (id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), executor_id TEXT NOT NULL CHECK(executor_id = 'mock'), status TEXT NOT NULL CHECK(status = 'completed'), created_at TEXT NOT NULL);
  CREATE INDEX runs_task_id ON runs(task_id);
  CREATE TABLE evidence (id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id), kind TEXT NOT NULL CHECK(kind = 'mock'), summary TEXT NOT NULL, created_at TEXT NOT NULL);
  CREATE INDEX evidence_run_id ON evidence(run_id);
  CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, goal_id TEXT NOT NULL REFERENCES goals(id), task_id TEXT NOT NULL REFERENCES tasks(id), type TEXT NOT NULL CHECK(type IN ('goal_created', 'mock_completed')), created_at TEXT NOT NULL);
  CREATE INDEX events_goal_id ON events(goal_id);
`,
];

export function openDatabase(path: string): {
  db: BetterSQLite3Database;
  close: () => void;
} {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const sqlite = new Database(path);
  try {
    sqlite.pragma('foreign_keys = ON');
    sqlite.pragma('journal_mode = WAL');
    sqlite.pragma('busy_timeout = 5000');
    sqlite
      .transaction(() => {
        const version = sqlite.pragma('user_version', {
          simple: true,
        }) as number;
        if (version > migrations.length)
          throw new Error(
            'Database is newer than this runtime. Upgrade Merforge.',
          );
        for (let i = version; i < migrations.length; i++) {
          sqlite.exec(migrations[i]!);
          sqlite.pragma(`user_version = ${i + 1}`);
        }
      })
      .immediate();
    return {
      db: drizzle(sqlite),
      close: () => {
        sqlite.close();
      },
    };
  } catch (error) {
    sqlite.close();
    throw error;
  }
}
