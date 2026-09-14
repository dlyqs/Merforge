# Merforge 最小原型架构

## 已确定的基础选型

TypeScript strict、Node.js LTS、pnpm workspace、Zod、SQLite / Drizzle、Fastify、Commander、React / Vite / TanStack Query、Vitest。

前端由原计划中的 Vue 3 改为 React。图编辑功能实际开始时使用 React Flow（`@xyflow/react`）与 ELK.js；本阶段不安装尚未使用的图或 UI 组件依赖。

## 依赖边界

```text
React Web ── HTTP ──┐
                   ├── Fastify API ── Runtime ── SQLite
Commander CLI ─────┘                    └── Mock / Human + Verifier

Contracts ← Web / CLI / API / Runtime
```

- Contracts 不依赖 Runtime、HTTP 或具体业务 Pack。
- Runtime 不依赖 Fastify、React 或 Commander。框架接口不含退款等垂类逻辑。
- API 是本地数据写入入口，CLI 与 Web 不直接访问数据库。
- Mock Executor 只验证链路，不能作为真实 AgentExecutor 生命周期接口。
- 数据契约版本与数据库迁移版本分别管理。迁移只追加；遇到高于当前版本的数据库拒绝启动。

## 当前行为

创建 Goal 时在同一事务内创建一个 ready Task 和 goal_created 事件，绑定 executorId 与验收版本。领取时先在短事务中持久化 Attempt、状态和业务事件，再派发异步 Mock；Human 保留 waiting_human 待办。

Executor 只返回产物。Runtime 持久化产物并转 verifying，独立 Verifier 在事务外执行 `summary.v1` 结构检查，最终用新事务保存 PASS/FAIL、状态及业务事件。只有当前 Attempt 的 PASS 能完成任务；失败重试保留 Task ID 和旧尝试。验证判定按 Attempt 和验收版本唯一。

这里的 PASS 只表示示例 JSON 契约合格；Mock Evidence 明确标记模拟。旧版本 completed 记录不补造验证结果。尚无 Planner、真实业务 Verifier、自动任务拆分或外部操作。

SQLite 使用 WAL、外键约束和版本化迁移。持久化测试证明已提交记录可在重开数据库后读取；不代表任意位置 crash-resume、恰好一次执行或多机器调度已经实现。

同库 Runtime 在迁移前获取独立 SQLite owner 事务锁，锁覆盖完整实例生命周期，崩溃后 OS 释放，路径归一化并拒绝硬链接。启动将 running 转 interrupted，保留 ready/waiting_human，重放 verifying 的持久化产物，completed 不再执行；缺产物明确失败。每次写命令核对所有权，结果还检查当前 Attempt 和状态，关闭后旧回调拒绝保存。协调文件不删除，仅支持本机磁盘。

## 后续扩展入口

近期范围与顺序以 [M1 执行计划](next-milestone.md) 为准：状态/Attempt → 异步 Mock → Verifier/Human → 重启核对 → 操作闭环。五阶段均已完成；验收包括真实 CLI/HTTP、同库争用和强制终止恢复。

后续大里程碑见 [开发计划总表](roadmap.md)：串行计划与执行边界、真实 Executor、多执行器与规划、业务改造、评估及 Pack SDK。这里只保存架构原则，不重复维护阶段进度。当前代码导航见 [项目概览](overview.md)。

业务事件、调试日志与遥测各有职责。不要把 OpenTelemetry 当作数据库替代品，也不要将全部执行日志塞进任务状态事务。

## 本地原型边界

API 仅绑定 127.0.0.1，未启用跨域访问。Vite 代理保留请求 Host，使开发界面保持同源；API 拒绝不匹配的浏览器 Origin。此措施不替代未来的身份认证和授权。

前端不依赖 SSR。初期使用原生可访问表单控件和局部 CSS，避免提前引入复杂设计系统。未来增加共享 UI 包时保留 API 与 Runtime 的独立性。
