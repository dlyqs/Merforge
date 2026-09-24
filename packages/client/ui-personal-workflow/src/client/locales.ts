/** Task plan labels owned by the Client locale. */
export const zh = {
  mode: '任务增强模式', modeLoading: '正在读取模式…', modeHint: '简单目标正常执行；复杂目标先生成待审核计划。',
  plans: '任务计划', close: '关闭', refresh: '刷新', loading: '正在读取任务计划…', empty: '暂无任务计划',
  error: '操作失败：{message}', revision: '计划版本 {revision}', approved: '计划已批准', pending: '计划待审核',
  approve: '批准此版本', approvalHint: '批准不启动执行，也不授予工具权限。',
  executionPending: '子任务执行入口将在后续阶段接入。', tree: '任务树', dependencies: '阶段与依赖',
  parallel: '同阶段无前置关系的任务可并列；可执行仍须批准及前置完成。',
  edit: '修改计划', save: '保存为新版本', cancel: '取消修改', export: '导出 Markdown',
  goal: '目标', scope: '范围', acceptance: '验收条件（每行一项）', artifacts: '产物（每行一项）', cwd: '工作目录',
  parent: '父任务', phase: '阶段', prerequisites: '前置任务', blockers: '等待完成', none: '无', required: '必要子任务',
  progress: '必要子任务：{done}/{total}', phaseProgress: '完成：{done}/{total}', sessions: '关联对话', noSessions: '暂无关联对话',
  noEvidence: '产物仅为声明，尚无执行证据。', overlap: '与其他任务声明的产物相同，请协调共享文件：{paths}',
  reviewAgain: '修改保存后需要重新审核。非法依赖由 Host 拒绝，失败时保留草稿。',
  draft: '草稿', pending_review: '待审核', blocked: '依赖阻塞', ready: '可执行', running: '正在执行',
  paused: '已暂停', needs_reconciliation: '待核对', completed: '已完成', cancelled: '已取消',
} satisfies Record<string, string>
/** Task plan locale keys. */
export type WorkflowKey = keyof typeof zh
/** Complete English task plan copy. */
export const en = {
  mode: 'Task enhancement', modeLoading: 'Loading mode…', modeHint: 'Simple goals run normally; complex goals become plans awaiting review.',
  plans: 'Task plans', close: 'Close', refresh: 'Refresh', loading: 'Loading task plans…', empty: 'No task plans yet',
  error: 'Operation failed: {message}', revision: 'Plan revision {revision}', approved: 'Plan approved', pending: 'Awaiting plan review',
  approve: 'Approve this revision', approvalHint: 'Approval does not start execution or grant tool permissions.',
  executionPending: 'Subtask execution will be available in a later phase.', tree: 'Task tree', dependencies: 'Stages and dependencies',
  parallel: 'Tasks without prerequisite relations can run in parallel; readiness requires approval and completed prerequisites.',
  edit: 'Edit plan', save: 'Save as new revision', cancel: 'Discard edits', export: 'Export Markdown',
  goal: 'Goal', scope: 'Scope', acceptance: 'Acceptance criteria (one per line)', artifacts: 'Artifacts (one per line)', cwd: 'Working directory',
  parent: 'Parent task', phase: 'Stage', prerequisites: 'Prerequisites', blockers: 'Waiting for completion', none: 'None', required: 'Required subtask',
  progress: 'Required children: {done}/{total}', phaseProgress: 'Completed: {done}/{total}', sessions: 'Linked conversations', noSessions: 'No linked conversations',
  noEvidence: 'Artifacts are declarations; no execution evidence is recorded yet.', overlap: 'Artifacts also declared by other tasks; coordinate shared files: {paths}',
  reviewAgain: 'Saved changes need review again. The Host rejects invalid dependencies; failed saves retain the draft.',
  draft: 'Draft', pending_review: 'Awaiting review', blocked: 'Blocked', ready: 'Ready', running: 'Running',
  paused: 'Paused', needs_reconciliation: 'Needs reconciliation', completed: 'Completed', cancelled: 'Cancelled',
} satisfies Record<WorkflowKey, string>
