import { afterEach, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { buildApp } from '../../api/src/app';

const harness = vi.hoisted(() => ({
  states: [] as unknown[],
  cursor: 0,
  pending: Promise.resolve(),
  environment: {} as unknown,
}));
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useState: (initial: unknown) => {
    const i = harness.cursor++;
    if (!(i in harness.states))
      harness.states[i] = typeof initial === 'function' ? initial() : initial;
    return [
      harness.states[i],
      (v: unknown) => {
        harness.states[i] = typeof v === 'function' ? v(harness.states[i]) : v;
      },
    ];
  },
}));
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: async () => {} }),
  useQuery: () => ({ data: harness.environment, refetch: async () => {} }),
  useMutation: (options: {
    mutationFn: (arg?: unknown) => Promise<unknown>;
    onSuccess?: (v: unknown) => Promise<void>;
  }) => ({
    isPending: false,
    mutate: (arg?: unknown) => {
      harness.pending = options.mutationFn(arg).then(async (v) => {
        await options.onSuccess?.(v);
      });
    },
  }),
}));
import { ManualPlanCreate } from './ManualPlanCreate';
import { PlanControls } from './PlanControls';
import { CodeDetails } from './CodeDetails';
import { runMenu } from '../../cli/src/menu';
import {
  readFileSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { codeDefinition } from '../../../packages/runtime/src/code-test-helpers';
import { git } from '../../../packages/runtime/src/workspace';
import { HumanSubmission } from './TaskActions';

type Node = ReactElement<Record<string, any>>;
function nodes(value: unknown): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== 'object' || !('props' in value)) return [];
  const n = value as Node;
  return [n, ...nodes(n.props.children)];
}
function label(tree: Node, text: string) {
  const n = nodes(tree).find(
    (n) =>
      n.type === 'label' &&
      (Array.isArray(n.props.children)
        ? n.props.children
        : [n.props.children]
      ).includes(text),
  );
  if (!n) throw new Error(`Missing label ${text}`);
  return nodes(n).find((c) =>
    ['input', 'select', 'textarea'].includes(c.type as string),
  )!;
}
function button(tree: Node, text: string) {
  return nodes(tree).find(
    (n) =>
      n.type === 'button' &&
      (Array.isArray(n.props.children)
        ? n.props.children.join('')
        : String(n.props.children)
      ).startsWith(text),
  )!;
}
afterEach(() => {
  harness.states = [];
  harness.cursor = 0;
  vi.unstubAllGlobals();
});
it('submits real form handlers to API, approves without starting, and pins mode control during polling', async () => {
  const app = buildApp({ databasePath: ':memory:' });
  vi.stubGlobal('fetch', async (path: string, init?: RequestInit) => {
    const res = await app.inject({
      method: init?.method === 'POST' ? 'POST' : 'GET',
      url: path,
      ...(init?.body ? { payload: JSON.parse(String(init.body)) } : {}),
    });
    return {
      ok: res.statusCode < 400,
      status: res.statusCode,
      json: async () => res.json(),
      text: async () => res.body,
    };
  });
  try {
    harness.environment = (await app.inject('/api/environment')).json();
    let id = '';
    const render = () => {
      harness.cursor = 0;
      return ManualPlanCreate({
        onCreated: (v) => {
          id = v;
        },
      });
    };
    let tree = render();
    for (const [name, value] of [
      ['目标', 'GUI human workflow'],
      ['阶段名称', 'Prepare'],
      ['任务名称', 'Deliver'],
      ['执行方式', 'human'],
    ]) {
      label(tree, name!).props.onChange({ target: { value } });
      tree = render();
    }
    button(tree, '添加阶段').props.onClick();
    tree = render();
    const phaseNames = nodes(tree).filter(
      (n) => n.type === 'input' && n.props.value === '',
    );
    phaseNames[0]!.props.onChange({ target: { value: 'Next' } });
    tree = render();
    nodes(tree)
      .find((n) => n.type === 'input' && n.props.value === '')!
      .props.onChange({ target: { value: 'Second task' } });
    tree = render();
    nodes(tree)
      .find((n) => n.type === 'form')!
      .props.onSubmit({ preventDefault() {} });
    await harness.pending;
    let detail = (await app.inject(`/api/goals/${id}`)).json();
    expect(detail.plan.phases).toHaveLength(2);
    expect(detail.tasks[0].executorId).toBe('human');
    expect(detail.attempts).toHaveLength(0);
    harness.states = [];
    const controls = () => {
      harness.cursor = 0;
      return PlanControls({ plan: detail.plan });
    };
    tree = controls();
    button(tree, '批准 revision').props.onClick();
    await harness.pending;
    detail = (await app.inject(`/api/goals/${id}`)).json();
    expect(detail.plan.review).toBe('approved');
    expect(detail.attempts).toHaveLength(0);
    tree = controls();
    button(tree, '加载当前版本').props.onClick();
    tree = controls();
    await app.inject({
      method: 'POST',
      url: `/api/plans/${detail.plan.id}/mode`,
      payload: {
        revision: 1,
        controlVersion: detail.plan.controlVersion,
        mode: 'auto',
      },
    });
    detail = (await app.inject(`/api/goals/${id}`)).json();
    tree = controls();
    expect(button(tree, '保存模式').props.disabled).toBe(true);
    button(tree, '加载当前版本').props.onClick();
    tree = controls();
    expect(button(tree, '保存模式').props.disabled).toBe(false);
    button(tree, '继续（').props.onClick();
    await harness.pending;
    detail = (await app.inject(`/api/goals/${id}`)).json();
    expect(detail.attempts).toHaveLength(1);
    expect(detail.tasks[0].status).toBe('waiting_human');
    harness.states = [];
    const submission = () => {
      harness.cursor = 0;
      return HumanSubmission({
        taskId: detail.tasks[0].id,
        attemptId: detail.attempts[0].id,
      });
    };
    tree = submission();
    nodes(tree)
      .find((n) => n.type === 'textarea')!
      .props.onChange({ target: { value: 'Human form result' } });
    tree = submission();
    nodes(tree)
      .find((n) => n.type === 'form')!
      .props.onSubmit({ preventDefault() {} });
    await harness.pending;
    detail = (await app.inject(`/api/goals/${id}`)).json();
    expect(detail.tasks[0].status).toBe('completed');
    expect(detail.artifacts[0].payload).toEqual({
      summary: 'Human form result',
    });
  } finally {
    await app.close();
  }
});
it('keeps the selected code baseline pinned and binds instructions/argv/path fields without JSON', async () => {
  harness.environment = {
    codex: { available: true, message: 'ready' },
    repositories: [
      {
        key: 'repo',
        baseCommit: 'a'.repeat(40),
        clean: true,
        message: 'ready',
      },
    ],
  };
  let submitted: any;
  vi.stubGlobal('fetch', async (_: string, init: RequestInit) => {
    submitted = JSON.parse(String(init.body));
    return { ok: false, status: 409, text: async () => 'test capture' };
  });
  const render = () => {
    harness.cursor = 0;
    return ManualPlanCreate({ onCreated() {} });
  };
  let tree = render();
  for (const [name, value] of [
    ['目标', 'Code task'],
    ['计划类型', 'code'],
    ['仓库当前干净 HEAD', `repo:${'a'.repeat(40)}`],
    ['阶段名称', 'Implement'],
    ['任务名称', 'Fix'],
    ['明确任务指令', 'Fix sum'],
    ['预期文件（每行一个相对路径）', 'sum.js'],
    ['允许修改路径（每行一个）', 'sum.js'],
    ['独立验收程序（例如 node，不经 shell）', 'node'],
    ['验收参数（每行一个，保留空格，不加 shell 引号）', '-e\nprocess.exit(0)'],
  ]) {
    label(tree, name!).props.onChange({ target: { value } });
    tree = render();
  }
  nodes(tree)
    .find((n) => n.type === 'form')!
    .props.onSubmit({ preventDefault() {} });
  await expect(harness.pending).rejects.toThrow('409');
  expect(submitted.definition.workspace.baseCommit).toBe('a'.repeat(40));
  expect(
    submitted.definition.phases[0].tasks[0].acceptance.checks[0].argv,
  ).toEqual(['node', '-e', 'process.exit(0)']);
  (harness.environment as any).repositories[0].baseCommit = 'b'.repeat(40);
  tree = render();
  expect(button(tree, '创建待审阅计划').props.disabled).toBe(true);
});

