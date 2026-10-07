# 个人任务、持久计划与执行设计

本文拥有个人工作流的业务和 API 语义；施工状态见 [执行计划](personal-workflow-plan.md)。Desktop 是唯一入口。Phase 2 提供数据服务和 Remote，Phase 3 的任务视图和 Phase 4 的增强模式及模型工具已接入；Phase 5 的任务执行与 Phase 6 的持久接力/恢复已接入。

## 数据与完成规则

`packages/workspace/personal-workflow` 拥有 `ctx.personalWorkflow`，是任务数据唯一写入者。计划用根 `TaskId` 标识，子任务同样有稳定的品牌化 `TaskId`。`PhaseId`、`OperationId` 单独品牌化；版本为从 1 开始的整数。Task 包含目标、范围、验收条件、产物路径、可选 cwd、parentTaskId、dependsOn、phaseId 和 required；根必需且没有父节点。所有引用属于同一计划；树只能有一个根且必须连通。移除的 TaskId 不得在后续版本复用于其他任务。

计划的 `planningMode` 可以是 `hierarchical` 或 `phases`；历史缺省为分层计划。分层计划的阶段数组表达审核与推进顺序，不在兄弟任务间插入依赖。每个任务属于一个阶段，显式前置和必要子任务的阶段不得晚于消费者/父任务。依赖图加上“父任务等待必要子任务”的隐含完成边后必须无环。子任务依赖祖先、跨分支与聚合边组成的隐环均拒绝。

CSV 示例：根“交付 CSV 导出”（集成阶段），子任务 A“接口约定”（约定阶段），B“实现导出”和 C“准备独立测试数据”（开发阶段，各依赖 A），D“集成验收”（集成阶段，依赖 B、C）。A 完成后 B/C 同时就绪；两者完成才释放 D。根等待必要子任务和自身验收证据，不能因子任务全部 idle 而完成。可选子任务不阻碍父完成，但显式依赖可选任务仍须完成。

纯投影接受持久 Run/Evidence 的执行观察值，计算阻塞原因、并列候选和子任务完成数。模型不能直接写任务状态。产物是声明，不是证据。API 完成必须由具体 Run 的验证结果、可重查产物位置及验证摘要支持；Codex 完成保留原生报告和每项验收摘要，应用不独立保证结果正确；父任务还需自身验收。

## 持久化、版本与审核

使用现有 `storageDomain`，域 `personal_workflow` version 1，`plans` 表一条记录保存一个根目标的全部不可变版本和操作回执。Desktop 沿用 `storage-json` 路由，单记录写入经现有原子文件替换提交；不新增 SQLite 表，不改变 SQLite SCHEMA_VERSION。未知存储格式/损坏记录拒绝加载，不自动跳过。`KvTable.update` 在存储队列内比较 expectedRevision 并提交；创建也由服务队列串行比较，关闭先拒绝新操作、排空已接收操作再关闭域。锁只覆盖计划提交，不能作为执行期独占锁。

提案/用户编辑均创建新版本；同一版本保存准确任务树、依赖、阶段和审核状态。首版采用全版本审核：任意定义变更令新版本所有批准失效，旧版本及批准保留用于历史展示。批准只接受当前准确版本，单独的用户 Remote 操作不启动执行、不授予工具权限。模型提案接口不能接受 approval、运行状态或自动执行授权。托管 `propose` 在提交队列内核对模式版本、复杂目标评估、Bot Skill 许可和当前对话归属。每个写请求包含 operationId；相同键和相同规范化请求返回原回执，相同键不同请求拒绝，即使期间产生新版也不重复写入。不同幂等键的过期版本请求拒绝，不能覆盖新版本。

根目标的 Project/Bot 归属在首次提案时固定；Session 移动不会更改任务归属。删除对象不删除任务或历史引用，视图显示失效归属；后续执行必须重新核对。编辑旧目标的归属需要未来明确的任务重归属动作，本轮不暴露隐式修改。

## Remote、模型与 Session

