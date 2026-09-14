# Merforge

Merge your workflow. Forge your AI future.

开源 Agent 工作编排框架的最小原型。当前打通 **Goal → Task → Attempt → Artifact → Verification**（Mock/Human），并已实现 M2 的版本化人工计划、审批和跨重启串行控制及 CLI/Web 入口。Runtime 已接入首个 Codex 执行器，代码产物由独立命令验收，支持中断核对与显式新 Attempt 重试。AI Transformation Pack 尚未实现。

## 当前体验与后续阶段

当前 CLI 使用逐条子命令；GUI 的普通目标入口支持 Mock/Human，真实 Codex 使用 JSON 计划入口。计划由人工定义，尚无菜单式 CLI 或 LLM 聊天规划；代码任务的核对/重试仍需要 CLI。页面中“仅模拟执行”的旧介绍待 M3.1 修正，不代表 Runtime 没有真实 Codex 能力。

后续交付已明确，尚未实现：

- [M3.1 完整人工操作流程](docs/m3.1-interaction-plan.md)：CLI 菜单与 GUI 表单，双端完整审阅、执行、取消、核对及重试；正常操作不手填 JSON/内部 ID/hash。
- [M4 对话规划与执行闭环](docs/m4-planning-scope.md)：CLI 问答和 GUI AI Chat，由 LLM 澄清、拆模块/任务、生成可审阅计划，再执行和独立验证。
- [企业转型 Pack](docs/ai-transformation-pack-scope.md)：M5 访谈/评估/方案及实施规划，M6 真实改造与业务验收，M7 对比评估，M8 Pack SDK 扩展。

[路线图](docs/roadmap.md) 管里程碑状态；当前下一入口为 M3.1，规划准备不代表已授权开发或已交付功能。

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

## M2 计划 API

计划可通过 API、CLI 和 Web 操作。可用以下命令创建示例，响应返回 PlanDetail（含 goalId、revision、phases、approvals 和控制状态）：

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

重启先完成全部 M1 核对和 verifying 重放，再核对计划聚合、控制及授权事件，最后派发安全待办。恢复中执行、控制和提交返回 409 recovery_in_progress；不一致控制以 recovery_blocked 持久阻塞，普通 continue/mode 无法解除。

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
- 启动先获取所有权，再迁移和核对：ready 保持，Mock running → interrupted，waiting_human 保持，verifying 从已保存产物重放纯验证，completed 不再执行。缺失产物会 failed/MISSING_ARTIFACT。
- 失败或中断需显式 retry；旧 Attempt 保留且不会覆盖新尝试。关闭取消 Mock 等待，旧回调拒绝保存。
- 不恢复任意代码位置、外部 Agent 会话或未持久化产物，不承诺外部操作恰好一次。当前没有真实 Agent 或自动重试；M2 仅恢复已有持久授权的安全待办，保留审批、Human 等待和停止边界。

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
- [M2 执行计划](docs/m2-serial-plan.md)：当前阶段执行入口，唯一阶段状态真源，完整出口证据见对应阶段记录。
- [M1 执行计划](docs/next-milestone.md)：已完成的阶段合同和 M1 验收记录。
- [开发计划总表](docs/roadmap.md)：终极目标、主要 Milestone 与验收出口。
- [架构说明](docs/architecture.md)：技术选型与扩展边界。

## M2 CLI 与 Web 操作

`pnpm cli plan --help` 查看命令。先启动 API，按响应复制 `plan-id`、`phase-id`、`approval-id` 和当前 `controlVersion`；以下尖括号内容须替换为对应值。CLI 不会自动读取新版本代替你已审阅的版本。

```bash
pnpm cli plan create ../../examples/serial-plan.json
pnpm cli plan inspect <plan-id>
pnpm cli plan review <plan-id> <review-approval-id> --revision 1 --decision approved --actor local
pnpm cli plan continue <plan-id> --revision 1 --phase <first-phase-id>
# 第一阶段两个 Mock 完成后停止；设置范围本身不启动。
pnpm cli plan mode <plan-id> auto_until --revision 1 --control-version <current-version> --stop <second-phase-id>
pnpm cli plan continue <plan-id> --revision 1
# inspect 返回阶段入口审批；批准后 Human 等待。
pnpm cli plan review <plan-id> <phase-approval-id> --revision 1 --decision approved --actor local
pnpm cli inspect <goal-id>
pnpm cli submit <human-task-id> <attempt-id> --artifact '{"summary":"Reviewed human contribution"}'
# 第二阶段 Human 及 Mock 完成，mode=manual，第三阶段零 Attempt。
pnpm cli plan continue <plan-id> --revision 1
```

