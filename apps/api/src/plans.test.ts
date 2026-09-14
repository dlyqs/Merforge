import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { planDetailSchema, apiErrorSchema } from '@merforge/contracts';
import { buildApp } from './app.js';
it('exposes version-bound plan APIs and guards every legacy start endpoint', async () => {
  const app = buildApp({ databasePath: ':memory:' });
  const payload = JSON.parse(
    readFileSync(
      new URL('../../../examples/serial-plan.json', import.meta.url),
      'utf8',
    ),
  );
  try {
    expect(
      (await app.inject({ method: 'POST', url: '/api/plans', payload: {} }))
        .statusCode,
    ).toBe(400);
    const res = await app.inject({
      method: 'POST',
      url: '/api/plans',
      payload,
    });
    expect(res.statusCode).toBe(201);
    const p = planDetailSchema.parse(res.json());
    const goal = (await app.inject(`/api/goals/${p.goalId}`)).json();
    for (const operation of ['run', 'retry', 'mock-run']) {
      const denied = await app.inject({
        method: 'POST',
        url: `/api/tasks/${goal.tasks[0].id}/${operation}`,
      });
      expect(denied.statusCode).toBe(409);
      expect(apiErrorSchema.parse(denied.json()).code).toBe('CONFLICT');
    }
    const approve = (revision: number) =>
      app.inject({
        method: 'POST',
        url: `/api/plans/${p.id}/approvals/${p.approvals[0]!.id}/decision`,
        payload: { revision, actor: 'local', decision: 'approved' },
      });
    expect((await approve(2)).statusCode).toBe(409);
    expect((await approve(1)).statusCode).toBe(200);
    const revised = await app.inject({
      method: 'POST',
      url: `/api/plans/${p.id}/revisions`,
      payload: { revision: 1, definition: payload.definition },
    });
    expect(planDetailSchema.parse(revised.json()).review).toBe('pending');
    expect((await approve(1)).statusCode).toBe(409);
    expect((await app.inject('/api/plans/missing')).statusCode).toBe(404);
  } finally {
    await app.close();
  }
});

it('controls an approved Human plan through mode, phase approval, continue and submission APIs', async () => {
  const app = buildApp({ databasePath: ':memory:' });
  const definition = {
    schemaVersion: 'plan.v1',
    phases: [
      {
        title: 'human',
        requiresApproval: true,
        tasks: [
          {
            title: 'submit',
            executorId: 'human',
            acceptanceVersion: 'summary.v1',
          },
        ],
      },
      {
        title: 'later',
        requiresApproval: false,
        tasks: [
          {
            title: 'later',
            executorId: 'human',
            acceptanceVersion: 'summary.v1',
          },
        ],
      },
    ],
  };
  const post = (url: string, payload: unknown) =>
    app.inject({ method: 'POST', url, payload: payload as object });
  try {
    let p = planDetailSchema.parse(
      (
        await post('/api/plans', {
          objective: 'controlled',
          revision: 1,
          definition,
        })
      ).json(),
    );
    expect(
      (await post(`/api/plans/${p.id}/continue`, { revision: 1 })).statusCode,
    ).toBe(409);
    await post(`/api/plans/${p.id}/approvals/${p.approvals[0]!.id}/decision`, {
      revision: 1,
      decision: 'approved',
      actor: 'local',
    });
    const bad = await post(`/api/plans/${p.id}/mode`, {
      revision: 1,
      controlVersion: 0,
      mode: 'auto_until',
    });
    expect(bad.statusCode).toBe(400);
    p = planDetailSchema.parse(
      (
        await post(`/api/plans/${p.id}/mode`, {
          revision: 1,
          controlVersion: 0,
          mode: 'auto_until',
          stopPhaseId: p.phases[0]!.id,
        })
      ).json(),
    );
    expect(
      (
        await post(`/api/plans/${p.id}/mode`, {
          revision: 1,
          controlVersion: 0,
          mode: 'auto',
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await post(`/api/plans/${p.id}/phases/${p.phases[1]!.id}/approval`, {
          revision: 1,
        })
      ).statusCode,
    ).toBe(409);
    await post(`/api/plans/${p.id}/phases/${p.phases[0]!.id}/approval`, {
      revision: 1,
    });
    p = planDetailSchema.parse(
      (await post(`/api/plans/${p.id}/continue`, { revision: 1 })).json(),
    );
    expect(p.stopReason).toBe('approval_waiting');
    await post(
      `/api/plans/${p.id}/approvals/${p.approvals.at(-1)!.id}/decision`,
      { revision: 1, decision: 'approved', actor: 'local' },
    );
    const goal = (await app.inject(`/api/goals/${p.goalId}`)).json();
    expect(goal.attempts).toHaveLength(1);
    const a = goal.attempts[0];
    expect(
      (
        await post(`/api/tasks/${a.taskId}/attempts/${a.id}/submit`, {
          artifact: { summary: 'ok' },
        })
      ).statusCode,
    ).toBe(202);
    // Injection yields to the verification microtask; no server or browser needed.
    p = planDetailSchema.parse((await app.inject(`/api/plans/${p.id}`)).json());
    expect(p).toMatchObject({
      mode: 'manual',
      authorized: false,
      stopReason: 'boundary_reached',
    });
    expect(
      (await app.inject(`/api/goals/${p.goalId}`)).json().attempts,
    ).toHaveLength(1);
  } finally {
    await app.close();
  }
});
