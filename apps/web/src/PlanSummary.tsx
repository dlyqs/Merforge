import type { PlanDefinition } from '@merforge/contracts';
export function PlanSummary({ definition }: { definition: PlanDefinition }) {
  return (
    <div aria-label="计划审阅内容">
      {definition.schemaVersion === 'plan.v2' && (
        <p>
          仓库：{definition.workspace.repositoryKey} · 基线：
          {definition.workspace.baseCommit}
        </p>
      )}
      {definition.phases.map((phase, i) => (
        <article key={i}>
          <h4>
            {i + 1}. {phase.title} ·{' '}
            {phase.requiresApproval ? '进入前审批' : '无需阶段审批'}
          </h4>
          {phase.tasks.map((task, j) => (
            <div key={j}>
              <strong>
                {j + 1}. {task.title} · {task.executorId}
              </strong>
              {task.executorId === 'codex' ? (
                <>
                  <p>{task.instructions}</p>
                  <p>
                    预期文件：{task.expectedFiles.join('、')}
                    <br />
                    允许修改：{task.allowedPaths.join('、')}
                    <br />
                    禁止修改：{task.forbiddenPaths.join('、') || '未额外指定'}
                  </p>
                  <p>
                    独立验收 commands.v1 ·{' '}
                    {task.acceptance.allowEmptyDiff
                      ? '允许空 diff'
                      : '必须有 diff'}
                  </p>
                  {task.acceptance.checks.map((check) => (
                    <p key={check.id}>
                      {check.id} · argv {JSON.stringify(check.argv)} · 目录{' '}
                      {check.cwd} · 超时 {check.timeoutMs} ms
                    </p>
                  ))}
                </>
              ) : (
                <p>summary.v1：非空 summary；仅验证示例结构。</p>
              )}
            </div>
          ))}
        </article>
      ))}
      <details>
        <summary>完整冻结定义（含输入、策略和验收限制）</summary>
        <pre>{JSON.stringify(definition, null, 2)}</pre>
      </details>
    </div>
  );
}
