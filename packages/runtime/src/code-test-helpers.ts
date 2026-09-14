import type { PlanDefinition } from '@merforge/contracts';
export function codeDefinition(baseCommit = 'a'.repeat(40)): PlanDefinition {
  return {
    schemaVersion: 'plan.v2',
    workspace: { repositoryKey: 'sample', baseCommit },
    phases: [
      {
        title: 'code',
        requiresApproval: false,
        tasks: [
          {
            title: 'implement sum',
            executorId: 'codex',
            acceptanceVersion: 'commands.v1',
            instructions: 'Implement sum(a,b) in sum.mjs. Only change sum.mjs.',
            inputs: [],
            expectedFiles: ['sum.mjs'],
            allowedPaths: ['sum.mjs'],
            forbiddenPaths: ['sum.test.mjs'],
            acceptance: {
              schemaVersion: 'commands.v1',
              checks: [
                {
                  id: 'sum',
                  argv: [
                    'node',
                    '--input-type=module',
                    '-e',
                    "import {sum} from './sum.mjs';if(sum(2,3)!==5)process.exit(1)",
                  ],
                  cwd: '.',
                  timeoutMs: 1000,
                  maxOutputBytes: 4096,
                  repeatable: true,
                  independent: true,
                },
              ],
              protectedFiles: [],
              allowedOutputs: [],
              allowEmptyDiff: false,
            },
            policy: {
              sandbox: 'workspace-write',
              network: false,
              detachedProcesses: false,
            },
          },
        ],
      },
    ],
  };
}
