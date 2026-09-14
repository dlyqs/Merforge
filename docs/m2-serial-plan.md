# M2 阶段执行计划：可控串行计划

## 目标与执行入口

将 M1 单任务运行时扩展为人工定义的 `Goal → Plan → Phase → Task`，用 Runtime 强制执行审阅门禁、串行顺序及 `manual / auto / auto_until` 边界，并在重启后保留审批、执行授权与停止位置。本文件是 M2 唯一阶段状态真源；后续“继续”“执行 Phase X”先读本文件和 [项目概览](overview.md)。

依据：[路线图 M2](roadmap.md)、根目录 [v0.1 开发说明](<../Merforge v0.1 — 开源 Agent Orchestration Framework & AI Transformation Agent 开发说明.md>) 第 12.4–12.7、18、19、21、24、25 节。路线图 M2 是原说明 Phase 1 的计划与执行控制子集，不等于开发原说明 Phase 2 的 Codex 集成。

- execution mode: manual
- automatic start phase: none
- automatic stop phase: none
- conversation relay: authorized; Phase 1–4 boundary reached, creating successor for Phase 5–7
- plan review: accepted for execution (2026-09-14 user instruction)
- execution authorization: 2026-09-14 用户“请自动完成 phase1-4 然后新开对话自动完成剩余 phase”；接力止于 M2。

这里的执行模式字段管理**开发本计划**；下文产品执行模式是将要实现的数据库契约，二者互不授权。M1 的自动执行授权已在 M1 结束，不能继承到 M2。无需额外创建专用 executor Skill。

## 基线、范围与可行性

M1 已完成，证据保留在 [M1 验收记录](next-milestone.md)。最初编写计划时的只读核对发现：Contracts 版本为 `0.2`；数据库已有四条追加迁移；`createGoal` 自动创建一个 Task；`start` 只判断 Task/Attempt，没有 Plan 门禁；事件要求非空 taskId；启动恢复将 running 标为 interrupted、重放 verifying、保留 ready 和 waiting_human。M1 记录的 29 项测试为既有验收结果，本次文档编写未重新执行。

M2 属于 large goal：需要同时改变持久化模型、调度入口、恢复链和三端操作。可行性高，现有 SQLite 短事务、单实例所有权、Mock/Human 与独立 Verifier 可复用，无需模型凭证或工作流引擎。主要风险及落点：

| 风险                                     | 控制与验证落点                                                                   |
| ---------------------------------------- | -------------------------------------------------------------------------------- |
| 旧 Task API 绕过计划审批或阶段边界       | Phase 2–4：所有计划内 run/retry/mock-run 经统一 Runtime 门禁，测试直接调用旧接口 |
| 审批与修订竞态，旧审批批准新内容         | Phase 1–2：不可变修订、显式 revision、条件写入、历史审批保留                     |
| 验证完成与下一任务派发之间崩溃           | Phase 3、5：持久状态决定可运行项，重算聚合状态，重复唤醒不重复领取               |
| auto_until 边界在 Human 等待或重启后丢失 | Phase 4–5：持久化模式、两端与授权；每次派发重新检查                              |
| 迁移损坏旧历史或伪造审批                 | Phase 1：保留无 Plan 的旧任务路径，旧库 fixture 与外键完整性验证                 |

**包含：** 人工输入的版本化计划；有序阶段和阶段内有序任务；Mock/Human；计划审阅；可选阶段入口人工审批；失败显式 retry；控制模式；重启核对；API/CLI/Web 最小闭环；三阶段可复现演示。

**不包含：** 智能 Planner、目标归一/复杂度分类、动态阶段拆分产品功能、DAG/并行调度、Codex/Claude/Generic Executor、真实工作区恢复、任意命令验收、业务 Pack、模型接入、跨会话 Agent 接力、生产部署和通用策略引擎。这些仍按 M3 以后安排。开发计划的受控子阶段拆分规则不代表 M2 产品支持动态拆计划。

## 产品契约与实现约束

以下是用户已授权执行的实施决策；如执行时发现不能兼容，先记录证据并修订相关阶段，不能默默换语义。

