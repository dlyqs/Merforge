import { goalDetailSchema, goalListSchema } from '@merforge/contracts';

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
  createGoal: async (objective: string) =>
    goalDetailSchema.parse(await request('/api/goals', { objective })),
  runMock: async (id: string) =>
    goalDetailSchema.parse(
      await request(`/api/tasks/${encodeURIComponent(id)}/mock-run`, {}),
    ),
};
