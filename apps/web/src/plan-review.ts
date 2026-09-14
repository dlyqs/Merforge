import { decisionSchema, type PlanDetail } from '@merforge/contracts';

export function reviewDecision(
  snapshot: PlanDetail,
  current: PlanDetail,
  approvalId: string,
  actor: string,
  decision: 'approved' | 'rejected',
) {
  if (snapshot.id !== current.id || snapshot.revision !== current.revision)
    throw new Error('计划版本已变化，请重新加载并审阅。');
  const approval = current.approvals.find(
    (a) => a.id === approvalId && a.revision === snapshot.revision,
  );
  if (!approval || approval.decision !== 'pending')
    throw new Error('审批已变化，请重新加载。');
  return decisionSchema.parse({ revision: snapshot.revision, actor, decision });
}
