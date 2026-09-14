import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { Task } from '@merforge/contracts';
import { api } from './api';
export function CodeDetails({
  task,
  attemptId,
}: {
  task: Task;
  attemptId: string | undefined;
}) {
  const client = useQueryClient();
  const detail = useQuery({
    queryKey: ['code', task.id],
    queryFn: () => api.codeDetail(task.id),
    refetchInterval: 5000,
  });
  const [evidenceId, setEvidenceId] = useState('');
  const evidence = useQuery({
    queryKey: ['code-evidence', task.id, evidenceId],
    queryFn: () => api.codeEvidence(task.id, evidenceId),
    enabled: !!evidenceId,
  });
  const cancel = useMutation({
    mutationFn: () => api.cancelCode(task.id, attemptId!),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['goal', task.goalId] });
    },
  });
  return (
    <section>
      <p>CODEX 真实执行 · commands.v1 独立命令验收</p>
      {detail.error && <p role="alert">{detail.error.message}</p>}
      {detail.data && (
        <>
          <p className="identifier">
            工作区：{detail.data.workspace.path ?? '尚未创建'} ·{' '}
            {detail.data.workspace.state}
            <br />
            基线：{detail.data.workspace.baseCommit}
          </p>
          {detail.data.runs.map((run) => (
            <p className="identifier" key={run.attemptId}>
              Attempt {run.attemptId}
              <br />
              会话 {run.sessionId ?? '尚无'} · {run.errorCode ?? '无执行错误'} ·{' '}
              {run.stoppedAt ? '进程已停止' : '停止未确认'}
            </p>
          ))}
          <label>
            证据{' '}
            <select
              value={evidenceId}
              onChange={(e) => setEvidenceId(e.target.value)}
            >
              <option value="">选择证据</option>
              {detail.data.evidence.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.kind} · {e.id}
                </option>
              ))}
            </select>
          </label>
          {evidence.error && <p role="alert">{evidence.error.message}</p>}
          {evidence.data !== undefined && (
            <pre>{JSON.stringify(evidence.data, null, 2)}</pre>
          )}
        </>
      )}
      {attemptId && ['running', 'verifying'].includes(task.status) && (
        <button disabled={cancel.isPending} onClick={() => cancel.mutate()}>
          请求取消
        </button>
      )}
      {cancel.error && <p role="alert">{cancel.error.message}</p>}
      {['failed', 'interrupted'].includes(task.status) && (
        <p>
          请通过 CLI reconcile 核对进程与文件，再用 retry-code 和核对快照 hash
          显式重试。保留旧尝试；当前不支持同会话恢复。
        </p>
      )}
    </section>
  );
}
