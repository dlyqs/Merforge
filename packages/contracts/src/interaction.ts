import { z } from 'zod';
import { createPlanSchema } from './plan.js';

export const environmentSchema = z.object({
  codex: z.object({
    configured: z.boolean(),
    available: z.boolean(),
    message: z.string(),
  }),
  repositories: z.array(
    z.object({
      key: z.string(),
      baseCommit: z.string().nullable(),
      clean: z.boolean(),
      message: z.string(),
    }),
  ),
  guidance: z.string(),
});
export type Environment = z.infer<typeof environmentSchema>;
export interface TaskDraft {
  title: string;
  executorId: 'mock' | 'human' | 'codex';
  instructions: string;
  expectedFiles: string;
  allowedPaths: string;
  forbiddenPaths: string;
  command: string;
  arguments: string;
  cwd: string;
  allowEmptyDiff: boolean;
}
export interface PlanDraft {
  objective: string;
  kind: 'example' | 'code';
  repositoryKey: string;
  baseCommit: string;
  phases: { title: string; requiresApproval: boolean; tasks: TaskDraft[] }[];
}
export const newTaskDraft = (): TaskDraft => ({
  title: '',
  executorId: 'mock',
  instructions: '',
  expectedFiles: '',
  allowedPaths: '',
  forbiddenPaths: '',
  command: '',
  arguments: '',
  cwd: '.',
  allowEmptyDiff: false,
});
export const newPlanDraft = (): PlanDraft => ({
  objective: '',
  kind: 'example',
  repositoryKey: '',
  baseCommit: '',
  phases: [{ title: '', requiresApproval: false, tasks: [newTaskDraft()] }],
});
const lines = (value: string) =>
  value
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
// Both interactive clients submit this exact validated contract. No shell parsing.
export function buildManualPlan(draft: PlanDraft) {
  const phases = draft.phases.map((p) => ({
    title: p.title,
    requiresApproval: p.requiresApproval,
    tasks: p.tasks.map((t) =>
      draft.kind === 'example'
        ? {
            title: t.title,
            executorId: t.executorId,
            acceptanceVersion: 'summary.v1',
          }
        : {
            title: t.title,
            executorId: 'codex',
            acceptanceVersion: 'commands.v1',
            instructions: t.instructions,
            inputs: [],
            expectedFiles: lines(t.expectedFiles),
            allowedPaths: lines(t.allowedPaths),
            forbiddenPaths: lines(t.forbiddenPaths),
            acceptance: {
              schemaVersion: 'commands.v1',
              checks: [
                {
                  id: 'check',
                  argv: [
                    t.command,
                    ...t.arguments.split('\n').filter((s) => s !== ''),
                  ],
                  cwd: t.cwd,
                  timeoutMs: 60000,
                  maxOutputBytes: 1048576,
                  repeatable: true,
                  independent: true,
                },
              ],
              protectedFiles: [],
              allowedOutputs: [],
              allowEmptyDiff: t.allowEmptyDiff,
            },
            policy: {
              sandbox: 'workspace-write',
              network: false,
              detachedProcesses: false,
            },
          },
    ),
  }));
  if (
    draft.kind === 'code' &&
    draft.phases.some((p) => p.tasks.some((t) => !t.command.trim()))
  )
    throw new Error('请填写独立验收程序');
  return createPlanSchema.parse({
    objective: draft.objective,
    revision: 1,
    definition:
      draft.kind === 'code'
        ? {
            schemaVersion: 'plan.v2',
            workspace: {
              repositoryKey: draft.repositoryKey,
              baseCommit: draft.baseCommit,
            },
            phases,
          }
        : { schemaVersion: 'plan.v1', phases },
  });
}