1. **计划与顺序：** 一个新计划型 Goal 对应一个 Plan 身份及递增 revision；一个 revision 含非空有序 Phase，每个 Phase 含非空有序 Task。顺序由服务端校验并保存，稳定 ID 与显示序号分离。同一 Plan 至多一个活跃 Task Attempt；不同 Goal 沿用既有独立运行能力，不增加跨 Goal 全局队列。
2. **兼容入口：** 既有 `POST /api/goals` 默认单任务行为保持；新增显式计划型创建入口原子保存 Goal/Plan/Phase/Task，不额外生成孤立默认 Task。旧 Task 没有 phaseId，按 M1 运行；新计划 Task 的 phaseId 不可由调用者去掉。不得给旧数据补造 approval、Phase 或 PASS。GoalDetail 兼容保留旧集合，新增计划信息；需要调整事件契约以支持无 taskId 的 Plan/Approval 事件，不能虚挂到首个任务。
3. **版本与修改：** 审阅对象包含任务内容、executorId、验收版本、顺序、阶段审批要求及计划 schemaVersion。提交新 revision 保留旧快照，当前审阅恢复 pending，旧 approval 不对新版本生效。M2 只允许整个 Plan 从未产生 Attempt 时修订；开始执行后内容冻结，拒绝替换/删除阶段、切换执行器或验收规则。模式控制单独保存，不篡改已审阅内容。
4. **审批与启动分离：** plan review 和可选 phase-entry approval 为独立 Approval 记录，绑定 planId/revision，阶段审批额外绑定 phaseId。决策为 pending/approved/rejected；保存本地操作者标签与时间，但不宣称认证身份。创建与批准都不自动授予执行权；初次启动必须显式命令。拒绝计划需新 revision 重审；拒绝阶段则停止，允许显式新建同版本该阶段的审批请求，保留旧拒绝，禁止后台无限重建。Human 提交是工作产物，不是 approval。
5. **串行与完成：** 仅所有前序阶段完成才可选择下一阶段，阶段内按任务顺序派发。每个任务仍由 M1 Verifier PASS 决定 completed；全部任务完成才完成 Phase，全部 Phase 完成才完成 Plan。failed/interrupted 阻止后续任务；等待 Human/审批不能算完成。聚合状态和停止原因区分存储，建议 Phase 使用 pending/in_progress/completed/blocked，Plan 另有 review 状态与 idle/running/waiting/blocked/completed 执行状态，Phase 1 固化合法转换表。
6. **模式语义：** 默认 manual；一次 continue 或指定 Phase 命令授权该阶段内串行任务，阶段完成即停，指定后序阶段不能跳过依赖。auto 显式授权后连续执行所有合格阶段。auto_until 保存包含两端的稳定 phaseId，省略起点取首个未完成阶段，校验起止同属当前 revision、顺序合法且无跳过依赖。范围全部完成后同事务切回 manual、清空两端并记录 boundary_reached，后续 Phase 不得产生 Attempt。manual/auto 两端为空；完成任务不重跑，范围已满足则直接确认边界。
7. **运行中控制：** 模式变更在事务中更新控制版本，每次派发重读；当前 Attempt 不强制取消。切 manual 时当前阶段可完成但不进入下一阶段；没有活跃阶段则停止等待显式启动。新 auto_until 终点不能早于当前已授权的活跃阶段。单阶段执行命令即使在 auto 下也设置持久化的本次阶段限制，结束即停；后续显式 continue 才按保存模式恢复。不能用进程内标志保存限制。M2 不提供取消任意执行器的能力。
8. **等待、失败与恢复：** auto/auto_until 的 Human 或阶段审批等待保留原授权；合格提交/批准后重新检查门禁再推进。失败或中断只允许用户显式 retry，不自动创建新 Attempt；retry 继续受版本、顺序及范围检查。重启先获取 M1 所有权并完成任务核对，再恢复计划推进。已有持久化授权的安全待办可继续；没有启动授权的计划、manual 已到边界、未批准/被拒绝计划都不启动。running 遗留仍为 interrupted，不重启 Mock 冒充恢复；verifying 重放完成后才决定下一步。
9. **工程约束：** 保持 TS/Zod/SQLite/Fastify/Commander/React 与轮询；Runtime 不依赖 API/Web，不引入垂类概念。外部执行与验证不占长事务；状态和业务事件原子提交。数据库只追加迁移；不拆包做无关重构。仅操作临时数据库验证，保留 M1 同库排他和迟到结果防护。
10. **用户要求：** 不自行启动页面，不使用 Playwright 等浏览器工具或 Skill；不使用 GitNexus，不自行调用子代理、提交推送或部署。2026-09-14 用户已明确授权 Phase 4 后新建一个任务继续 Phase 5–7。前端靠类型检查、构建、契约和可测试逻辑验证；用户视觉检查为可选且未执行，不能写为通过。

