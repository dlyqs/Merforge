# M1 执行计划：可靠的单任务运行时

## 目标与执行入口

将当前同步 Mock 原型升级为支持独立运行尝试、失败重试、人工提交、确定性验证和重启核对的单任务运行时。本文件是 M1 的唯一阶段执行合同；后续“继续”“执行 Phase 2”先读取本文件和 [项目概览](overview.md)。项目级目标见 [开发计划总表](roadmap.md)，总表的 Milestone 编号与本文件的 Phase 编号互不替代。

本次需求已归一为：改造已有 M1 计划、创建总路线表与项目概览，不实施功能。范围明确，无需额外澄清。M1 涉及持久化契约、异步执行及恢复链路，按 large goal 管理。

- execution mode: manual
- automatic start phase: none
- automatic stop phase: none
- conversation relay: off
- plan review: pending
- execution authorization: none（本次仅授权文档改造）

默认不创建专用执行 Skill；本计划足以作为执行入口。

## 当前基线、范围与可行性

基线：`packages/runtime/src/index.ts` 将同步 Mock、Run、Evidence、Task 完成与事件写入同一事务；Task 只有 ready/completed；没有真正失败尝试、HumanExecutor 或独立 Verifier。当前成果只是初始开发说明 Phase 0/1 的部分基础，不代表这两个阶段已完成。

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

| 阶段    | 主题               | 主要目标                                | 状态    | 实际产物 | 备注                  |
| ------- | ------------------ | --------------------------------------- | ------- | -------- | --------------------- |
| Phase 1 | 状态与持久化契约   | 分离 Task / Attempt，建立合法转换及迁移 | pending | —        | 无前置阶段            |
| Phase 2 | 异步执行与重试     | 持久化后派发 Mock，失败可重试           | pending | —        | 依赖 Phase 1          |
| Phase 3 | 独立验证与人工提交 | 产物经检查后完成，支持 Human            | pending | —        | 依赖 Phase 2          |
| Phase 4 | 重启核对与实例边界 | 保留待办，识别中断，拒绝旧结果          | pending | —        | 依赖 Phase 3          |
| Phase 5 | 操作闭环与验收     | 补齐 UI/CLI、进程级回归和演示           | pending | —        | 依赖 Phase 4；M1 终点 |

## Phase 1：状态与持久化契约

**目标：** 让任务身份、运行尝试和状态转换具备稳定基础。

**预期代码区域：** `packages/contracts/src/index.ts`；`packages/runtime/src/schema.ts`、`database.ts`、`index.ts`；新增状态转换模块（建议 `state-machine.ts`）；对应 Runtime 测试。按兼容需求更新消费者类型。

**实现与验收清单：**

- [ ] Task 覆盖 ready/running/waiting_human/verifying/completed/failed/interrupted；明确每条允许转换及前置条件。
- [ ] Attempt 保存 taskId、尝试序号、executorId、状态、开始/结束时间、错误；重试不改变 Task ID。
- [ ] 单一 Runtime 命令入口实施条件更新；数据库保证尝试序号唯一及至多一个活跃 Attempt。
- [ ] 状态和相应业务事件原子写入，失败事务不留下部分记录。
- [ ] 从旧 schema 迁移并重开数据库后，旧目标、任务、Mock 记录仍可读取。

**助手验证：** 状态转换单测、重复领取/约束测试、迁移 fixture 回归；`pnpm typecheck`、`pnpm test`。迁移与回滚测试使用临时数据库，不修改用户实际数据库做破坏性验证。

**用户手动检查：** 可选检查旧目标的可读性；不是后续硬门禁。

**依赖/过渡：** 暂保留现有同步 Mock 兼容路径，明确它仍是模拟；Phase 2 才切换异步。日志遵循下文通用规范，重点记录 transition_rejected 与 attempt_created。

**实际完成：** 未开始；执行后填写改动文件、验证结果、跳过项、偏差和下一阶段。

## Phase 2：异步 Mock 与显式重试

**目标：** 先记录 Attempt，再执行，失败可追踪且可重试。