`sessionController` 提供 `workflowList`、`workflowRead`、`workflowSave`、`workflowApprove`、`workflowExport`、`workflowSnapshot`、`workflowMode`、`workflowSetMode`、`workflowPreferences` 和 `workflowSetPreferences`。保存/批准为用户动作；提案服务入口 `propose(session, modeRevision, request)` 供 Phase 4 的托管工具消费，只能保存未审核版本。标准 preset 的 `skill-dev-workflow` 提供模式适配和 `workflow_assess` / `workflow_propose`；未明确选择的对话默认继承本人自动识别设置，初值为开启；显式关闭时 API 隐藏工作流工具且不注入方法。Codex 的三个任务声明在原 thread 创建时广告，关闭时由 executor 拒绝调用，方法同样不注入。Client 读取具体版本，导出从同一对象渲染，Markdown 无回写入口。

`workflowSnapshot` 和模型提案把准确版本/批准状态/完整定义记入 `personal-workflow/snapshot`，包括 taskId、operationId 和 Session 的稳定引用。提交顺序：先提交领域记录，再追加 Session 快照，再 flush Session，全部成功才返回。Session 写失败时领域提交不回滚，调用方收到失败；用原 operationId 重试会复用领域回执，补写/flush 快照。快照以 sessionId + operationId 判重，事件内容必须相同；模型可见文本来自已 flush 的快照，未来工具结果由现有工具流水线记录，不能临时读取最新版本替代历史快照。审核本身无须跨存储写入；下次读取记录当时实际批准状态。Session 引用是阅读/规划关联，不授予执行所有权。

此阶段无需修改 agent-loop。真实扩展点：模型能力用 `ctx.tools.register`；模式上下文用 `agent/pre-step` 或已有 prompt 贡献并遵循 Session 日志；执行许可在 `tools/pre-execute` 重新核对；停止在 `agent/turn-stopping`。所有注册经 effect/on 清理。Session 创建/恢复沿用 session-controller 的显式 Agent 操作，不因读取计划创建会话。`workflowSnapshot` 为写日志的显式动作，可以恢复已有普通 Session，但不提交 prompt 或领取任务；其余计划读写不激活 Agent。

## 模式、视图与候选

本人自动规划设置默认开启，当前对话的显式 mode 事件优先；没有 mode 事件才继承本人设置。历史默认 off/revision 0 不代表关闭，历史确有 off 事件则保留。Project/Bot 都能进入，没有 Bot 也可使用。关闭为普通 Agent；开启时简单目标仍普通执行；Bot 禁用规划 Skill 时普通对话继续，但规划操作拒绝。复杂或不确定目标先澄清和评估，再提交未审核方案。Skill 禁用时明确失败，不绕过 Bot 权限。

已实现的 Phase 3 树视图展示拆分层级，依赖视图展示前置与并列分支，详情展示范围、阶段、验收、产物、版本、审核和关联会话。两视图读取同一版本；修改后必须再次审核。输入框沿用现有 `conversation.input.left` 扩展位承载任务选择弹窗，其中下拉列表只列就绪候选。任务列表刷新不领取、不启动，不创建对话；关联历史对话从详情进入。

| Task 状态 | 新执行候选 | 操作 |
| --- | --- | --- |
| draft | 否 | 编辑/提交审核 |
| pending_review | 否 | 查看/编辑/批准 |
| blocked | 否 | 查看依赖/必要子任务 |
| ready | 是 | 显式选择并开始 |
| running | 否 | 打开当前对话/停止 |
| paused | 否 | 显式恢复/接力 |
| needs_reconciliation | 否 | 核对工作区、权限及未知副作用 |
| completed | 否 | 查看成果及历史 |
| cancelled | 否 | 查看历史；重新规划形成新版 |

草稿只存在未来编辑器本地，提交后为 pending_review；批准后按依赖投影为 ready/blocked。running → paused/completed/needs_reconciliation；取消进入 cancelled。paused 仅在用户明确恢复且 Host 复核后进入 running，不作为新执行候选。父任务有必要子任务未完成时 blocked；即使必要子任务全部完成仍需自身执行与验收。已知目录和产物重叠在视图提示，不提供自动文件隔离。