## 阶段状态总表

本表是唯一全局阶段进度表；实现事实与验证证据只写在对应阶段详情。

| 阶段    | 主题               | 主要目标                           | 状态      | 实际产物                 | 备注                  |
| ------- | ------------------ | ---------------------------------- | --------- | ------------------------ | --------------------- |
| Phase 1 | 计划契约与持久化   | 版本、阶段、审批和控制状态可持久化 | completed | Contracts 0.3、迁移 5    | 已验证                |
| Phase 2 | 修订与审阅门禁     | 人工计划可审阅，旧入口不能绕过     | completed | plans.ts、API、JSON 示例 | 已验证                |
| Phase 3 | manual 串行调度    | 单阶段内逐任务验证并停止           | completed | scheduler.ts、5 项测试   | 已验证                |
| Phase 4 | 自动模式与阶段审批 | auto/auto_until 及等待后继续       | completed | 模式/审批控制、9 项测试  | 同进程验证通过        |
| Phase 5 | 跨重启恢复         | 核对后按原授权恢复，绝不越界       | pending   | —                        | 依赖 Phase 4          |
| Phase 6 | CLI/Web 操作闭环   | 用户可定义、审阅、控制并追踪计划   | pending   | —                        | 依赖 Phase 5          |
| Phase 7 | M2 出口验收        | 三阶段演示与失败/恢复证据齐备      | pending   | —                        | 依赖 Phase 6；止于 M2 |

## Phase 1：计划契约与持久化

**目标：** 固化数据关系及合法状态转换，为后续命令提供版本和并发控制基础。

**预期文件：** `packages/contracts/src/index.ts`（必要时拆 `plan.ts`）；Runtime `schema.ts`、`database.ts`，新增 `plan-state.ts` 和迁移测试 fixture；现有事件消费者兼容修改。

**验收清单：**

- [x] 明确 Plan 身份/revision、Phase/Task 顺序、Approval、执行授权和控制版本字段、状态枚举及转换表；schemaVersion 与 revision、DB user_version 分开。
- [x] 数据约束拒绝重复顺序、跨版本 Phase/Task/Approval 引用及非法边界；空计划、空阶段在写入前拒绝。
- [x] 新增计划事件关联字段，旧 task 事件仍可读，CLI/Web 契约解析不回归。
- [x] 追加迁移保留四个已交付迁移；M0/M1 数据、Artifact、Verification 与事件不丢失，迁移失败整体回滚。

**助手验证：** Zod 正反例、临时库迁移/重开/外键/回滚测试；`pnpm typecheck`、相关 persistence 测试。执行前先记录当前基线检查结果，不能把既有测试记录当本次通过。

**用户手动检查：** 无必需项。

**依赖与过渡：** M1 完成。此阶段仅持久化基础，产品计划入口未开放，不宣称可执行；记录迁移结果与拒绝原因，按下文脱敏规则输出。

**实际完成：** Contracts 0.3 新增 plan.v1、修订/审批/控制输入与详情契约，Task 可关联阶段，Event 可不关联 Task。追加 `plan-migration.ts` 为第 5 条迁移，保留前四条；`plan-state.ts` 记录聚合转换表。外键、唯一顺序、不可变快照/成员关系及合法控制边界有数据库约束。基线类型检查及全部 29 项测试通过（HTTP 测试经授权解除回环监听限制）；变更后类型检查通过，persistence/verification 18 项及新 plan-persistence 初始 2 项通过（随后补充 v4 fixture 原样保留产物/验证/事件并重开，现共 3 项），涵盖旧库重开、回滚与非法引用。未启动页面。下一阶段：定义/修订/审阅。

## Phase 2：人工计划修订与审阅门禁

**目标：** 可以创建、查看和修订人工计划，审批精确绑定所见版本。

**预期文件：** Runtime 新增 `plans.ts`、`approvals.ts`（名称可随实际职责微调），接入 `index.ts`；Contracts；`apps/api/src/app.ts` 及测试；新增三阶段 JSON 示例 `examples/serial-plan.json`。

**验收清单：**

