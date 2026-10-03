# 对话规划协议与消费者

本文拥有产品 Phase 7C 的输入路由、有效设置、组织规划准入和对话关联语义。实施范围与进度只在[施工计划](conversation-planning-plan.md)记录。个人消费者在 Phase 2 实现；Phase 3–6 已实现有限组织规划许可、独立项目对话宿主、共享草案/子树修改及普通对话控件；明确分配、员工对话自动建立和对话执行确认仍属后续阶段。既有[个人工作流](personal-workflow.md)、[WorkGraph](organization-workgraph.md)、[分配](organization-assignment.md)和[执行](organization-execution.md)继续拥有各自业务事实。

## 有效设置与兼容

个人 profile 的 `personal_workflow_preferences` version 1 保存本人自动识别开关及粒度 `balanced` / `fine`，通过用户 Remote 比较 revision 修改；不同 profile 使用不同存储根。默认 enabled=true、balanced、revision=0。首版不承诺跨设备同步。现有 Session `personal-workflow/mode` 保留当前对话覆盖：有明确 mode 事件时始终以该事件为准，没有事件才继承本人设置。历史投影 `{enabled:false, revision:0}` 是未选择的初值，不是关闭证据；若日志确有关闭事件，即使 revision=0，也保留关闭。历史明确 on/off、审核、预算和接力记录不重写。

`resolve(session)` 显式计算有效规划设置：本人默认 → 日志中当前对话覆盖 → 真人测试 override。权限在所有设置之上；override 不解除 Bot Skill、工具或组织权限。`forceDecomposition` 默认 false，只经真人设置改变；打开时简单新目标也需拆分，关闭恢复本人/对话选择。已绑定 Run 先进入执行路由，不评估或再拆分。本人设置、对话模式、测试设置各有独立 revision；模型评估和提案必须使用同一次解析的资格，任何一项变化都拒绝旧资格。

模型配置引用来自当前 Agent 的显式 backend/provider/model/effort；工具与方法引用来自当前 Bot 的 allowedTools/allowedSkills 和托管方法版本。方法文本、有效设置与引用随每次实际用户输入进入普通 user/message 日志；不保存密钥。粒度仅影响建议。执行方式和停止位置仍由现有 ClaimTaskRequest 的 `authorization.mode` / `stopPhaseId`、预算和准确任务版本提供，缺少真人授权不产生执行 Spec。规划默认停止于未批准计划；选择自动识别不选择自动执行。

组织覆盖保存在独立 `organization_conversation` version 1 本机域，按 server/account/organization 保存 enabled、granularity 与 revision；默认由部署 Config 的 `defaultSettings` 提供，Desktop 为开启/balanced。偏好修改比较 revision，相同已提交 operation 重试不再次递增。项目策略与在线权限为上限。登出、切换或 generation 失效销毁有效资格与在途调用；不得取个人默认模型、私人 Bot 或个人历史填补组织许可。当前项目规划宿主只接受显式 API model/endpoint 与本机 credential destination 的交集；不继承个人模型。Codex 原生项目规划尚未接入，不能自动改用 API 模型。既有 Codex Run 继续使用其原生 runtime/model/effort，无 endpoint/key。

## 输入、目标与准确版本

用户消息的既有品牌化 MessageId 是输入身份，不用正文哈希。评估服务生成品牌化 GoalId；调用方在澄清、修改和查询时引用原 GoalId。新消息可提出内容相同的另一个新目标，但同一已接收 MessageId 只能有一份评估回执，重试相同请求恢复原结果、不同请求拒绝。多个目标可以属于同一对话，不能按“最近未完成目标”隐式关联。