## 执行与恢复协议

规划/阅读关联由 PlanRevision.sessionId 与 Session 快照保存；执行关联由 TaskRun.sessions 保存当前及历史对话。Run 保存 taskId、planRevision、品牌化 RunId、ownerEpoch、状态、动作和 Evidence。每个任务最多一个当前执行者，不同任务可同时持有所有权。领取在该任务原子更新内复核当前版本、批准、前置、终态及所有者，使用 expectedRevision + ownerEpoch + operationId；候选过期返回明确原因并刷新。阅读不是领取，Session 归档不算完成；运行中归档/移动、目录或权限变化暂停受影响任务，等待核对，不扩大范围。

manual 为默认。分层计划的 auto/auto_until 仍只绑定当前任务；顺序阶段计划须显式保存 `startPhaseId` 和 `stopPhaseId`，auto 覆盖剩余全部阶段，auto_until 覆盖含起止端点的范围。Host 校验当前准确版本、审核、顺序、前置和预算，原子保留范围内任务；不能选择范围之外的任务或分配 Agent。可另外授权 `relayEveryPhases`，指定每完成几个阶段自动换一个同目录对话。每次新工具动作核对批准/所有权/权限/预算，取消只阻止后续动作，不能回滚在途副作用。修改正在执行的任务版本须先停止并收敛在途动作；不同任务正常产物变化不自动撤销其他任务批准。

Handoff 保存源/目标 Session、TaskId、revision、ownerEpoch、上下文、决定、证据、cwd、Git HEAD、脏文件指纹、非 Git 资料/产物指纹、预算及停止位置。先提交交接包，再幂等创建目标 Session，再待旧动作收敛或记录 unknown，最后转移 epoch；手动接力的新对话保持暂停，由用户明确恢复并发送执行指令；已授权的阶段自动接力由 Session Controller 复核后恢复并发送持久的继续消息。崩溃恢复对照交接包与 Session 引用补齐关联，不能重发未知 shell/外部动作。只允许同客户端、同工作区接力；无法归因的变化仅暂停受影响任务。

## 验证与观测

关键提交/校验失败记录 `personal-workflow`、taskId、planRevision、operationId、decisionCode 和 result，不记录正文或凭据。业务事实由领域记录及 Session 快照恢复。测试必须覆盖真实 JSON 重开、并列汇合、隐含完成环、版本冲突、重复批准、存储失败、Session 重试和 Remote 调用；可见验收在 Phase 3。领取与接力已有 Loader、真实 AgentLoop/工具链、Remote 和文件观察测试；Desktop 可见验收仍由用户执行。

## 内置方法与模式实现

`packages/skill/skill-dev-workflow/assets/source.json` 固定上游 dlyqs/dev-workflow-skill 提交 `4f51803b4578139dd9de2dc690c1d2638c54decd` 和 SHA-256；`NOTICE.md` 记录作者在本任务中的身份确认及内置授权，不声明上游已有公开许可证。运行时只加载包内托管方法 v4，不依赖作者机器路径；上游源码作为来源记录保留，未引入自动接力引用资源。

输入框中的显式模式开关保存 `personal-workflow/mode`，含单调版本及幂等操作 ID。读取以真实持久日志为准，flush 失败不能启用提案；模式选择的同步投影只用于工具可见性。Bot 禁用 Skill、缺少包内 Skill、模式过期或关闭时明确拒绝。对话的每次用户输入在 pre-step 加入准确方法及模式信息，由普通 `user/message` 日志保存；工具后续步骤不重复注入。关闭后的下一次用户输入记录取代旧方法的关闭说明。

模型通过 `workflow_assess` 给出 simple / clarify / infeasible / complex 及理由，保存 `personal-workflow/assessment`。前三者不创建计划；复杂目标经消歧和可行性判断后才可提案。程序不假装能从自然语言独立证明复杂度判断正确；确定性测试覆盖每个路由的许可和持久效果。提案只产生待审核版本，既不批准也不创建 Run。托管方法中的 Markdown 权威和 Codex 对话管理流程已替换为应用结构化计划、审核和工具路径。