- [x] 计划型创建独立于旧单任务创建，事务一次保存完整结构；查询返回当前修订、历史审阅与执行状态。
- [x] 创建、修订、review 决策命令显式核对 revision；过期、跨计划/阶段请求拒绝，重复相同决策幂等，冲突决策拒绝。
- [x] 未执行计划的新修订使旧批准失效，首个 Attempt 后拒绝修订；并发 revise/approve 不会串版本。
- [x] 审批通过不派发任务；未审阅或拒绝时所有计划任务 run/retry/mock-run 都不能绕过门禁。调度尚未接通时，计划内直接启动统一拒绝，旧无 Plan Task 继续可用。
- [x] API 区分非法输入、缺失对象和状态冲突，成功/错误响应纳入共享契约。

**助手验证：** Runtime 版本/审批竞态及 API inject 测试；直接调用旧端点绕过测试；`pnpm typecheck` 与相关测试。

**用户手动检查：** 可选查看 JSON 计划与审阅内容是否易懂，非阻塞。

**依赖与过渡：** Phase 1。本阶段只有定义/审阅能力，Phase 3 开启执行。日志覆盖 revision_created、review_requested/decided、revision_conflict、plan_gate_rejected。

**实际完成：** `plans.ts` 原子创建与修订，独立审批记录和版本核对；`errors.ts` 共享运行错误；API 增加 plans、revisions 和 approval decision。`examples/serial-plan.json` 包含三阶段、双任务及 Human/审批示例。Runtime/API 新增 2 项组合测试通过：空计划回滚、批准不启动、旧三种 Task 入口拒绝、过期/跨计划审批、重复/冲突决策、修订历史保留、M1 单任务继续工作；类型检查通过。开始后的冻结条件已实现，随 Phase 3 执行测试验证。下一阶段：manual 调度。

## Phase 3：manual 串行执行与聚合完成

**目标：** 显式运行一个阶段，逐 Task 执行和验证，完成后停止。

**预期文件：** Runtime 新增 `scheduler.ts`，修改 `index.ts` 的 start、验证结果和失败收尾路径；`plan-state.ts`；Contracts/API 控制端点；新增 `scheduler.test.ts`。

**验收清单：**

- [x] 统一资格检查和 Attempt 领取使用同一短事务；计划审阅、版本、顺序、控制授权均不能被公开任务接口跳过。
- [x] 同一 Plan 至多一个 running/waiting_human/verifying Attempt；重复 continue、直接 run、验证回调竞争不并行创建尝试。
- [x] manual 持久化本次选择的阶段；至少两个任务的阶段按顺序完成，阶段完成后下一阶段没有 Attempt。
- [x] 只有 Verifier PASS 推进任务与阶段；Human 等待、FAIL、interrupted、Verifier 错误都阻挡后续任务。
- [x] 显式 retry 保留原 Task/旧 Attempt，成功后继续本次阶段；completed 不重复执行。聚合状态与事件可从持久化事实核对，不依赖内存游标。

**助手验证：** 受控 Mock/Verifier 同步点覆盖先后次序、重复唤醒、失败重试、Human→Mock、跳阶段拒绝；API/Runtime 测试与类型检查。不使用固定 sleep 推断顺序。

**用户手动检查：** 无必需项；CLI/Web 控制入口留 Phase 6。

**依赖与过渡：** Phase 2。只开放 manual；auto 输入明确拒绝直至 Phase 4。记录 scheduler_selected/rejected、phase_started/completed、plan_completed。

**实际完成：** `scheduler.ts` 在同一 SQLite 短事务内核对审批、版本、授权、前序任务并领取 Attempt；数据库另限制同 Plan 单活跃 Attempt。验证/失败收尾同事务重算 Phase/Plan，并保存单阶段授权及边界。新增 continue API；直接 Task run/retry 使用同一门禁。类型检查与 scheduler 5 项测试通过，覆盖同步点控制串行、重复 continue/run/retry、执行后修订冻结、跳阶段拒绝、失败显式重试、Human PASS/FAIL/验证器错误以及 completed 不重跑。auto 控制入口尚未开放，留 Phase 4。下一阶段：模式/审批矩阵。

## Phase 4：自动模式、停止边界与阶段审批

**目标：** 将执行模式和阶段人工门禁变成无法绕过的 Runtime 控制。

**预期文件：** Runtime `scheduler.ts`、`plans.ts`、`approvals.ts`；Contracts/API 模式和审批端点；模式/审批专项测试。

