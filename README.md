# Merforge

Merge your workflow. Forge your AI future.

开源 Agent 工作编排框架的最小原型。当前打通 **Goal → Task → Attempt → Artifact → Verification**（Mock/Human），并已实现 M2 的版本化人工计划、审批和同进程串行控制。真实 Executor 与 AI Transformation Pack 尚未接入。

## 快速开始

推荐 Node.js 24 LTS、pnpm 10.27.0。

```bash
pnpm install
pnpm dev
```

- React 开发界面：<http://127.0.0.1:5173>
- Fastify API：<http://127.0.0.1:4317/api/health>
- SQLite：仓库根目录 `.merforge/runtime.sqlite`，首次启动自动初始化。

`pnpm dev` 会先构建共享包，然后运行 API 与 Vite。修改 `packages/` 后，执行 `pnpm build:packages` 并重启开发服务以加载新的共享代码。前端和 API 自身支持开发时更新。

界面支持 Mock/Human 选择、运行与显式重试、人工 JSON 提交、尝试历史、错误、产物及验证详情；继续每 5 秒轮询。刷新或重启服务后，已提交的数据仍会保留。

**Mock 不调用模型、不执行代码、不证明业务任务已完成。重启会识别执行中断，需显式重试。**

## CLI

先启动 API（`pnpm dev`），然后在另一个终端运行：

```bash
pnpm cli create "梳理退款流程"
pnpm cli list
pnpm cli inspect <goal-id>
pnpm cli mock-run <task-id>
```

ID 从 `create` 或 `inspect` 输出获取。`mock-run` 返回 202 受理数据 `{goalId, taskId, attemptId}`，随后用 `inspect` 查询状态和验证结果。重复开始返回 409；失败后通过 `retry` 或下面的 API 显式重试。CLI 与 Web 使用同一份数据。

## M1 API

创建目标仍默认使用 Mock，Human 需显式选择。以下路径均相对于 `http://127.0.0.1:4317`：

| 请求                                             | JSON 请求体                                         | 行为                                                                           |
| ------------------------------------------------ | --------------------------------------------------- | ------------------------------------------------------------------------------ |
| `POST /api/goals`                                | `{"objective":"人工提交示例","executorId":"human"}` | 返回 GoalDetail，从 tasks 取得 Task ID                                         |
| `POST /api/tasks/:id/run`                        | `{}`                                                | 202；Human 进入 waiting_human，返回 attemptId                                  |
| `POST /api/tasks/:id/attempts/:attemptId/submit` | `{"artifact":{"summary":"已整理提交说明"}}`         | 202；保存产物后独立验证                                                        |
| `POST /api/tasks/:id/mock-run`                   | `{"delayMs":1000,"outcome":"failure"}`              | 202；仅 Mock，延迟后模拟失败；两个选项均可省略                                 |
| `POST /api/tasks/:id/retry`                      | `{}`                                                | failed/interrupted 创建新 Attempt，Task ID 不变；Mock 也可指定 delayMs/outcome |
| `GET /api/goals/:id`                             | —                                                   | 查询状态、尝试历史、原始产物与验证明细                                         |

`summary.v1` 只检查 JSON 对象中 summary 是否为去除空白后非空的字符串。`{"artifact":{}}` 或 `{"artifact":{"summary":42}}` 会被受理并验证为 FAIL，原因码为 `SUMMARY_REQUIRED_NON_EMPTY_STRING`；重试后需使用新的 attemptId 提交。只有当前 Attempt 的 PASS 才能完成 Task。Human 表示人工产物来源，不是审批功能。

数据库启动时执行追加迁移。旧模拟记录保持可读，不补造 Attempt 或验证判定；所有 Mock 产物仍标记模拟。

## M2 计划 API（Phase 1–4）

当前计划功能通过 API 使用；CLI/Web 专用控制界面留 Phase 6。可用以下命令创建示例，响应返回 PlanDetail（含 goalId、revision、phases、approvals 和控制状态）：

```bash
curl -sS http://127.0.0.1:4317/api/plans -H 'Content-Type: application/json' --data-binary @examples/serial-plan.json
```

| 请求                                               | JSON 请求体                                                   | 行为                                                                  |
| -------------------------------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------- |
| GET /api/plans/:id                                 | —                                                             | 当前计划、历史定义和审批                                              |
| POST /api/plans/:id/revisions                      | {revision, definition}                                        | revision 是所见当前版本；没有任何 Attempt 才能递增修订，旧审批失效    |
| POST /api/plans/:id/approvals/:approvalId/decision | {revision, decision: "approved" 或 "rejected", actor}         | 绑定版本与审批 ID；actor 仅为本地标签；批准不授予初次执行权           |
| POST /api/plans/:id/continue                       | {revision, phaseId?}                                          | 显式启动；默认 manual 完成一个阶段后停；指定 phaseId 总是只授权该阶段 |
| POST /api/plans/:id/mode                           | {revision, controlVersion, mode, startPhaseId?, stopPhaseId?} | manual / auto / auto_until；controlVersion 取最新详情，过期返回 409   |
| POST /api/plans/:id/phases/:phaseId/approval       | {revision}                                                    | 首个未完成阶段的审批请求；被拒后可显式重建，历史保留                  |

auto 模式在显式启动后持续推进；auto_until 必须提供包含在范围内的 stopPhaseId，省略 startPhaseId 取首个未完成阶段。到界与阶段完成同事务切回 manual、清空两端、撤销本次授权，后续阶段没有 Attempt。已完成范围可显式指定两端确认边界。单阶段覆盖不会修改保存的模式；结束后需显式 continue 恢复该模式。运行中切 manual 允许当前阶段完成。