| 输入路由 | 先决条件 | 持久效果 |
| --- | --- | --- |
| new_goal | 普通未绑定对话中的当前已接收用户输入 | 新 GoalId 与该 MessageId、评估及设置资格关联；simple 继续普通对话、clarify 等答复、infeasible 说明条件、complex 可提案 |
| clarification | 明确引用本对话尚在 clarify 的 GoalId | 同一目标的新消息评估；不建第二根树 |
| modify | 本对话 GoalId 已有关联计划 | complex 允许修改同一根与准确 expectedRevision；保留所有历史 |
| query | 明确引用本对话既有 GoalId | 只读答复与路由记录，不授予提案资格 |
| 人工答复 | 已绑定任务或对应持久人工请求 | 现有 Run/Inbox 答复路径，不创建目标 |
| 执行输入 | 本 Session 绑定的 Run 和明确执行授权 | 现有 execution.enterTurn 与独立日志，不触发规划 |

评估保存 MessageId、GoalId、路由、mode/preferences/testing 版本以及 Project/Bot affiliation 变更位置。提案在串行提交处重新核对资格、当前输入身份、Skill/工具权限及归属。旧评估没有这些字段仍可读取，但不能授权新提案，必须重新评估。简单目标、查询和无共享写权限的建议没有共享计划副作用。

计划绑定由带 GoalId 的准确 `personal-workflow/snapshot` 保存；第一次根 taskId 固定，澄清不另建根，modify 不允许换根。相同 save operationId 返回原版本，不能因后来的评估/版本重复建树。提交先写计划与回执，再写 Session 快照并 flush；第二步失败保留领域回执，用原请求补写。已有回执可以核对恢复，但权限失效时不得返回新的任务内容。不同 operationId + 相同目标的另一初始根拒绝。用户编辑产生新 revision、未批准状态，不自动修改执行授权。

## 组织数据作者与权限

| 记录/命令 | 唯一作者 | 读取/写入条件 | 消费者 |
| --- | --- | --- | --- |
| 规划许可与请求限额 | organization SQLite 权威 | 当前项目 read、本人模型选择、组织出站/模型策略；不要求 write | 固定 organization-api/connection、私有 Host 规划适配器 |
| 共享草案 | organization WorkGraph | 当前 project write 与准确根 edit；模型输出严格解析和关系校验 | 组织目标对话、工作台 |
| 本人私有建议 | 独立 organization-conversation 本机域 | 当前项目 read；共享树写权不足时标为建议 | 本人项目目标对话；获权后重新审核应用 |
| 子树修改 | organization 固定新命令 | 当前指定子树 edit、准确整计划版本、继承资源/预算/批准限制 | 员工任务对话；原下发人重新批准 |
| 真人候选查询 | organization 权限裁剪查询 | 当前可见且仍启用的 membership；身份可见不授予任务 read | 对话内负责人选择；不能用仅 admin 可读的成员整表 |
| 分配/接受/委托/开始/提交/验收 | 既有 assignment/execution 权威 | 既有准确版本、真人身份、任务 read、grant 管理权、设备/租约/预算 | 固定业务确认卡、现有 Workbench 消费者 |
| 员工对话待绑定记录 | 组织持久通知 + 员工本机 writer | 在线复核本人通知及当前任务 read | 员工端幂等创建独立任务对话，不复制下发人正文 |

规划许可只允许澄清、授权查询、评估与草案工具。无任务时不得伪造 assignment/lease/Run 或从 personal Agent 借权。`organization.Config.planning` 验证模型目的地、ttlMs、permitTtlMs、maxRequests、maxInputBytes、maxOutputBytes、maxTotalBytes 与 maxDurationMs。SQLite v13 的 planning_grants、planning_permits、planning_events 保存资格、累积用量及事件；启动和备份恢复校验独立关系。每次实际 HTTP 请求及重试需独立在线准入、原子限额核算；原生 Codex 项目规划资格留待其专用消费者实现。重复相同请求不重复预留，但未知已发调用先查回执，不按“免费重试”重发。取消、撤权、停用、到期、epoch/generation 改变、休眠和离线拒绝新增请求并排空已拥有调用。规划许可不含文件、shell、subagent、job、审批、分配或执行副作用。

组织对话保存本机输入意图与绑定，组织权威保存共享业务操作回执，两者分步恢复。批量确认逐项使用原子固定动作，各项发送前保存 operationId，呈现成功/冲突/未确认；不承诺跨项事务。未知分配只核对回执。缺目标负责人 read 时单独明确补 grant，且必须有 grant 管理权；人员建议不自动授权、下发或委托。

