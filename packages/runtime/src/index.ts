import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import {
  createGoalSchema,
  mockOptionsSchema,
  ACCEPTANCE_VERSION,
  verificationResultSchema,
  type CreateGoal,
  type GoalDetail,
  type Task,
  type Attempt,
  type TaskStatus,
  type Accepted,
  type MockOptions,
} from '@merforge/contracts';
import { acquireOwnership } from './ownership.js';
import { openDatabase } from './database.js';
import { MockExecutor, HumanExecutor, type Executor } from './executor.js';
import { SubmissionVerifier, type Verifier } from './verifier.js';
import { canTransition } from './state-machine.js';
import {
  goals,
  tasks,
  attempts,
  artifacts,
  verifications,
  runs,
  evidence,
  events,
} from './schema.js';
export { SubmissionVerifier, type Verifier } from './verifier.js';
export { MockExecutor, HumanExecutor, type Executor } from './executor.js';

export class RuntimeError extends Error {
  constructor(
    public readonly code: 'NOT_FOUND' | 'CONFLICT' | 'INVALID_INPUT',
    message: string,
  ) {
    super(message);
  }
}
export interface RuntimeLog {
  component: 'merforge.runtime';
  event: string;
  goalId?: string;
  taskId?: string;
  attemptId?: string | undefined;
  fromStatus?: TaskStatus | null | undefined;
  toStatus?: TaskStatus | null | undefined;
  errorCode?: string | null | undefined;
}
export interface RuntimeOptions {
  executor?: Executor;
  verifier?: Verifier;
  logger?: (entry: RuntimeLog) => void;
}

