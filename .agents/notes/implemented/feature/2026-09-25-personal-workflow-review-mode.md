# 个人计划视图与显式任务增强模式

业务语义由 [个人工作流](../../../../docs/personal-workflow.md) 维护，施工范围与证据由 [执行计划](../../../../docs/personal-workflow-plan.md) 维护。

ui-personal 声明 sidebar.personal.workflow 子槽位；ui-personal-workflow 从同一 Host 计划集合派生全部/Project/Bot 入口，编辑、审核和导出绑定显示版本。失败保留草稿与操作 ID，批准不启动执行。Client 不复制任务定义为独立业务权威，不以 Session idle 计完成。输入框新增用户模式选择，不提供本期尚未实现的子任务执行入口。

skill-dev-workflow 固定作者授权的上游提交及资源校验值，托管适配使用结构化提案取代 Markdown 状态文件和 Codex 对话管理。普通模式不注入方法，也不暴露工作流工具；用户启用后，当前目标先评估再决定普通协助、澄清、不可行反馈或复杂计划提案。Host 在提案提交队列内核对模式、评估、Bot 许可、归属和计划图；方法指令不能代替这些检查。

新增模式和评估事件不改变 Session envelope 版本；真实 JSON/JSONL、Loader、AgentLoop 和 built 资源测试覆盖持久效果。可见 Desktop 验收由用户执行，助理不启动页面。执行、证据和接力留给施工 Phase 5–6。
