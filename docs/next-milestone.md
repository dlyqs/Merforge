# M1 执行计划：可靠的单任务运行时

## 目标与执行入口

将当前同步 Mock 原型升级为支持独立运行尝试、失败重试、人工提交、确定性验证和重启核对的单任务运行时。本文件是 M1 的唯一阶段执行合同；后续“继续”“执行 Phase 2”先读取本文件和 [项目概览](overview.md)。项目级目标见 [开发计划总表](roadmap.md)，总表的 Milestone 编号与本文件的 Phase 编号互不替代。

当前执行授权：用户于 2026-09-14 指示「继续自动完成剩余 phase」。依次执行剩余 Phase 4–5。M1 涉及持久化契约、异步执行及恢复链路，按 large goal 管理。

- execution mode: manual
- automatic start phase: none
- automatic stop phase: none
- conversation relay: off
- plan review: accepted（用户明确指定执行范围）
- execution authorization: 2026-09-14「继续自动完成剩余 phase」（Phase 4–5 已完成，M1 结束）

默认不创建专用执行 Skill；本计划足以作为执行入口。

## 当前基线、范围与可行性

实施前基线：`packages/runtime/src/index.ts` 将同步 Mock、Run、Evidence、Task 完成与事件写入同一事务；Task 只有 ready/completed；没有真正失败尝试、HumanExecutor 或独立 Verifier。该基线只是初始开发说明 Phase 0/1 的部分基础；本轮成果见下方阶段记录。

M1 范围：单 Goal 对应单 Task；Mock/Human 两种执行方式；Task 和 Attempt 分离；短事务；固定版本的结构化提交检查；人工重试；单机重启核对；现有 React/CLI/API 的最小操作支持。

后置：多任务/Phase/DAG 调度、计划审批、智能 Planner、Codex/Claude、工作区沙箱、外部操作、业务 Pack、SSE、图编辑、远程部署。这里的开发执行模式 manual/auto/auto_until 是本计划的执行规则，**不是 M1 产品已实现的工作流模式**。

可行性高，现有 TS/SQLite/Fastify 基础可以复用。主要风险为事务拆分后的中断窗口、重复领取、旧结果覆盖、数据库兼容性和实例排他保护。各风险必须通过下述阶段测试解决。恢复承诺限于待办和已持久化产物；不承诺恢复任意代码位置、真实 Agent 会话或外部操作恰好一次。

## 约束与兼容策略

- 保持 React、Node.js LTS、pnpm、Zod、SQLite/Drizzle、Fastify、Commander；不引入工作流引擎。
- 保持本机单用户、单 daemon；不为本阶段添加多机器租约系统。Phase 4 实现同一数据库的实例排他与失效持有者识别。
- 旧数据库仅追加迁移；旧 Mock 完成记录保持可读且明确标记为模拟，不补造真实验证结果。保留可重放的迁移测试 fixture。
- 创建目标默认仍为 Mock；新增 Human 作为显式选项。尽量保留现有路由与 CLI；若 mock-run 改为异步返回 202，API、契约、CLI/Web 必须在同阶段兼容更新并记录变更。
- 状态/事件事务提交一致；异步 Executor 和 Verifier 不占用长事务。每个 Task 最多一个活跃 Attempt。
- Task 的验收规则与版本创建时绑定，M1 不提供运行中修改规则的入口。Mock Evidence 始终显示模拟性质。
- 不自行拉起页面，不使用 Playwright 等浏览器工具或 Skill；本计划未授权 GitNexus、子代理、新任务接力、提交推送或部署。
- 沿用轮询。用户自愿视觉检查默认不阻塞后续阶段，不能把未进行的视觉检查记录为通过。

## 阶段状态总表

状态仅使用 pending / in_progress / completed / blocked。实际完成细节只写入相应 Phase，表格保持摘要。

| 阶段    | 主题               | 主要目标                                | 状态      | 实际产物                  | 备注                  |
| ------- | ------------------ | --------------------------------------- | --------- | ------------------------- | --------------------- |
| Phase 1 | 状态与持久化契约   | 分离 Task / Attempt，建立合法转换及迁移 | completed | 契约、追加迁移、测试      | 无前置阶段            |
| Phase 2 | 异步执行与重试     | 持久化后派发 Mock，失败可重试           | completed | 异步派发、重试、202 适配  | 依赖 Phase 1          |
| Phase 3 | 独立验证与人工提交 | 产物经检查后完成，支持 Human            | completed | 独立验证、Human、回归测试 | 依赖 Phase 2          |
| Phase 4 | 重启核对与实例边界 | 保留待办，识别中断，拒绝旧结果          | completed | 所有权、恢复与进程测试    | 依赖 Phase 3          |
| Phase 5 | 操作闭环与验收     | 补齐 UI/CLI、进程级回归和演示           | completed | CLI/Web 闭环、三场景验收  | 依赖 Phase 4；M1 终点 |

