# M2 Phase 5–7 接力说明

用户原始授权（2026-09-14）：请自动完成 phase1-4 然后新开对话自动完成剩余 phase。

唯一状态真源为 [M2 计划](m2-serial-plan.md)。前四阶段已完成并通过 `pnpm check`（12 文件 / 50 测试、类型、构建）。当前任务在 Phase 4 到界，后继任务应先将开发模式记为 auto，记录本授权，连续执行 Phase 5、6、7，完成 M2 后停止。不要创建专用 Skill，不要再请求同一授权。

本轮代码尚未提交。源仓库基线为 `043dbcc359181aabf7e28fe4e538e98955ee30ce`（main），接力任务提示提供完整补丁位置及校验值。若新任务运行于独立 worktree，先核对基线并应用补丁，完整带入已验证代码、测试、示例和文档，再开始 Phase 5；不要从未实现的 main 重做前四阶段。原工作区改动保持不动。

实现入口：Contracts `plan.ts`；Runtime `plans.ts` 管理定义/审阅/修订，`scheduler.ts` 管理控制/聚合/资格，`plan-migration.ts` 为追加迁移 5。该连接与 Drizzle 共用 Runtime command 事务。Plan 查询为 getPlan，创建/修订、continuePlan、setPlanMode、requestPhaseApproval、decideApproval 已由 API 暴露，具体协议见 README。旧任务入口统一通过 scheduler.gate；验证终态在 move 中调用 taskChanged，同事务聚合并处理边界，verifyAttempt 提交后调用 wakeGoal。

Phase 5 必须处理的尚未完成工作：

- 统一恢复就绪屏障：现有 M1 恢复先标记 interrupted、异步重放 verifying。要确保全部重放结束后才统一核对计划并派发，且就绪前控制命令不能竞态推进；现有 verifyAttempt 会调用 wakeGoal，需要纳入恢复屏障。
- 授权已持久化，但还没有启动时扫描全部计划的安全待办推进；需要覆盖前序 PASS 已提交、后继未领取的窗口。
- 验证损坏/不一致控制记录安全阻塞、Human/审批等待重开、auto_until/manual/单阶段边界前后 SIGKILL、恢复幂等。前四阶段仅证明同进程模式语义和 M1 interrupted 对串行后继的阻塞。

Phase 6 实现 CLI/Web 专用控制，保留当前 API 契约并增加必要测试；Phase 7 使用计划中的 A–D 场景完成实际出口，更新 README、architecture、overview、roadmap 和唯一阶段表。不要把单任务恢复或当前构建成功替代完整 M2 验收。

用户限制持续有效：前端改动不启动页面，不使用 Playwright/浏览器工具或相关 Skill，不使用 GitNexus；不调用子代理；不提交、推送或部署；仅临时测试数据库。视觉检查可选且尚未执行。HTTP 子进程回归需本机回环监听，沙箱 EPERM 时按授权工具流程提升执行；本轮提升后测试已通过。构建的 Zod 第三方注释注解警告不影响结果。
