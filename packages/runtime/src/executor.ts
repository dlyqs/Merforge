import type { Task } from '@merforge/contracts';

// This synchronous adapter only exercises wiring. Real agent adapters will need
// asynchronous lifecycle, capability negotiation and persisted run attempts.
export interface PrototypeExecutor {
  readonly id: 'mock';
  execute(task: Task): { kind: 'mock'; summary: string };
}
export class MockExecutor implements PrototypeExecutor {
  readonly id = 'mock' as const;
  execute(task: Task) {
    return {
      kind: 'mock' as const,
      summary: `Mock execution recorded for task ${task.id}. No agent was called and no business outcome was verified.`,
    };
  }
}
