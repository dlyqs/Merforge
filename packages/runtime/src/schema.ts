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
  status: text('status', { enum: ['ready', 'completed'] }).notNull(),
  createdAt: text('created_at').notNull(),
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
  type: text('type', { enum: ['goal_created', 'mock_completed'] }).notNull(),
  createdAt: text('created_at').notNull(),
});