文件路径相对于 CLI 的工作目录 `apps/cli`；绝对路径也可用。`plan create` 读取完整 CreatePlan JSON；`plan revise <plan-id> <definition-file> --revision <current-revision>` 读取仅含 schemaVersion/phases 的 PlanDefinition JSON。任何 Attempt 产生后禁止修订。`plan request-approval <plan-id> <phase-id> --revision <revision>` 可在阶段审批拒绝后显式新建请求。`plan mode` 支持 manual/auto/auto_until，auto_until 可加 `--start`；`plan continue --phase` 在任何模式下都只运行一个阶段。失败/中断仍使用 `retry <task-id>`；测试用延迟和失败选项仅用于 Mock。

Web 的“新建串行计划”接受同一 CreatePlan JSON。详情显示服务端阶段状态、历史审阅、模式/范围、停止原因及任务证据，可提交修订、审阅、请求阶段审批、继续或指定阶段。审阅快照固定在所见 revision；轮询发现新版本后需点击“加载当前版本供审阅”，不能静默批准新内容。原单任务及 Human/retry 操作继续可用。未执行浏览器或人工视觉检查。

M2 A–D 自动演示使用同一个 `examples/serial-plan.json`，通过真实 CLI/HTTP 和临时 SQLite 验证 manual 双任务、auto_until 审批/Human 等待 SIGKILL 重启、Mock 失败与执行中断显式重试、旧 revision 审批拒绝。同步点进程测试覆盖边界提交及派发窗口：

```bash
pnpm build:packages
pnpm exec vitest run apps/api/src/plan-cli-process.test.ts packages/runtime/src/plan-process.test.ts packages/runtime/src/plan-recovery.test.ts
pnpm check
pnpm format:check
git diff --check
```

HTTP 测试需要本机回环监听权限；受限沙箱中须获准解除该限制。全部测试仅用临时数据库。

## M3 真实 Codex 入口

已实现 `plan.v2`、冻结的 `task-package.v1`、受管 Git worktree 与 `commands.v1` 独立命令验收。当前支持 macOS / Codex CLI 0.120.0 的受信任本地样例。默认 API 不开启 Codex；只由本地配置映射 repositoryKey 到干净 Git 源，计划使用明确 commit，不携带本机路径。

先准备专用样例（此命令不调用模型）：

```bash
pnpm build:packages
node examples/codex-task/prepare-cli.mjs
```

按输出的绝对路径配置 `MERFORGE_CODE_CONFIG=/.../code-config.json` 和 `MERFORGE_DB=/.../runtime.sqlite`，再启动 `pnpm --filter @merforge/api start`。配置字段为 `executable`、`repositories`、`managedRoot`、`artifactRoot`，可选 `model` 和 `timeoutMs`。不能通过 HTTP 修改本地执行配置。

```bash
pnpm cli plan create /.../plan.json
pnpm cli plan inspect PLAN_ID
pnpm cli plan review PLAN_ID APPROVAL_ID --revision 1 --decision approved --actor local-user
pnpm cli plan continue PLAN_ID --revision 1
pnpm cli inspect GOAL_ID
pnpm cli code-inspect TASK_ID
pnpm cli code-evidence TASK_ID EVIDENCE_ID
pnpm cli cancel TASK_ID ATTEMPT_ID
pnpm cli reconcile TASK_ID ATTEMPT_ID --stop
pnpm cli retry-code TASK_ID ATTEMPT_ID --revision 1 --snapshot REVIEWED_HASH
```

`reconcile` 不执行 Agent；`--stop` 明确请求终止核实身份的遗留进程。检查返回的 diff、文件清单与 snapshotHash，再将该 hash 传入 `retry-code`；工作区尚未创建时传 `--snapshot none`。有外部漂移、证据缺失或无法确认进程身份时保持阻塞，不 reset 文件。重试仍须满足原计划审批、revision、模式和阶段范围。当前 Runtime 不支持同会话 resume，显式重试创建新 Attempt 并保留前驱、旧日志和验收。

新增 HTTP 入口：`GET /api/tasks/:id/code`、`GET /api/tasks/:id/code/evidence/:evidenceId`、`POST /api/tasks/:id/attempts/:attemptId/cancel`、`POST /api/tasks/:id/reconcile`（`{attemptId,stop}`）、`POST /api/tasks/:id/retry-code`（`{attemptId,revision,snapshotHash}`）。Web 展示真实执行标识、工作区、会话、验收与证据，支持请求取消；核对和重试使用 CLI。

Runtime `close()` 必须 await。数据库锁释放不等于 Agent 停止，持久目录 lease 会保留未确认的工作区。工作区和轮询进程身份不是任意恶意代码的隔离平台；同会话恢复、守护化子进程、联网验收与任意外部副作用恢复不在支持范围。

真实演示、逐 Attempt 指标与持久证据见 [M3 验收报告](docs/m3-acceptance.md)；历史探针见 [接口记录](docs/m3-codex-interface.md)。演示脚本会调用现有本机 Codex 认证并产生实际模型费用，不属于常规测试。