阶段入口审批请求会在已授权执行到达该阶段时产生。批准或 Human 合格提交只恢复已有授权。失败/中断需显式 retry；所有计划 Task 的 run/mock-run/retry 均受审阅、顺序、授权与范围门禁约束。非法输入返回 400，缺失对象返回 404，版本/状态冲突返回 409，响应含 error 与 code。Human 产物仍仅接受 summary.v1 结构验证，不代表业务验收。

计划控制和审批已经持久化；完整跨重启调度恢复及崩溃窗口保证尚待 Phase 5，不把 M1 单任务恢复结果视为 M2 出口验收。

## 三个可复现演示

先启动 API，各 ID 从前一条命令 JSON 获取。`inspect` 可重复执行，操作受理不等于执行完成。

```bash
# A：失败后重试，保留两次尝试
pnpm cli create "Mock 重试示例"
pnpm cli mock-run <task-id> --outcome failure
pnpm cli inspect <goal-id>  # 等待 failed
pnpm cli retry <task-id>
pnpm cli inspect <goal-id>  # completed；两次尝试，模拟证据

# B：人工待办跨重启，先 FAIL 后 PASS
pnpm cli create "人工示例" --executor human
pnpm cli run <task-id>
# 在 API 终端退出并重新启动，仍 waiting_human
pnpm cli submit <task-id> <attempt-id> --artifact '{}'
pnpm cli inspect <goal-id>  # FAIL 与具体原因
pnpm cli retry <task-id>    # 返回新的 attempt-id
pnpm cli submit <task-id> <new-attempt-id> --artifact '{"summary":"已整理说明"}'
pnpm cli inspect <goal-id>  # PASS；旧提交和 FAIL 保留

# C：运行中终止并重启
pnpm cli create "中断示例"
pnpm cli run <task-id> --delay-ms 60000
pnpm cli inspect <goal-id>  # running
# 退出 API 再重新启动：interrupted，不自动派发
pnpm cli inspect <goal-id>
pnpm cli retry <task-id>
pnpm cli inspect <goal-id>
```

真实强制终止（SIGKILL）和三个场景可自动复现：

```bash
pnpm build:packages
pnpm exec vitest run apps/api/src/cli-process.test.ts packages/runtime/src/process.test.ts packages/runtime/src/recovery.test.ts
```

## 恢复与实例边界

- 同一数据库仅一个 Runtime/daemon，即使端口不同也拒绝第二实例。使用 canonical 路径旁的 `.owner.sqlite` 独立事务锁；进程退出由系统释放，遗留文件无需删除。运行中不要删除或替换数据库及 owner 文件。符号链接归一化，硬链接拒绝；仅支持本机磁盘，不支持网络文件系统。
- 启动先获取所有权，再迁移和核对：ready 保持，running → interrupted，waiting_human 保持，verifying 从已保存产物重放纯验证，completed 不再执行。缺失产物会 failed/MISSING_ARTIFACT。
- 失败或中断需显式 retry；旧 Attempt 保留且不会覆盖新尝试。关闭取消 Mock 等待，旧回调拒绝保存。
- 不恢复任意代码位置、外部 Agent 会话或未持久化产物，不承诺外部操作恰好一次。当前没有真实 Agent 或自动重试；M2 计划的跨重启自动推进待 Phase 5 完成专项验证。

## 工程结构

```text
apps/
  api/          Fastify 本地 HTTP 服务
  cli/          Commander CLI
  web/          React + Vite + TanStack Query
packages/
  contracts/    Zod 数据契约与 TypeScript 类型
  runtime/      SQLite、Drizzle、任务操作与 Mock Executor
  runtime/src/database.ts  按版本顺序执行的数据库迁移
docs/          架构决策与扩展路线
```

## 开发检查

```bash
pnpm format:check
pnpm typecheck
pnpm test
pnpm build
# 或合并执行类型检查、测试和构建（格式检查另行运行）
pnpm check
```

测试使用临时 SQLite、Fastify 注入和真实 CLI/HTTP 子进程，不需要浏览器。进程测试需允许监听 127.0.0.1 随机端口，包含 SIGKILL 与同库争用；端口被沙箱阻止时需在允许本地监听的环境运行，不会跳过并冒充通过。覆盖旧库迁移及回滚、提交后派发、失败重试、人工提交、独立验证、重复/过期保护和 HTTP 错误。

构建后可单独启动 API：

```bash
pnpm --filter @merforge/api start
```

Web 产物在 `apps/web/dist`。当前 API 不托管静态页面；生产部署时需要配置静态服务与 `/api` 反向代理。

## 配置

| 环境变量           | 默认值                            | 用途                             |
| ------------------ | --------------------------------- | -------------------------------- |
| `MERFORGE_DB`      | 仓库根 `.merforge/runtime.sqlite` | API 数据库路径，建议使用绝对路径 |
| `MERFORGE_PORT`    | `4317`                            | API 监听端口                     |
| `MERFORGE_API_URL` | `http://127.0.0.1:4317`           | CLI 使用的 API 地址              |

修改 API 端口时，需要同步修改 `apps/web/vite.config.ts` 中的代理目标。服务固定绑定本机回环地址。当前为单用户本地原型，没有账户、远程认证或多租户功能。

## 开发文档

- [项目概览](docs/overview.md)：当前代码结构与核心链路。
- [M2 执行计划](docs/m2-serial-plan.md)：当前阶段执行入口，Phase 1–4 已实现，后续恢复及操作闭环继续按计划推进。
- [M1 执行计划](docs/next-milestone.md)：已完成的阶段合同和 M1 验收记录。
- [开发计划总表](docs/roadmap.md)：终极目标、主要 Milestone 与验收出口。
- [架构说明](docs/architecture.md)：技术选型与扩展边界。
