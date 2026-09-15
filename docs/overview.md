# Merforge 项目概览

## 当前项目

Merforge 面向可追踪、可恢复、可验证的 Agent 工作编排及 AI Transformation。已完成 M1 Phase 1–5：本机单任务、异步 Mock、Human 提交、独立确定性验证、显式重试、重启核对及 CLI/Web 操作闭环。React 页面和 Commander CLI 调用 Fastify API，由 Runtime 操作 SQLite；Mock/Human 保留示例语义；M3 Codex 已支持受控本地代码任务。

关键技术：TypeScript strict、Node.js LTS、pnpm workspace、Zod、Drizzle/SQLite、React/Vite/TanStack Query。推荐 Node.js 24；启动与环境变量以 [README](../README.md) 为准。本轮检查实际使用 Node.js 25.8.2、pnpm 10.27.0，未另做 Node.js 24 运行验证。

[M2 可控串行计划](m2-serial-plan.md) 保留为前置里程碑完成记录。后继任务已接入并核验前序补丁，按原授权连续执行 Phase 5–7，止于 M2。恢复屏障、安全待办扫描和 CLI/Web 专用控制已实现，最终 pnpm check 已通过（16 文件 / 63 测试、类型检查和构建），格式与 diff 检查通过。M2 已完成；M3 当前进展见下段。Contracts 0.3 和第 5 条追加迁移保留 M1 兼容路径。宏观范围见 [开发计划总表](roadmap.md)。

最近完成记录为 [M3 首个真实 Executor](m3-codex-plan.md)。Phase 1–7 全部完成，开发模式回 manual，止于 M3，relay off。Contracts 0.4、追加迁移 6–7、代码计划与冻结 Package、受管 Git worktree、独立命令验收、显式核对及新 Attempt 重试已接入 Runtime/API/CLI。Web 提供真实执行详情、证据与取消。真实 A/B/C 演示均已通过；全量检查 21 个文件 / 92 项测试、类型检查和构建通过，格式及 diff 检查通过。能力、指标及限制见 [M3 验收报告](m3-acceptance.md)。

## 当前交互阶段

[M3.1 完整人工操作流程](m3.1-interaction-plan.md) Phase 1–5 已完成：菜单式 CLI、GUI 表单、环境诊断、固定版本审阅和双端恢复。停止、核对、接受固定快照和创建新尝试分开操作；漂移拒绝。止于 M3.1，不承担 LLM Planner，不启动 M4。

[M4 交付合同](m4-planning-scope.md) 将 CLI 问答、GUI AI Chat、真实 LLM 澄清及模块/任务规划、有界修复和独立验收列为必需出口。[企业转型 Pack 合同](ai-transformation-pack-scope.md) 明确 M5 交付领域访谈/评估/实施计划，M6 完成真实改造，M7 评估，M8 扩展 SDK。

首页保留 Mock/Human 单目标入口，并新增支持 Mock/Human 或全 Codex 的结构化多阶段计划表单；JSON 为高级入口。CLI 提供 menu 及无参数 TTY 菜单。首页已区分三种执行方式，无聊天式 LLM 规划。最终检查 23 文件 / 102 项常规测试、类型与构建通过；2 项真实 Codex 双端交互测试单独 PASS。PTY Human/取消恢复/三阶段边界、GUI 组件事件/API 回归通过。详见 [M3.1 验收](m3.1-acceptance.md)；浏览器视觉检查未执行。

## 文件组织与修改入口

| 文件/目录                                           | 当前作用                                                                      |
| --------------------------------------------------- | ----------------------------------------------------------------------------- |
| `packages/contracts/src/index.ts`                   | 七种 Task 状态、Attempt、Artifact、Verification、202 受理响应与版本化提交契约 |
| `packages/runtime/src/index.ts`                     | 统一短事务命令、条件转换、异步派发、Human 提交、验证落盘与日志注入            |
| `packages/runtime/src/state-machine.ts`             | 合法状态边及前置条件说明；Runtime 另检查当前 Attempt 身份                     |
| `packages/runtime/src/database.ts`、`schema.ts`     | 追加迁移、Drizzle 表定义、序号/单活跃 Attempt/最终验证唯一约束                |
| `packages/runtime/src/executor.ts`                  | 可控延迟/成功/失败的异步 Mock；Human 等待状态适配器                           |
| `packages/runtime/src/verifier.ts`                  | 独立 `summary.v1` 检查，固定原因码与 PASS/FAIL                                |
| `packages/runtime/src/*.test.ts`、`fixtures/v1.sql` | 迁移及失败回滚、异步重试、并发保护、Human/Mock 验证和验证重放测试             |
| `apps/api/src/app.ts`、`app.test.ts`                | API 路由、同源限制、错误映射与受理/重试/人工提交测试                          |
| `apps/api/src/main.ts`                              | 本机监听、配置与关闭边界；Runtime 启动先排他和恢复，关闭释放锁                |
| `apps/cli/src/main.ts`                              | create/list/inspect/run/mock-run/retry/submit；执行方式和 Mock 参数选择       |
| `apps/web/src/App.tsx`、`api.ts`                    | 执行方式选择、尝试/产物/验证明细；TaskActions.tsx 提供运行/重试/人工提交      |
| `apps/web/src/main.tsx`                             | QueryClient，继续每 5 秒轮询                                                  |