for (const surface of ['GUI', 'CLI'] as const) {
  for (const cancelFirst of [false, true])
    it(`${surface} ${cancelFirst ? 'cancel and restart' : 'failure'} recovery uses reviewed hash, rejects drift, preserves attempts and explicitly retries through API`, async () => {
      const root = mkdtempSync(join(tmpdir(), 'merforge-interaction-'));
      const source = join(root, 'source');
      mkdirSync(source);
      await git(source, 'init', '-q');
      writeFileSync(join(source, 'sum.mjs'), 'export const sum=()=>0;');
      await git(source, 'add', '.');
      await git(
        source,
        '-c',
        'user.name=Test',
        '-c',
        'user.email=test@example.invalid',
        'commit',
        '-qm',
        'base',
      );
      const definition = codeDefinition(
        (await git(source, 'rev-parse', 'HEAD')).trim(),
      );
      if (definition.schemaVersion !== 'plan.v2') throw Error();
      definition.phases[0]!.tasks[0]!.instructions = cancelFirst
        ? 'CRASH_RETRY'
        : 'RETRY_SUCCESS';
      const options = {
        databasePath: join(root, 'db'),
        runtimeOptions: {
          codex: {
            executable: fileURLToPath(
              new URL(
                '../../../packages/runtime/src/fixtures/codex.mjs',
                import.meta.url,
              ),
            ),
            repositories: { sample: source },
            managedRoot: join(root, 'managed'),
            artifactRoot: join(root, 'evidence'),
          },
        },
      };
      let app = buildApp(options);
      const request = async (url: string, payload?: unknown): Promise<any> => {
        const res = await app.inject({
          method: payload === undefined ? 'GET' : 'POST',
          url,
          ...(payload === undefined ? {} : { payload: payload as object }),
        });
        if (res.statusCode >= 400) throw Error(res.body);
        return res.json();
      };
      vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
        const res = await app.inject({
          method: init?.method === 'POST' ? 'POST' : 'GET',
          url,
          ...(init?.body ? { payload: JSON.parse(String(init.body)) } : {}),
        });
        return {
          ok: res.statusCode < 400,
          status: res.statusCode,
          json: async () => res.json(),
          text: async () => res.body,
        };
      });
      try {
        const p = await request('/api/plans', {
          objective: 'Recovery',
          revision: 1,
          definition,
        });
        await request(
          `/api/plans/${p.id}/approvals/${p.approvals[0].id}/decision`,
          { revision: 1, actor: 'test', decision: 'approved' },
        );
        await request(`/api/plans/${p.id}/continue`, { revision: 1 });
        let goal: any;
        if (cancelFirst) {
          await expect
            .poll(
              async () => {
                goal = await request(`/api/goals/${p.goalId}`);
                const c = await request(`/api/tasks/${goal.tasks[0].id}/code`);
                return c.runs[0]?.pid;
              },
              { timeout: 10000 },
            )
            .toBeTruthy();
          const c = await request(`/api/tasks/${goal.tasks[0].id}/code`);
          await expect
            .poll(
              () => readFileSync(join(c.workspace.path, 'sum.mjs'), 'utf8'),
              { timeout: 10000 },
            )
            .toContain('()=>1');
          if (surface === 'GUI') {
            harness.environment = c;
            harness.cursor = 0;
            const tree = CodeDetails({
              task: goal.tasks[0],
              attemptId: goal.attempts[0].id,
            });
            button(tree, '请求取消').props.onClick();
            await harness.pending;
          } else {
            const answers = ['1', '1', '7', '1', '2', 'y', '0', '0'];
            await runMenu(request, {
              show() {},
              ask: async () => answers.shift() ?? '0',
            });
          }
        }
        await expect
          .poll(
            async () => {
              goal = await request(`/api/goals/${p.goalId}`);
              return goal.tasks[0].status;
            },
            { timeout: 10000 },
          )
          .toBe(cancelFirst ? 'interrupted' : 'failed');
        await app.close();
        app = buildApp(options);
        harness.states = [];
        const task = goal.tasks[0],
          attemptId = goal.attempts[0].id;
        const code = await request(`/api/tasks/${task.id}/code`);
        if (surface === 'GUI') {
          harness.environment = code;
          const render = () => {
            harness.cursor = 0;
            return CodeDetails({ task, attemptId });
          };
          let tree = render();
          expect(button(tree, '停止已确认进程').props.disabled).toBe(true);
          label(
            tree,
            '确认停止身份已核实的受管进程树（未知身份将拒绝）',
          ).props.onChange({ target: { checked: true } });
          tree = render();
          button(tree, '停止已确认进程').props.onClick();
          await harness.pending;
          tree = render();
          expect(button(tree, '创建新尝试').props.disabled).toBe(true);
          label(tree, '已审阅 diff 与文件清单，接受此固定快照').props.onChange({
            target: { checked: true },
          });
          tree = render();
          writeFileSync(
            join(code.workspace.path, 'sum.mjs'),
            'export const sum=()=>2;',
          );
          button(tree, '创建新尝试').props.onClick();
          await expect(harness.pending).rejects.toThrow('WORKSPACE_DRIFT');
          tree = render();
          button(tree, '核对进程与文件').props.onClick();
          await harness.pending;
          tree = render();
          expect(button(tree, '创建新尝试').props.disabled).toBe(true);
          label(tree, '已审阅 diff 与文件清单，接受此固定快照').props.onChange({
            target: { checked: true },
          });
          tree = render();
          button(tree, '创建新尝试').props.onClick();
          await harness.pending;
        } else {
          const output: unknown[] = [];
          for (const drift of [true, false]) {
            const answers = [
              '1',
              '1',
              '7',
              '1',
              '3',
              '2',
              'y',
              'y',
              'y',
              '0',
              '0',
            ];
            await runMenu(request, {
              show: (v) => output.push(v),
              ask: async (prompt) => {
                if (drift && prompt.includes('显式创建新尝试'))
                  writeFileSync(
                    join(code.workspace.path, 'sum.mjs'),
                    'export const sum=()=>2;',
                  );
                return answers.shift() ?? '0';
              },
            });
          }
          expect(
            output.some((v) => String(v).includes('WORKSPACE_DRIFT')),
          ).toBe(true);
        }
        await expect
          .poll(
            async () => {
              goal = await request(`/api/goals/${p.goalId}`);
              return goal.tasks[0].status;
            },
            { timeout: 10000 },
          )
          .toBe('completed');
        expect(goal.attempts).toHaveLength(2);
        expect(goal.verifications.at(-1).verdict).toBe('PASS');
        expect(goal.attempts[0].status).toBe(
          cancelFirst ? 'interrupted' : 'failed',
        );
      } finally {
        await app.close();
        rmSync(root, { recursive: true, force: true });
      }
    }, 30000);
}

