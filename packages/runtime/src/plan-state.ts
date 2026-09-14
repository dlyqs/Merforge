import type { PlanDetail } from '@merforge/contracts';

// Aggregates are projections of verified task facts, never commands to mark work done.
// Phase: pending -> in_progress -> completed; failed/interrupted -> blocked;
// explicit retry: blocked -> in_progress. completed is terminal.
// Plan: idle -> running/waiting/blocked/completed after explicit authorization;
// running <-> waiting; running/waiting -> blocked; explicit retry unblocks;
// a boundary returns to idle; all verified phases -> completed (terminal).
// Review: pending -> approved|rejected; new revision alone resets to pending.
export function phaseStatus(
  statuses: string[],
): PlanDetail['phases'][number]['status'] {
  if (statuses.length && statuses.every((s) => s === 'completed'))
    return 'completed';
  if (statuses.some((s) => s === 'failed' || s === 'interrupted'))
    return 'blocked';
  if (statuses.some((s) => s !== 'ready')) return 'in_progress';
  return 'pending';
}
