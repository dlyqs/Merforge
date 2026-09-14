import Fastify from 'fastify';
import { CONTRACT_VERSION, createGoalSchema } from '@merforge/contracts';
import { createRuntime, RuntimeError } from '@merforge/runtime';

export function buildApp(options: { databasePath: string; logger?: boolean }) {
  const app = Fastify({
    logger: options.logger ?? false,
    bodyLimit: 32 * 1024,
  });
  const runtime = createRuntime(options.databasePath);
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
        .code(error.code === 'NOT_FOUND' ? 404 : 409)
        .send({ error: error.message });
    const status =
      typeof error === 'object' && error !== null && 'statusCode' in error
        ? Number(error.statusCode)
        : 500;
    if (status >= 400 && status < 500)
      return reply.code(status).send({ error: 'Invalid request' });
    request.log.error(error);
    return reply.code(500).send({ error: 'Internal server error' });
  });
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
    async (request) => runtime.runMock(request.params.id),
  );
  return app;
}