for (const surface of ['GUI', 'CLI'] as const) {
  it.skipIf(!process.env.MERFORGE_REAL_CODEX)(
    `${surface} real Codex from interaction entry`,
    async () => {
      const root = mkdtempSync(join(tmpdir(), 'merforge-m31-real-'));
      const source = join(root, 'source');
      mkdirSync(source);
      await git(source, 'init', '-q');
      writeFileSync(join(source, 'sum.mjs'), 'export const sum=()=>0;\n');
      await git(source, 'add', '.');
      await git(
        source,
        '-c',
        'user.name=Test',
        '-c',
        'user.email=test@example.invalid',
        'commit',
        '-qm',
        'base',
      );
      const baseCommit = (await git(source, 'rev-parse', 'HEAD')).trim();
      const app = buildApp({
        databasePath: join(root, 'db'),
        runtimeOptions: {
          codex: {
            executable: process.env.MERFORGE_REAL_CODEX!,
            repositories: { sample: source },
            managedRoot: join(root, 'managed'),
            artifactRoot: join(root, 'evidence'),
            timeoutMs: 180000,
          },
        },
      });
      const request = async (url: string, payload?: unknown): Promise<any> => {
        const res = await app.inject({
          method: payload === undefined ? 'GET' : 'POST',
          url,
          ...(payload === undefined ? {} : { payload: payload as object }),
        });
        if (res.statusCode >= 400) throw Error(res.body);
        return res.json();
      };
      vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
        const res = await app.inject({
          method: init?.method === 'POST' ? 'POST' : 'GET',
          url,
          ...(init?.body ? { payload: JSON.parse(String(init.body)) } : {}),
        });
        return {
          ok: res.statusCode < 400,
          status: res.statusCode,
          json: async () => res.json(),
          text: async () => res.body,
        };
      });
      const instruction =
        'Implement sum(a,b) as a+b in sum.mjs. Change only sum.mjs. Do not create any other file. Do not launch background processes.';
      const assertion =
        "import {sum} from './sum.mjs';if(sum(2,3)!==5||sum(-2,1)!==-1)process.exit(1)";
      let goal: any;
      try {
        if (surface === 'CLI') {
          const answers = [
            '2',
            'M3.1 real CLI',
            '2',
            '1',
            'y',
            'Implement',
            'n',
            'Sum',
            instruction,
            'sum.mjs',
            'sum.mjs',
            '',
            'node',
            '--input-type=module',
            '-e',
            assertion,
            '',
            '.',
            'n',
            'n',
            'n',
            'y',
            '1',
            '1',
            '2',
            '1',
            '1',
            'local',
            '4',
            'y',
            '0',
            '0',
          ];
          const transcript: unknown[] = [];
          await runMenu(request, {
            show: (v) => transcript.push(v),
            ask: async (prompt) => {
              transcript.push(prompt);
              return answers.shift() ?? '0';
            },
          });
          writeFileSync(
            join(root, 'menu.json'),
            JSON.stringify(transcript, null, 2),
          );
        } else {
          harness.environment = await request('/api/environment');
          const render = () => {
            harness.cursor = 0;
            return ManualPlanCreate({ onCreated() {} });
          };
          let tree = render();
          for (const [name, value] of [
            ['目标', 'M3.1 real GUI'],
            ['计划类型', 'code'],
            ['仓库当前干净 HEAD', `sample:${baseCommit}`],
            ['阶段名称', 'Implement'],
            ['任务名称', 'Sum'],
            ['明确任务指令', instruction],
            ['预期文件（每行一个相对路径）', 'sum.mjs'],
            ['允许修改路径（每行一个）', 'sum.mjs'],
            ['独立验收程序（例如 node，不经 shell）', 'node'],
            [
              '验收参数（每行一个，保留空格，不加 shell 引号）',
              `--input-type=module\n-e\n${assertion}`,
            ],
          ]) {
            label(tree, name!).props.onChange({ target: { value } });
            tree = render();
          }
          nodes(tree)
            .find((n) => n.type === 'form')!
            .props.onSubmit({ preventDefault() {} });
          await harness.pending;
          const goals = await request('/api/goals');
          goal = await request(`/api/goals/${goals[0].id}`);
          harness.states = [];
          const controls = () => {
            harness.cursor = 0;
            return PlanControls({ plan: goal.plan });
          };
          tree = controls();
          button(tree, '批准 revision').props.onClick();
          await harness.pending;
          goal = await request(`/api/goals/${goal.id}`);
          tree = controls();
          button(tree, '加载当前版本').props.onClick();
          tree = controls();
          button(tree, '继续（').props.onClick();
          await harness.pending;
        }
        const goals = await request('/api/goals');
        expect(goals).toHaveLength(1);
        await expect
          .poll(
            async () => {
              goal = await request(`/api/goals/${goals[0].id}`);
              return ['completed', 'failed', 'interrupted'].includes(
                goal.tasks[0].status,
              );
            },
            { timeout: 210000, interval: 1000 },
          )
          .toBe(true);
        const code = await request(`/api/tasks/${goal.tasks[0].id}/code`);
        const evidence = [];
        for (const e of code.evidence)
          evidence.push({
            ...e,
            content: await request(
              `/api/tasks/${goal.tasks[0].id}/code/evidence/${e.id}`,
            ),
          });
        writeFileSync(
          join(root, 'result.json'),
          JSON.stringify(
            { surface, baseCommit, goal, code, evidence },
            null,
            2,
          ),
        );
        console.log(
          `M3.1_REAL_EVIDENCE ${surface} ${root}/result.json ${goal.tasks[0].status}`,
        );
        expect(goal.tasks[0].status).toBe('completed');
        expect(goal.verifications[0].verdict).toBe('PASS');
      } finally {
        await app.close();
      }
    },
    240000,
  );
}

