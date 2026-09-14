import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const goals = sqliteTable('goals', {
  id: text('id').primaryKey(),
  objective: text('objective').notNull(),
  createdAt: text('created_at').notNull(),
});
export const tasks = sqliteTable('tasks', {
  id: text('id').primaryKey(),
  goalId: text('goal_id')
    .notNull()
    .references(() => goals.id),
  title: text('title').notNull(),
  executorId: text('executor_id', { enum: ['mock', 'human'] }).notNull(),
  acceptanceVersion: text('acceptance_version').notNull(),
  status: text('status', {
    enum: [
      'ready',
      'running',
      'waiting_human',
      'verifying',
      'completed',
      'failed',
      'interrupted',
    ],
  }).notNull(),
  createdAt: text('created_at').notNull(),
});
export const attempts = sqliteTable('attempts', {
  id: text('id').primaryKey(),
  taskId: text('task_id')
    .notNull()
    .references(() => tasks.id),
  sequence: integer('sequence').notNull(),
  executorId: text('executor_id', { enum: ['mock', 'human'] }).notNull(),
  status: text('status', {
    enum: [
      'running',
      'waiting_human',
      'verifying',
      'completed',
      'failed',
      'interrupted',
    ],
  }).notNull(),
  startedAt: text('started_at').notNull(),
  endedAt: text('ended_at'),
  error: text('error'),
});
export const runs = sqliteTable('runs', {
  id: text('id').primaryKey(),
  taskId: text('task_id')
    .notNull()
    .references(() => tasks.id),
  executorId: text('executor_id', { enum: ['mock'] }).notNull(),
  status: text('status', { enum: ['completed'] }).notNull(),
  createdAt: text('created_at').notNull(),
});
export const evidence = sqliteTable('evidence', {
  id: text('id').primaryKey(),
  runId: text('run_id')
    .notNull()
    .references(() => runs.id),
  kind: text('kind', { enum: ['mock'] }).notNull(),
  summary: text('summary').notNull(),
  createdAt: text('created_at').notNull(),
});
export const events = sqliteTable('events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  goalId: text('goal_id')
    .notNull()
    .references(() => goals.id),
  taskId: text('task_id')
    .notNull()
    .references(() => tasks.id),
  attemptId: text('attempt_id').references(() => attempts.id),
  fromStatus: text('from_status', {
    enum: [
      'ready',
      'running',
      'waiting_human',
      'verifying',
      'completed',
      'failed',
      'interrupted',
    ],
  }),
  toStatus: text('to_status', {
    enum: [
      'ready',
      'running',
      'waiting_human',
      'verifying',
      'completed',
      'failed',
      'interrupted',
    ],
  }),
  errorCode: text('error_code'),
  type: text('type').notNull(),
  createdAt: text('created_at').notNull(),
});

export const artifacts = sqliteTable('artifacts', {
  id: text('id').primaryKey(),
  attemptId: text('attempt_id')
    .notNull()
    .references(() => attempts.id),
  kind: text('kind', { enum: ['mock', 'human'] }).notNull(),
  // Store serialized JSON explicitly: JSON null must not become SQL NULL.
  payload: text('payload').notNull(),
  createdAt: text('created_at').notNull(),
});

export const verifications = sqliteTable('verifications', {
  id: text('id').primaryKey(),
  attemptId: text('attempt_id')
    .notNull()
    .references(() => attempts.id),
  artifactId: text('artifact_id')
    .notNull()
    .references(() => artifacts.id),
  acceptanceVersion: text('acceptance_version').notNull(),
  verdict: text('verdict', { enum: ['PASS', 'FAIL'] }).notNull(),
  reasons: text('reasons', { mode: 'json' }).$type<string[]>().notNull(),
  createdAt: text('created_at').notNull(),
});
