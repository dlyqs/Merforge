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
  phaseId: text('phase_id'),
  position: integer('position'),
  title: text('title').notNull(),
  executorId: text('executor_id', {
    enum: ['mock', 'human', 'codex'],
  }).notNull(),
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
  executorId: text('executor_id', {
    enum: ['mock', 'human', 'codex'],
  }).notNull(),
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
  taskId: text('task_id').references(() => tasks.id),
  planId: text('plan_id'),
  revision: integer('revision'),
  phaseId: text('phase_id'),
  approvalId: text('approval_id'),
  controlVersion: integer('control_version'),
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
  kind: text('kind', { enum: ['mock', 'human', 'codex'] }).notNull(),
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

// Code execution uses explicit composite-FK SQL in migration 6. Keep the
// Drizzle read model aligned; local filesystem paths never enter plan.v2.
export const codeWorkspaces = sqliteTable('code_workspaces', {
  id: text('id').primaryKey(),
  planId: text('plan_id').notNull(),
  revision: integer('revision').notNull(),
  repositoryKey: text('repository_key').notNull(),
  baseCommit: text('base_commit').notNull(),
  sourcePath: text('source_path'),
  path: text('path'),
  state: text('state').notNull(),
  ownerToken: text('owner_token'),
  lastOutputId: text('last_output_id'),
});
export const taskPackages = sqliteTable('task_packages', {
  taskId: text('task_id').primaryKey(),
  planId: text('plan_id').notNull(),
  revision: integer('revision').notNull(),
  workspaceId: text('workspace_id').notNull(),
  packageJson: text('package_json').notNull(),
  packageHash: text('package_hash').notNull(),
  acceptanceHash: text('acceptance_hash').notNull(),
});
export const codeRuns = sqliteTable('code_runs', {
  attemptId: text('attempt_id').primaryKey(),
  taskId: text('task_id').notNull(),
  workspaceId: text('workspace_id').notNull(),
  packageHash: text('package_hash').notNull(),
  predecessorAttemptId: text('predecessor_attempt_id'),
  dispatchToken: text('dispatch_token').notNull(),
  adapterVersion: text('adapter_version').notNull(),
  model: text('model'),
  sessionId: text('session_id'),
  pid: integer('pid'),
  processIdentity: text('process_identity'),
  cancelRequestedAt: text('cancel_requested_at'),
  stoppedAt: text('stopped_at'),
  inputArtifactId: text('input_artifact_id'),
  outputArtifactId: text('output_artifact_id'),
  errorCode: text('error_code'),
});
export const fileArtifacts = sqliteTable('file_artifacts', {
  id: text('id').primaryKey(),
  attemptId: text('attempt_id').notNull(),
  workspaceId: text('workspace_id').notNull(),
  kind: text('kind').notNull(),
  relativePath: text('relative_path').notNull(),
  sha256: text('sha256').notNull(),
  size: integer('size').notNull(),
  createdAt: text('created_at').notNull(),
});