export function createRuntime(
  databasePath: string,
  options: RuntimeOptions = {},
) {
  let ownership: ReturnType<typeof acquireOwnership>;
  try {
    ownership = acquireOwnership(databasePath);
  } catch (error) {
    try {
      options.logger?.({
        component: 'merforge.runtime',
        event: 'ownership_rejected',
        errorCode: 'OWNERSHIP_CONFLICT',
      });
    } catch {
      /* best effort */
    }
    throw error;
  }
  let database;
  try {
    database = openDatabase(ownership.path);
  } catch (error) {
    ownership.release();
    throw error;
  }
  const { db, close: closeDatabase } = database;
  const executor = options.executor ?? new MockExecutor();
  const human = new HumanExecutor();
  const verifier = options.verifier ?? new SubmissionVerifier();
  const controller = new AbortController();
  const pending = new Set<Promise<void>>();
  let closed = false;
  type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
  function log(entry: Omit<RuntimeLog, 'component'>) {
    // Diagnostic sinks cannot change the outcome of a committed command.
    try {
      options.logger?.({ component: 'merforge.runtime', ...entry });
    } catch {
      /* best effort */
    }
  }
  function taskById(tx: Tx | typeof db, id: string): Task {
    const task = tx.select().from(tasks).where(eq(tasks.id, id)).get();
    if (!task) throw new RuntimeError('NOT_FOUND', 'Task not found');
    return task;
  }
  function reject(task: Task, attemptId?: string): never {
    log({
      event: 'transition_rejected',
      goalId: task.goalId,
      taskId: task.id,
      attemptId,
      fromStatus: task.status,
      errorCode: 'CONFLICT',
    });
    throw new RuntimeError(
      'CONFLICT',
      `Task ${task.id}: transition rejected${attemptId ? ` for attempt ${attemptId}` : ''}`,
    );
  }
  function command<T>(
    fn: (tx: Tx, emit: (event: typeof events.$inferInsert) => void) => T,
  ): T {
    if (closed) throw new RuntimeError('CONFLICT', 'Runtime is closed');
    ownership.assert();
    const committed: (typeof events.$inferInsert)[] = [];
    const result = db.transaction(
      (tx) =>
        fn(tx, (event) => {
          tx.insert(events).values(event).run();
          committed.push(event);
        }),
      { behavior: 'immediate' },
    );
    for (const event of committed)
      log({
        event: event.type,
        goalId: event.goalId,
        taskId: event.taskId,
        ...(event.attemptId ? { attemptId: event.attemptId } : {}),
        fromStatus: event.fromStatus,
        toStatus: event.toStatus,
        errorCode: event.errorCode,
      });
    return result;
  }
  type Emit = (event: typeof events.$inferInsert) => void;
  function move(
    tx: Tx,
    emit: Emit,
    task: Task,
    attempt: Attempt,
    to: Attempt['status'],
    type: string,
    error: string | null = null,
  ) {
    if (
      attempt.taskId !== task.id ||
      attempt.status !== task.status ||
      !canTransition(task.status, to)
    )
      reject(task, attempt.id);
    const current = tx
      .select()
      .from(attempts)
      .where(eq(attempts.taskId, task.id))
      .orderBy(desc(attempts.sequence))
      .get();
    if (current?.id !== attempt.id) reject(task, attempt.id);
    const now = new Date().toISOString();
    const changed = tx
      .update(tasks)
      .set({ status: to })
      .where(and(eq(tasks.id, task.id), eq(tasks.status, task.status)))
      .run();
    if (changed.changes !== 1) reject(task, attempt.id);
    tx.update(attempts)
      .set({
        status: to,
        error,
        endedAt: ['completed', 'failed', 'interrupted'].includes(to)
          ? now
          : null,
      })
      .where(
        and(eq(attempts.id, attempt.id), eq(attempts.status, attempt.status)),
      )
      .run();
    emit({
      goalId: task.goalId,
      taskId: task.id,
      attemptId: attempt.id,
      fromStatus: task.status,
      toStatus: to,
      type,
      errorCode: error,
      createdAt: now,
    });
  }
  function getGoal(id: string): GoalDetail {
    const goal = db.select().from(goals).where(eq(goals.id, id)).get();
    if (!goal) throw new RuntimeError('NOT_FOUND', 'Goal not found');
    const goalTasks = db.select().from(tasks).where(eq(tasks.goalId, id)).all();
    const taskIds = goalTasks.map((t) => t.id);
    const goalRuns = taskIds.length
      ? db.select().from(runs).where(inArray(runs.taskId, taskIds)).all()
      : [];
    const goalAttempts = taskIds.length
      ? db
          .select()
          .from(attempts)
          .where(inArray(attempts.taskId, taskIds))
          .orderBy(asc(attempts.sequence))
          .all()
      : [];
    const sequence = new Map(goalAttempts.map((a, index) => [a.id, index]));
    const byAttempt = (a: { attemptId: string }, b: { attemptId: string }) =>
      sequence.get(a.attemptId)! - sequence.get(b.attemptId)!;
    return {
      ...goal,
      tasks: goalTasks,
      attempts: goalAttempts,
      runs: goalRuns,
      artifacts: goalAttempts.length
        ? db
            .select()
            .from(artifacts)
            .where(
              inArray(
                artifacts.attemptId,
                goalAttempts.map((a) => a.id),
              ),
            )
            .all()
            .sort(byAttempt)
            .map((a) => ({ ...a, payload: JSON.parse(a.payload) as unknown }))
        : [],
      verifications: goalAttempts.length
        ? db
            .select()
            .from(verifications)
            .where(
              inArray(
                verifications.attemptId,
                goalAttempts.map((a) => a.id),
              ),
            )
            .all()
            .sort(byAttempt)
        : [],
      evidence: goalRuns.length
        ? db
            .select()
            .from(evidence)
            .where(
              inArray(
                evidence.runId,
                goalRuns.map((r) => r.id),
              ),
            )
            .all()
        : [],
      events: db
        .select()
        .from(events)
        .where(eq(events.goalId, id))
        .orderBy(asc(events.id))
        .all(),
    };
  }
  function acceptArtifact(
    taskId: string,
    attemptId: string,
    payload: unknown,
    kind: 'mock' | 'human',
  ): Accepted {
    // Normalize once to immutable JSON so caller mutation cannot alter verification.
    let serialized: string | undefined;
    try {
      serialized = JSON.stringify(payload);
    } catch {
      /* invalid JSON */
    }
    if (serialized === undefined)
      throw new RuntimeError('INVALID_INPUT', 'Artifact must be JSON');
    const snapshot = serialized;
    return command((tx, emit) => {
      const task = taskById(tx, taskId);
      const attempt = tx
        .select()
        .from(attempts)
        .where(eq(attempts.id, attemptId))
        .get();
      if (
        !attempt ||
        attempt.taskId !== taskId ||
        attempt.executorId !== kind ||
        task.executorId !== kind ||
        task.status !== (kind === 'mock' ? 'running' : 'waiting_human')
      )
        reject(task, attemptId);
      // Move checks the latest attempt and its status before any artifact insert.
      move(
        tx,
        emit,
        task,
        attempt,
        'verifying',
        kind === 'mock' ? 'executor_finished' : 'human_submission_received',
      );
      tx.insert(artifacts)
        .values({
          id: randomUUID(),
          attemptId,
          kind,
          payload: snapshot,
          createdAt: new Date().toISOString(),
        })
        .run();
      return { goalId: task.goalId, taskId, attemptId };
    });
  }
  async function verifyAttempt(attemptId: string) {
    const attempt = db
      .select()
      .from(attempts)
      .where(eq(attempts.id, attemptId))
      .get();
    if (!attempt) throw new RuntimeError('NOT_FOUND', 'Attempt not found');
    const task = taskById(db, attempt.taskId);
    const existing = db
      .select()
      .from(verifications)
      .where(
        and(
          eq(verifications.attemptId, attemptId),
          eq(verifications.acceptanceVersion, task.acceptanceVersion),
        ),
      )
      .get();
    if (existing) return existing;
    if (attempt.status !== 'verifying' || task.status !== 'verifying')
      reject(task, attemptId);
    const artifact = db
      .select()
      .from(artifacts)
      .where(eq(artifacts.attemptId, attemptId))
      .get();
    if (!artifact) {
      command((tx, emit) =>
        move(
          tx,
          emit,
          task,
          attempt,
          'failed',
          'verification_failed',
          'MISSING_ARTIFACT',
        ),
      );
      return;
    }
    command((_tx, emit) =>
      emit({
        goalId: task.goalId,
        taskId: task.id,
        attemptId,
        type: 'verification_started',
        createdAt: new Date().toISOString(),
      }),
    );
    // No transaction is held while the independent verifier runs.
    let result;
    try {
      result = verificationResultSchema.parse(
        await verifier.verify(
          JSON.parse(artifact.payload) as unknown,
          task.acceptanceVersion,
        ),
      );
      if (result.acceptanceVersion !== task.acceptanceVersion)
        throw new Error('Version mismatch');
    } catch {
      result = {
        acceptanceVersion: task.acceptanceVersion,
        verdict: 'FAIL' as const,
        reasons: ['VERIFIER_ERROR'],
      };
    }
    if (closed) {
      log({
        event: 'stale_result_rejected',
        goalId: task.goalId,
        taskId: task.id,
        attemptId,
      });
      return;
    }
    return command((tx, emit) => {
      const replay = tx
        .select()
        .from(verifications)
        .where(
          and(
            eq(verifications.attemptId, attemptId),
            eq(verifications.acceptanceVersion, task.acceptanceVersion),
          ),
        )
        .get();
      if (replay) return replay;
      const currentTask = taskById(tx, task.id);
      const currentAttempt = tx
        .select()
        .from(attempts)
        .where(eq(attempts.id, attemptId))
        .get();
      if (
        !currentAttempt ||
        currentAttempt.status !== 'verifying' ||
        currentTask.acceptanceVersion !== result.acceptanceVersion
      )
        reject(currentTask, attemptId);
      const verification = {
        id: randomUUID(),
        attemptId,
        artifactId: artifact.id,
        ...result,
        createdAt: new Date().toISOString(),
      };
      tx.insert(verifications).values(verification).run();
      move(
        tx,
        emit,
        currentTask,
        currentAttempt,
        result.verdict === 'PASS' ? 'completed' : 'failed',
        result.verdict === 'PASS'
          ? 'verification_passed'
          : 'verification_failed',
        result.verdict === 'PASS' ? null : 'VERIFICATION_FAILED',
      );
      if (result.verdict === 'PASS' && artifact.kind === 'mock') {
        // Preserve the legacy mock evidence reader. Human evidence is its saved
        // artifact plus verification; never mislabel it as a simulated run.
        tx.insert(runs)
          .values({
            id: attemptId,
            taskId: task.id,
            executorId: 'mock',
            status: 'completed',
            createdAt: verification.createdAt,
          })
          .run();
        tx.insert(evidence)
          .values({
            id: randomUUID(),
            runId: attemptId,
            kind: 'mock',
            summary:
              'Simulated artifact passed summary.v1 structure checks only. No agent or business outcome was verified.',
            createdAt: verification.createdAt,
          })
          .run();
      }
      return verification;
    });
  }
  function track(work: () => Promise<void>, accepted: Accepted) {
    const job = Promise.resolve()
      .then(work)
      .catch(() => {
        log({
          event: 'dispatch_failed',
          goalId: accepted.goalId,
          taskId: accepted.taskId,
          attemptId: accepted.attemptId,
          errorCode: 'PERSISTENCE_FAILED',
        });
      });
    pending.add(job);
    void job.finally(() => pending.delete(job));
  }
  function fail(taskId: string, attemptId: string) {
    command((tx, emit) => {
      const task = taskById(tx, taskId);
      const attempt = tx
        .select()
        .from(attempts)
        .where(eq(attempts.id, attemptId))
        .get();
      if (!attempt || task.status !== 'running') reject(task, attemptId);
      move(
        tx,
        emit,
        task,
        attempt,
        'failed',
        'executor_failed',
        'EXECUTOR_FAILED',
      );
    });
  }
  function dispatch(task: Task, accepted: Accepted, config: MockOptions) {
    track(async () => {
      if (closed) return;
      command((_tx, emit) =>
        emit({
          goalId: task.goalId,
          taskId: task.id,
          attemptId: accepted.attemptId,
          type: 'executor_started',
          createdAt: new Date().toISOString(),
        }),
      );
      let payload: unknown;
      try {
        payload = await executor.execute(task, config, controller.signal);
      } catch {
        if (!closed) fail(task.id, accepted.attemptId);
        else log({ event: 'stale_result_rejected', ...accepted });
        return;
      }
      if (!closed) {
        acceptArtifact(task.id, accepted.attemptId, payload, 'mock');
        await verifyAttempt(accepted.attemptId);
      } else log({ event: 'stale_result_rejected', ...accepted });
    }, accepted);
  }
  function start(
    taskId: string,
    retry: boolean,
    input: MockOptions = {},
    mockOnly = false,
  ): Accepted {
    const config = mockOptionsSchema.parse(input);
    const result = command((tx, emit) => {
      const task = taskById(tx, taskId);
      const initialStatus =
        task.executorId === 'human' ? human.initialStatus : 'running';
      if (
        (mockOnly && task.executorId !== 'mock') ||
        !(retry
          ? ['failed', 'interrupted'].includes(task.status)
          : task.status === 'ready') ||
        !canTransition(task.status, initialStatus)
      )
        reject(task);
      if (task.executorId === 'human' && Object.keys(config).length)
        throw new RuntimeError(
          'INVALID_INPUT',
          'Mock options are not valid for human tasks',
        );
      const previous = tx
        .select()
        .from(attempts)
        .where(eq(attempts.taskId, taskId))
        .orderBy(desc(attempts.sequence))
        .get();
      const attemptId = randomUUID();
      const now = new Date().toISOString();
      const updated = tx
        .update(tasks)
        .set({ status: initialStatus })
        .where(and(eq(tasks.id, taskId), eq(tasks.status, task.status)))
        .run();
      if (updated.changes !== 1) reject(task);
      tx.insert(attempts)
        .values({
          id: attemptId,
          taskId,
          sequence: (previous?.sequence ?? 0) + 1,
          executorId: task.executorId,
          status: initialStatus,
          startedAt: now,
        })
        .run();
      emit({
        goalId: task.goalId,
        taskId,
        attemptId,
        type: 'attempt_created',
        fromStatus: task.status,
        toStatus: initialStatus,
        createdAt: now,
      });
      return { task, accepted: { goalId: task.goalId, taskId, attemptId } };
    });
    if (result.task.executorId === 'mock')
      dispatch(result.task, result.accepted, config);
    return result.accepted;
  }
  // Ownership is acquired before migration/recovery and retained until close.
  try {
    log({ event: 'ownership_acquired' });
    log({ event: 'recovery_started' });
    const replay = command((tx, emit) => {
      const active = tx
        .select()
        .from(attempts)
        .where(inArray(attempts.status, ['running', 'verifying']))
        .all();
      for (const attempt of active) {
        if (attempt.status === 'running')
          move(
            tx,
            emit,
            taskById(tx, attempt.taskId),
            attempt,
            'interrupted',
            'attempt_interrupted',
            'EXECUTION_INTERRUPTED',
          );
      }
      return active.filter((a) => a.status === 'verifying');
    });
    for (const attempt of replay) {
      const task = taskById(db, attempt.taskId);
      track(
        async () => {
          if (!closed) await verifyAttempt(attempt.id);
        },
        { goalId: task.goalId, taskId: task.id, attemptId: attempt.id },
      );
    }
    const recoveryJobs = [...pending];
    track(
      async () => {
        await Promise.all(recoveryJobs);
        log({ event: 'recovery_finished' });
      },
      { goalId: '', taskId: '', attemptId: '' },
    );
  } catch (error) {
    closeDatabase();
    ownership.release();
    throw error;
  }
  return {
    close() {
      if (!closed) {
        closed = true;
        controller.abort();
        try {
          closeDatabase();
        } finally {
          ownership.release();
        }
      }
    },
    async waitForIdle() {
      while (pending.size) await Promise.all([...pending]);
    },
    listGoals: () =>
      db
        .select()
        .from(goals)
        .orderBy(desc(goals.createdAt), desc(goals.id))
        .all(),
    getGoal,
    createGoal(input: CreateGoal) {
      const { objective, executorId = 'mock' } = createGoalSchema.parse(input);
      const goal = {
        id: randomUUID(),
        objective,
        createdAt: new Date().toISOString(),
      };
      command((tx, emit) => {
        const task: Task = {
          id: randomUUID(),
          goalId: goal.id,
          title: objective,
          status: 'ready',
          executorId,
          acceptanceVersion: ACCEPTANCE_VERSION,
          createdAt: goal.createdAt,
        };
        tx.insert(goals).values(goal).run();
        tx.insert(tasks).values(task).run();
        emit({
          goalId: goal.id,
          taskId: task.id,
          type: 'goal_created',
          createdAt: goal.createdAt,
        });
      });
      return getGoal(goal.id);
    },
    runMock: (taskId: string, input?: MockOptions) =>
      start(taskId, false, input, true),
    runTask: (taskId: string, input?: MockOptions) =>
      start(taskId, false, input),
    submitHuman(taskId: string, attemptId: string, payload: unknown) {
      const accepted = acceptArtifact(taskId, attemptId, payload, 'human');
      track(async () => {
        if (!closed) await verifyAttempt(attemptId);
      }, accepted);
      return accepted;
    },
    verifyAttempt,
    retry: (taskId: string, input?: MockOptions) => start(taskId, true, input),
  };
}
export type Runtime = ReturnType<typeof createRuntime>;
