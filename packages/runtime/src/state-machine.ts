import type { TaskStatus } from '@merforge/contracts';

// Claims require ready, retries require failed/interrupted. Result commands also
// require the matching active attempt; completion additionally requires PASS.
const transitions: Record<TaskStatus, readonly TaskStatus[]> = {
  ready: ['running', 'waiting_human'],
  running: ['verifying', 'failed', 'interrupted'],
  waiting_human: ['verifying'],
  verifying: ['completed', 'failed'],
  failed: ['running', 'waiting_human'],
  interrupted: ['running', 'waiting_human'],
  completed: [],
};
export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return transitions[from].includes(to);
}
