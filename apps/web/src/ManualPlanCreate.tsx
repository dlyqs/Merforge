import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  buildManualPlan,
  newPlanDraft,
  newTaskDraft,
  type TaskDraft,
} from '@merforge/contracts';
import { api } from './api';

export function ManualPlanCreate({
  onCreated,
}: {
  onCreated: (id: string) => void;
}) {
  const [draft, setDraft] = useState(newPlanDraft);
  const env = useQuery({
    queryKey: ['environment'],
    queryFn: api.environment,
    refetchInterval: false,
  });
  const client = useQueryClient();
  const create = useMutation({
    mutationFn: () => api.createPlan(buildManualPlan(draft)),
    onSuccess: async (p) => {
      onCreated(p.goalId);
      setDraft(newPlanDraft());
      await client.invalidateQueries({ queryKey: ['goals'] });
    },
  });
  const code = draft.kind === 'code';
  const repo = env.data?.repositories.find(
    (r) =>
      r.key === draft.repositoryKey &&
      r.baseCommit === draft.baseCommit &&
      r.clean,
  );
  const updateTask = (pi: number, ti: number, patch: Partial<TaskDraft>) =>
    setDraft((d) => ({
      ...d,
      phases: d.phases.map((p, i) =>
        i === pi
          ? {
              ...p,
              tasks: p.tasks.map((t, j) => (j === ti ? { ...t, ...patch } : t)),
            }
          : p,
      ),
    }));
  return (
    <section className="panel" aria-label="手工计划编辑器">
      <h2>新建手工计划</h2>
      <p>自行定义任务与验收；不调用 LLM 规划。创建后先审阅，再显式启动。</p>
      <p role="status">
        {env.isPending
          ? '正在检测本地服务…'
          : env.error
            ? '本地服务不可用：请在项目目录运行 pnpm dev，再重试连接。'
            : `已连接 · ${env.data?.codex.message}`}
      </p>
      <p>{env.data?.guidance}</p>
      <button
        type="button"
        className="secondary"
        onClick={() => void env.refetch()}
      >
        刷新环境诊断
      </button>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <label>
          目标
          <input
            required
            maxLength={2000}
            value={draft.objective}
            onChange={(e) => setDraft({ ...draft, objective: e.target.value })}
          />
        </label>
        <label>
          计划类型
          <select
            value={draft.kind}
            onChange={(e) =>
              setDraft({ ...draft, kind: e.target.value as typeof draft.kind })
            }
          >
            <option value="example">Mock / Human · 示例</option>
            <option value="code">Codex · 真实代码</option>
          </select>
        </label>
        {code && (
          <fieldset>
            <legend>受控仓库与明确基线</legend>
            <label>
              仓库当前干净 HEAD
              <select
                required
                value={
                  draft.repositoryKey
                    ? `${draft.repositoryKey}:${draft.baseCommit}`
                    : ''
                }
                onChange={(e) => {
                  const [repositoryKey = '', baseCommit = ''] =
                    e.target.value.split(':');
                  setDraft({ ...draft, repositoryKey, baseCommit });
                }}
              >
                <option value="">请选择仓库与基线</option>
                {env.data?.repositories.map((r) => (
                  <option
                    key={r.key}
                    disabled={!r.clean || !r.baseCommit}
                    value={`${r.key}:${r.baseCommit}`}
                  >
                    {r.key} · {r.baseCommit ?? '无基线'} · {r.message}
                  </option>
                ))}
              </select>
            </label>
            <p>
              已选择基线：{draft.baseCommit || '尚未选择'}
              。刷新环境不会自动替换已选择基线。
            </p>
            <p>
              执行策略：受管工作区、禁止网络及后台进程。认证仅由本机 Codex
              管理。
            </p>
          </fieldset>
        )}
        {draft.phases.map((phase, pi) => (
          <fieldset key={pi}>
            <legend>阶段 {pi + 1}</legend>
            <label>
              阶段名称
              <input
                required
                value={phase.title}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    phases: draft.phases.map((p, i) =>
                      i === pi ? { ...p, title: e.target.value } : p,
                    ),
                  })
                }
              />
            </label>
            <label>
              <input
                type="checkbox"
                checked={phase.requiresApproval}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    phases: draft.phases.map((p, i) =>
                      i === pi
                        ? { ...p, requiresApproval: e.target.checked }
                        : p,
                    ),
                  })
                }
              />
              进入阶段前审批
            </label>
            {phase.tasks.map((task, ti) => (
              <fieldset key={ti}>
                <legend>任务 {ti + 1}</legend>
                <label>
                  任务名称
                  <input
                    required
                    value={task.title}
                    onChange={(e) =>
                      updateTask(pi, ti, { title: e.target.value })
                    }
                  />
                </label>
                {!code ? (
                  <>
                    <label>
                      执行方式
                      <select
                        value={task.executorId}
                        onChange={(e) =>
                          updateTask(pi, ti, {
                            executorId: e.target
                              .value as TaskDraft['executorId'],
                          })
                        }
                      >
                        <option value="mock">Mock · 模拟</option>
                        <option value="human">Human · 人工提交</option>
                      </select>
                    </label>
                    <p>
                      固定验收 summary.v1：非空 summary；PASS 仅证明结构合格。
                    </p>
                  </>
                ) : (
                  <>
                    {(
                      [
                        ['instructions', '明确任务指令'],
                        ['expectedFiles', '预期文件（每行一个相对路径）'],
                        ['allowedPaths', '允许修改路径（每行一个）'],
                        ['forbiddenPaths', '禁止修改路径（可空）'],
                        ['command', '独立验收程序（例如 node，不经 shell）'],
                        [
                          'arguments',
                          '验收参数（每行一个，保留空格，不加 shell 引号）',
                        ],
                        ['cwd', '验收工作目录'],
                      ] as const
                    ).map(([key, label]) => (
                      <label key={key}>
                        {label}
                        <textarea
                          required={
                            !['forbiddenPaths', 'arguments'].includes(key)
                          }
                          rows={key === 'instructions' ? 4 : 2}
                          value={task[key]}
                          onChange={(e) =>
                            updateTask(pi, ti, { [key]: e.target.value })
                          }
                        />
                      </label>
                    ))}
                    <label>
                      <input
                        type="checkbox"
                        checked={task.allowEmptyDiff}
                        onChange={(e) =>
                          updateTask(pi, ti, {
                            allowEmptyDiff: e.target.checked,
                          })
                        }
                      />
                      允许空 diff
                    </label>
                    <p>
                      验收须独立、可重复；默认超时 60 秒、输出上限 1
                      MiB、不允许验收额外输出文件。高级 JSON
                      支持多检查、受保护文件及输入摘要。
                    </p>
                  </>
                )}
                <button
                  type="button"
                  className="secondary"
                  disabled={phase.tasks.length === 1}
                  onClick={() =>
                    setDraft({
                      ...draft,
                      phases: draft.phases.map((p, i) =>
                        i === pi
                          ? { ...p, tasks: p.tasks.filter((_, j) => j !== ti) }
                          : p,
                      ),
                    })
                  }
                >
                  删除任务
                </button>
              </fieldset>
            ))}
            <button
              type="button"
              onClick={() =>
                setDraft({
                  ...draft,
                  phases: draft.phases.map((p, i) =>
                    i === pi
                      ? { ...p, tasks: [...p.tasks, newTaskDraft()] }
                      : p,
                  ),
                })
              }
            >
              添加任务
            </button>
            <button
              type="button"
              className="secondary"
              disabled={draft.phases.length === 1}
              onClick={() =>
                setDraft({
                  ...draft,
                  phases: draft.phases.filter((_, i) => i !== pi),
                })
              }
            >
              删除阶段
            </button>
          </fieldset>
        ))}
        <button
          type="button"
          onClick={() =>
            setDraft({
              ...draft,
              phases: [
                ...draft.phases,
                { title: '', requiresApproval: false, tasks: [newTaskDraft()] },
              ],
            })
          }
        >
          添加阶段
        </button>
        <button
          disabled={
            create.isPending || (code && (!repo || !env.data?.codex.available))
          }
        >
          创建待审阅计划（不启动）
        </button>
        {create.error && <p role="alert">{create.error.message}</p>}
      </form>
    </section>
  );
}