**验收清单：**

- [x] auto 在已审阅且显式启动后连续推进；auto_until 绑定当前 revision 内合法两端，到界切 manual 并清空边界，与阶段完成原子保存。
- [x] 覆盖缺省起点、非法/反向/跨版本边界、已完成范围、不完整前置及完成终点前仍有缺口；不为已完成任务创建新 Attempt。
- [x] 在 auto 中发起单阶段命令只执行该阶段，持久化本次限制；运行中切 manual 或缩小范围不会多派发后续阶段，也不伪造当前 Attempt 取消。
- [x] 阶段入口审批在首个 Task 前等待；请求、批准/拒绝及历史持久化。批准仅恢复已有授权，拒绝不推进；重复批准不会重复执行，旧/跨阶段批准拒绝。
- [x] Human 提交完成与 approval 分离；等待期间模式变更后，以最新控制状态决定是否继续。所有旧 Task 端点同样受范围约束。

**助手验证：** 三阶段模式矩阵、并发模式更新/完成回调、Human 等待中切模式、审批重复/拒绝后新请求；检查边界外 Attempt 数量为零及事件原因；类型/API/Runtime 测试。

**用户手动检查：** 可选确认模式名称和停止原因，非阻塞。

**依赖：** Phase 3。此时先证明同进程语义，跨进程承诺到 Phase 5 验证后才成立。记录 mode_changed、approval_waiting/decided、boundary_reached、execution_paused。

**实际完成：** `scheduler.ts` 实现 auto/auto_until、版本化模式控制、范围合法性检查、单阶段覆盖、运行中切 manual、同事务到界切回 manual/清两端/撤销授权。`plans.ts` 保留阶段审批拒绝历史并支持显式重建；审批与 Human 提交仅恢复已有授权。新增 mode/phase approval API 和共享契约；结构化日志关联计划/版本/阶段/审批/控制版本，拒绝使用固定原因码。模式专项 9 项、manual 调度 6 项（含 M1 中断阻塞）、API 计划 2 项测试通过，覆盖验证进行中控制更新、审批等待/Human 等待切模式、非法/跨修订/已完成范围、重复控制及边界外零 Attempt。最终 `pnpm check` 通过：类型检查、12 个测试文件共 50 项测试、全量构建；真实 HTTP 进程测试获准使用回环随机端口。环境 Node 25.8.2 / pnpm 10.27.0。Vite 仅有依赖 Zod 注释注解警告，不影响构建。README/architecture/overview/roadmap 已同步。未启动页面，视觉检查未执行。Phase 1–4 已到界，开发模式切 manual 并清两端；按用户授权新任务从 Phase 5 自动执行至 M2，完整跨重启恢复保证仍待验证。

## Phase 5：跨重启计划核对与持久授权恢复

**目标：** 无聊天或内存上下文时，仍根据数据库正确判断等待、失败、边界和下一步。

**预期文件：** Runtime `index.ts`、`scheduler.ts`，必要时新增 `plan-recovery.ts`；`recovery.test.ts`、`process.test.ts` 和进程 fixture；API 启动就绪边界。

**验收清单：**

- [ ] 启动按“获取所有权→迁移→M1 Attempt 核对/验证重放→计划聚合核对→授权检查→安全派发”顺序执行；恢复未结束时控制命令等待或明确拒绝，不竞态派发。
- [ ] 审阅待办、阶段审批待办、Human 待办、模式、授权、两端和单阶段限制跨重启保留；没有执行授权的 ready 不派发。
- [ ] 已授权自动计划在前序 PASS 已提交、后继尚未领取的崩溃窗口恢复；若 Attempt 已领取则识别 interrupted，等待显式 retry，不自动重跑。
- [ ] manual 完成边界和 auto_until 停止边界前后强制终止，重启均不创建边界外 Attempt；verifying 重放只能推进一次。
- [ ] M1 同库排他、关闭后迟到回调拒绝、缺产物失败、恢复幂等继续成立；损坏或不一致控制记录安全阻塞并给出原因，不猜测授权。

**助手验证：** 临时库子进程 SIGKILL/重开，受控同步点覆盖提交/派发窗口；同库不同端口实例争用；重复恢复核对状态、Attempt 数及事件。使用本地回环，不启动 Web 页面。权限限制如实记录为未验证，不替代成通过。