## Phase 1：状态与持久化契约

**目标：** 让任务身份、运行尝试和状态转换具备稳定基础。

**预期代码区域：** `packages/contracts/src/index.ts`；`packages/runtime/src/schema.ts`、`database.ts`、`index.ts`；新增状态转换模块（建议 `state-machine.ts`）；对应 Runtime 测试。按兼容需求更新消费者类型。

**实现与验收清单：**

- [x] Task 覆盖 ready/running/waiting_human/verifying/completed/failed/interrupted；明确每条允许转换及前置条件。
- [x] Attempt 保存 taskId、尝试序号、executorId、状态、开始/结束时间、错误；重试不改变 Task ID。
- [x] 单一 Runtime 命令入口实施条件更新；数据库保证尝试序号唯一及至多一个活跃 Attempt。
- [x] 状态和相应业务事件原子写入，失败事务不留下部分记录。
- [x] 从旧 schema 迁移并重开数据库后，旧目标、任务、Mock 记录仍可读取。

**助手验证：** 状态转换单测、重复领取/约束测试、迁移 fixture 回归；`pnpm typecheck`、`pnpm test`。迁移与回滚测试使用临时数据库，不修改用户实际数据库做破坏性验证。

**用户手动检查：** 可选检查旧目标的可读性；不是后续硬门禁。

**依赖/过渡：** 暂保留现有同步 Mock 兼容路径，明确它仍是模拟；Phase 2 才切换异步。日志遵循下文通用规范，重点记录 transition_rejected 与 attempt_created。

**实际完成：** 2026-09-14。更新 contracts、runtime/schema.ts、database.ts、index.ts，新增 state-machine.ts、persistence.test.ts 与 fixtures/v1.sql。Task/Attempt 分离，数据库限制序号和单活跃尝试；旧 Run/Evidence 保留。`pnpm typecheck`、`pnpm test` 通过（8 项）。同步 Mock 兼容路径仍保留，仅作模拟；Phase 2 移除该过渡路径。用户视觉检查未执行（可选）。下一阶段：Phase 2。

## Phase 2：异步 Mock 与显式重试

**目标：** 先记录 Attempt，再执行，失败可追踪且可重试。

**预期代码区域：** `packages/runtime/src/executor.ts`、`index.ts`，按需新增执行派发模块；`apps/api/src/app.ts`；共享请求/响应契约；现有 CLI/Web 接口调用适配。

**实现与验收清单：**

- [x] Mock 支持可控延迟、成功与失败；提供最小异步执行/结果接口，不提前实现完整 Agent 生命周期。
- [x] API 受理返回 202 与 taskId/attemptId，查询可观察 running，不等待长执行结束。
- [x] 执行前完成事务提交；结果、错误及状态在新的短事务中保存。
- [x] 失败后显式 retry 创建新 Attempt，保留旧错误和尝试历史；重复发起不创建并行尝试。
- [x] 异步结果保存为产物并进入 verifying，不由 Executor 宣布 completed。
- [x] 现有页面/CLI 兼容异步响应，不继续将受理响应解析成旧 GoalDetail。

**助手验证：** 延迟 Mock 请求及时返回、失败→retry、Task ID 不变、两次 Attempt 留存、重复请求保护和数据库重开；类型检查、API/Runtime 测试。使用受控同步点而非脆弱的固定 sleep 判断状态。

**用户手动检查：** 可选观察 running 与失败提示；非阻塞。

**依赖/过渡：** Phase 1 完成。成功结果在本阶段允许停在 verifying，直至 Phase 3 接通独立验证；阶段报告必须明确这一临时限制。记录 executor_started / executor_finished / executor_failed。

**实际完成：** 2026-09-14。重构 runtime/index.ts、executor.ts，新增产物追加迁移；更新 Contracts、API、CLI/Web 的 202 解析与页面状态文案。Runtime 以短事务命令保存关联事件并注入结构化日志；失败错误码保留，retry 使用原 Task 和新 Attempt。`pnpm typecheck`、`pnpm test` 通过（8 项，含受控执行器同步点、重复连接领取、失败重开与重试）。成功此时停在 verifying，Phase 3 接通验证。提前在本阶段增加 artifacts 表以满足产物持久化要求；视觉检查未执行（可选）。下一阶段：Phase 3。

