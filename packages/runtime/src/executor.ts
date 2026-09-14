import { setTimeout } from 'node:timers/promises';
import type { Task, MockOptions } from '@merforge/contracts';

export interface Executor {
  readonly id: 'mock';
  execute(
    task: Task,
    options: MockOptions,
    signal: AbortSignal,
  ): Promise<unknown>;
}
export class MockExecutor implements Executor {
  readonly id = 'mock' as const;
  async execute(task: Task, options: MockOptions, signal: AbortSignal) {
    await setTimeout(options.delayMs ?? 0, undefined, { signal });
    if (options.outcome === 'failure')
      throw new Error('Controlled mock failure');
    return {
      summary: `Mock execution recorded for task ${task.id}. No agent was called and no business outcome was verified.`,
    };
  }
}

// Human work is represented by a durable waiting attempt; it runs no background
// I/O and consumes a submission only through the runtime's identity checks.
export class HumanExecutor {
  readonly id = 'human' as const;
  readonly initialStatus = 'waiting_human' as const;
}
