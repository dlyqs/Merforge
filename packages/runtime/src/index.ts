import { randomUUID } from 'node:crypto';
import { asc, desc, eq, inArray } from 'drizzle-orm';
import {
  createGoalSchema,
  type CreateGoal,
  type GoalDetail,
} from '@merforge/contracts';
import { openDatabase } from './database.js';
import { MockExecutor } from './executor.js';
import { goals, tasks, runs, evidence, events } from './schema.js';
export { MockExecutor, type PrototypeExecutor } from './executor.js';

export class RuntimeError extends Error {
  constructor(
    public readonly code: 'NOT_FOUND' | 'CONFLICT',
    message: string,
  ) {
    super(message);
  }
}

export function createRuntime(databasePath: string) {
  const { db, close } = openDatabase(databasePath);
  const executor = new MockExecutor();
  function getGoal(id: string): GoalDetail {
    const goal = db.select().from(goals).where(eq(goals.id, id)).get();
    if (!goal) throw new RuntimeError('NOT_FOUND', 'Goal not found');
    const goalTasks = db.select().from(tasks).where(eq(tasks.goalId, id)).all();
    const goalRuns = goalTasks.length
      ? db
          .select()
          .from(runs)
          .where(
            inArray(
              runs.taskId,
              goalTasks.map((t) => t.id),
            ),
          )
          .all()
      : [];
    const goalEvidence = goalRuns.length
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
      : [];
    return {
      ...goal,
      tasks: goalTasks,
      runs: goalRuns,
      evidence: goalEvidence,
      events: db
        .select()
        .from(events)
        .where(eq(events.goalId, id))
        .orderBy(asc(events.id))
        .all(),
    };
  }
  return {
    close,
    listGoals: () =>
      db
        .select()
        .from(goals)
        .orderBy(desc(goals.createdAt), desc(goals.id))
        .all(),
    getGoal,
    createGoal(input: CreateGoal) {
      const { objective } = createGoalSchema.parse(input);
      const goal = {
        id: randomUUID(),
        objective,
        createdAt: new Date().toISOString(),
      };
      const task = {
        id: randomUUID(),
        goalId: goal.id,
        title: objective,
        status: 'ready' as const,
        createdAt: goal.createdAt,
      };
      db.transaction((tx) => {
        tx.insert(goals).values(goal).run();
        tx.insert(tasks).values(task).run();
        tx.insert(events)
          .values({
            goalId: goal.id,
            taskId: task.id,
            type: 'goal_created',
            createdAt: goal.createdAt,
          })
          .run();
      });
      return getGoal(goal.id);
    },
    runMock(taskId: string) {
      // No external I/O is allowed inside this transaction. Real executors must
      // persist an attempt before dispatch and reconcile external results later.
      const goalId = db.transaction(
        (tx) => {
          const task = tx
            .select()
            .from(tasks)
            .where(eq(tasks.id, taskId))
            .get();
          if (!task) throw new RuntimeError('NOT_FOUND', 'Task not found');
          if (task.status !== 'ready')
            throw new RuntimeError('CONFLICT', 'Task has already completed');
          const output = executor.execute(task);
          const createdAt = new Date().toISOString();
          const run = {
            id: randomUUID(),
            taskId,
            executorId: executor.id,
            status: 'completed' as const,
            createdAt,
          };
          tx.insert(runs).values(run).run();
          tx.insert(evidence)
            .values({ id: randomUUID(), runId: run.id, ...output, createdAt })
            .run();
          tx.update(tasks)
            .set({ status: 'completed' })
            .where(eq(tasks.id, taskId))
            .run();
          tx.insert(events)
            .values({
              goalId: task.goalId,
              taskId,
              type: 'mock_completed',
              createdAt,
            })
            .run();
          return task.goalId;
        },
        { behavior: 'immediate' },
      );
      return getGoal(goalId);
    },
  };
}
export type Runtime = ReturnType<typeof createRuntime>;