## Phase 3：独立 Verifier 与 HumanExecutor

**目标：** 人与 Mock 使用同一产物验证链路，提交不等于完成。

**预期代码区域：** `packages/runtime/src/executor.ts`，新增 `verifier.ts`，产物/验证表与迁移；Contracts；API 的 Human 提交和重试操作。

**实现与验收清单：**

- [x] 内置版本化通用提交契约，例如 `{ summary: 非空字符串 }`；保存验收版本与提交产物，不支持任意可执行检查脚本。
- [x] Verifier 独立输出 PASS/FAIL、检查原因及版本。只有当前 Attempt 的 PASS 可令 Task completed。
- [x] 验证失败为 failed，保留原提交和验证明细；重试产生新 Attempt。
- [x] Human 进入 waiting_human；提交时检查 Attempt 身份/状态，防止重复消费和过期提交。
- [x] Mock 成功自动进入相同验证入口，产物/证据保留 mock 标识；Human 不等于审批功能。
- [x] 验证重放不会重复写入同一 Attempt 同一验收版本的最终判定。

**助手验证：** 合法/缺字段/错误类型产物、重复提交、过期提交、失败重试、Mock 验证；验证未通过无法完成；API 和 Runtime 测试及类型检查。

**用户手动检查：** 可通过 API/CLI 示例检查 FAIL 原因；图形提交入口在 Phase 5 完善，非阻塞。

**依赖/说明：** Phase 2 完成。JSON 结构合格只证明示例契约通过，不宣称业务判断正确。记录 human_submission_received、verification_started / passed / failed，不记录原始提交内容。

**实际完成：** 2026-09-14。

- 文件：contracts/index.ts；runtime/index.ts、executor.ts、verifier.ts、schema.ts、database.ts；verification.test.ts、persistence.test.ts、runtime.test.ts；API app.ts/app.test.ts；README、overview、architecture 与 roadmap。
- 行为：创建时绑定 `summary.v1`；Human 经 run 进入 waiting_human，提交携带 Task/Attempt 身份；Mock/Human 统一保存产物后独立验证，只有当前 Attempt PASS 完成。失败保留原始 JSON、原因码、版本和历史；最终判定去重。旧模拟记录不补造验证。所有新 Mock Evidence 保留模拟说明。
- 验证：`pnpm typecheck` 通过；`pnpm test` 全部 25 项通过（4 文件）；`pnpm format:check`、`pnpm build`、`git diff --check` 通过。测试覆盖旧库迁移及失败回滚、受控异步提交边界、重复领取、失败重开再重试、Human 重开/重复/过期/跨 Task 提交、各类不合格 JSON、Mock 验证、Verifier 错误、事务外验证与并发重放。检查实际使用 Node.js 25.8.2/pnpm 10.27.0，未另行验证推荐的 Node.js 24。
- 修正：回归发现 JSON null 被 ORM 映射为 SQL NULL，现显式序列化；查询产物/判定显式按 Attempt 排序。构建仅有 Zod 依赖的 Rollup 注释警告，不影响成功产物。
- 范围/跳过：Human/重试通过 API 可用，CLI inspect 可读取原因；图形提交入口和专用 CLI 操作依计划留给 Phase 5。未启动页面、未做视觉检查（可选），未操作真实用户数据库，未提交推送。没有实现 Phase 4 的实例排他、强制终止恢复或启动核对，因此 M1 整体仍 in_progress。
- 已到达用户授权的 Phase 3 边界，Phase 1–3 均 completed；模式切回 manual，两端清为 none。下一阶段为 Phase 4，等待后续执行指令。

## Phase 4：重启核对与实例排他

**目标：** 区分已完成、等待人工和执行中断，避免重启伪造成功或重复派发。

**预期代码区域：** 新增 Runtime 恢复/实例所有权模块，`packages/runtime/src/index.ts`、`database.ts`，`apps/api/src/main.ts` 的启动/关闭边界；进程级测试。

**实现与验收清单：**

- [x] 同一数据库只有一个活跃 daemon；实例保护覆盖不同端口启动，不能只依赖端口冲突。
- [x] 核对失效实例后才能获取所有权并恢复；不能只因锁文件存在而永久无法启动，也不能仅按 PID 数值盲删活跃锁。
- [x] running 遗留 Attempt 转 interrupted，保留历史，用户显式重试；ready 不自动派发。
- [x] waiting_human 保留；verifying 使用已保存产物重跑无副作用验证；completed 不再执行。
- [x] 结果提交核对 Attempt 身份、当前状态与实例所有权，旧结果不得覆盖新尝试。
- [x] 恢复重复运行结果一致，缺少必要产物时记录明确错误而非判成功。