## 子树修改与资格失效

完整 workgraphSave 继续要求 project write 和根 edit。`save-planning-draft` 支持指定非根子树的独立 read/edit grant，`readPlanningPlan` 只返回该子树和编辑资格。服务端读取完整版本、只替换选定子树，不要求员工提交或回读隐藏兄弟/祖先。外部依赖、原目标、资源、预算上限及原批准条件不能扩大；含义差异由原下发人审阅并重新批准，不声称自然语言可机器证明。

任何定义变化产生新的整计划 revision；结构变化增加 structureVersion，旧结构 task grant 不再满足当前读取/编辑资格，按既有规则明确重新授权。旧批准、待接受或已接受分配及依赖的委托、租约、Run 新动作资格失效；在途动作由原执行机制收敛，历史回执和不可变成果保留。当前 revision 的前置、提交验收和集成资格重新计算，不把旧叶子变父任务后自动继承已交付状态。对话编辑前显示批准、grant、Run 和交付资格失效提示。SQLite planning_reapprovals 按原批准祖先保存不可替换的原下发人；新叶子由其重新批准，员工无代批权。限额只能继承或收窄，不能通过细分重置已消耗预算。

## 服务角色、消费路径与销毁

| 定义/提供者 | 实际消费位置 | 失效与销毁 |
| --- | --- | --- |
| personal-workflow 类型与唯一 writer，storageDomain JSON + Session JSONL | skill-dev-workflow agent/pre-step、workflow_assess/propose，session-controller workflowMode/SetMode/Preferences/SetPreferences | 串行队列内资格复核；关闭拒绝新操作、排空队列、关闭各域 |
| sessionProjections personalWorkflowMode | ui-personal-workflow 的 conversation.input.left；本人设置在既有 settings.personal.testing | 效果注册释放；持久 mode 决定提案，投影只决定显示 |
| Agent/Tools/Skill 既有注册 | 标准 preset；托管方法走普通 user/message；proposal tool result 保存准确快照 | Skill 或工具禁用、Session 归属变化拒绝旧评估；注册及监听随 fiber 撤销 |
| organization 权威与 organization-api 固定 HTTPS | organization-connection generation/回执/SSE；apps/desktop/src/organization-context.ts 和 organization-execution.ts | Electron 持 token 和设备材料，所属 top frame、nonce/request/generation 复核；断线/休眠/身份切换取消并排空 |
| organization-context 现有两事件只读 writer | apps/desktop-host/src/organization-context.ts、ui-organization 固定 context 消费者 | 保持只读格式，不伪造 task、不作为规划 Agent 入口 |
| organization-conversation（Phase 4） | 独立本机 Session/Agent 注册域、私有固定 IPC、项目目标、澄清、修改、查询及成员建议；员工从 Inbox 在线打开时幂等建立任务对话 | 保留独立 namespace；个人发送/搜索/上传/fork/恢复拒绝其 ID；冷重开先在线复核 |
| ConversationNodeDefinition + keyed renderer（Phase 6） | uiConversation.events → conversation.chat.node；ui-organization 提取纯展示/动作消费者 | 按稳定业务 ID 与准确 revision 从既有 Session 事件重建，不开启第二条历史流；fiber 清理贡献 |
| assignment/execution 固定真人动作（Phase 7–8 对话消费） | 现有 AssignmentPanel/Inbox/ExecutionPanel/DeliveryPanel/AcceptanceReview/IntegrationPanel 与新确认卡 | generation、准确版本和当前权限复核；用户确认后才执行，接受和建对话不自动启动 |

组织目标对话、员工任务对话、Run 执行日志分别关联，双方不共享聊天记录。业务详情只展示当前获准快照、目标/范围、验收、责任人、准确版本、状态、待谁处理及最新提交。完整执行转录沿现有独立授权读取。Phase 3–4 新增组织规划包、固定私有 IPC 与 SQLite v13；Session envelope 版本不变。