Client 全部计划入口及 Project/Bot 子入口读取同一版本投影；树和阶段分组分别显示层级与显式依赖，不由展示顺序产生依赖。编辑保存需重新审核，失败保留草稿及幂等键；导出引用显示的准确版本。可见 Desktop 验收由用户执行，助理不启动页面。

## 执行授权与持久恢复细节

`StoredPlan.runs` 与 `executionReceipts` 和计划版本在同一条存储记录内提交。旧记录可以省略这两个字段；有执行记录时验证 Task/版本/阶段引用、单执行者、会话唯一性、epoch、预算和证据。格式仍是 `personal_workflow` domain v1；未变更 SQLite 或 Session envelope。旧构建会拒绝不能识别的新增字段/消息来源，不能用旧构建继续写这些记录。

Remote 增加 `workflowCandidates`、`workflowLimits`、`workflowRun`、`workflowClaim`、`workflowStop`、`workflowResume`、`workflowHandoff`。候选查询、绑定、手动恢复和手动接力均不提交模型输入。一个执行对话绑定一个尝试；普通任务终态后执行另一任务仍需另一个对话。`phases` 计划的 Run 通过 `sequence.taskIds` 保留准确授权顺序，通过 `sequence.completed` 保存每个已完成任务的独立证据；current taskId 指向当前阶段任务。阶段完成后在 turn-stopping 中核对后续资格再推进，动作、轮次和首次开始时间均不重置。范围到达终点即 completed，不启动下一阶段；覆盖最终阶段时还须核验根任务的整体验收。

Config 的 `maxActions`（默认 100）、`maxTurns`（20）、`maxDurationMs`（3600000）、`maxEvidenceBytes`（16777216）是部署上限，用户可以在绑定时收窄。时长从首次领取起累计，暂停和接力不重置。`maxTurns` 计用户输入或同任务自动续步的推进次数；工具返回后的普通模型续步不重复计数。`blockedTools` 默认包含标准 `subagent`、`subagent_fork`、`subagent_codex`、`subagent_claude_code` 和 `send_message` 委派工具；部署重命名委派工具时应同步此列表。已有工具审批、Bot allow list 与沙箱仍独立执行。

工具调用在派发前保存 pending，派发返回后保存 succeeded/failed。取消只禁止新动作；迟到结果仍归原 Run。API 完成必须引用该 Run 成功动作的真实 Session tool/result，先 flush 日志，再读取声明产物并保存 SHA-256、验收摘要及时间。实际文件与成功检查是必要证据，验收摘要仍由执行模型填写，程序不宣称可自动判定任意自然语言验收语义。

接力先持久化目标 SessionId、准确计划、决定/待办、证据、前置成果、基线及剩余授权，再由已有 Session 创建接口按固定 ID 创建或采用目标对话。准备期间源暂停、目标也被保留为不可执行；创建成功但提交失败时重试复用目标。必须先等待工具和已登记的 Session 活动收敛，才允许移交；转移增加 epoch，旧对话后续请求被拒绝。手动接收者不自动唤醒；阶段自动接力只由当前活跃 Host 在已验收阶段之间执行。重启、未知结果或接力失败均需人工检查恢复，不重放原有动作。已经到预算终点的任务不能再创建接收者。

恢复保存 cwd、Git HEAD、脏文件内容指纹以及本任务/前置产物 SHA-256；非 Git 目录必须声明产物路径。读取拒绝逃逸工作目录的符号链接、循环目录和超限文件。已运行兄弟任务的已声明产物变化可以归因，不自动暂停本任务；自身关联文件、HEAD 或无法归因的脏文件变化要求人工核对。恢复不覆盖文件、不重放动作。模型失败或取消后，对话 idle 而 Task 未正常结算时也进入待核对；idle 永远不表示任务完成。重启将 running 改为 needs_reconciliation，将 pending 改为 unknown；用户核对后 unknown 变为 reconciled 并保留备注，它不能作为成功检查证据，完成需要新的真实成功检查。

