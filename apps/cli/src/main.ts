#!/usr/bin/env node
import { Command } from 'commander';
import {
  createGoalSchema,
  goalDetailSchema,
  goalListSchema,
} from '@merforge/contracts';

const program = new Command()
  .name('merforge')
  .description('Merforge local prototype CLI')
  .version('0.1.0');
const baseUrl = process.env.MERFORGE_API_URL ?? 'http://127.0.0.1:4317';
async function request(path: string, body?: unknown) {
  const response = await fetch(new URL(path, baseUrl), {
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
    throw new Error(`API ${response.status}: ${await response.text()}`);
  return response.json();
}
const print = (value: unknown) => console.log(JSON.stringify(value, null, 2));
program
  .command('create')
  .argument('<objective>')
  .description('Create a goal with one prototype task')
  .action(async (objective) => {
    const input = createGoalSchema.parse({ objective });
    print(goalDetailSchema.parse(await request('/api/goals', input)));
  });
program
  .command('list')
  .description('List goals')
  .action(async () => print(goalListSchema.parse(await request('/api/goals'))));
program
  .command('inspect')
  .argument('<goal-id>')
  .description('Inspect tasks, runs and mock evidence')
  .action(async (id) =>
    print(
      goalDetailSchema.parse(
        await request(`/api/goals/${encodeURIComponent(id)}`),
      ),
    ),
  );
program
  .command('mock-run')
  .argument('<task-id>')
  .description('Record a simulated execution; does not call an agent')
  .action(async (id) =>
    print(
      goalDetailSchema.parse(
        await request(`/api/tasks/${encodeURIComponent(id)}/mock-run`, {}),
      ),
    ),
  );
try {
  await program.parseAsync();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
