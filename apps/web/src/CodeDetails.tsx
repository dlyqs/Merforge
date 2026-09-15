import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { Task, CodeReconciliation } from '@merforge/contracts';
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
  const [report, setReport] = useState<
    (CodeReconciliation & { revision: number }) | null
  >(null);
  const [accepted, setAccepted] = useState(false);
  const [stopConfirmed, setStopConfirmed] = useState(false);
  const reconcile = useMutation({
    mutationFn: async (stop: boolean) => {
      setReport(null);
      setAccepted(false);
      setStopConfirmed(false);
      const revision = detail.data!.package.revision;
      return {
        ...(await api.reconcileCode(task.id, attemptId!, stop)),
        revision,
      };
    },
    onSuccess: async (value) => {
      setReport(value);
    },
  });
  const retry = useMutation({
    mutationFn: () =>
      api.retryCode(task.id, {
        attemptId: report!.attemptId,
        revision: report!.revision,
        snapshotHash: report!.snapshotHash,
      }),
    onSuccess: async () => {
      setReport(null);
      setAccepted(false);
      await client.invalidateQueries({ queryKey: ['goal', task.goalId] });
      await client.invalidateQueries({ queryKey: ['code', task.id] });
    },
  });
  const currentReport =
    report?.attemptId === attemptId && report?.taskId === task.id;
  const busy = reconcile.isPending || retry.isPending;
  const [evidenceId, setEvidenceId] = useState('');
  const selectedEvidenceId =
    evidenceId ||
    detail.data?.runs.at(-1)?.outputArtifactId ||
    detail.data?.runs.at(-1)?.inputArtifactId ||
    '';
  const evidence = useQuery({
    queryKey: ['code-evidence', task.id, selectedEvidenceId],
    queryFn: () => api.codeEvidence(task.id, selectedEvidenceId),
    enabled: !!selectedEvidenceId,
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
              value={selectedEvidenceId}
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
      <p>取消受理或请求超时不代表进程已停止；核对会显示具体阻塞原因。</p>
      {cancel.isSuccess && <p>取消请求已受理，请刷新并核对停止状态。</p>}
      {cancel.error && <p role="alert">{cancel.error.message}</p>}
      {['failed', 'interrupted'].includes(task.status) && (
        <div>
          <p>
            保留旧尝试；同会话 resume 不支持。先核对进程、文件和
            diff，再接受固定快照，最后显式创建新尝试。
          </p>
          <button
            disabled={busy || !attemptId || !detail.data}
            onClick={() => reconcile.mutate(false)}
          >
            核对进程与文件
          </button>
          <label>
            <input
              type="checkbox"
              checked={stopConfirmed}
              onChange={(e) => setStopConfirmed(e.target.checked)}
            />
            确认停止身份已核实的受管进程树（未知身份将拒绝）
          </label>
          <button
            disabled={busy || !stopConfirmed || !attemptId || !detail.data}
            onClick={() => reconcile.mutate(true)}
          >
            停止已确认进程并核对
          </button>
          {reconcile.error && (
            <p role="alert">核对阻塞：{reconcile.error.message}</p>
          )}
          {currentReport && report && (
            <>
              <p>
                固定 revision {report.revision} · 进程已停止 · 快照{' '}
                {report.snapshotHash ?? '工作区尚未创建'}
              </p>
              <pre>{JSON.stringify(report, null, 2)}</pre>
              <label>
                <input
                  type="checkbox"
                  checked={accepted}
                  onChange={(e) => setAccepted(e.target.checked)}
                />
                已审阅 diff 与文件清单，接受此固定快照
              </label>
              <button
                disabled={busy || !accepted}
                onClick={() => retry.mutate()}
              >
                创建新尝试
              </button>
            </>
          )}
          {retry.error && (
            <p role="alert">
              重试被拒绝：{retry.error.message}；请重新核对并审阅。
            </p>
          )}
        </div>
      )}
    </section>
  );
}