运行时没有第二份所有权缓存，候选、guard 和详情都从同一计划聚合派生。日志仅记录领取、停止、完成、移交、恢复等关键状态变化，不为每次成功工具调用输出排障日志。

## Codex 个人任务消费者

TaskRun 可显式保存 `backend: codex`，领取从当前 Agent 后端固定；历史 API Run 省略该字段并保持原逻辑。继续和动作准入拒绝后端变化。真实 `agent/pre-step` 管线将准确任务、方法、验收与选定资料追加到持久消息，原生 driver 一次发送给当前 thread；不使用内部 API 模型规划或监督。

`workflow_assess/propose/complete` 经同一工具 registry、mode/Bot/归属/任务 guard；批准和领取仍为用户动作。Codex completed Evidence 使用 `reportedBy: codex` 和 summary/acceptance 报告，files/callIds 必须为空。它不要求 Harness 原生工具日志或独立成果核验；前置/必要子任务及每项验收报告的数量规则保留。API 的文件哈希与真实成功 tool/result 检查不变。

原生 turn 后任务未完成则 paused，用户明确 resume 并发送才能继续。首次领取的 maxDurationMs 和累计 maxTurns 不重置，时长到期取消所属 Agent；应用 maxActions 只约束任务管理调用。原生领取、回合结束和恢复只解析现有目录，复核应用权限，不扫描文件或 Git 内容，也不要求声明产物；目录和权限核对服务于继续资格。普通原生单任务 handoff 仍报 native-task-handoff-unavailable。显式授权的原生阶段序列支持同目录新对话接力：保持 Codex 模型、effort、Run、证据和剩余预算，新建原生 thread，不切换到 API 后端。原生阶段完成后可以按授权继续下一阶段；未完成的原生回合仍暂停等待明确恢复。

提问和一次审批复用现有 Agent-scoped 服务、窗口和答复通道；请求/答复进入 codex/request 与 codex/request-result。停止、终态、人工等待超时或 provider 卸载撤销旧答复，drain 后再关闭 Session 回合。恢复只核对原 thread，不自动重答或重发。具体协议与用户步骤见[Codex 消费规则](codex-backend.md)。

## 验证与验收

