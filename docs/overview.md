# Merforge 项目概览

## 当前项目

Merforge 面向可追踪、可恢复、可验证的 Agent 工作编排及 AI Transformation。当前代码是本机单用户工程原型：React 页面和 Commander CLI 调用 Fastify API，由 Runtime 操作 SQLite。现有 Executor 只有同步 Mock，不调用模型或执行实际业务任务。

关键技术：TypeScript strict、Node.js LTS、pnpm workspace、Zod、Drizzle/SQLite、React/Vite/TanStack Query。推荐运行 Node.js 24；启动与环境变量以 [README](../README.md) 为准。

当前详细执行入口是 [M1 可靠单任务计划](next-milestone.md)，尚未实施。宏观目标见 [开发计划总表](roadmap.md)。计划中的待开发文件/行为不能当作已存在实现。

## 文件组织与修改入口

| 文件/目录                              | 当前作用                                                                            |
| -------------------------------------- | ----------------------------------------------------------------------------------- |
| `packages/contracts/src/index.ts`      | Goal/Task/Run/Evidence/Event 的 Zod schema 与导出类型；当前 Task 仅 ready/completed |
| `packages/runtime/src/index.ts`        | createRuntime、createGoal、getGoal、listGoals、runMock；统一数据操作入口            |
| `packages/runtime/src/database.ts`     | 打开 SQLite、WAL/外键/超时、按 user_version 执行追加迁移                            |
| `packages/runtime/src/schema.ts`       | Drizzle goals/tasks/runs/evidence/events 表定义                                     |
| `packages/runtime/src/executor.ts`     | 同步 PrototypeExecutor 与 MockExecutor，输出模拟说明                                |
| `packages/runtime/src/runtime.test.ts` | 数据库重开、Mock 历史、重复执行及非法输入测试                                       |
| `apps/api/src/app.ts`                  | Fastify 构建、Runtime 生命周期、同源限制、路由与错误映射                            |
| `apps/api/src/main.ts`                 | 本机监听、数据库路径/端口配置、SIGINT/SIGTERM 关闭                                  |
| `apps/api/src/app.test.ts`             | Fastify 注入测试：创建/执行/查询、输入错误、Origin 校验                             |
| `apps/cli/src/main.ts`                 | create/list/inspect/mock-run 命令，通过 HTTP 调用 API                               |
| `apps/web/src/App.tsx`                 | 创建目标、目标选择、Mock 操作、任务/执行/证据/事件展示                              |
| `apps/web/src/api.ts`                  | HTTP 请求及 Zod 响应解析；接口形状变更需同步这里                                    |
| `apps/web/src/main.tsx`                | React 入口与 QueryClient，目前每 5 秒轮询                                           |
| `apps/web/vite.config.ts`              | React 插件与开发 `/api` 代理                                                        |
| `vitest.config.ts`                     | 限定仓库测试路径，避免扫描 pnpm store                                               |
| `docs/architecture.md`                 | 当前架构边界及后续扩展原则                                                          |

## 核心行为链路

**创建目标：** App/CLI → `POST /api/goals` → createGoalSchema → Runtime.createGoal → 一个事务写入 Goal、同名 ready Task 与 goal_created 事件 → 返回 GoalDetail。当前没有自动规划或任务拆解。

**模拟执行：** App/CLI → `POST /api/tasks/:id/mock-run` → Runtime.runMock → 检查 ready → 同步 MockExecutor.execute → 同一事务写 Run、mock Evidence、completed Task、mock_completed 事件。重复执行返回冲突；没有独立验证，不能把 completed 解读成实际业务完成。

**读取与持久化：** GET goals/goal detail → Runtime 联查表 → Web 轮询或 CLI 显示。已提交记录在重启后存在；没有执行中断恢复、租约、实例所有权或 Human 待办处理。

## 维护约定

- 改数据/API 契约时同步 Contracts、Runtime、API、CLI、Web 解析和对应测试。
- 修改数据库必须追加迁移，不能修改已经交付的迁移历史。使用临时数据库验证旧数据兼容。
- Core 不引入退款等业务概念；未来领域模型放在 Pack。Runtime 不依赖 React/Fastify；CLI/Web 不直接写 SQLite。
- 每完成一个 M1 Phase，更新其实际完成记录与状态，并按真实代码同步本概览；Milestone 状态变化再更新 roadmap。
- `pnpm check` 包含类型检查、测试和构建；格式检查另运行 `pnpm format:check`。修改共享包后需构建，并按 README 重启开发服务。
- 不自行启动页面或使用 Playwright，不使用本计划未授权的 GitNexus。可选用户视觉检查保持未验证标记。
- 不把待实施的 M1 能力提前写入当前行为。后续真实 Executor 的外部 I/O 必须离开数据库长事务。
