import type { Runtime } from './index.js';
import type { PlanDefinition } from '@merforge/contracts';
export const definition: PlanDefinition = {
  schemaVersion: 'plan.v1',
  phases: [
    {
      title: 'one',
      requiresApproval: false,
      tasks: [
        { title: 'a', executorId: 'mock', acceptanceVersion: 'summary.v1' },
        { title: 'b', executorId: 'mock', acceptanceVersion: 'summary.v1' },
      ],
    },
    {
      title: 'two',
      requiresApproval: false,
      tasks: [
        { title: 'c', executorId: 'mock', acceptanceVersion: 'summary.v1' },
      ],
    },
    {
      title: 'three',
      requiresApproval: false,
      tasks: [
        { title: 'd', executorId: 'mock', acceptanceVersion: 'summary.v1' },
      ],
    },
  ],
};
export function approved(r: Runtime, d = definition) {
  const p = r.createPlan({ objective: 'serial', revision: 1, definition: d });
  return r.decideApproval(p.id, p.approvals[0]!.id, {
    revision: 1,
    decision: 'approved',
    actor: 'local',
  });
}
