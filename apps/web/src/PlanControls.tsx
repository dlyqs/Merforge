import { PlanSummary } from './PlanSummary';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  createPlanSchema,
  revisePlanSchema,
  modeCommandSchema,
  type PlanDetail,
} from '@merforge/contracts';
import { api } from './api';
import { reviewDecision } from './plan-review';

const example = JSON.stringify(
  {
    objective: '串行演示',
    revision: 1,
    definition: {
      schemaVersion: 'plan.v1',
      phases: [
        {
          title: '第一阶段',
          requiresApproval: false,
          tasks: [
            {
              title: '模拟任务',
              executorId: 'mock',
              acceptanceVersion: 'summary.v1',
            },
          ],
        },
      ],
    },
  },
  null,
  2,
);
export function PlanCreate({ onCreated }: { onCreated: (id: string) => void }) {
  const [text, setText] = useState(example);
  const client = useQueryClient();
  const create = useMutation({
    mutationFn: async () =>
      api.createPlan(createPlanSchema.parse(JSON.parse(text))),
    onSuccess: async (p) => {
      onCreated(p.goalId);
      await client.invalidateQueries();
    },
  });
  return (
    <details className="panel">
      <summary>高级入口：新建串行计划（JSON）</summary>
      <label htmlFor="plan-create">目标、阶段、任务及验收版本</label>
      <textarea
        id="plan-create"
        rows={12}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <button disabled={create.isPending} onClick={() => create.mutate()}>
        校验并创建待审阅计划
      </button>
      {create.error && (
        <p role="alert" className="error">
          {create.error.message}
        </p>
      )}
    </details>
  );
}