**用户手动检查：** 可选人工退出重启；自动进程测试满足功能验收，不依赖人工演示。

**依赖：** Phase 4。真实 Agent 会话/工作区恢复不在范围。记录 plan_recovery_started/finished、recovery_blocked、execution_resumed，关联原授权及版本。

**实际完成：** 未开始，执行后填写。

## Phase 6：CLI/Web 计划操作闭环

**目标：** 用户可以完成定义、审阅、阶段审批、执行控制、失败处理与结果追踪。

**预期文件：** `apps/cli/src/main.ts`；Web `App.tsx`、`api.ts`、`TaskActions.tsx`，按职责增加计划表单/详情组件和样式；API/CLI 测试；README 使用说明。

**验收清单：**

- [ ] CLI 支持从 JSON 文件创建/修订计划、inspect、review、continue/指定 Phase、模式/范围设置及阶段审批，复用既有 retry/submit。最终命令名写入 README，不提前把示例当已实现命令。
- [ ] Web 提供最小人工计划输入（可用带校验提示的 JSON 文本区）、版本化审阅内容、阶段/Task 列表、模式/停止边界、审批及 Human/重试操作；不做图编辑器。
- [ ] 审批操作绑定用户当前查看的 revision；轮询发现版本变化不能静默批准新内容。错误给出具体版本冲突/依赖/停止原因。
- [ ] 旧单任务操作仍可用；计划内 Task 操作展示门禁原因；Mock 和 summary.v1 PASS 的模拟/结构检查含义明确。
- [ ] UI/CLI 不自行推算权威完成状态、不直接写库，继续 API + 轮询。

**助手验证：** CLI→HTTP→临时库集成测试覆盖主要操作和过期审阅；API 错误契约、前端可独立验证的输入/状态映射逻辑；`pnpm typecheck`、相关测试、`pnpm build`。禁止浏览器/Playwright 验证，不为纯样式写无意义测试。

**用户手动检查：** 可选布局、键盘操作、窄屏、审批文本可读性；未执行则明确记录，不阻塞 Phase 7。

**依赖：** Phase 5。日志复用服务端边界事件，不在前端重复上报提交原文。

**实际完成：** 未开始，执行后填写。

## Phase 7：M2 验收、演示与文档收尾

**目标：** 用同一三阶段示例证明完整出口，而非仅展示保存的计划记录。

**预期文件：** `examples/serial-plan.json`；API `cli-process.test.ts` 或独立计划集成测试；Runtime 回归测试；README、`docs/architecture.md`、overview、roadmap、本计划。

**验收清单：**

- [ ] 场景 A：新建三阶段计划，未审阅执行被拒绝；批准不启动；manual 执行第一阶段（含两个 Task）并停，第二阶段零 Attempt。
- [ ] 场景 B：新计划批准后 auto_until 到第二阶段；第二阶段设入口审批和 Human Task，分别在审批等待、Human 等待时重启；批准/合格提交后完成第二阶段，模式回 manual，第三阶段零 Attempt；显式 continue 才完成第三阶段。
- [ ] 场景 C：auto 计划中 Mock 失败，后继不执行；显式 retry 通过后继续；另用延迟 Mock 执行中 SIGKILL，重启标 interrupted、保留边界，显式 retry 后完成。历史错误、验证和审批证据可追踪。
- [ ] 场景 D：审阅旧 revision 后提交新 revision，旧批准失效；过期审批与直接 Task API 绕过均拒绝；批准新版本并显式启动后才产生 Attempt。
- [ ] 补齐边界提交崩溃窗口、模式切换、重复控制请求的专项证据，M1 三场景无回归。
- [ ] README 给出真实可运行命令、模拟性质、兼容策略、恢复限制；architecture/overview 描述实际实现。全部必需项通过才将 M2 标 completed，下一节点 M3 仅建议另行规划。

**助手验证：** `pnpm check`（类型、全量测试、构建）、`pnpm format:check`、`git diff --check`；真实 CLI/HTTP/临时 SQLite 进程测试，检查业务事件和结构化日志能串起场景。记录运行环境、检查结果与未覆盖项；若基线存在无关失败明确区分，不靠构建成功宣布验收完成。

**用户手动检查：** 可选按 README 复现演示及视觉检查；除发现实际阻塞外，不以其尚未执行为由延迟已授权自动流程。