无页面 Desktop Host 组件组合测试位于 `apps/desktop-host/tests/personal-workflow.spec.ts`，覆盖 Project/Bot 简单目标，以及 CSV 三阶段提案、审核、并行执行、接力、汇合、父任务证据和重开。测试通过独立 Node 子进程执行导出并读取最终文件；模型使用确定性响应，不能据此推断真实模型分类质量。包级故障测试、Client 纯交互测试与 built Host smoke 的实际命令见[施工计划 Phase 7](personal-workflow-plan.md#phase-7集成验证与文档收尾)。

工程验证已完成，Desktop 可见验收和真实模型验证待定。[验收剧本](personal-workflow-acceptance.md)列出用户操作、期望状态、CSV 内容和异常恢复检查；不要求助理启动页面。

## 集中设置与临时强制拆分

设置中的“任务、项目与 Bot”页面仅提供默认规划、拆分粒度和临时测试偏好。任务计划查看/修改/审核、项目与 Bot 管理均位于主界面，设置页不挂载 `personal.manager` 或读取具体记录。

“临时测试 → 每次任务强制拆分”默认关闭。用户开启后，本机未绑定执行任务的对话即使关闭了增强模式，也会要求每个新目标走澄清（必要时）、复杂任务评估和结构化拆分。Host 拒绝 simple 分类和少于两个必要子任务的模型提案；未绑定执行任务时，仅允许评估、提案与提问工具，不能绕过拆分直接执行。不可行目标仍可说明条件，不编造可执行计划。已选子任务按原授权执行，不递归拆分。

开关由 `workflowTestingPreferences` / `workflowSetTestingPreferences` 用户 Remote 读写，存入独立 `personal_workflow_testing` domain 的 global，字段为 `forceDecomposition` 和单调 `revision`，初始 false/0。写入失败不显示成功，版本冲突须刷新；重启保留选择。模型不能修改该开关。原对话模式不变，关闭临时开关后恢复原模式；覆盖和撤销指令通过现有 `personal-workflow-method` 消息进入日志，历史模型输入可重建。计划审核、执行领取、Bot 许可与预算没有被此开关授权。

相关验证包含设置注册、共享管理入口、失败写入反馈、Gateway 版本冲突、强制拆分与关闭恢复、已绑定任务执行和持久重开。此临时选项服务于个人流程测试，不代表真实模型总能产出合格计划；Desktop 可见验收仍由用户执行。

## 自动识别、目标身份与本人设置

[对话规划协议](conversation-planning.md)拥有设置优先级和后续组织路径。个人 `preferences()` / `setPreferences()` 用独立 `personal_workflow_preferences` domain v1 保存 enabled、granularity 和 CAS revision。现有 plan、testing 域与 Session mode 日志不重写；按 profile 存储根隔离，同安装重开恢复。`resolve(session)` 明确计算模式、本人/测试版本和当前 Bot/Project 权限引用。balanced 偏好分层分配，fine 偏好 Agent 顺序阶段；执行方式、起止位置、接力批次与预算仍由真人 claim 表单提供，自动识别不授权执行。

`assess` 将模型路由与已接收 MessageId、服务生成的 GoalId 及有效 policy 持久关联。同一 MessageId 的相同评估请求返回原结果，冲突请求拒绝；正文相同的新消息可以是不同目标。`clarification` 必须引用本对话待澄清 GoalId，`modify` 引用已有计划目标，`query` 只读且不能提案。旧 assessment 没有 context 时仍可读取，但不能授权新提案。第一次模型提案把 goalId 存在 PlanRevision 中；重试 Session 快照失败可从领域回执恢复，不能给同一目标建另一根。用户编辑保留目标关联，创建新的未批准版本。

方法 v4 的普通 user/message 来源带准确 policy，正文带模型配置、归属和可重建目标摘要。提案在唯一提交队列内复核模式、本人设置、测试版本、输入身份、Bot Skill/工具及归属；改变设置或权限后旧评估失效。已经绑定执行任务的输入先进入既有 execution 路径，不递归拆分；测试开关不改变既有 Run 范围。分类仍由模型决定，确定性组合测试只证明路由、持久效果和拒绝路径。

## 顺序阶段规划与执行模式入口

输入框的“执行模式”按钮使用向上打开的菜单，提供当前对话的自动规划开关和本机 profile 的规划偏好。开关写入原有 mode 事件，偏好通过已有 CAS preferences 写入；菜单变化不审核或启动任何计划。设置页面显示相同两种偏好。

分层分配（balanced）延续每节点通常不超过 5 个子任务的建议。Agent 顺序阶段（fine）要求 `planningMode: phases`：一个根，每个阶段一个必要的直属任务，显式依赖上一个阶段任务，根整体验收位于最后阶段。阶段数量没有 5 个上限，不为展示插入中间分组。JSON/parser 和模型提案提交均验证此规则。主任务页及对话计划使用顺序列表呈现阶段，并可查看各阶段历史证据和执行对话。

执行表单默认 manual；选中已就绪的起始任务后，可选择 auto 或 auto_until、含端点的停止阶段，以及是否每完成指定数量阶段自动跨对话接力。前置未满足、倒序范围、跨计划引用、其他执行者已持有范围内任务或超部署预算均拒绝。换阶段和换对话不重置授权、时间或动作预算。自动接力保留全部关联对话中的原始用户文本、完整计划、阶段证据和工作目录，并保持模型/后端、权限预设、沙箱和审批设置。接力文本受 maxEvidenceBytes 限制，超限停止并记录原因。

范围、证据、交接包和单所有者 epoch 保存在同一个计划聚合。最终范围结束不再选择阶段；重启恢复及失败交接仍走显式核对/恢复路径。确定性验证覆盖六个平铺阶段、范围终点、Host 自动接力、JSON 重开及原生 Codex 阶段推进；Desktop 可见效果和真实模型拆分质量由用户验收。
