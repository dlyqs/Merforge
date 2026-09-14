import { afterEach, describe, expect, it } from 'vitest';
import { goalDetailSchema } from '@merforge/contracts';
import { buildApp } from './app.js';

const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});
function setup() {
  const app = buildApp({ databasePath: ':memory:' });
  apps.push(app);
  return app;
}

describe('HTTP API', () => {
  it('provides the create → inspect → mock-run workflow and rejects duplicate execution', async () => {
    const app = setup();
    const created = await app.inject({
      method: 'POST',
      url: '/api/goals',
      payload: { objective: 'Build prototype' },
    });
    expect(created.statusCode).toBe(201);
    const goal = goalDetailSchema.parse(created.json());
    const result = await app.inject({
      method: 'POST',
      url: `/api/tasks/${goal.tasks[0]!.id}/mock-run`,
    });
    expect(result.statusCode).toBe(200);
    expect(goalDetailSchema.parse(result.json()).evidence).toHaveLength(1);
    const duplicate = await app.inject({
      method: 'POST',
      url: `/api/tasks/${goal.tasks[0]!.id}/mock-run`,
    });
    expect(duplicate.statusCode).toBe(409);
    const detail = await app.inject(`/api/goals/${goal.id}`);
    expect(goalDetailSchema.parse(detail.json()).runs).toHaveLength(1);
    expect((await app.inject('/api/goals')).json()).toHaveLength(1);
  });

  it('validates input and returns useful HTTP status codes', async () => {
    const app = setup();
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/goals',
          payload: { objective: '' },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/goals',
          payload: { objective: 'ok', unexpected: true },
        })
      ).statusCode,
    ).toBe(400);
    expect((await app.inject('/api/goals/missing')).statusCode).toBe(404);
    expect((await app.inject('/api/health')).json()).toMatchObject({
      status: 'ok',
      mode: 'prototype',
    });
  });

  it('rejects foreign browser origins and permits same-origin proxy requests', async () => {
    const app = setup();
    const request = {
      method: 'POST' as const,
      url: '/api/goals',
      payload: { objective: 'Test origin' },
    };
    expect(
      (
        await app.inject({
          ...request,
          headers: { origin: 'https://example.com' },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          ...request,
          headers: { origin: 'http://127.0.0.1:5173', host: '127.0.0.1:5173' },
        })
      ).statusCode,
    ).toBe(201);
  });
});
