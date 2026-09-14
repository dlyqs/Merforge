# Merforge 最小原型架构

## 已确定的基础选型

TypeScript strict、Node.js LTS、pnpm workspace、Zod、SQLite / Drizzle、Fastify、Commander、React / Vite / TanStack Query、Vitest。

前端由原计划中的 Vue 3 改为 React。图编辑功能实际开始时使用 React Flow（`@xyflow/react`）与 ELK.js；本阶段不安装尚未使用的图或 UI 组件依赖。

## 依赖边界

```text
React Web ── HTTP ──┐
                   ├── Fastify API ── Runtime ── SQLite
Commander CLI ─────┘                    └── Mock Executor

Contracts ← Web / CLI / API / Runtime
```

- Contracts 不依赖 Runtime、HTTP 或具体业务 Pack。
- Runtime 不依赖 Fastify、React 或 Commander。框架接口不含退款等垂类逻辑。
- API 是本地数据写入入口，CLI 与 Web 不直接访问数据库。
- Mock Executor 只验证链路，不能作为真实 AgentExecutor 生命周期接口。
- 数据契约版本与数据库迁移版本分别管理。迁移只追加；遇到高于当前版本的数据库拒绝启动。

## 当前行为

创建 Goal 时在同一事务内创建一个 ready Task 和 goal_created 事件。运行 Mock 时在同一事务内记录 Run、mock Evidence、mock_completed 事件，并将 Task 标记为 completed。

这里的 completed 仅表示模拟执行完成。尚无 Planner、真实业务 Verifier、自动任务拆分或外部操作。

Mock 是没有外部 I/O 的同步操作，允许整体放在一个短事务中。真实 Executor 不得沿用这一执行方式：调用 Agent 前应先持久化运行尝试，外部执行在事务之外进行，收到结果后再提交状态和证据。

SQLite 使用 WAL、外键约束和版本化迁移。持久化测试证明已提交记录可在重开数据库后读取；不代表任意位置 crash-resume、恰好一次执行或多机器调度已经实现。

## 后续扩展入口

近期范围与顺序以 [M1 执行计划](next-milestone.md) 为准：状态/Attempt → 异步 Mock → Verifier/Human → 重启核对 → 操作闭环。该计划尚未实施。

后续大里程碑见 [开发计划总表](roadmap.md)：串行计划与执行边界、真实 Executor、多执行器与规划、业务改造、评估及 Pack SDK。这里只保存架构原则，不重复维护阶段进度。当前代码导航见 [项目概览](overview.md)。

业务事件、调试日志与遥测各有职责。不要把 OpenTelemetry 当作数据库替代品，也不要将全部执行日志塞进任务状态事务。

## 本地原型边界

API 仅绑定 127.0.0.1，未启用跨域访问。Vite 代理保留请求 Host，使开发界面保持同源；API 拒绝不匹配的浏览器 Origin。此措施不替代未来的身份认证和授权。

前端不依赖 SSR。初期使用原生可访问表单控件和局部 CSS，避免提前引入复杂设计系统。未来增加共享 UI 包时保留 API 与 Runtime 的独立性。
