import { createRuntime } from '../../dist/index.js';
process.once('message', async ({ db, options, definition }) => {
  const r = createRuntime(db, options);
  const p = r.createPlan({
    objective: 'crash sample',
    revision: 1,
    definition,
  });
  r.decideApproval(p.id, p.approvals[0].id, {
    revision: 1,
    decision: 'approved',
    actor: 'test',
  });
  r.continuePlan(p.id, { revision: 1 });
  process.send({
    planId: p.id,
    goalId: p.goalId,
    taskId: r.getGoal(p.goalId).tasks[0].id,
  });
});
