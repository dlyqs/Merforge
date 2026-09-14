import { createRuntime } from '../../dist/index.js';
const [path, scenario] = process.argv.slice(2);
let count = 0;
const runtime = createRuntime(path, {
  ...(scenario === 'claimed'
    ? {
        executor: {
          id: 'mock',
          async execute() {
            process.kill(process.pid, 'SIGKILL');
            return {};
          },
        },
      }
    : {}),
  logger(e) {
    const kill =
      scenario === 'claimed'
        ? false
        : ['before-boundary', 'before-manual', 'before-single'].includes(
              scenario,
            )
          ? e.event === 'executor_finished' && ++count === 2
          : scenario === 'window'
            ? e.event === 'verification_passed'
            : scenario === 'until'
              ? e.event === 'boundary_reached'
              : e.event === 'execution_paused';
    if (kill) process.kill(process.pid, 'SIGKILL');
  },
});
const definition = {
  schemaVersion: 'plan.v1',
  phases: [2, 1, 1].map((n, i) => ({
    title: String(i),
    requiresApproval: false,
    tasks: Array.from({ length: n }, () => ({
      title: 'mock',
      executorId: 'mock',
      acceptanceVersion: 'summary.v1',
    })),
  })),
};
const p = runtime.createPlan({ objective: scenario, revision: 1, definition });
runtime.decideApproval(p.id, p.approvals[0].id, {
  revision: 1,
  decision: 'approved',
  actor: 'local',
});
if (!['manual', 'before-manual'].includes(scenario))
  runtime.setPlanMode(p.id, {
    revision: 1,
    controlVersion: 0,
    mode: ['until', 'before-boundary', 'claimed'].includes(scenario)
      ? 'auto_until'
      : 'auto',
    ...(['until', 'before-boundary', 'claimed'].includes(scenario)
      ? { stopPhaseId: p.phases[0].id }
      : {}),
  });
runtime.continuePlan(p.id, {
  revision: 1,
  ...(['single', 'before-single'].includes(scenario)
    ? { phaseId: p.phases[0].id }
    : {}),
});
await runtime.waitForIdle();
throw new Error('Crash checkpoint was not reached');
