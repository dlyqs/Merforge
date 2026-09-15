import { CodeDetails } from './CodeDetails';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Accepted, Attempt, Task } from '@merforge/contracts';
import { api } from './api';

export function TaskActions({
  task,
  attempts,
}: {
  task: Task;
  attempts: Attempt[];
}) {
  const client = useQueryClient();
  const [outcome, setOutcome] = useState<'success' | 'failure'>('success');
  const [delayMs, setDelayMs] = useState(0);
  const refresh = async (accepted: Accepted) => {
    await client.invalidateQueries({ queryKey: ['goal', accepted.goalId] });
  };
  const run = useMutation({ mutationFn: api.operate, onSuccess: refresh });
  const current = attempts.at(-1);
  const canStart = task.status === 'ready';
  const canRetry = task.status === 'failed' || task.status === 'interrupted';
  const state = {
    ready: '等待执行',
    running: task.executorId === 'codex' ? 'Codex 执行中' : '模拟执行中',
    waiting_human: '等待人工提交',
    verifying: '验证中',
    completed: '已完成',
    failed: '失败，可显式重试',
    interrupted: '执行中断，可显式重试',
  }[task.status];
  return (
    <div className="task-controls">
      <div className="task">
        <div>
          <strong>{task.title}</strong>
          <p>
            {task.executorId} · {state}
          </p>
          <p className="identifier">Task {task.id}</p>
          {task.phaseId && (
            <p className="identifier">
              Phase {task.phaseId} · 任务顺序 {task.position}
            </p>
          )}
        </div>
        {(canStart || (canRetry && task.executorId !== 'codex')) && (
          <button
            disabled={run.isPending}
            onClick={() =>
              run.mutate({
                taskId: task.id,
                operation: canRetry ? 'retry' : 'run',
                ...(task.executorId === 'mock'
                  ? { options: { outcome, delayMs } }
                  : {}),
              })
            }
          >
            {run.isPending
              ? '受理中…'
              : canRetry
                ? '创建新尝试'
                : task.executorId === 'mock'
                  ? '运行 Mock'
                  : task.executorId === 'codex'
                    ? '运行 Codex'
                    : '开始人工任务'}
          </button>
        )}
      </div>
      {task.executorId === 'mock' && (canStart || canRetry) && (
        <div className="input-row">
          <label>
            模拟结果{' '}
            <select
              value={outcome}
              onChange={(e) =>
                setOutcome(e.target.value as 'success' | 'failure')
              }
            >
              <option value="success">成功</option>
              <option value="failure">失败</option>
            </select>
          </label>
          <label>
            模拟延迟（毫秒）
            <input
              type="number"
              min={0}
              max={60000}
              step={1}
              value={delayMs}
              onChange={(e) => setDelayMs(Number(e.target.value))}
            />
          </label>
        </div>
      )}
      {run.error && (
        <p className="error" role="alert">
          Task {task.id}：{run.error.message}
        </p>
      )}
      {task.executorId === 'codex' && (
        <CodeDetails task={task} attemptId={current?.id} />
      )}
      {task.status === 'waiting_human' && current && (
        <HumanSubmission
          key={current.id}
          taskId={task.id}
          attemptId={current.id}
        />
      )}
    </div>
  );
}

export function HumanSubmission({
  taskId,
  attemptId,
}: {
  taskId: string;
  attemptId: string;
}) {
  const [text, setText] = useState('');
  const [advanced, setAdvanced] = useState(false);
  const [parseError, setParseError] = useState('');
  const client = useQueryClient();
  const submit = useMutation({
    mutationFn: api.submitHuman,
    onSuccess: async (accepted) => {
      await client.invalidateQueries({ queryKey: ['goal', accepted.goalId] });
    },
  });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        let artifact: unknown;
        try {
          artifact = advanced ? JSON.parse(text) : { summary: text.trim() };
          if (!advanced && !text.trim()) {
            setParseError('请填写非空 summary。');
            return;
          }
          setParseError('');
        } catch {
          setParseError('请输入有效 JSON。');
          return;
        }
        submit.mutate({ taskId, attemptId, artifact });
      }}
    >
      <p className="identifier">Attempt {attemptId}</p>
      <label>
        <input
          type="checkbox"
          checked={advanced}
          onChange={(e) => {
            setAdvanced(e.target.checked);
            setParseError('');
          }}
        />
        使用高级 JSON 输入（切换后请核对内容格式）
      </label>
      <label htmlFor={`artifact-${attemptId}`}>
        {advanced ? '高级人工产物 JSON' : '人工产物 summary（非空文字）'}
      </label>
      <textarea
        id={`artifact-${attemptId}`}
        rows={5}
        value={text}
        onChange={(e) => setText(e.target.value)}
        required
      />
      <button disabled={submit.isPending || submit.isSuccess}>
        {submit.isPending
          ? '提交中…'
          : submit.isSuccess
            ? '已受理，等待验证'
            : '提交并验证'}
      </button>
      {(parseError || submit.error) && (
        <p className="error" role="alert">
          Task {taskId} / Attempt {attemptId}：
          {parseError || submit.error?.message}
        </p>
      )}
    </form>
  );
}