export function PlanControls({ plan }: { plan: PlanDetail }) {
  // The review snapshot is deliberately pinned; polling never advances the decision target.
  const [snapshot, setSnapshot] = useState(plan);
  const [actor, setActor] = useState('local');
  const [mode, setMode] = useState<'manual' | 'auto' | 'auto_until'>(plan.mode);
  const [start, setStart] = useState('');
  const [stop, setStop] = useState('');
  const [definition, setDefinition] = useState(
    JSON.stringify(snapshot.revisions.at(-1)!.definition, null, 2),
  );
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: async ({
      operation,
      input,
    }: {
      operation: string;
      input: unknown;
    }) => api.planCommand({ id: plan.id, operation, input }),
    onSuccess: async () => {
      await client.invalidateQueries();
    },
  });
  const revision = snapshot.revision;
  const stale =
    revision !== plan.revision ||
    snapshot.controlVersion !== plan.controlVersion;
  const disabled = mutation.isPending || stale;
  const send = (operation: string, input: unknown) =>
    mutation.mutate({ operation, input });
  const [inputError, setInputError] = useState<string | null>(null);
  function validated(action: () => void) {
    try {
      setInputError(null);
      action();
    } catch (e) {
      setInputError(e instanceof Error ? e.message : String(e));
    }
  }
  return (
    <section aria-label="计划控制">
      <h3>
        串行计划 · revision {plan.revision} · {plan.status}
      </h3>
      <p>
        审阅：{plan.review} · 模式：{plan.mode} · 授权：
        {plan.authorized ? '已启动' : '等待显式启动'}
      </p>
      <p>
        停止原因：{plan.stopReason ?? '—'} · 控制版本：{plan.controlVersion}
      </p>
      <p>
        范围：{plan.startPhaseId ?? '—'} → {plan.stopPhaseId ?? '—'} ·
        本次阶段限制：{plan.limitPhaseId ?? '—'}
      </p>
      {stale && (
        <p role="alert">计划版本已变化。请加载并重新阅读新版本后再操作。</p>
      )}
      <button
        className="secondary"
        onClick={() => {
          setSnapshot(plan);
          setMode(plan.mode);
          setStart(plan.startPhaseId ?? '');
          setStop(plan.stopPhaseId ?? '');
          setDefinition(
            JSON.stringify(plan.revisions.at(-1)!.definition, null, 2),
          );
        }}
      >
        加载当前版本供审阅
      </button>
      <details open>
        <summary>正在审阅 revision {revision}</summary>
        <PlanSummary
          definition={
            snapshot.revisions.find((r) => r.revision === revision)!.definition
          }
        />
      </details>
      <label>
        本地操作者标签（非认证身份）
        <input
          value={actor}
          onChange={(e) => setActor(e.target.value)}
          maxLength={100}
        />
      </label>
      <p>批准只代表审阅决定；首次执行仍需“继续”。Human 产物提交独立于审批。</p>
      {plan.approvals.map((a) => (
        <article className="evidence" key={a.id}>
          <p>
            {a.kind} · revision {a.revision} · {a.phaseId ?? '整个计划'} ·{' '}
            {a.decision} · {a.actor ?? '—'}
          </p>
          {a.decision === 'pending' && a.revision === revision && (
            <>
              <button
                disabled={disabled || !actor.trim()}
                onClick={() =>
                  validated(() =>
                    send(
                      `approvals/${a.id}/decision`,
                      reviewDecision(snapshot, plan, a.id, actor, 'approved'),
                    ),
                  )
                }
              >
                批准 revision {revision}
              </button>
              <button
                className="secondary"
                disabled={disabled || !actor.trim()}
                onClick={() =>
                  validated(() =>
                    send(
                      `approvals/${a.id}/decision`,
                      reviewDecision(snapshot, plan, a.id, actor, 'rejected'),
                    ),
                  )
                }
              >
                拒绝
              </button>
            </>
          )}
        </article>
      ))}
      <ol>
        {plan.phases.map((f) => (
          <li key={f.id}>
            <strong>
              {f.position}. {f.title} · {f.status}
            </strong>
            <p className="identifier">{f.id}</p>
            <button
              disabled={disabled}
              onClick={() => send('continue', { revision, phaseId: f.id })}
            >
              仅运行此阶段
            </button>
            {f.requiresApproval && (
              <button
                className="secondary"
                disabled={disabled}
                onClick={() => send(`phases/${f.id}/approval`, { revision })}
              >
                请求阶段审批
              </button>
            )}
          </li>
        ))}
      </ol>
      <button
        disabled={disabled}
        onClick={() => send('continue', { revision })}
      >
        继续（按保存模式执行）
      </button>
      <label>
        执行模式
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value as typeof mode)}
        >
          <option>manual</option>
          <option>auto</option>
          <option>auto_until</option>
        </select>
      </label>
      {mode === 'auto_until' && (
        <>
          <label>
            起点（包含）
            <select value={start} onChange={(e) => setStart(e.target.value)}>
              <option value="">首个未完成阶段</option>
              {plan.phases.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.position}. {f.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            终点（包含）
            <select value={stop} onChange={(e) => setStop(e.target.value)}>
              <option value="">请选择终点</option>
              {plan.phases.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.position}. {f.title}
                </option>
              ))}
            </select>
          </label>
        </>
      )}
      <button
        disabled={disabled}
        onClick={() =>
          validated(() =>
            send(
              'mode',
              modeCommandSchema.parse({
                revision,
                controlVersion: snapshot.controlVersion,
                mode,
                ...(mode === 'auto_until'
                  ? {
                      stopPhaseId: stop,
                      ...(start ? { startPhaseId: start } : {}),
                    }
                  : {}),
              }),
            ),
          )
        }
      >
        保存模式（不授予初次执行权）
      </button>
      <details>
        <summary>提交新修订（仅在从未执行时可用）</summary>
        <label htmlFor="plan-revise">PlanDefinition JSON</label>
        <textarea
          id="plan-revise"
          rows={12}
          value={definition}
          onChange={(e) => setDefinition(e.target.value)}
        />
        <button
          disabled={disabled}
          onClick={() =>
            validated(() =>
              send(
                'revisions',
                revisePlanSchema.parse({
                  revision,
                  definition: JSON.parse(definition),
                }),
              ),
            )
          }
        >
          提交新版本并重新审阅
        </button>
      </details>
      {(mutation.error || inputError) && (
        <p role="alert" className="error">
          {mutation.error?.message ?? inputError}
        </p>
      )}
      <p className="muted">
        任务的运行/重试仍由服务端核对审批、先后顺序和停止范围；下方显示具体拒绝原因。Mock
        为模拟执行，PASS 只检查 summary.v1 结构。
      </p>
    </section>
  );
}