**预期代码区域：** `packages/runtime/src/executor.ts`、`index.ts`，按需新增执行派发模块；`apps/api/src/app.ts`；共享请求/响应契约；现有 CLI/Web 接口调用适配。

**实现与验收清单：**

- [ ] Mock 支持可控延迟、成功与失败；提供最小异步执行/结果接口，不提前实现完整 Agent 生命周期。
- [ ] API 受理返回 202 与 taskId/attemptId，查询可观察 running，不等待长执行结束。
- [ ] 执行前完成事务提交；结果、错误及状态在新的短事务中保存。
- [ ] 失败后显式 retry 创建新 Attempt，保留旧错误和尝试历史；重复发起不创建并行尝试。
- [ ] 异步结果保存为产物并进入 verifying，不由 Executor 宣布 completed。
- [ ] 现有页面/CLI 兼容异步响应，不继续将受理响应解析成旧 GoalDetail。

**助手验证：** 延迟 Mock 请求及时返回、失败→retry、Task ID 不变、两次 Attempt 留存、重复请求保护和数据库重开；类型检查、API/Runtime 测试。使用受控同步点而非脆弱的固定 sleep 判断状态。

**用户手动检查：** 可选观察 running 与失败提示；非阻塞。

**依赖/过渡：** Phase 1 完成。成功结果在本阶段允许停在 verifying，直至 Phase 3 接通独立验证；阶段报告必须明确这一临时限制。记录 executor_started / executor_finished / executor_failed。

**实际完成：** 未开始；执行后填写改动文件、验证结果、跳过项、偏差和下一阶段。

## Phase 3：独立 Verifier 与 HumanExecutor

**目标：** 人与 Mock 使用同一产物验证链路，提交不等于完成。

**预期代码区域：** `packages/runtime/src/executor.ts`，新增 `verifier.ts`，产物/验证表与迁移；Contracts；API 的 Human 提交和重试操作。

**实现与验收清单：**

- [ ] 内置版本化通用提交契约，例如 `{ summary: 非空字符串 }`；保存验收版本与提交产物，不支持任意可执行检查脚本。
- [ ] Verifier 独立输出 PASS/FAIL、检查原因及版本。只有当前 Attempt 的 PASS 可令 Task completed。
- [ ] 验证失败为 failed，保留原提交和验证明细；重试产生新 Attempt。
- [ ] Human 进入 waiting_human；提交时检查 Attempt 身份/状态，防止重复消费和过期提交。
- [ ] Mock 成功自动进入相同验证入口，产物/证据保留 mock 标识；Human 不等于审批功能。
- [ ] 验证重放不会重复写入同一 Attempt 同一验收版本的最终判定。

**助手验证：** 合法/缺字段/错误类型产物、重复提交、过期提交、失败重试、Mock 验证；验证未通过无法完成；API 和 Runtime 测试及类型检查。

**用户手动检查：** 可通过 API/CLI 示例检查 FAIL 原因；图形提交入口在 Phase 5 完善，非阻塞。

**依赖/说明：** Phase 2 完成。JSON 结构合格只证明示例契约通过，不宣称业务判断正确。记录 human_submission_received、verification_started / passed / failed，不记录原始提交内容。

**实际完成：** 未开始；执行后填写改动文件、验证结果、跳过项、偏差和下一阶段。

## Phase 4：重启核对与实例排他

**目标：** 区分已完成、等待人工和执行中断，避免重启伪造成功或重复派发。

**预期代码区域：** 新增 Runtime 恢复/实例所有权模块，`packages/runtime/src/index.ts`、`database.ts`，`apps/api/src/main.ts` 的启动/关闭边界；进程级测试。

**实现与验收清单：**

- [ ] 同一数据库只有一个活跃 daemon；实例保护覆盖不同端口启动，不能只依赖端口冲突。
- [ ] 核对失效实例后才能获取所有权并恢复；不能只因锁文件存在而永久无法启动，也不能仅按 PID 数值盲删活跃锁。
- [ ] running 遗留 Attempt 转 interrupted，保留历史，用户显式重试；ready 不自动派发。
- [ ] waiting_human 保留；verifying 使用已保存产物重跑无副作用验证；completed 不再执行。
- [ ] 结果提交核对 Attempt 身份、当前状态与实例所有权，旧结果不得覆盖新尝试。
- [ ] 恢复重复运行结果一致，缺少必要产物时记录明确错误而非判成功。

