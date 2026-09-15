import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import {
  buildManualPlan,
  newPlanDraft,
  newTaskDraft,
  environmentSchema,
  goalListSchema,
  goalDetailSchema,
  planDetailSchema,
  codeDetailSchema,
  codeReconciliationSchema,
  type PlanDetail,
} from '@merforge/contracts';
type Request = (path: string, body?: unknown) => Promise<unknown>;
export interface MenuIO {
  ask: (prompt: string) => Promise<string>;
  show: (value: unknown) => void;
}
class Back extends Error {}
export async function runMenu(request: Request, io: MenuIO) {
  const ask = async (prompt: string) => {
    const answer = await io.ask(`${prompt}（/back 返回）: `);
    if (answer === '/back') throw new Back();
    return answer;
  };
  const choose = async <T>(
    label: string,
    items: T[],
    name: (v: T) => string,
  ): Promise<T> => {
    if (!items.length) throw new Error('暂无可选项');
    for (;;) {
      io.show(label);
      items.forEach((v, i) => io.show(`${i + 1}. ${name(v)}`));
      const n = await ask('选择编号，0 返回');
      if (n === '0') throw new Back();
      if (/^\d+$/.test(n) && items[Number(n) - 1] !== undefined)
        return items[Number(n) - 1]!;
      io.show('请输入列表中的编号');
    }
  };
  const yes = async (message: string) =>
    (await ask(`${message} [y/N]`)).toLowerCase() === 'y';
  const diagnostics = async () => {
    const env = environmentSchema.parse(await request('/api/environment'));
    io.show(env);
    return env;
  };
  const command = (p: PlanDetail, op: string, input: unknown) =>
    request(`/api/plans/${p.id}/${op}`, input);
  async function create() {
    const draft = newPlanDraft();
    draft.objective = await ask('目标');
    draft.kind = await choose('计划类型', ['example', 'code'] as const, (v) =>
      v === 'code' ? 'Codex 真实代码' : 'Mock / Human 示例',
    );
    if (draft.kind === 'code') {
      const env = await diagnostics();
      if (!env.codex.available) throw new Error(env.codex.message);
      const repo = await choose(
        '选择受控仓库与当前干净 HEAD',
        env.repositories.filter((r) => r.clean && r.baseCommit),
        (r) => `${r.key} · ${r.baseCommit}`,
      );
      draft.repositoryKey = repo.key;
      draft.baseCommit = repo.baseCommit!;
      if (!(await yes(`使用基线 ${repo.baseCommit}？`))) return;
    }
    draft.phases = [];
    do {
      const phase = {
        title: await ask('阶段名称'),
        requiresApproval: await yes('进入此阶段前需要审批？'),
        tasks: [] as ReturnType<typeof newTaskDraft>[],
      };
      do {
        const t = newTaskDraft();
        t.title = await ask('任务名称');
        if (draft.kind === 'example') {
          t.executorId = await choose(
            '执行方式（验收固定 summary.v1）',
            ['mock', 'human'] as const,
            (v) => v,
          );
        } else {
          t.instructions = await ask('明确任务指令');
          t.expectedFiles = (await ask('预期文件（逗号分隔相对路径）'))
            .split(',')
            .join('\n');
          t.allowedPaths = (await ask('允许修改路径（逗号分隔）'))
            .split(',')
            .join('\n');
          t.forbiddenPaths = (await ask('禁止修改路径（可空，逗号分隔）'))
            .split(',')
            .join('\n');
          t.command = await ask('独立验收程序（不经 shell，例如 node）');
          const args: string[] = [];
          let arg: string;
          while ((arg = await ask('添加一个验收参数（直接回车结束）')))
            args.push(arg);
          t.arguments = args.join('\n');
          t.cwd = (await ask('验收工作目录（回车为 .）')) || '.';
          t.allowEmptyDiff = await yes('允许空 diff？');
          io.show(
            '验收须可重复且独立；默认 60 秒、不允许额外输出文件；高级 JSON 可设置多个检查、受保护文件和输入摘要。',
          );
        }
        phase.tasks.push(t);
      } while (await yes('继续添加任务？'));
      draft.phases.push(phase);
    } while (await yes('继续添加阶段？'));
    const input = buildManualPlan(draft);
    io.show(input);
    if (await yes('确认创建待审阅计划（不会启动）？'))
      io.show(await request('/api/plans', input));
  }
  async function inspect() {
    const goal = await choose(
      '目标与计划',
      goalListSchema.parse(await request('/api/goals')),
      (g) => g.objective,
    );
    let detail = goalDetailSchema.parse(await request(`/api/goals/${goal.id}`));
    for (;;) {
      io.show(detail);
      const action = await choose(
        '目标操作',
        [
          '刷新',
          '审阅决定',
          '执行模式',
          '继续',
          '仅运行阶段',
          '请求阶段审批',
          '任务操作',
        ],
        (v) => v,
      );
      const p = detail.plan;
      if (action === '刷新') {
        detail = goalDetailSchema.parse(await request(`/api/goals/${goal.id}`));
        continue;
      }
      if (action === '任务操作') {
        const task = await choose(
          '选择任务',
          detail.tasks,
          (t) => `${t.title} · ${t.status}`,
        );
        if (task.executorId === 'codex') {
          const code = codeDetailSchema.parse(
            await request(`/api/tasks/${task.id}/code`),
          );
          io.show(code);
          const op = await choose(
            '代码任务',
            ['读取证据', '请求取消', '核对与创建新尝试'],
            (v) => v,
          );
          if (op === '读取证据') {
            const e = await choose(
              '选择证据',
              code.evidence,
              (e) => `${e.kind} · ${e.attemptId}`,
            );
            io.show(
              await request(`/api/tasks/${task.id}/code/evidence/${e.id}`),
            );
          } else if (op === '核对与创建新尝试') {
            const attempt = detail.attempts
              .filter((a) => a.taskId === task.id)
              .at(-1);
            if (!attempt) throw new Error('尚无旧尝试');
            io.show(
              '保留旧尝试；当前不支持同会话 resume。核对不会创建新尝试。',
            );
            const oldRun = code.runs.find((r) => r.attemptId === attempt.id);
            const oldEvidence =
              oldRun?.outputArtifactId ?? oldRun?.inputArtifactId;
            if (oldEvidence)
              io.show(
                await request(
                  `/api/tasks/${task.id}/code/evidence/${oldEvidence}`,
                ),
              );
            else
              io.show(
                '旧文件快照不可用；请核对具体阻塞原因，不能据此推断工作区安全。',
              );
            const operation = await choose(
              '恢复操作',
              ['仅核对进程与文件', '停止身份已确认的进程并核对'],
              (v) => v,
            );
            const stop = operation === '停止身份已确认的进程并核对';
            if (
              stop &&
              !(await yes('显式停止身份已确认的受管进程树？未知身份会拒绝'))
            )
              return;
            const report = codeReconciliationSchema.parse(
              await request(`/api/tasks/${task.id}/reconcile`, {
                attemptId: attempt.id,
                stop,
              }),
            );
            io.show(report);
            if (
              !(await yes('已审阅上述 diff、文件清单及固定快照，接受此快照？'))
            )
              continue;
            if (
              await yes(
                '显式创建新尝试（保留旧尝试；文件漂移或旧 revision 将拒绝）？',
              )
            )
              io.show(
                await request(`/api/tasks/${task.id}/retry-code`, {
                  attemptId: report.attemptId,
                  revision: code.package.revision,
                  snapshotHash: report.snapshotHash,
                }),
              );
          } else {
            const attempt = detail.attempts
              .filter((a) => a.taskId === task.id)
              .at(-1);
            if (
              attempt &&
              (await yes('请求取消当前尝试？请求受理不代表进程已停止'))
            )
              io.show(
                await request(
                  `/api/tasks/${task.id}/attempts/${attempt.id}/cancel`,
                  {},
                ),
              );
          }
        } else {
          const op = await choose(
            '任务操作',
            ['run', 'retry', 'submit'] as const,
            (v) =>
              ({ run: '运行', retry: '创建新尝试', submit: '提交 Human 产物' })[
                v
              ],
          );
          if (op === 'submit') {
            const attempt = detail.attempts
              .filter((a) => a.taskId === task.id)
              .at(-1);
            if (!attempt) throw new Error('尚无尝试，请先运行');
            io.show(
              await request(
                `/api/tasks/${task.id}/attempts/${attempt.id}/submit`,
                { artifact: { summary: await ask('人工产物 summary') } },
              ),
            );
          } else io.show(await request(`/api/tasks/${task.id}/${op}`, {}));
        }
      } else {
        if (!p) throw new Error('此目标没有串行计划');
        const current = planDetailSchema.parse(
          await request(`/api/plans/${p.id}`),
        );
        if (
          current.revision !== p.revision ||
          current.controlVersion !== p.controlVersion
        )
          throw new Error('版本已变化，请重新选择目标并审阅');
        if (action === '审阅决定') {
          io.show(p.revisions.find((r) => r.revision === p.revision));
          const approval = await choose(
            '待审批项',
            p.approvals.filter(
              (a) => a.revision === p.revision && a.decision === 'pending',
            ),
            (a) =>
              `${a.kind} · ${p.phases.find((f) => f.id === a.phaseId)?.title ?? '整个计划'}`,
          );
          const decision = await choose(
            '审阅决定（批准不会启动）',
            ['approved', 'rejected'] as const,
            (v) => v,
          );
          io.show(
            await command(p, `approvals/${approval.id}/decision`, {
              revision: p.revision,
              actor: (await ask('本地操作者标签')) || 'local',
              decision,
            }),
          );
        } else if (action === '执行模式') {
          const mode = await choose(
            '模式',
            ['manual', 'auto', 'auto_until'] as const,
            (v) => v,
          );
          const bounds =
            mode === 'auto_until'
              ? {
                  startPhaseId: (
                    await choose('起点（含）', p.phases, (f) => f.title)
                  ).id,
                  stopPhaseId: (
                    await choose('终点（含）', p.phases, (f) => f.title)
                  ).id,
                }
              : {};
          io.show(
            await command(p, 'mode', {
              revision: p.revision,
              controlVersion: p.controlVersion,
              mode,
              ...bounds,
            }),
          );
        } else if (action === '继续') {
          if (await yes('按保存的模式显式启动/继续？'))
            io.show(await command(p, 'continue', { revision: p.revision }));
        } else {
          const phase = await choose(
            '选择阶段',
            p.phases,
            (f) => `${f.title} · ${f.status}`,
          );
          io.show(
            await command(
              p,
              action === '仅运行阶段'
                ? 'continue'
                : `phases/${phase.id}/approval`,
              {
                revision: p.revision,
                ...(action === '仅运行阶段' ? { phaseId: phase.id } : {}),
              },
            ),
          );
        }
      }
      // Refresh only after the user's action; never replace an in-progress review.
      detail = goalDetailSchema.parse(await request(`/api/goals/${goal.id}`));
    }
  }
  io.show(
    'Merforge 菜单 · Mock/Human 示例 / Codex 真实执行；超时不表示服务端已撤销。',
  );
  for (;;) {
    try {
      const choice = await ask(
        '主菜单 1 目标与计划 / 2 新建手工计划 / 3 环境诊断 / 0 退出',
      );
      if (choice === '0') return;
      if (choice === '1') await inspect();
      else if (choice === '2') await create();
      else if (choice === '3') await diagnostics();
      else io.show('请选择 0–3');
    } catch (error) {
      if (!(error instanceof Back)) {
        if (error instanceof Error && error.message === 'MENU_CLOSED') return;
        io.show(error instanceof Error ? error.message : String(error));
        io.show(
          '服务不可用时，请在项目目录运行 pnpm dev；代码配置参见 README。',
        );
      }
    }
  }
}
export async function interactiveMenu(request: Request) {
  if (!stdin.isTTY || !stdout.isTTY)
    throw new Error('menu 需要交互式 TTY；脚本请使用原子子命令或 --help');
  const rl = createInterface({ input: stdin, output: stdout });
  let closed = false;
  const abort = new AbortController();
  rl.on('close', () => {
    closed = true;
    abort.abort();
  });
  rl.on('SIGINT', () => rl.close());
  try {
    await runMenu(request, {
      ask: async (prompt) => {
        if (closed) throw new Error('MENU_CLOSED');
        try {
          return await rl.question(prompt, { signal: abort.signal });
        } catch {
          throw new Error('MENU_CLOSED');
        }
      },
      show: (v) =>
        console.log(typeof v === 'string' ? v : JSON.stringify(v, null, 2)),
    });
  } finally {
    rl.close();
  }
}