**助手验证：** 子进程强制终止/重启、双实例争用、锁持有者失效恢复、verifying 重放、迟到结果与恢复幂等测试。使用临时数据库与本地回环地址；端口权限不足时报告实际限制，不冒充通过。

**用户手动检查：** 可选手动退出/重启演示，自动进程测试可替代其验收作用。

**依赖/说明：** Phase 3 完成。不承诺外部 Agent 的恢复。实现前记录所选单机所有权策略；若其范围无法在本阶段内可靠验证，按受控拆分规则细分。记录 ownership_acquired / rejected、recovery_started / finished、attempt_interrupted、stale_result_rejected。

**实施策略：** 独立 SQLite owner 文件持有 BEGIN IMMEDIATE，进程退出由 OS 释放锁，不删除锁文件、不按 PID 猜测；路径 realpath 归一化并拒绝硬链接。仅支持本机磁盘，排他先于迁移与恢复。

**实际完成：** 2026-09-14。新增 `runtime/ownership.ts`、`recovery.test.ts`、`process.test.ts`、`fixtures/owner-process.mjs`；更新 Runtime 与事务外执行/验证测试。所有 Runtime 在迁移前获取独占所有权，API 继承此边界，原 onClose 负责释放。启动核对中断、保留待办并重放持久化验证；缺产物明确 failed/MISSING_ARTIFACT，关闭后旧回调拒绝落盘并记录关联日志。`pnpm typecheck` 与 `pnpm test` 通过（28 项，6 文件），覆盖真实 SIGKILL/重启、进程争用、符号链接、幂等与迟到结果。无新增业务表迁移；owner 是独立协调文件。可选人工重启/视觉检查未执行；本地磁盘单实例范围，无 PID 推断。下一阶段 Phase 5（含不同端口 API 争用与 CLI→HTTP 三场景）。

## Phase 5：操作入口与 M1 验收

**目标：** 将已实现的能力组织成可复现的用户操作闭环。

**预期代码区域：** `apps/web/src/App.tsx`、`api.ts`（按需要拆分详情/表单组件）；`apps/cli/src/main.ts`；API/Runtime 测试；`README.md`、`docs/overview.md`。

**实现与验收清单：**

- [x] 页面提供 executor 选择、状态、Attempt 历史、错误、验证详情、显式重试和 Human 提交入口。
- [x] CLI/API 提供对应操作；错误反馈可定位到任务与尝试，继续轮询，不引入新图形框架。
- [x] 场景 A：Mock 第一次失败，重试通过模拟验证，两次记录均保留。
- [x] 场景 B：Human 等待→重启→不合格提交 FAIL→重试→合格提交 PASS。
- [x] 场景 C：延迟 Mock 运行中强制退出→重启识别 interrupted→重试；旧结果不能覆盖新状态。
- [x] README 写明演示命令、迁移兼容、模拟含义和恢复边界。
- [x] 原有创建/查询链路无回归；所有阶段验收缺口关闭，或明确标为未完成，不能仅凭构建通过宣布 M1 完成。

**助手验证：** `pnpm format:check`、`pnpm typecheck`、`pnpm test`、`pnpm build`；真实 CLI→HTTP→临时 SQLite 演示与进程恢复测试。禁止浏览器自动验收。

**用户手动检查：** 可选检查布局、交互文案与窄屏可用性；记录为未执行的非阻塞视觉项，不宣称视觉一致性已验证。

**依赖/终点：** Phase 4 完成。全部必需检查通过即达 M1，不自动执行 roadmap 的 M2。核对关键日志可由 taskId/attemptId 串起三个场景。

**实际完成：** 2026-09-14。

