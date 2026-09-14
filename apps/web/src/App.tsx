import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import { TaskActions } from './TaskActions';
import { PlanCreate, PlanControls } from './PlanControls';

export function App() {
  const [objective, setObjective] = useState('');
  const [executorId, setExecutorId] = useState<'mock' | 'human'>('mock');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const client = useQueryClient();
  const goals = useQuery({ queryKey: ['goals'], queryFn: api.listGoals });
  const activeId = selectedId ?? goals.data?.[0]?.id;
  const detail = useQuery({
    queryKey: ['goal', activeId],
    queryFn: () => api.getGoal(activeId!),
    enabled: Boolean(activeId),
  });
  const create = useMutation({
    mutationFn: api.createGoal,
    onSuccess: async (goal) => {
      setSelectedId(goal.id);
      setObjective('');
      client.setQueryData(['goal', goal.id], goal);
      await client.invalidateQueries({ queryKey: ['goals'] });
    },
  });
  function submit(event: FormEvent) {
    event.preventDefault();
    if (objective.trim())
      create.mutate({ objective: objective.trim(), executorId });
  }
  const error = create.error ?? goals.error ?? detail.error;
  return (
    <div className="shell">
      <header>
        <a className="brand" href="/">
          Merforge<span>LOCAL PROTOTYPE / 0.1</span>
        </a>
        <span className="mode">Mock / Human</span>
      </header>
      <main>
        <section className="intro">
          <p className="eyebrow">BRING YOUR AGENT. KEEP YOUR WORKFLOW.</p>
          <h1>让目标成为可追踪的工作。</h1>
          <p>
            从一个目标开始，查看任务、执行记录与证据。当前原型仅模拟执行，不调用
            AI，也不修改业务代码。
          </p>
        </section>
        <form className="create" onSubmit={submit}>
          <label htmlFor="objective">新建目标</label>
          <label htmlFor="executor">执行方式</label>
          <select
            id="executor"
            value={executorId}
            onChange={(e) => setExecutorId(e.target.value as 'mock' | 'human')}
          >
            <option value="mock">Mock · 模拟执行</option>
            <option value="human">Human · 人工提交</option>
          </select>
          <div className="input-row">
            <input
              id="objective"
              value={objective}
              onChange={(e) => setObjective(e.target.value)}
              placeholder="例如：梳理退款流程的 AI 改造方案"
              maxLength={2000}
              required
            />
            <button disabled={create.isPending || !objective.trim()}>
              {create.isPending ? '创建中…' : '创建目标'}
            </button>
          </div>
        </form>
        <PlanCreate onCreated={setSelectedId} />
        {error && (
          <p role="alert" className="error">
            {error.message}
            <button
              className="secondary"
              onClick={() => {
                create.reset();
                void client.invalidateQueries();
              }}
            >
              重试加载
            </button>
          </p>
        )}
        <div className="workspace">
          <aside className="panel">
            <div className="panel-heading">
              <h2>目标</h2>
              <span>{goals.data?.length ?? 0}</span>
            </div>
            {goals.isPending && <p className="muted">正在连接运行时…</p>}
            {goals.data?.length === 0 && (
              <p className="muted">尚无目标。创建第一个目标以开始。</p>
            )}
            <nav aria-label="目标列表">
              {goals.data?.map((goal) => (
                <button
                  key={goal.id}
                  className={`goal ${activeId === goal.id ? 'active' : ''}`}
                  aria-current={activeId === goal.id ? 'true' : undefined}
                  onClick={() => {
                    setSelectedId(goal.id);
                  }}
                >
                  <strong>{goal.objective}</strong>
                  <small>{new Date(goal.createdAt).toLocaleString()}</small>
                </button>
              ))}
            </nav>
          </aside>
          <section className="panel detail" aria-label="目标详情">
            {!activeId && (
              <div className="empty">
                <h2>工作从这里展开</h2>
                <p>Goal → Task → Attempt → Verification</p>
                <p className="muted">任务与执行记录保存在本地 SQLite 中。</p>
              </div>
            )}
            {activeId && detail.isPending && (
              <p className="muted">加载目标详情…</p>
            )}
            {detail.data && (
              <>
                <p className="eyebrow">GOAL</p>
                <h2 className="objective">{detail.data.objective}</h2>
                <p className="identifier">{detail.data.id}</p>
                {detail.data.plan && (
                  <PlanControls
                    key={detail.data.plan.id}
                    plan={detail.data.plan}
                  />
                )}
                <h3>任务（包含历史修订；阶段 ID 见任务记录）</h3>
                {detail.data.tasks.map((task) => (
                  <TaskActions
                    key={task.id}
                    task={task}
                    attempts={detail.data.attempts.filter(
                      (a) => a.taskId === task.id,
                    )}
                  />
                ))}
                <h3>尝试历史</h3>
                {detail.data.attempts.length === 0 && (
                  <p className="muted">尚无尝试。旧版模拟记录见下方。</p>
                )}
                {detail.data.attempts.map((attempt) => (
                  <article className="evidence" key={attempt.id}>
                    <strong>
                      #{attempt.sequence} ·{' '}
                      {attempt.executorId === 'mock'
                        ? 'MOCK 模拟'
                        : attempt.executorId === 'codex'
                          ? 'CODEX 真实执行'
                          : 'HUMAN 人工'}{' '}
                      · {attempt.status}
                    </strong>
                    <p className="identifier">
                      Task {attempt.taskId}
                      <br />
                      Attempt {attempt.id}
                    </p>
                    <p>
                      开始：{new Date(attempt.startedAt).toLocaleString()} ·
                      结束：
                      {attempt.endedAt
                        ? new Date(attempt.endedAt).toLocaleString()
                        : '—'}
                    </p>
                    {attempt.error && <p className="error">{attempt.error}</p>}
                    {detail
                      .data!.artifacts.filter((a) => a.attemptId === attempt.id)
                      .map((a) => (
                        <details key={a.id}>
                          <summary>
                            提交产物 · {a.kind === 'mock' ? '模拟' : '人工'}
                          </summary>
                          <pre>{JSON.stringify(a.payload, null, 2)}</pre>
                        </details>
                      ))}
                    {detail
                      .data!.verifications.filter(
                        (v) => v.attemptId === attempt.id,
                      )
                      .map((v) => (
                        <p key={v.id}>
                          验证：{v.verdict} · {v.acceptanceVersion}
                          <br />
                          {v.reasons.join(' · ')}
                        </p>
                      ))}
                  </article>
                ))}
                <p className="muted">
                  PASS 仅表示 summary.v1 提交结构合格，不证明业务结果正确。
                </p>
                <h3>
                  执行记录{' '}
                  <span className="count">{detail.data.runs.length}</span>
                </h3>
                {detail.data.runs.length === 0 && (
                  <p className="muted">尚无执行记录。</p>
                )}
                {detail.data.runs.map((item) => (
                  <p key={item.id} className="identifier">
                    mock / {item.id}
                  </p>
                ))}
                <h3>证据</h3>
                {detail.data.evidence.length === 0 && (
                  <p className="muted">运行 Mock 后生成链路验证记录。</p>
                )}
                {detail.data.evidence.map((item) => (
                  <div className="evidence" key={item.id}>
                    <strong>MOCK · 仅用于原型验证</strong>
                    <p>{item.summary}</p>
                  </div>
                ))}
                <h3>事件</h3>
                <ol className="events">
                  {detail.data.events.map((event) => (
                    <li key={event.id}>
                      <span>{event.type}</span>
                      <time>
                        {new Date(event.createdAt).toLocaleTimeString()}
                      </time>
                    </li>
                  ))}
                </ol>
              </>
            )}
          </section>
        </div>
      </main>
      <footer>Merforge · 本地运行 · 数据保存在 .merforge/runtime.sqlite</footer>
    </div>
  );
}
