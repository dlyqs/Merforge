/** Task plan labels owned by the Client locale. */
export const zh = {
  selectTask: '执行任务', chooseReadyTask: '请选择已批准且前置满足的任务', conversationDirectory: '使用当前对话目录',
  sharedWorkspace: '共享目录中的文件不会自动隔离或合并，请协调任务间重叠产物。', executionMode: '推进方式',
  manual: '手动（每轮结束暂停）', auto: '自动（仅当前任务）', auto_until: '自动至当前任务阶段终点',
  stopAtPhase: '停止阶段', maxActions: '工具动作预算', maxTurns: '推进轮次预算', durationMs: '总时长预算（毫秒）',
  claim: '绑定此任务', claimHint: '绑定会保存授权，但不会发送消息。准备好后在当前对话输入执行指令。',
  openOwner: '打开当前执行对话', reconciliationNote: '核对结果／接力决定与待办', resume: '明确恢复', pause: '暂停任务', cancelTask: '取消任务', handoff: '接力到新对话',
  resumeHint: '先核对未知动作和文件变化，再填写结果并恢复。恢复不会重发旧动作，也不会重置预算。接力后在新对话明确恢复并发送指令。',

  mode: '任务增强模式', modeLoading: '正在读取模式…', modeHint: '简单目标正常执行；复杂目标先生成待审核计划。',
  plans: '任务计划', close: '关闭', refresh: '刷新', loading: '正在读取任务计划…', empty: '暂无任务计划',
  error: '操作失败：{message}', revision: '计划版本 {revision}', approved: '计划已批准', pending: '计划待审核',
  approve: '批准此版本', approvalHint: '批准不启动执行，也不授予工具权限。',
  executionPending: '在对话输入框选择可执行任务；不同子任务可分别在不同对话执行。', tree: '任务树', dependencies: '阶段与依赖',
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
  selectTask: 'Execute task', chooseReadyTask: 'Choose an approved task with completed prerequisites', conversationDirectory: 'Use conversation directory',
  sharedWorkspace: 'Shared files are not isolated or merged automatically. Coordinate overlapping artifacts.', executionMode: 'Progression',
  manual: 'Manual (pause after each turn)', auto: 'Automatic (selected task only)', auto_until: 'Automatic through selected task phase',
  stopAtPhase: 'Stop phase', maxActions: 'Tool action budget', maxTurns: 'Progression turn budget', durationMs: 'Total duration budget (milliseconds)',
  claim: 'Bind this task', claimHint: 'Binding records authorization without sending a message. Send an execution instruction when ready.',
  openOwner: 'Open current execution conversation', reconciliationNote: 'Reconciliation / handoff decisions and remaining work', resume: 'Explicitly resume', pause: 'Pause task', cancelTask: 'Cancel task', handoff: 'Hand off to a new conversation',
  resumeHint: 'Inspect unknown actions and changed files before recording reconciliation. Resume never replays actions or resets budgets. Explicitly resume and send an instruction in the receiving conversation.',

  mode: 'Task enhancement', modeLoading: 'Loading mode…', modeHint: 'Simple goals run normally; complex goals become plans awaiting review.',
  plans: 'Task plans', close: 'Close', refresh: 'Refresh', loading: 'Loading task plans…', empty: 'No task plans yet',
  error: 'Operation failed: {message}', revision: 'Plan revision {revision}', approved: 'Plan approved', pending: 'Awaiting plan review',
  approve: 'Approve this revision', approvalHint: 'Approval does not start execution or grant tool permissions.',
  executionPending: 'Select ready tasks in the conversation composer; use separate conversations for independent tasks.', tree: 'Task tree', dependencies: 'Stages and dependencies',
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
