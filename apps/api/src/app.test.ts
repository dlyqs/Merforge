import { afterEach, describe, expect, it, vi } from 'vitest';
import { acceptedSchema, goalDetailSchema } from '@merforge/contracts';
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
    let release!: (value: unknown) => void;
    const gate = new Promise<unknown>((resolve) => {
      release = resolve;
    });
    const app = buildApp({
      databasePath: ':memory:',
      runtimeOptions: { executor: { id: 'mock', execute: async () => gate } },
    });
    apps.push(app);
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
    expect(result.statusCode).toBe(202);
    expect(acceptedSchema.parse(result.json()).taskId).toBe(goal.tasks[0]!.id);
    const duplicate = await app.inject({
      method: 'POST',
      url: `/api/tasks/${goal.tasks[0]!.id}/mock-run`,
    });
    expect(duplicate.statusCode).toBe(409);
    const detail = await app.inject(`/api/goals/${goal.id}`);
    expect(goalDetailSchema.parse(detail.json()).tasks[0]?.status).toBe(
      'running',
    );
    expect(goalDetailSchema.parse(detail.json()).attempts).toHaveLength(1);
    release({ summary: 'mock' });
    expect((await app.inject('/api/goals')).json()).toHaveLength(1);
  });

  it('supports human FAIL, retry, PASS and rejects stale submissions over HTTP', async () => {
    const app = setup();
    const created = await app.inject({
      method: 'POST',
      url: '/api/goals',
      payload: { objective: 'human', executorId: 'human' },
    });
    const goal = goalDetailSchema.parse(created.json());
    const taskId = goal.tasks[0]!.id;
    const firstResponse = await app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/run`,
    });
    expect(firstResponse.statusCode).toBe(202);
    const first = acceptedSchema.parse(firstResponse.json());
    expect(
      goalDetailSchema.parse((await app.inject(`/api/goals/${goal.id}`)).json())
        .tasks[0]?.status,
    ).toBe('waiting_human');
    const submit = (attemptId: string, payload: unknown) =>
      app.inject({
        method: 'POST',
        url: `/api/tasks/${taskId}/attempts/${attemptId}/submit`,
        payload: payload as object,
      });
    expect((await submit(first.attemptId, {})).statusCode).toBe(400);
    expect(
      (await submit(first.attemptId, { artifact: { summary: 3 } })).statusCode,
    ).toBe(202);
    await vi.waitFor(async () => {
      const detail = goalDetailSchema.parse(
        (await app.inject(`/api/goals/${goal.id}`)).json(),
      );
      expect(detail.tasks[0]?.status).toBe('failed');
      expect(detail.verifications[0]?.reasons).toEqual([
        'SUMMARY_REQUIRED_NON_EMPTY_STRING',
      ]);
    });
    expect(
      (await submit(first.attemptId, { artifact: { summary: 'duplicate' } }))
        .statusCode,
    ).toBe(409);
    const secondResponse = await app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/retry`,
    });
    expect(secondResponse.statusCode).toBe(202);
    const second = acceptedSchema.parse(secondResponse.json());
    expect(
      (await submit(first.attemptId, { artifact: { summary: 'stale' } }))
        .statusCode,
    ).toBe(409);
    expect(
      (await submit(second.attemptId, { artifact: { summary: 'done' } }))
        .statusCode,
    ).toBe(202);
    await vi.waitFor(async () => {
      const detail = goalDetailSchema.parse(
        (await app.inject(`/api/goals/${goal.id}`)).json(),
      );
      expect(detail.tasks[0]?.status).toBe('completed');
      expect(detail.attempts).toHaveLength(2);
      expect(detail.verifications.map((v) => v.verdict)).toEqual([
        'FAIL',
        'PASS',
      ]);
    });
  });

  it('accepts controlled mock failure and retries with the same task', async () => {
    const app = setup();
    const goal = goalDetailSchema.parse(
      (
        await app.inject({
          method: 'POST',
          url: '/api/goals',
          payload: { objective: 'mock failure' },
        })
      ).json(),
    );
    const taskId = goal.tasks[0]!.id;
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/tasks/${taskId}/mock-run`,
          payload: { delayMs: -1 },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/tasks/${taskId}/mock-run`,
          payload: { outcome: 'failure' },
        })
      ).statusCode,
    ).toBe(202);
    await vi.waitFor(async () =>
      expect(
        goalDetailSchema.parse(
          (await app.inject(`/api/goals/${goal.id}`)).json(),
        ).tasks[0]?.status,
      ).toBe('failed'),
    );
    expect(
      (await app.inject({ method: 'POST', url: `/api/tasks/${taskId}/retry` }))
        .statusCode,
    ).toBe(202);
    await vi.waitFor(async () => {
      const detail = goalDetailSchema.parse(
        (await app.inject(`/api/goals/${goal.id}`)).json(),
      );
      expect(detail.tasks[0]?.status).toBe('completed');
      expect(detail.attempts).toHaveLength(2);
      expect(detail.artifacts[0]?.kind).toBe('mock');
      expect(detail.evidence[0]?.kind).toBe('mock');
      expect(detail.verifications[0]?.verdict).toBe('PASS');
    });
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
