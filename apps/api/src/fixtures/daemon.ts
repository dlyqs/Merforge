import { buildApp } from '../app.js';
const app = buildApp({ databasePath: process.argv[2]!, logger: true });
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