## 当前项目规划接口与恢复

`organization` 提供 `readPlanning`、`planningCommand` 和 `readPlanningCandidates`；固定 HTTPS POST 为 `/organization/v1/planning/read`、`/planning/command`、`/planning/candidates`。命令包含 open-planning、reserve-planning-request、consume-planning-request 和 save-planning-draft，Renderer 固定动作可查询资格、候选及获准子树，规划写命令由 Electron 私有 `planningCommand(input, generation)` 消费。候选分页只返回当前同项目 read、账号/成员均启用的 membershipId 与 username；不提供职责或管理员成员整表。未知 mutation 持久进入原生 pending journal，先查回执，不重发。

资格绑定 server epoch、账户/成员/project grant 版本、完整策略摘要及模型选择。新的显式发送可续期失效资格，保留首次限额和累积 usedRequests/usedBytes；不重置预算，也不重新启用旧 qualificationRevision 的未消费 permit。冷重开和重连只读取，不自动续期或启动模型。每次最终 HTTP payload 在 credential/preparation 后按 UTF-8 实际字节预留 inputBytes 与输出上限；预留和消费意图各先 flush，回执确认后再在线读与同步取消/到期检查，然后 fetch。provider retry 使用新的一次性许可；消费重放拒绝，历史回执仍可核对。预留、取消和不确定派发不退款。

`organization-conversation.perform` 只接受 open、read、stop、settings、send、suggest、catalog、bot-save，固定选择 organizationId/projectId/conversationId/operationId；SessionId、服务身份、文件路径、credential 和任意 URL 由调用方注入均拒绝。open 原子预留独立 `organization-conversation:` Session 后创建 JSONL，半完成重开恢复同一绑定。send 先持久输入身份、稳定 goalId、设置和方法，new_goal 创建目标，clarification 必须明确引用本对话已评为 clarify 的目标。相同 operation 只读原状态；相同文本的新 operation 可以提出新目标。发送一旦进入 sending，崩溃后呈现 unknown，取消呈现 stopped，均不自动重放。

五个必需 Session 事件是 organization/conversation-owner、organization/planning-input、organization/planning-assessment、organization/planning-operation、organization/planning-proposal。普通 user/message 记录 organization-planning/v2 方法（兼容读取旧 v1 输入）与实际有效授权输入，标准 request/header 和模型/工具事件记录请求历史。`./invariant` 比较本机预留、JSONL owner、输入/评估归属和重复/孤儿记录；真实 Loader 执行校验。个人 Session/Agent、查询、持久化、上传和 fork 消费者拒绝该 namespace；原 organization-context 两事件不变。

发送挂载隔离标准 loop、text-only DeepSeekAdapter 和 workflow_assess/workflow_propose/planning_authorization/planning_members；关闭自动识别时移除评估及提案工具。当前输入的 complex 评估允许保存未批准共享草案，无 edit 者只保存本人私有建议。Host 通过 nonce/request/authorizationId 对应在线授权，Electron 核验 generation、所属 top-frame、Host 和窗口寿命；销毁、身份切换、离线、休眠与权限复核失败取消并排空。组织主面板支持普通发送、稳定目标选择、设置、树/版本、负责人建议和权威业务详情；个人对话从已有快照增量构造 personal-plan 节点。可见验收由用户检查。

SQLite 当前 v15；v15 保存直属上级关系，planning_goals 保存本人 conversation/goal 到 plan/task 的唯一关联，planning_reapprovals 保存细分后的原批准责任；v13 迁移不重置模型累计用量。`/planning/plan` 返回归一化子树；保存前持久 proposal 意图，已发送未知结果先通过回执与 goal 关联核对。自己的保存触发 generation 更新时，只在身份仍相同时只读恢复，不重发输入、建树或模型。私有建议和冲突修改保留在本人 JSONL；共享展示每次重读权威版本。历史中任何任务失权都会阻止旧正文再次进入模型，并隐藏旧内容或拒绝读取。结构变更不自动续 grant；重新批准仍需当前查看/编辑资格。

## 对话分配与执行消费者

