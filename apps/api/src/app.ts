import Fastify from 'fastify';
import {
  CONTRACT_VERSION,
  createPlanSchema,
  revisePlanSchema,
  decisionSchema,
  continuePlanSchema,
  modeCommandSchema,
  revisionCommandSchema,
  createGoalSchema,
  mockOptionsSchema,
  humanSubmissionSchema,
} from '@merforge/contracts';
import {
  createRuntime,
  RuntimeError,
  type RuntimeOptions,
} from '@merforge/runtime';

export function buildApp(options: {
  databasePath: string;
  logger?: boolean;
  runtimeOptions?: RuntimeOptions;
}) {
  const app = Fastify({
    logger: options.logger ?? false,
    bodyLimit: 32 * 1024,
  });
  const runtime = createRuntime(options.databasePath, {
    ...options.runtimeOptions,
    logger: (entry) => app.log.info(entry),
  });
  app.addHook('onClose', async () => runtime.close());
  // Local prototype: browser writes must originate from the same host. No CORS.
  app.addHook('onRequest', async (request, reply) => {
    const origin = request.headers.origin;
    if (origin) {
      let allowed = false;
      try {
        allowed = new URL(origin).host === request.headers.host;
      } catch {
        /* reject malformed origins */
      }
      if (!allowed)
        return reply
          .code(403)
          .send({ error: 'Cross-origin requests are not allowed' });
    }
  });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof RuntimeError)
      return reply
        .code(
          error.code === 'NOT_FOUND'
            ? 404
            : error.code === 'INVALID_INPUT'
              ? 400
              : 409,
        )
        .send({ error: error.message, code: error.code });
    const status =
      typeof error === 'object' && error !== null && 'statusCode' in error
        ? Number(error.statusCode)
        : 500;
    if (status >= 400 && status < 500)
      return reply.code(status).send({ error: 'Invalid request' });
    request.log.error(error);
    return reply.code(500).send({ error: 'Internal server error' });
  });
  app.post('/api/plans', async (request, reply) => {
    const input = createPlanSchema.safeParse(request.body);
    if (!input.success)
      return reply
        .code(400)
        .send({ error: 'Invalid plan', code: 'INVALID_INPUT' });
    return reply.code(201).send(runtime.createPlan(input.data));
  });
  app.get<{ Params: { id: string } }>('/api/plans/:id', async (request) =>
    runtime.getPlan(request.params.id),
  );
  app.post<{ Params: { id: string } }>(
    '/api/plans/:id/revisions',
    async (request, reply) => {
      const input = revisePlanSchema.safeParse(request.body);
      if (!input.success)
        return reply
          .code(400)
          .send({ error: 'Invalid revision', code: 'INVALID_INPUT' });
      return runtime.revisePlan(request.params.id, input.data);
    },
  );
  app.post<{ Params: { id: string; approvalId: string } }>(
    '/api/plans/:id/approvals/:approvalId/decision',
    async (request, reply) => {
      const input = decisionSchema.safeParse(request.body);
      if (!input.success)
        return reply
          .code(400)
          .send({ error: 'Invalid decision', code: 'INVALID_INPUT' });
      return runtime.decideApproval(
        request.params.id,
        request.params.approvalId,
        input.data,
      );
    },
  );
  app.post<{ Params: { id: string } }>(
    '/api/plans/:id/continue',
    async (request, reply) => {
      const input = continuePlanSchema.safeParse(request.body);
      if (!input.success)
        return reply
          .code(400)
          .send({ error: 'Invalid continuation', code: 'INVALID_INPUT' });
      return runtime.continuePlan(request.params.id, input.data);
    },
  );
  app.post<{ Params: { id: string } }>(
    '/api/plans/:id/mode',
    async (request, reply) => {
      const input = modeCommandSchema.safeParse(request.body);
      if (!input.success)
        return reply
          .code(400)
          .send({ error: 'Invalid mode', code: 'INVALID_INPUT' });
      return runtime.setPlanMode(request.params.id, input.data);
    },
  );
  app.post<{ Params: { id: string; phaseId: string } }>(
    '/api/plans/:id/phases/:phaseId/approval',
    async (request, reply) => {
      const input = revisionCommandSchema.safeParse(request.body);
      if (!input.success)
        return reply
          .code(400)
          .send({ error: 'Invalid revision', code: 'INVALID_INPUT' });
      return runtime.requestPhaseApproval(
        request.params.id,
        request.params.phaseId,
        input.data,
      );
    },
  );
  app.get('/api/health', async () => ({
    status: 'ok',
    contractVersion: CONTRACT_VERSION,
    mode: 'prototype',
  }));
  app.get('/api/goals', async () => runtime.listGoals());
  app.post('/api/goals', async (request, reply) => {
    const result = createGoalSchema.safeParse(request.body);
    if (!result.success)
      return reply
        .code(400)
        .send({ error: 'Objective must contain 1–2000 characters' });
    return reply.code(201).send(runtime.createGoal(result.data));
  });
  app.get<{ Params: { id: string } }>('/api/goals/:id', async (request) =>
    runtime.getGoal(request.params.id),
  );
  app.post<{ Params: { id: string } }>(
    '/api/tasks/:id/mock-run',
    async (request, reply) => {
      const result = mockOptionsSchema.safeParse(request.body ?? {});
      if (!result.success)
        return reply.code(400).send({ error: 'Invalid mock options' });
      return reply
        .code(202)
        .send(runtime.runMock(request.params.id, result.data));
    },
  );
  app.post<{ Params: { id: string } }>(
    '/api/tasks/:id/retry',
    async (request, reply) => {
      const result = mockOptionsSchema.safeParse(request.body ?? {});
      if (!result.success)
        return reply.code(400).send({ error: 'Invalid mock options' });
      return reply
        .code(202)
        .send(runtime.retry(request.params.id, result.data));
    },
  );
  app.post<{ Params: { id: string } }>(
    '/api/tasks/:id/run',
    async (request, reply) => {
      const result = mockOptionsSchema.safeParse(request.body ?? {});
      if (!result.success)
        return reply.code(400).send({ error: 'Invalid execution options' });
      return reply
        .code(202)
        .send(runtime.runTask(request.params.id, result.data));
    },
  );
  app.post<{ Params: { id: string; attemptId: string } }>(
    '/api/tasks/:id/attempts/:attemptId/submit',
    async (request, reply) => {
      const result = humanSubmissionSchema.safeParse(request.body);
      if (!result.success)
        return reply.code(400).send({ error: 'A JSON artifact is required' });
      return reply
        .code(202)
        .send(
          runtime.submitHuman(
            request.params.id,
            request.params.attemptId,
            result.data.artifact,
          ),
        );
    },
  );
  return app;
}