**助手验证：** 子进程强制终止/重启、双实例争用、锁持有者失效恢复、verifying 重放、迟到结果与恢复幂等测试。使用临时数据库与本地回环地址；端口权限不足时报告实际限制，不冒充通过。

**用户手动检查：** 可选手动退出/重启演示，自动进程测试可替代其验收作用。

**依赖/说明：** Phase 3 完成。不承诺外部 Agent 的恢复。实现前记录所选单机所有权策略；若其范围无法在本阶段内可靠验证，按受控拆分规则细分。记录 ownership_acquired / rejected、recovery_started / finished、attempt_interrupted、stale_result_rejected。

**实际完成：** 未开始；执行后填写改动文件、验证结果、跳过项、偏差和下一阶段。

## Phase 5：操作入口与 M1 验收

**目标：** 将已实现的能力组织成可复现的用户操作闭环。

**预期代码区域：** `apps/web/src/App.tsx`、`api.ts`（按需要拆分详情/表单组件）；`apps/cli/src/main.ts`；API/Runtime 测试；`README.md`、`docs/overview.md`。

**实现与验收清单：**

- [ ] 页面提供 executor 选择、状态、Attempt 历史、错误、验证详情、显式重试和 Human 提交入口。
- [ ] CLI/API 提供对应操作；错误反馈可定位到任务与尝试，继续轮询，不引入新图形框架。
- [ ] 场景 A：Mock 第一次失败，重试通过模拟验证，两次记录均保留。
- [ ] 场景 B：Human 等待→重启→不合格提交 FAIL→重试→合格提交 PASS。
- [ ] 场景 C：延迟 Mock 运行中强制退出→重启识别 interrupted→重试；旧结果不能覆盖新状态。
- [ ] README 写明演示命令、迁移兼容、模拟含义和恢复边界。
- [ ] 原有创建/查询链路无回归；所有阶段验收缺口关闭，或明确标为未完成，不能仅凭构建通过宣布 M1 完成。

**助手验证：** `pnpm format:check`、`pnpm typecheck`、`pnpm test`、`pnpm build`；真实 CLI→HTTP→临时 SQLite 演示与进程恢复测试。禁止浏览器自动验收。

**用户手动检查：** 可选检查布局、交互文案与窄屏可用性；记录为未执行的非阻塞视觉项，不宣称视觉一致性已验证。

**依赖/终点：** Phase 4 完成。全部必需检查通过即达 M1，不自动执行 roadmap 的 M2。核对关键日志可由 taskId/attemptId 串起三个场景。

**实际完成：** 未开始；执行后填写改动文件、验证结果、跳过项、偏差和下一步建议。

## 关键链路可观测性

长期保留以下业务边界事件：创建/领取 Attempt、非法转换、派发开始/结束/失败、人工提交受理、验证结果、恢复判断、实例所有权冲突、迟到结果拒绝。具体阶段事件见各阶段依赖说明。

沿用 API 的 Fastify/Pino，Runtime 使用可注入的结构化日志接口，不依赖 Fastify 实例。建议字段：`component: merforge.runtime`、`event`、`goalId`、`taskId`、`attemptId`、`fromStatus`、`toStatus`、`errorCode`、必要时 `durationMs`。只在边界记录，不逐轮询重复输出。

业务事件与状态同事务保存；调试日志不代替业务事件或 Evidence。不得记录凭证、环境变量、完整目标文本、人工提交原文、大型产物；记录 ID、类型、大小或检查代码即可。测试至少覆盖失败和恢复路径的关联字段。

## 后续执行规则

1. 本版计划尚待审阅。创建/改造计划或选择 Skill 不等于授权 Phase 1；用户审阅后明确指定开始阶段，记录原始指令，再执行。当前请求只完成文档。
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
