# Merforge 最小原型架构

## 已确定的基础选型

TypeScript strict、Node.js LTS、pnpm workspace、Zod、SQLite / Drizzle、Fastify、Commander、React / Vite / TanStack Query、Vitest。

前端由原计划中的 Vue 3 改为 React。图编辑功能实际开始时使用 React Flow（`@xyflow/react`）与 ELK.js；本阶段不安装尚未使用的图或 UI 组件依赖。

## 依赖边界

```text
React Web ── HTTP ──┐
                   ├── Fastify API ── Runtime ── SQLite
Commander CLI ─────┘                    └── Mock / Human + Verifier；Codex + 受管 worktree

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

同库 Runtime 在迁移前获取独立 SQLite owner 事务锁，锁覆盖完整实例生命周期，崩溃后 OS 释放，路径归一化并拒绝硬链接。启动将 Mock running 转 interrupted，保留 ready/waiting_human，重放 verifying 的持久化产物，completed 不再执行；缺产物明确失败。每次写命令核对所有权，结果还检查当前 Attempt 和状态，关闭后旧回调拒绝保存。协调文件不删除，仅支持本机磁盘。

## M2 计划与调度

Contracts 0.3 使用独立 plan.v1 定义版本、递增 revision 和数据库迁移 5。一个 Plan 身份保留每次不可变定义、独立有序 Phase/Task 及审批历史；Task 通过 phaseId 唯一关联修订。旧 Goal 仍创建单任务，新 POST /api/plans 原子保存完整结构，不附加默认任务。

plans.ts 管理定义、修订与审批；scheduler.ts 管理资格、授权、聚合和边界。计划数据使用同一 SQLite 连接的参数化 SQL，复用 Runtime 的短事务和事件出口；既有任务继续使用 Drizzle。审批、模式及阶段状态不依赖内存游标。修改计划须尚无 Attempt；review 与 phase_entry 审批均绑定 revision，Human 产物与审批独立。

串行资格检查与 Attempt 领取处于同一个短事务；旧 run/mock-run/retry 也调用该门禁。数据库同时限制同 Plan 一个活跃 Attempt。验证 PASS 提交时重算 Phase/Plan，且到界切 manual、清空范围与撤销授权一起提交。提交后才唤醒下一任务；失败或 interrupted 等待显式 retry。显式单阶段限制与模式两端均持久化，控制命令校验 revision，模式更新额外校验 controlVersion。

计划事件可无 taskId，使用 planId/revision/phaseId/approvalId/controlVersion 关联。业务状态与事件同事务；结构化诊断日志仅输出 ID、事件和固定原因码。Task 终态事件附带 Plan/revision/Phase 关联。启动统一屏障阻止验证回调提前派发，全部重放结束后核对聚合、阶段引用、模式范围及授权事件，再扫描安全待办；恢复中执行/控制/提交明确拒绝。损坏控制撤销授权并持久阻塞为 recovery_blocked。PASS 提交后未领取的后继可恢复；已领取的 running 仍只标 interrupted。

## 后续扩展入口

[M1 执行计划](next-milestone.md) 的五阶段均已完成；验收包括真实 CLI/HTTP、同库争用和强制终止恢复。当前执行入口为 [M2 可控串行计划](m2-serial-plan.md)：计划契约 → 审阅门禁 → manual 串行 → 自动模式/阶段审批 → 恢复 → 操作闭环 → 验收。M2 已实现跨重启计划调度及 CLI/Web 闭环，出口证据以阶段计划为准。Web 审阅固定 revision 快照，轮询不改变待批准版本；CLI 强制传入 revision，模式更新还需控制版本。

后续大里程碑见 [开发计划总表](roadmap.md)：串行计划与执行边界、真实 Executor、多执行器与规划、业务改造、评估及 Pack SDK。这里只保存架构原则，不重复维护阶段进度。当前代码导航见 [项目概览](overview.md)。

业务事件、调试日志与遥测各有职责。不要把 OpenTelemetry 当作数据库替代品，也不要将全部执行日志塞进任务状态事务。

## 本地原型边界

API 仅绑定 127.0.0.1，未启用跨域访问。Vite 代理保留请求 Host，使开发界面保持同源；API 拒绝不匹配的浏览器 Origin。此措施不替代未来的身份认证和授权。

前端不依赖 SSR。初期使用原生可访问表单控件和局部 CSS，避免提前引入复杂设计系统。未来增加共享 UI 包时保留 API 与 Runtime 的独立性。

## M3 代码执行边界

Contracts 0.4 增加 plan.v2（当前为全代码任务计划）、task-package.v1、commands.v1；迁移 6 保留已发布表/索引/触发器及历史记录，并增加 Package、workspaces、code_runs 和文件证据。身份通过 revision、Task、Attempt、workspace 的复合引用绑定；输入/验收内容 hash 与审批修订一起冻结。

Runtime 在统一领取事务内持久化 Attempt、dispatch token 和工作区占用，事务后创建/核对 Git worktree、发布输入快照，再将固定序列化 Package 送入 Codex stdin。`executors/process.ts` 记录根进程及后代启动身份，覆盖独立进程组；取消先持久化，再停止已核实进程，无法核实时保留隔离。持久目录 lease 不因 daemon 数据库锁释放就可抢占；异常重启的占用先隔离，显式核对由 code-recovery.ts 完成。关闭等待真实执行任务收尾。

证据目录保存原子发布的快照与有界事件元数据，数据库保存 hash、大小、相对路径和归属。快照包含除 .git 外的全部文件内容/hash/mode，以及 tracked Git binary diff；untracked 内容由文件清单覆盖。拒绝 symlink/hardlink、路径逃逸、脏源接管、范围外修改及外部漂移。快照上限为单文件 8MiB、总量 32MiB、10000 文件；超限明确失败。

正常 Codex 产物进入 verifying，`code-verifier.ts` 在排他工作区独立运行冻结检查，不使用 summary.v1 兜底。所有命令通过且保护文件未变才保存 PASS；命令输出仅保存有界字节数和摘要，避免保存任意敏感输出。检查的 argv/cwd、时间、退出码和规则/快照 hash 存入证据。原有文件（包含已有构建输出）在检查期间不可修改；allowedOutputs 仅允许额外生成预声明输出。后继输入核对前序 PASS 输出及允许生成的文件。

追加迁移 7 保存 code_reconciliations。恢复先隔离占用，不自动执行 Agent；显式 reconcile 核对证据、Git 归属、进程启动身份与 macOS cwd 占用。派发身份缺失的窗口不猜测已停止；遗留进程只在显式 stop 后按身份终止。核对结果仍不授权执行，retryCode 必须提交原 Attempt、revision 和核对快照 hash，重新通过计划门禁后创建带前驱的新 Attempt。Runtime 同会话 resume 未开放，CLI 探针能力与 Runtime 能力分开记录。

API 只允许本地配置文件启用 Codex，客户端不能指定任意本机执行路径。CLI 提供 code-inspect/code-evidence/cancel/reconcile/retry-code，Web 提供最小详情及取消。证据通过 taskId + evidenceId 校验归属并验证 hash，文件快照不在 HTTP 返回 base64 文件内容；React 按普通文本渲染 diff/JSON。

支持范围为 macOS/Codex 0.120.0 的受信任本地样例，禁止自行守护化。轮询后代和 cwd 核对不承诺拦截任意恶意进程，不承诺恢复外部副作用恰好一次。完整验收见 [M3 报告](m3-acceptance.md)。

## 后续架构演进合同（尚未实现）

M3.1 复用现有 API/Runtime，CLI 菜单与 GUI 操作必须共享版本、授权和恢复语义；不能在客户端另建调度器。配置引导仅处理操作者授权的本地配置，浏览器不持有执行器凭证或任意文件系统权限。详细范围见 [M3.1 计划](m3.1-interaction-plan.md)。

M4 增加对话/澄清和版本化规划草案，LLM 将自然语言转为可审阅结构；明确区分对话历史、草案、批准计划和真实 Attempt。模块作为可追溯规划分组，是否新增独立实体在详细设计时确定。运行后修改范围或验收不能覆盖冻结计划。独立 Verifier 决定完成；有界修复策略须事先明确授权。混合执行器与新验证类型先落实契约和迁移，不只增加 UI 选项。见 [M4 合同](m4-planning-scope.md)。

M5 内置 AI Transformation Pack 管领域访谈、企业现状/流程 schema、评估、目标方案和业务规则；M6 将领域任务交回 Core 调度，并增加集成/业务验收。Core 继续管理身份、版本、权限、执行、证据和恢复，不能包含某个企业的固定业务逻辑。M8 基于真实内置 Pack 的经验抽取 SDK，M5 不等待通用 SDK。见 [Pack 合同](ai-transformation-pack-scope.md)。

这些合同不引入当前依赖或空包；实际模型适配、对话存储、schema 与迁移编号在后续详细阶段中验证确定。