- 文件：Web App.tsx、api.ts、styles.css，新增 TaskActions.tsx；CLI main.ts；新增 API cli-process.test.ts、fixtures/daemon.ts；README、overview、architecture、roadmap 与本计划。
- 行为：CLI 新增 executor 选择、run/retry/submit 与 Mock 延迟/结果选项，保留 mock-run；Web 提供相同操作和尝试/错误/产物/版本/原因明细，表单绑定当前 Attempt，继续轮询。PASS 与模拟含义保持明确。
- 验证：`pnpm format:check`、`pnpm typecheck`、`pnpm build`、`git diff --check` 全部通过；`pnpm test` 29 项、7 文件全部通过。真实 CLI→HTTP→临时 SQLite 完成 A/B/C，含 SIGTERM 待办恢复、SIGKILL 中断恢复、不同随机端口同库排他、旧提交拒绝及按 goalId/taskId/attemptId 关联失败/恢复日志。Runtime 受控同步点证明旧回调不覆盖新尝试及 verifying 重放幂等。
- 环境：Node.js 25.8.2 / pnpm 10.27.0，未另测推荐 Node.js 24。首次 HTTP 测试被沙箱 EPERM 阻止，获得沙箱外执行许可后专项及完整测试均通过。首次测试夹具工作目录错误已修正。构建仅有既有 Zod/Rollup 注释警告。
- 跳过/范围：未启动页面，布局/窄屏视觉检查未执行（可选、非阻塞）；未操作用户实际数据库，未提交推送或部署。所有必需验收项完成，无剩余阻塞。M1 completed，自动执行在本计划终点结束并切回 manual；下一步是另行规划 M2，本次未启动 M2。

## 关键链路可观测性

长期保留以下业务边界事件：创建/领取 Attempt、非法转换、派发开始/结束/失败、人工提交受理、验证结果、恢复判断、实例所有权冲突、迟到结果拒绝。具体阶段事件见各阶段依赖说明。

沿用 API 的 Fastify/Pino，Runtime 使用可注入的结构化日志接口，不依赖 Fastify 实例。建议字段：`component: merforge.runtime`、`event`、`goalId`、`taskId`、`attemptId`、`fromStatus`、`toStatus`、`errorCode`、必要时 `durationMs`。只在边界记录，不逐轮询重复输出。

业务事件与状态同事务保存；调试日志不代替业务事件或 Evidence。不得记录凭证、环境变量、完整目标文本、人工提交原文、大型产物；记录 ID、类型、大小或检查代码即可。测试至少覆盖失败和恢复路径的关联字段。

## 后续执行规则

1. 创建/改造计划或选择 Skill 不等于执行授权；以顶部记录的用户明确指令与范围为准。
2. 每次执行先读本计划、overview、当前代码和用户约束。先复查相关 blocked 阶段的解除条件：已解除恢复为 in_progress，否则遵守依赖门禁。
3. 单阶段命令“执行 Phase X”只做该阶段，即使持久化模式为自动也不连带下一阶段，不改变持久化模式、不创建接力任务。前置未完成且无法隔离则报告依赖，不跳过。
4. manual 下“继续”选首个 in_progress，否则首个 pending；先标记 in_progress，完成验证和记录后停止。不得同时开展多个阶段。
5. auto 仅由计划存在后的明确连续执行授权启用；先记录用户指令，边界均为 none。每阶段完成后重新读取状态、依赖和授权，继续下一个合格阶段，直至本计划完成或真实阻塞。
6. auto_until 同样需事后明确授权。校验并记录包含两端的实际范围；省略起点使用首个 in_progress，否则首个 pending；“再完成 N 阶段”按主表顺序解析出唯一终点。终点不得早于起点，不能跳过依赖。范围无效时保持原模式并请求修正。
7. auto_until 只执行范围内未完成阶段。全部完成后切回 manual，两边界清为 none，并在最后执行阶段的实际完成记录中写明到达授权边界；若范围原已全部完成，只在授权字段记录此次指令与已满足边界，不重复实施。不能仅凭终点 completed 忽略范围内缺口。
8. 自动选择每一阶段前重读计划；非阻塞人工检查记为待检查，继续推进。重大歧义、依赖人工结果、新权限/外部条件、无法安全修复的验证失败或用户中止才暂停。阻塞阶段设 blocked 并记录条件；除非用户撤销，保留自动模式/范围，解除后复用授权。
9. 仅当实际执行证明阶段过大、风险过高或难以验证，才拆成最少必要子阶段（通常 A/B）。先更新主表、该阶段细节、验收和依赖再实现；保留后续编号，不为对称预拆。auto_until 原阶段终点覆盖其最后子阶段，除非用户明确只授权到某子阶段。
10. 每阶段实际记录包含具体文件、实际行为、检查命令/结果、跳过及原因、偏差、风险/阻塞条件、下一阶段建议；同步主表和 overview。总路线表只在里程碑状态发生实质变化时更新摘要，不复制 Phase 进度。
11. 自动执行不授权扩展到 M2、部署、提交推送、破坏性操作或新凭证使用。conversation relay 为 off；启用必须另获该计划的明确新会话接力授权并加载 Skill 的 relay reference，不能自行新建任务。
