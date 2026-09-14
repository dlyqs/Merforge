import { readFileSync } from 'node:fs';
import { buildApp } from '../app.js';
import { MockExecutor } from '@merforge/runtime';
let first = true;
const mock = new MockExecutor();
const app = buildApp({
  databasePath: process.argv[2]!,
  logger: true,
  ...(process.env.MERFORGE_TEST_CODE_CONFIG
    ? {
        runtimeOptions: {
          codex: JSON.parse(
            readFileSync(process.env.MERFORGE_TEST_CODE_CONFIG, 'utf8'),
          ),
        },
      }
    : {}),
  ...(process.argv[4] === 'fail-first'
    ? {
        runtimeOptions: {
          executor: {
            id: 'mock' as const,
            async execute(...args: Parameters<MockExecutor['execute']>) {
              if (first) {
                first = false;
                throw new Error('Controlled first mock failure');
              }
              return mock.execute(...args);
            },
          },
        },
      }
    : {}),
});
try {
  const url = await app.listen({
    host: '127.0.0.1',
    port: Number(process.argv[3] ?? 0),
  });
  process.send?.({ url });
} catch (error) {
  await app.close();
  throw error;
}
process.once('SIGTERM', () => {
  void app.close().then(() => process.disconnect?.());
});