`packages/runtime/src/ownership.ts` 管理进程级独占锁；recovery/process 测试覆盖恢复、迟到结果与 SIGKILL，API cli-process.test.ts 覆盖真实 CLI/HTTP 三场景。

## 核心行为链路

**创建目标：** `POST /api/goals` → 同一事务写入 Goal、ready Task、goal_created 事件。默认 executorId 为 mock，可显式设 human。Task 创建时绑定 `summary.v1`，没有运行中修改入口。

**开始/重试：** `POST /api/tasks/:id/run` 或兼容 mock-run → 短事务创建 Attempt 与 attempt_created 事件 → 返回 202 `{goalId, taskId, attemptId}`。Mock 在事务提交后异步执行，Human 停在 waiting_human。`retry` 只接受 failed/interrupted，保留 Task ID 并递增尝试序号。唯一约束防止并行领取；completed 不可重试。

**产物与验证：** Mock 输出或 `POST /api/tasks/:id/attempts/:attemptId/submit` 的 Human JSON 先保存 Artifact、转 verifying；独立 Verifier 在事务外检查，再用新事务保存最终判定、状态和事件。只有当前 Attempt 的 PASS 可以 completed。FAIL 保留原产物、版本和原因。缺字段、空 summary 或错误类型均 FAIL；重复/过期/跨 Task 提交返回 409。判定按 Attempt + 验收版本去重。

**读取与持久化：** GoalDetail 包含 attempts、artifacts、verifications 和旧 runs/evidence/events。历史按尝试顺序返回。旧 Mock Run/Evidence 原样保留，不补造验证；新 Mock Evidence 明确标记模拟。PASS 只证明示例 JSON 结构合格，不代表业务判断正确。

**当前边界：** 同库 Runtime 使用独立 SQLite 事务锁排他，进程退出由系统释放，支持符号链接路径归一化、拒绝硬链接。启动时 Mock running 转 interrupted，无计划或无授权的 ready 不派发，waiting_human 保留，verifying 从产物重放，缺产物 failed。旧实例关闭后的结果拒绝落盘。仅限本机磁盘，不恢复任意执行位置或外部 Agent 会话。全部 verifying 重放结束后才核对计划授权、范围并派发安全待办。CLI/API/Web 均提供计划控制及 Human/重试入口。视觉检查未执行；浏览器自动验收未运行。

## 维护约定

- 改数据/API 契约时同步 Contracts、Runtime、API、CLI、Web 解析和对应测试。
- 修改数据库必须追加迁移，不能修改已经交付的迁移历史。使用临时数据库验证旧数据兼容。
- Core 不引入退款等业务概念；未来领域模型放在 Pack。Runtime 不依赖 React/Fastify；CLI/Web 不直接写 SQLite。
- 每完成当前执行计划的一个 Phase，更新对应实际完成记录与状态，并按真实代码同步本概览；Milestone 状态变化再更新 roadmap。
- `pnpm check` 包含类型检查、测试和构建；格式检查另运行 `pnpm format:check`。修改共享包后需构建，并按 README 重启开发服务。
- 不自行启动页面或使用 Playwright，不使用本计划未授权的 GitNexus。可选用户视觉检查保持未验证标记。
- 不把 M2 计划中的能力提前写入当前行为。后续真实 Executor 的外部 I/O 必须离开数据库长事务。

M2 代码入口：`packages/contracts/src/plan.ts` 定义计划契约；Runtime `plans.ts` 管理版本与审批，`scheduler.ts` 管理串行派发/范围/聚合，`plan-migration.ts` 是第 5 条追加迁移；`plans.test.ts`、`scheduler.test.ts`、`modes.test.ts` 和 API plans 测试覆盖同进程操作；plan-recovery、plan-process 和 API plan-cli-process 覆盖重启及 M2 A–D。审批与模式均不会授予初次执行权；新计划须显式 continue。历史 Task 通过 phaseId 区分修订，旧无 Phase 的 Task 仍使用 M1 入口。

CLI 的 plan 子命令提供定义、修订、审阅、阶段审批和模式控制；Web PlanControls.tsx 提供同等操作及固定版本审阅视图。

M3 代码入口：Contracts task-package.ts/plan.v2；Runtime code-store.ts 校验 Package 与身份，workspace.ts/artifact-store.ts/code-workspace.ts 管理文件和证据，executors/codex.ts/process.ts 管理协议及进程，code-verifier.ts 独立验收，code-recovery.ts 核对和授权重试。code-execution.ts 与 index.ts 连接调度、条件写入及三端接口。API 由 MERFORGE_CODE_CONFIG 启用本地配置；命令和示例见 README。未知进程或缺证据仍保持隔离，不自动重跑，Runtime 不开放同会话 resume。
