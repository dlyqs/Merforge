export class RuntimeError extends Error {
  constructor(
    public readonly code: 'NOT_FOUND' | 'CONFLICT' | 'INVALID_INPUT',
    message: string,
    public readonly context: {
      planId?: string;
      goalId?: string;
      revision?: number;
      phaseId?: string;
      taskId?: string;
      controlVersion?: number;
    } = {},
  ) {
    super(message);
  }
}
