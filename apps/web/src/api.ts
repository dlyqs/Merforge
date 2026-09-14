import {
  acceptedSchema,
  type CreateGoal,
  type MockOptions,
  goalDetailSchema,
  goalListSchema,
} from '@merforge/contracts';

async function request(path: string, body?: unknown) {
  const response = await fetch(path, {
    ...(body === undefined
      ? {}
      : {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok)
    throw new Error(`请求失败 (${response.status})：${await response.text()}`);
  return response.json();
}
export const api = {
  listGoals: async () => goalListSchema.parse(await request('/api/goals')),
  getGoal: async (id: string) =>
    goalDetailSchema.parse(
      await request(`/api/goals/${encodeURIComponent(id)}`),
    ),
  createGoal: async (input: CreateGoal) =>
    goalDetailSchema.parse(await request('/api/goals', input)),
  operate: async ({
    taskId,
    operation,
    options = {},
  }: {
    taskId: string;
    operation: 'run' | 'retry';
    options?: MockOptions;
  }) =>
    acceptedSchema.parse(
      await request(
        `/api/tasks/${encodeURIComponent(taskId)}/${operation}`,
        options,
      ),
    ),
  submitHuman: async ({
    taskId,
    attemptId,
    artifact,
  }: {
    taskId: string;
    attemptId: string;
    artifact: unknown;
  }) =>
    acceptedSchema.parse(
      await request(
        `/api/tasks/${encodeURIComponent(taskId)}/attempts/${encodeURIComponent(attemptId)}/submit`,
        { artifact },
      ),
    ),
};
