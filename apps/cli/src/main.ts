#!/usr/bin/env node
import { Command } from 'commander';
import { readFile } from 'node:fs/promises';
import {
  createGoalSchema,
  codeDetailSchema,
  codeRetrySchema,
  createPlanSchema,
  revisePlanSchema,
  decisionSchema,
  continuePlanSchema,
  modeCommandSchema,
  revisionCommandSchema,
  planDetailSchema,
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
program
  .command('code-inspect')
  .argument('<task-id>')
  .action(async (id) =>
    print(
      codeDetailSchema.parse(
        await request(`/api/tasks/${encodeURIComponent(id)}/code`),
      ),
    ),
  );
program
  .command('code-evidence')
  .argument('<task-id>')
  .argument('<evidence-id>')
  .action(async (id, evidence) =>
    print(
      await request(
        `/api/tasks/${encodeURIComponent(id)}/code/evidence/${encodeURIComponent(evidence)}`,
      ),
    ),
  );
program
  .command('cancel')
  .argument('<task-id>')
  .argument('<attempt-id>')
  .action(async (id, attempt) =>
    print(
      await request(
        `/api/tasks/${encodeURIComponent(id)}/attempts/${encodeURIComponent(attempt)}/cancel`,
        {},
      ),
    ),
  );
program
  .command('reconcile')
  .argument('<task-id>')
  .argument('<attempt-id>')
  .option('--stop', 'Stop identity-verified surviving processes')
  .action(async (id, attempt, options) =>
    print(
      await request(`/api/tasks/${encodeURIComponent(id)}/reconcile`, {
        attemptId: attempt,
        stop: !!options.stop,
      }),
    ),
  );
program
  .command('retry-code')
  .argument('<task-id>')
  .argument('<attempt-id>')
  .requiredOption('--revision <revision>')
  .requiredOption(
    '--snapshot <hash>',
    'Reviewed reconciliation hash, or none before workspace creation',
  )
  .action(async (id, attempt, options) =>
    print(
      acceptedSchema.parse(
        await request(
          `/api/tasks/${encodeURIComponent(id)}/retry-code`,
          codeRetrySchema.parse({
            attemptId: attempt,
            revision: Number(options.revision),
            snapshotHash: options.snapshot === 'none' ? null : options.snapshot,
          }),
        ),
      ),
    ),
  );
const plan = program
  .command('plan')
  .description('Versioned serial plans; approval does not start execution');
const segment = (id: string) => encodeURIComponent(id);
plan
  .command('create')
  .argument('<file>')
  .description('Create from a CreatePlan JSON file')
  .action(async (file) => {
    const input = createPlanSchema.parse(
      JSON.parse(await readFile(file, 'utf8')),
    );
    print(planDetailSchema.parse(await request('/api/plans', input)));
  });
plan
  .command('inspect')
  .argument('<plan-id>')
  .action(async (id) => {
    print(planDetailSchema.parse(await request(`/api/plans/${segment(id)}`)));
  });
plan
  .command('revise')
  .argument('<plan-id>')
  .argument('<file>')
  .requiredOption('--revision <n>', 'Currently reviewed revision')
  .action(async (id, file, opts) => {
    const input = revisePlanSchema.parse({
      revision: Number(opts.revision),
      definition: JSON.parse(await readFile(file, 'utf8')),
    });
    print(
      planDetailSchema.parse(
        await request(`/api/plans/${segment(id)}/revisions`, input),
      ),
    );
  });
plan
  .command('review')
  .argument('<plan-id>')
  .argument('<approval-id>')
  .requiredOption('--revision <n>', 'Revision actually reviewed')
  .requiredOption('--decision <decision>', 'approved or rejected')
  .requiredOption(
    '--actor <label>',
    'Local operator label; not authenticated identity',
  )
  .description('Decide a plan review or phase-entry approval')
  .action(async (id, approval, opts) => {
    const input = decisionSchema.parse({
      revision: Number(opts.revision),
      decision: opts.decision,
      actor: opts.actor,
    });
    print(
      planDetailSchema.parse(
        await request(
          `/api/plans/${segment(id)}/approvals/${segment(approval)}/decision`,
          input,
        ),
      ),
    );
  });
plan
  .command('continue')
  .argument('<plan-id>')
  .requiredOption('--revision <n>', 'Current revision')
  .option('--phase <id>', 'Run only this phase')
  .action(async (id, opts) => {
    const input = continuePlanSchema.parse({
      revision: Number(opts.revision),
      ...(opts.phase ? { phaseId: opts.phase } : {}),
    });
    print(
      planDetailSchema.parse(
        await request(`/api/plans/${segment(id)}/continue`, input),
      ),
    );
  });
plan
  .command('mode')
  .argument('<plan-id>')
  .argument('<mode>')
  .requiredOption('--revision <n>', 'Current revision')
  .requiredOption('--control-version <n>', 'Observed control version')
  .option(
    '--start <phase-id>',
    'Inclusive start; defaults to first incomplete phase',
  )
  .option('--stop <phase-id>', 'Inclusive auto_until boundary')
  .action(async (id, mode, opts) => {
    const input = modeCommandSchema.parse({
      revision: Number(opts.revision),
      controlVersion: Number(opts.controlVersion),
      mode,
      ...(opts.start ? { startPhaseId: opts.start } : {}),
      ...(opts.stop ? { stopPhaseId: opts.stop } : {}),
    });
    print(
      planDetailSchema.parse(
        await request(`/api/plans/${segment(id)}/mode`, input),
      ),
    );
  });
plan
  .command('request-approval')
  .argument('<plan-id>')
  .argument('<phase-id>')
  .requiredOption('--revision <n>', 'Current revision')
  .action(async (id, phase, opts) => {
    const input = revisionCommandSchema.parse({
      revision: Number(opts.revision),
    });
    print(
      planDetailSchema.parse(
        await request(
          `/api/plans/${segment(id)}/phases/${segment(phase)}/approval`,
          input,
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
