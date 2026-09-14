import { readFileSync } from 'node:fs';
import { codeConfigSchema } from '@merforge/contracts';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app.js';

const port = Number(process.env.MERFORGE_PORT ?? 4317);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error('Invalid MERFORGE_PORT');

const codex = process.env.MERFORGE_CODE_CONFIG
  ? codeConfigSchema.parse(
      JSON.parse(readFileSync(process.env.MERFORGE_CODE_CONFIG, 'utf8')),
    )
  : undefined;
const app = buildApp({
  ...(codex ? { runtimeOptions: { codex } } : {}),
  databasePath:
    process.env.MERFORGE_DB ??
    fileURLToPath(
      new URL('../../../.merforge/runtime.sqlite', import.meta.url),
    ),
  logger: true,
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void app.close().catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
  });
}
try {
  await app.listen({ port, host: '127.0.0.1' });
} catch (error) {
  app.log.error(error);
  await app.close();
  process.exitCode = 1;
}