组织主入口同时提供项目对话和持久 Inbox。共享树的叶子可逐项审核并确认，或选中多项、审核各自当前权限后批量明确确认。缺负责人 read 仍由现有授权控件单独确认，批准不自动补 grant。原生 `assignment-batch` 按当前 server/account/organization 与 plan/revision 保存逐项 operationId、终态和回执；每项发送前先落盘。成功项不重发，冲突/拒绝逐项呈现，未知项只查回执并停止后续发送，未发送项保留未确认。重开通过 `assignment-batch-read` 恢复结果，不自动续发。

原有 assignment、accept-assignment request 和 notification 的原子关联就是员工离线期间的待建立标识，不新增共享聊天表或第二份通知。员工从组织对话入口或 Inbox 点击打开时，以 assignmentId 作为稳定 conversationId，并携带只含 planId/assignmentId 的 selector。Electron 每次授权都重读 preparation，验证当前成员是该原分配的 assignee；Host 先保留本人绑定再写 JSONL，失败后恢复同一 Session。双方账号、目标对话、员工对话与 Run 转录相互独立。界面显示原下发人、原任务与分配版本；打开不接受、不委托、不领取、不运行。

任务对话固定同一 goal 和任务范围，拒绝 new_goal、其他目标及其他任务 selector。规划依旧消耗独立有限许可；模型工具不能调用业务确认。撤销、拒绝或失效分配拒绝新发送，保留有当前 read 时的历史查看；新版本或改派通过新的通知和 assignment 对话取得新资格，旧 Session 不转换身份。对话的当前子树、私有建议及历史正文继续按当前权限裁剪。

`ConversationTask` 从权威读取所选任务后复用 AssignmentPanel、ExecutionPanel 和 IntegrationPanel；Run 内复用 ExecutionHumanRequest、DeliveryPanel、AcceptanceReview。员工明确接受/拒绝、配置 API 或 Codex、有限委托/领取、开始/停止/恢复、答复、上传/提交；原下发人明确验收/驳回、目标核验和最终确认。任务对话把 ExecutionPanel 固定到原 assignment，完整私有日志仍走单独的员工授权读取。答复不继续、完成不提交、验收不自动集成，文件不自动应用。只读进度输入使用 query 路由，不授予建树/修改资格。

## 验证与产品交接

正常模式发送到 CSV 交付、规划故障回归和发行验证入口见[验收交接](conversation-planning-acceptance.md)。确定性模型仅验证其结果沿真实工具和权威服务产生的效果；自然识别质量由独立真实模型语料及用户三机验收判断。Desktop 可见和 Windows 结果单独记录，不由无窗口 smoke 推导。

## 组织对话与 Bot 导航

组织身份下的加号建立独立 conversationId，Projects、Bots、Recent 展示当前身份的组织记录；Recent 重开原有私有对话，任务分配对话继续通过 Inbox 的原 assignmentId 打开。移除侧边栏范围说明及请求/未读摘要，组织工作台从组织名称和账号入口打开。个人输入框不再显示“强制拆分已覆盖”徽标，既有拆分设置仍由原 writer 决定。

独立 organization_navigation v1 域保存私有 Bot、对话关联及保存操作摘要，不改变 organization_conversation v1 域格式。Bot 仅属于本人及所选组织项目，保存需当前在线授权和本机/组织模型策略均允许的显式 API 模型。名称、指令和选择的配置在每次实际发送前作为 Bot 快照写入 organization/planning-input，再进入模型输入；不使用个人 Bot 配置。catalog 只读取当前项目的本人导航，不触发模型，也不让已撤权任务历史阻塞最近列表。导航按每项目 maxCatalogItems（默认 200）及 maxBots（默认 100）限制，并受 maxReportBytes 限制。

Tasks 显示当前授权的节点，选中后复用审核、分配与执行控件。分配必须另行确认；普通成员只可选自己或直属下属，管理员可选任意启用成员，后端叠加现有任务/项目授权校验。组织工作台增加组织架构树及管理员直属上级编辑，变更后的分配权限在线重新计算。