for (const surface of ['GUI', 'CLI'] as const) {
  it(`${surface} three phase auto_until survives restart and requires explicit continuation`, async () => {
    const root = mkdtempSync(join(tmpdir(), 'merforge-boundary-'));
    let app = buildApp({ databasePath: join(root, 'db') });
    const request = async (url: string, payload?: unknown): Promise<any> => {
      const res = await app.inject({
        method: payload === undefined ? 'GET' : 'POST',
        url,
        ...(payload === undefined ? {} : { payload: payload as object }),
      });
      if (res.statusCode >= 400) throw Error(res.body);
      return res.json();
    };
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      const res = await app.inject({
        method: init?.method === 'POST' ? 'POST' : 'GET',
        url,
        ...(init?.body ? { payload: JSON.parse(String(init.body)) } : {}),
      });
      return {
        ok: res.statusCode < 400,
        status: res.statusCode,
        json: async () => res.json(),
        text: async () => res.body,
      };
    });
    const menu = async (answers: string[]) =>
      runMenu(request, { show() {}, ask: async () => answers.shift() ?? '0' });
    try {
      const p = await request('/api/plans', {
        objective: 'Three stages',
        revision: 1,
        definition: {
          schemaVersion: 'plan.v1',
          phases: [1, 2, 3].map((n) => ({
            title: `Phase ${n}`,
            requiresApproval: false,
            tasks: [
              {
                title: `Human ${n}`,
                executorId: 'human',
                acceptanceVersion: 'summary.v1',
              },
            ],
          })),
        },
      });
      let goal = await request(`/api/goals/${p.goalId}`);
      const controls = () => {
        harness.cursor = 0;
        return PlanControls({ plan: goal.plan });
      };
      if (surface === 'GUI') {
        let tree = controls();
        button(tree, '批准 revision').props.onClick();
        await harness.pending;
        goal = await request(`/api/goals/${p.goalId}`);
        tree = controls();
        button(tree, '加载当前版本').props.onClick();
        tree = controls();
        label(tree, '执行模式').props.onChange({
          target: { value: 'auto_until' },
        });
        tree = controls();
        label(tree, '终点（包含）').props.onChange({
          target: { value: p.phases[1].id },
        });
        tree = controls();
        button(tree, '保存模式').props.onClick();
        await harness.pending;
        goal = await request(`/api/goals/${p.goalId}`);
        tree = controls();
        button(tree, '加载当前版本').props.onClick();
        tree = controls();
        button(tree, '继续（').props.onClick();
        await harness.pending;
      } else
        await menu([
          '1',
          '1',
          '2',
          '1',
          '1',
          'local',
          '3',
          '3',
          '1',
          '2',
          '4',
          'y',
          '0',
          '0',
        ]);
      for (let n = 0; n < 2; n++) {
        await expect
          .poll(async () => {
            goal = await request(`/api/goals/${p.goalId}`);
            return goal.tasks[n].status;
          })
          .toBe('waiting_human');
        if (surface === 'GUI') {
          harness.states = [];
          const submission = () => {
            harness.cursor = 0;
            return HumanSubmission({
              taskId: goal.tasks[n].id,
              attemptId: goal.attempts
                .filter((a: any) => a.taskId === goal.tasks[n].id)
                .at(-1).id,
            });
          };
          let tree = submission();
          nodes(tree)
            .find((n) => n.type === 'textarea')!
            .props.onChange({ target: { value: 'done' } });
          tree = submission();
          nodes(tree)
            .find((n) => n.type === 'form')!
            .props.onSubmit({ preventDefault() {} });
          await harness.pending;
        } else
          await menu(['1', '1', '7', String(n + 1), '3', 'done', '0', '0']);
      }
      await expect
        .poll(async () => {
          goal = await request(`/api/goals/${p.goalId}`);
          return goal.plan.stopReason;
        })
        .toBe('boundary_reached');
      expect(goal.attempts).toHaveLength(2);
      expect(goal.tasks[2].status).toBe('ready');
      await app.close();
      app = buildApp({ databasePath: join(root, 'db') });
      goal = await request(`/api/goals/${p.goalId}`);
      expect(goal.attempts).toHaveLength(2);
      expect(goal.plan.mode).toBe('manual');
      expect(goal.plan.stopReason).toBe('boundary_reached');
      expect(goal.plan.authorized).toBe(false);
      if (surface === 'GUI') {
        harness.states = [];
        let tree = controls();
        nodes(tree)
          .filter(
            (n) => n.type === 'button' && n.props.children === '仅运行此阶段',
          )[2]!
          .props.onClick();
        await harness.pending;
      } else await menu(['1', '1', '5', '3', '0', '0']);
      goal = await request(`/api/goals/${p.goalId}`);
      expect(goal.attempts).toHaveLength(3);
      expect(goal.tasks[2].status).toBe('waiting_human');
      if (surface === 'GUI') {
        harness.states = [];
        const render = () => {
          harness.cursor = 0;
          return HumanSubmission({
            taskId: goal.tasks[2].id,
            attemptId: goal.attempts
              .filter((a: any) => a.taskId === goal.tasks[2].id)
              .at(-1).id,
          });
        };
        let tree = render();
        nodes(tree)
          .find((n) => n.type === 'textarea')!
          .props.onChange({ target: { value: 'last' } });
        tree = render();
        nodes(tree)
          .find((n) => n.type === 'form')!
          .props.onSubmit({ preventDefault() {} });
        await harness.pending;
      } else await menu(['1', '1', '7', '3', '3', 'last', '0', '0']);
      goal = await request(`/api/goals/${p.goalId}`);
      expect(goal.tasks.every((t: any) => t.status === 'completed')).toBe(true);
    } finally {
      await app.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
}