**依赖与终点：** Phase 6。未解决必需验收不得标 completed；达到 M2 即停，不启动 M3、不接真实 Agent。

**实际完成：** 未开始，执行后填写。

## 关键链路可观测性

沿用 `component: merforge.runtime` 的注入式结构化 logger，API 接 Fastify/Pino。既有 Task/Attempt 日志继续保留；新增计划定义/修订→审阅→执行授权→阶段审批→调度→验证聚合→边界停止→恢复的长期边界日志，具体事件见阶段详情。

建议关联字段：`event`、`goalId`、`planId`、`revision`、`phaseId`、`taskId`、`attemptId`、`approvalId`、`controlVersion`、`mode`、`startPhaseId`、`stopPhaseId`、`fromStatus`、`toStatus`、`reasonCode`，仅记录适用字段；性能诊断可加 durationMs。Phase 1 扩展 RuntimeLog 时保持旧调用兼容，不伪造 taskId。

审批、授权变化、阶段完成与停止事件须和相应状态同事务持久化；logger 不替代 Event 或 Verification。日志只在边界变化输出，不逐次轮询/调度空转打印。不记录凭证、环境变量、完整目标/计划、Human 提交原文、大型产物、原始异常敏感载荷。Phase 2–5 测试关联 ID 与固定拒绝原因码，Phase 7 用日志核对失败/审批/恢复链。临时诊断若新增，阶段完成时删除或关闭，不能留下高频噪声。

## 后续执行规则

1. 默认先审阅本计划。创建文档、选择 Skill 和此前 M1 的授权均不启动 M2；用户后续明确“执行 Phase 1”才开始对应阶段。
2. 每次执行先读本计划、overview、当前代码和最新用户要求。复查相关 blocked 的解除条件，解除则恢复 in_progress，未解除则遵守依赖，不能跳过。
3. 单阶段命令“执行 Phase X”仅执行该阶段，即使保存为自动模式也适用；不改变持久化模式，不创建接力任务。若前置尚未完成且不能安全隔离，报告依赖并停止。
4. manual 下“继续”选择首个 in_progress，否则首个 pending，先标记 in_progress，完成检查、记录与文档同步后停止。
5. 计划存在后，明确“自动完成剩余阶段”才能启用 auto；先记录原始授权，两端为 none。每完成一阶段重新读取状态、依赖、模式，继续下一合格阶段，止于 M2 完成或真实阻塞。
6. 明确“自动执行到 Phase X”启用 auto_until；先验证并记录包含两端的范围。省略起点取首个 in_progress，否则首个 pending；计数请求按主表规范为唯一终点。两端必须存在、终点不早于起点且不得跳过依赖；无法解析或非法则保持原模式并请求修正。“执行 Phase 5”与“执行到 Phase 5”不同。
7. auto_until 只选范围内未完成阶段；整个范围完成后切 manual，两端清为 none，记录到界并停止。若范围原已全部完成，记录授权及已满足边界，不重复实现；不能仅因终点 completed 就忽略前面缺口。
8. 自动选阶段前重读授权与依赖并标 in_progress。非阻塞用户手动检查记为未执行并继续；实质产品歧义、确实依赖人工结果/外部状态、新权限或凭证、无法安全修复的验证失败、用户停止才暂停。阶段设 blocked，记录准确解除条件；未撤销则保留自动模式/范围，解除后沿用授权。
9. 只有执行证据表明某阶段过大、风险过高或难以验证时，才最小拆分为 A/B 等子阶段。先更新主表、该阶段详情、验收与后续依赖，再实现；不为对称拆分，保留无关后续编号和已完成记录。auto_until 原阶段终点映射到最后子阶段，除非用户只授权某个子阶段。
10. 每阶段实际完成区域写具体改动/文件、验证命令与结果、跳过原因、偏差/风险、下一阶段；同步主表和 overview。修改架构/使用入口时同步 architecture/README，里程碑变化时更新 roadmap，不再复制一份全局 Phase 进度。
11. 自动执行仅限已审阅 M2 范围，不授权新模型集成、外部发布、部署、提交推送、破坏性操作、新凭证或 M3。本次已获明确接力授权：Phase 4 完成后使用应用新任务工具创建后继任务，传递已验证未提交代码及本计划；后继任务记录 auto 授权并执行 Phase 5–7，不启动 M3。此次未选用 executor Skill，无需额外引用 Skill 接力文件。
