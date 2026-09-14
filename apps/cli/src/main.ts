#!/usr/bin/env node
import { Command } from 'commander';
import {
  createGoalSchema,
  mockOptionsSchema,
  acceptedSchema,
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
  .option('--executor <executor>', 'mock or human', 'mock')
  .action(async (objective, options) => {
    const input = createGoalSchema.parse({
      objective,
      executorId: options.executor,
    });
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
for (const operation of ['run', 'mock-run', 'retry']) {
  program
    .command(operation)
    .argument('<task-id>')
    .description(
      operation === 'retry'
        ? 'Create a new attempt after failure/interruption'
        : 'Start Mock or wait for Human submission',
    )
    .option('--delay-ms <ms>', 'Mock delay, 0–60000 milliseconds')
    .option('--outcome <outcome>', 'Mock success or failure')
    .action(async (id, options) => {
      const input = mockOptionsSchema.parse({
        ...(options.delayMs === undefined
          ? {}
          : { delayMs: Number(options.delayMs) }),
        ...(options.outcome === undefined ? {} : { outcome: options.outcome }),
      });
      print(
        acceptedSchema.parse(
          await request(
            `/api/tasks/${encodeURIComponent(id)}/${operation}`,
            input,
          ),
        ),
      );
    });
}
program
  .command('submit')
  .argument('<task-id>')
  .argument('<attempt-id>')
  .requiredOption('--artifact <json>', 'JSON artifact; e.g. {"summary":"done"}')
  .description('Submit a Human artifact for independent verification')
  .action(async (id, attemptId, options) => {
    let artifact: unknown;
    try {
      artifact = JSON.parse(options.artifact);
    } catch {
      throw new Error(
        `Task ${id}, attempt ${attemptId}: artifact must be valid JSON`,
      );
    }
    print(
      acceptedSchema.parse(
        await request(
          `/api/tasks/${encodeURIComponent(id)}/attempts/${encodeURIComponent(attemptId)}/submit`,
          { artifact },
        ),
      ),
    );
  });
try {
  await program.parseAsync();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
