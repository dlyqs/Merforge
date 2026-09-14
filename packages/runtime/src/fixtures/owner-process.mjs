import { createRuntime } from '../../dist/index.js';
const runtime = createRuntime(process.argv[2]);
const goal =
  runtime.listGoals()[0] ?? runtime.createGoal({ objective: 'crash recovery' });
let detail = runtime.getGoal(goal.id);
if (detail.tasks[0].status === 'ready')
  runtime.runTask(detail.tasks[0].id, { delayMs: 60000 });
process.send(runtime.getGoal(goal.id));
setInterval(() => {}, 1000);
