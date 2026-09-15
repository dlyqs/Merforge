import { expect, it } from 'vitest';
import { buildApp } from './app.js';
import { runMenu } from '../../cli/src/menu.js';
it('menu creates, reviews, runs and submits a Human plan by numbered choices through API', async () => {
  const app = buildApp({ databasePath: ':memory:' });
  const answers = [
    '3',
    '2',
    'Menu objective',
    '1',
    'Phase one',
    'n',
    'Human task',
    '2',
    'n',
    'n',
    'y',
    '1',
    '1',
    '2',
    '1',
    '1',
    'local',
    '4',
    'y',
    '7',
    '1',
    '3',
    'done',
    '0',
    '0',
  ];
  const output: unknown[] = [];
  try {
    await runMenu(
      async (url, payload) => {
        const res = await app.inject({
          method: payload === undefined ? 'GET' : 'POST',
          url,
          ...(payload === undefined ? {} : { payload: payload as object }),
        });
        if (res.statusCode >= 400) throw new Error(res.body);
        return res.json();
      },
      {
        ask: async () => {
          if (!answers.length) throw new Error('MENU_CLOSED');
          return answers.shift()!;
        },
        show: (v) => output.push(v),
      },
    );
    const goals = (await app.inject('/api/goals')).json();
    const g = (await app.inject(`/api/goals/${goals[0].id}`)).json();
    expect(g.plan.review).toBe('approved');
    expect(g.tasks[0].status).toBe('completed');
    expect(g.verifications[0].verdict).toBe('PASS');
    expect(output.some((v) => JSON.stringify(v).includes('guidance'))).toBe(
      true,
    );
  } finally {
    await app.close();
  }
});
it('environment is read-only and provides actionable unconfigured diagnostics without exposing paths', async () => {
  const app = buildApp({ databasePath: ':memory:' });
  try {
    const env = (await app.inject('/api/environment')).json();
    expect(env.codex.available).toBe(false);
    expect(env.repositories).toEqual([]);
    expect(env.guidance).toContain('pnpm dev');
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/environment',
          payload: { path: '/tmp' },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          url: '/api/environment',
          headers: { origin: 'https://untrusted.example' },
        })
      ).statusCode,
    ).toBe(403);
  } finally {
    await app.close();
  }
});
