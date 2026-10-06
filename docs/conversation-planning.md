# 对话规划协议与消费者

本文拥有输入路由、有效设置、组织任务权限和对话关联语义。个人与组织模式复用普通 Session、Agent、模型、工具和对话界面；组织模式增加账号分区、身份层级和任务分配。持久通知自动建立员工任务对话，选中节点从普通对话执行。既有[个人工作流](personal-workflow.md)、[WorkGraph](organization-workgraph.md)、[分配](organization-assignment.md)和[执行](organization-execution.md)继续拥有各自业务事实。

## 有效设置与兼容

个人 profile 的 `personal_workflow_preferences` version 1 保存本人自动识别开关及粒度 `balanced` / `fine`，通过用户 Remote 比较 revision 修改；不同 profile 使用不同存储根。默认 enabled=true、balanced、revision=0。首版不承诺跨设备同步。现有 Session `personal-workflow/mode` 保留当前对话覆盖：有明确 mode 事件时始终以该事件为准，没有事件才继承本人设置。历史投影 `{enabled:false, revision:0}` 是未选择的初值，不是关闭证据；若日志确有关闭事件，即使 revision=0，也保留关闭。历史明确 on/off、审核、预算和接力记录不重写。

`resolve(session)` 显式计算有效规划设置：本人默认 → 日志中当前对话覆盖 → 真人测试 override。权限在所有设置之上；override 不解除 Bot Skill、工具或组织权限。`forceDecomposition` 默认 false，只经真人设置改变；打开时简单新目标也需拆分，关闭恢复本人/对话选择。已绑定 Run 先进入执行路由，不评估或再拆分。本人设置、对话模式、测试设置各有独立 revision；模型评估和提案必须使用同一次解析的资格，任何一项变化都拒绝旧资格。

模型配置引用来自当前 Agent 的显式 backend/provider/model/effort；工具与方法引用来自当前 Bot 的 allowedTools/allowedSkills 和托管方法版本。方法文本、有效设置与引用随每次实际用户输入进入普通 user/message 日志；不保存密钥。粒度仅影响建议。执行方式和停止位置仍由现有 ClaimTaskRequest 的 `authorization.mode` / `stopPhaseId`、预算和准确任务版本提供，缺少真人授权不产生执行 Spec。规划默认停止于未批准计划；选择自动识别不选择自动执行。

组织覆盖保存在 `organization_conversation` version 1 本机域，按 server/account/organization 保存 enabled、granularity 与 revision。组织会话使用普通 Session Controller、标准 preset、模型提供方和工具；模型选择、附件、逐字输出、斜杠命令、队列编辑及本地执行沿用普通会话链路。native attach 在线授权后将历史一次性导入持久 sharedSessionId，保留原账号归属。已打开对话的 attachment 与 Controller binding 由账号生命周期持有；切换任务、项目或其它对话不停止 Agent，返回时复用同一绑定。detach、窗口关闭、身份或权限失效取消并排空普通 Agent。账号访问策略保护普通 API 的精确读取与操作，并从个人目录隐藏组织会话及派生会话。共享任务写入继续由组织权威服务核验。

组织项目对话也读取本机 `forceDecomposition` 和 testing revision，并随 `organization/planning-input` 与模型上下文保存。未选任务的新目标不能走 simple 路由或直接执行，提案至少包含两个必要子任务；关闭组织规划开关不绕过测试设置。已选或已分配任务继续执行。项目与通知的内容 generation 刷新保留账号 attachment、当前会话与侧栏记录，只有账号生命周期或权限失效才取消；有限目录查询完成最终在线复核后再清理请求。

## 输入、目标与准确版本

用户消息的既有品牌化 MessageId 是输入身份，不用正文哈希。评估服务生成品牌化 GoalId；调用方在澄清、修改和查询时引用原 GoalId。新消息可提出内容相同的另一个新目标，但同一已接收 MessageId 只能有一份评估回执，重试相同请求恢复原结果、不同请求拒绝。多个目标可以属于同一对话，不能按“最近未完成目标”隐式关联。

| 输入路由 | 先决条件 | 持久效果 |
| --- | --- | --- |
| new_goal | 普通未绑定对话中的当前已接收用户输入 | 新 GoalId 与该 MessageId、评估及设置资格关联；simple 继续普通对话、clarify 等答复、infeasible 说明条件、complex 可提案 |
| clarification | 明确引用本对话尚在 clarify 的 GoalId | 同一目标的新消息评估；不建第二根树 |
| modify | 本对话 GoalId 已有关联计划 | complex 允许修改同一根与准确 expectedRevision；保留所有历史 |
| query | 明确引用本对话既有 GoalId | 只读答复与路由记录，不授予提案资格 |
| 人工答复 | 已绑定任务或对应持久人工请求 | 现有 Run/Inbox 答复路径，不创建目标 |
| 执行输入 | 员工任务对话要求当前已接受分配；高级 Run 另需其执行设置 | 普通 user/message 与日志中的任务上下文；高级 Run 沿用 execution.enterTurn 与独立日志 |

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
| 分配/接受/执行/提交/验收 | assignment/execution/delivery 权威 | 准确版本、真人身份和当前任务权限；普通 Agent 与手工汇报无需 Run，高级 Run 校验其限额 | 固定业务确认卡、任务详情消费者 |
| 员工对话待绑定记录 | 组织持久通知 + 员工本机 writer | 在线复核本人通知及当前任务 read | 员工端幂等创建独立任务对话，不复制下发人正文 |

旧式未接入普通会话的有限规划服务只允许澄清、授权查询、评估与草案工具。其 `organization.Config.planning` 验证模型目的地、许可寿命、请求/字节/时长限额；SQLite 的 planning_grants、planning_permits、planning_events 保存资格、累积用量及事件。该服务的每次 HTTP 请求及重试独立核算许可，未知已发调用先查回执，取消或失权拒绝新增请求并排空已拥有调用。普通 Desktop 组织对话直接复用普通 API/Codex 提供方和执行能力；组织草案写入、分配、验收仍由当前组织权限校验，不通过这条旧规划传输发送用户消息。`save-planning-draft` 不要求旧模型 grant 或 eligible；新计划仍要求 project write，已有计划及子树仍要求对应 edit。SQLite v16 将 planning_events 的账号和项目直接关联到账号、项目及审计事件，升级保留原资格、累计用量、计划关联和回执。

组织对话保存本机输入意图与绑定，组织权威保存共享业务操作回执，两者分步恢复。批量确认逐项使用原子固定动作，各项发送前保存 operationId，呈现成功/冲突/未确认；不承诺跨项事务。未知分配只核对回执。正式分配在同一事务授予员工项目读写与选定任务子树读写；下发人须有相应授权管理资格。人员建议不自动授权或下发。

## 共享任务背景

组织自动提案要求 `sharedContext` 总结创建者对话中的动机、整体目标、决策、约束与资源，供没有原对话记录的执行人使用。背景初次随提案保存，后续仅原创建者编辑；当前节点读者都能查看。选择节点执行时，普通 pre-step 重新读取最新背景，随 `organization/planning-input` 和 user/message 记录并传给模型，员工无需查看完整树即可获取背景。背景版本独立于任务定义，编辑背景不会让分配重新审批。完整树申请、创建者审批和只读授权由 [WorkGraph](organization-workgraph.md) 拥有。

## 子树修改与资格失效

完整 workgraphSave 继续要求 project write 和根 edit。`save-planning-draft` 支持指定非根子树的独立 read/edit grant，`readPlanningPlan` 只返回该子树和编辑资格。服务端读取完整版本、只替换选定子树，不要求员工提交或回读隐藏兄弟/祖先。外部依赖、原目标、资源、预算上限及原批准条件不能扩大；含义差异由原下发人审阅并重新批准，不声称自然语言可机器证明。

任何定义变化产生新的整计划 revision；结构变化增加 structureVersion，旧结构 task grant 不再满足当前读取/编辑资格，按既有规则重新授权。旧批准、待接受或已接受分配及高级 Run 新动作资格失效；在途动作由原执行机制收敛，历史回执和不可变成果保留。当前 revision 的前置、提交验收和集成资格重新计算，不把旧叶子变父任务后自动继承已交付状态。对话编辑前显示批准、grant、Run 和交付资格失效提示。SQLite planning_reapprovals 按原批准祖先保存不可替换的原下发人；新叶子由其重新批准，员工无代批权。高级 Run 限额只能继承或收窄，不能通过细分重置已消耗预算。

## 服务角色、消费路径与销毁

| 定义/提供者 | 实际消费位置 | 失效与销毁 |
| --- | --- | --- |
| personal-workflow 类型与唯一 writer，storageDomain JSON + Session JSONL | skill-dev-workflow agent/pre-step、workflow_assess/propose，session-controller workflowMode/SetMode/Preferences/SetPreferences | 串行队列内资格复核；关闭拒绝新操作、排空队列、关闭各域 |
| sessionProjections personalWorkflowMode | ui-personal-workflow 的 conversation.input.left；本人设置在既有 settings.personal.testing | 效果注册释放；持久 mode 决定提案，投影只决定显示 |
| Agent/Tools/Skill 既有注册 | 标准 preset；托管方法走普通 user/message；proposal tool result 保存准确快照 | Skill 或工具禁用、Session 归属变化拒绝旧评估；注册及监听随 fiber 撤销 |
| organization 权威与 organization-api 固定 HTTPS | organization-connection generation/回执/SSE；apps/desktop/src/organization-context.ts 和 organization-execution.ts | Electron 持登录 token，所属 top frame、nonce/request/generation 复核；断线/休眠/身份切换取消并排空 |
| organization-context 现有两事件只读 writer | apps/desktop-host/src/organization-context.ts、ui-organization 固定 context 消费者 | 保持只读格式，不伪造 task、不作为规划 Agent 入口 |
| organization-conversation | 普通 Session Controller、Agent、模型、工具和对话界面；native attach 维护账号授权，持久通知幂等建立员工任务对话 | 普通 Session 按组织归属保护读取和操作，个人目录隐藏组织及派生会话；冷重开先在线复核 |
| ConversationNodeDefinition + keyed renderer（Phase 6） | uiConversation.events → conversation.chat.node；ui-organization 提取纯展示/动作消费者 | 按稳定业务 ID 与准确 revision 从既有 Session 事件重建，不开启第二条历史流；fiber 清理贡献 |
| assignment/execution 固定真人动作 | 右侧任务详情的 AssignmentPanel、持久 Inbox、DeliveryPanel/AcceptanceReview/IntegrationPanel；独立 Run 属于高级执行消费 | generation、准确版本和当前权限复核；普通节点执行从共享对话发起，接受和建对话不自动启动 |

组织目标对话、员工任务对话、Run 执行日志分别关联，双方不共享聊天记录。业务详情只展示当前获准快照、目标/范围、验收、责任人、准确版本、状态、待谁处理及最新提交。完整执行转录沿现有独立授权读取。Phase 3–4 新增组织规划包、固定私有 IPC 与 SQLite v13；Session envelope 版本不变。


## 当前项目规划接口与恢复

`organization` 提供 `readPlanning`、`planningCommand` 和 `readPlanningCandidates`；固定 HTTPS POST 为 `/organization/v1/planning/read`、`/planning/command`、`/planning/candidates`。命令包含 open-planning、reserve-planning-request、consume-planning-request 和 save-planning-draft，Renderer 固定动作可查询资格、候选及获准子树，规划写命令由 Electron 私有 `planningCommand(input, generation)` 消费。候选分页只返回当前同项目 read、账号/成员均启用的 membershipId 与 username；不提供职责或管理员成员整表。未知 mutation 持久进入原生 pending journal，先查回执，不重发。

资格绑定 server epoch、账户/成员/project grant 版本、完整策略摘要及模型选择。新的显式发送可续期失效资格，保留首次限额和累积 usedRequests/usedBytes；不重置预算，也不重新启用旧 qualificationRevision 的未消费 permit。冷重开和重连只读取，不自动续期或启动模型。每次最终 HTTP payload 在 credential/preparation 后按 UTF-8 实际字节预留 inputBytes 与输出上限；预留和消费意图各先 flush，回执确认后再在线读与同步取消/到期检查，然后 fetch。provider retry 使用新的一次性许可；消费重放拒绝，历史回执仍可核对。预留、取消和不确定派发不退款。

`organization-conversation` 的固定 native 操作负责账号导航、attach/detach、设置、任务选择、管理与组织业务写入，选择器包含 organizationId/projectId/conversationId/operationId。open 保留历史 `organization-conversation:` 身份；attach 原子保留普通 sharedSessionId 并导入历史。已有普通别名的对话拒绝旧 send，用户输入沿普通 prompt 和 follow。API/Codex 后继会话通过 durable parent 继承账号归属，activeSessionId 保存当前会话；重开恢复相同后端。旧未接入的 send 仍保留原输入意图和回执恢复规则，未知或停止的派发不自动重放。

organization/conversation-owner、organization/planning-input、organization/planning-assessment、organization/planning-operation、organization/planning-proposal 保存账号归属和任务业务证据。普通 user/message 记录方法与授权任务上下文，标准 request/header 和模型/工具事件记录实际请求。`./invariant` 比较历史预留、JSONL owner 和输入/评估归属；普通别名初始化核对持久 owner。普通查询、上传、fork 和恢复沿共享接口检查账号策略，组织及派生会话不进入个人目录。原 organization-context 两事件不变。

发送沿用普通 AgentLoop、标准模型提供方与工具。组织方法通过现有 pre-step 扩展记录任务事实和 Bot 指令，按有效设置提供 workflow_assess/workflow_propose；共享草案经当前组织权限提交。native attach 保留授权寿命，Common Session follow 直接推送实时 assistant chunks。组织任务详情保留右侧分配控件，“在对话中执行”打开同一套对话并选中节点，不另启隔离执行 Run。Desktop 可见验收由用户检查。

SQLite 当前 v22，任务流程与历史迁移见[执行协议](organization-execution.md)。v15 保存直属上级关系，planning_goals 保存本人 conversation/goal 到 plan/task 的唯一关联，planning_reapprovals 保存细分后的原批准责任；v13 迁移不重置模型累计用量。`/planning/plan` 返回归一化子树；保存前持久 proposal 意图，已发送未知结果先通过回执与 goal 关联核对。自己的保存触发 generation 更新时，只在身份仍相同时只读恢复，不重发输入、建树或模型。私有建议和冲突修改保留在本人 JSONL；共享展示每次重读权威版本。历史中任何任务失权都会阻止旧正文再次进入模型，并隐藏旧内容或拒绝读取。结构变更不自动续 grant；重新批准仍需当前查看/编辑资格。

## 对话分配与执行消费者

组织主入口同时提供项目对话和持久 Inbox。共享树的叶子可逐项审核并确认，或选中多项、审核各自当前权限后批量明确确认。正式分配原子补齐员工项目与任务访问权。原生 `assignment-batch` 按当前 server/account/organization 与 plan/revision 保存逐项 operationId、终态和回执；每项发送前先落盘。成功项不重发，冲突/拒绝逐项呈现，未知项只查回执并停止后续发送，未发送项保留未确认。重开通过 `assignment-batch-read` 恢复结果，不自动续发。

原有 assignment、accept-assignment request 和 notification 的原子关联就是员工离线期间的待建立标识，不新增共享聊天表或第二份通知。员工从组织对话入口或 Inbox 点击打开时，以 assignmentId 作为稳定 conversationId，并携带只含 planId/assignmentId 的 selector。Electron 每次授权都重读 preparation，验证当前成员是该原分配的 assignee；Host 先保留本人绑定再写 JSONL，失败后恢复同一 Session。双方账号、目标对话、员工对话与 Run 转录相互独立。界面显示原下发人、原任务与分配版本；打开不接受或执行。任务浮层的执行区域读取员工本人获准的任务对话日志，按当前 planId、taskId、revision 的输入及实际 step/start、turn/end 显示未执行、执行中、已执行或中断；自动介绍和选择节点不计为执行，已执行不代表成果已经审批。普通 Session 活动及运行状态变化触发重新读取。员工明确接受后等待主动输入，普通 Agent 请求、准备及工具调用复核 accepted 状态；设备登记、准备授权和领取不参与流程。


员工正式提交保存后，原下发人的持久 Inbox 提供成果审批请求。Client 通过 `open-review` 以 submissionId 建立原下发人账号内的独立审批通知对话；Electron 重读分配与成果记录，确认当前成员为本次提交的 handler，Host 才写入一次成果摘要、补充说明和共享附件说明，并选中原任务。重复刷新重开同一 Session，不复制员工私有转录，不启动模型。上传和正式提交期间，任务详情与成果表单在连接 generation 刷新时保留挂载并隐藏，待当前权限重读完成再显示，避免附件上传成功后后续正式提交被组件卸载中断。

分配任务对话固定同一任务范围，其他任务 selector 被拒绝。普通 Agent 通过已有能力执行选中节点；组织模型工具只提交当前获准的业务写入，不能代替真人批准或验收。权限失效停止普通 Agent，历史读取也需当前任务权限；新版本或改派通过新的通知和 assignment 对话取得新资格，旧 Session 不转换身份。

任务详情从权威读取所选节点，在右侧复用 AssignmentPanel 和 IntegrationPanel；“在对话中执行”打开普通对话并选中节点，沿普通输入、模型及工具链执行。API 与 Codex 后端切换沿共享机制创建继承组织归属的后继会话，并保留任务元数据。员工也可自行执行。DeliveryPanel、AcceptanceReview 支持无 Run 的成果上传、完成汇报和原下发人审批。高级独立 Run 是可选执行方式，保留本次执行限额及 ExecutionHumanRequest。完成不自动提交，审批不自动集成。

## 验证与产品交接

正常模式发送到 CSV 交付、规划故障回归和发行验证入口见[验收交接](conversation-planning-acceptance.md)。确定性模型仅验证其结果沿真实工具和权威服务产生的效果；自然识别质量由独立真实模型语料及用户三机验收判断。Desktop 可见和 Windows 结果单独记录，不由无窗口 smoke 推导。

## 组织对话与 Bot 导航

组织身份下的加号建立独立 conversationId，Projects、Bots、Recent 展示当前身份的组织记录；Recent 重开原有私有对话，任务分配对话继续通过 Inbox 的原 assignmentId 打开。移除侧边栏范围说明及请求/未读摘要，组织工作台从组织名称和账号入口打开。个人输入框不再显示“强制拆分已覆盖”徽标，既有拆分设置仍由原 writer 决定。

organization_navigation v1 域保存该账号分区的 Bot、对话关联及保存操作摘要。Bot 模型表单读取普通模型目录，保存 provider/model/backend/effort；旧 endpoint 配置仍按旧策略读取。新对话通过普通 Controller 应用 Bot 默认模型，用户明确选择的模型在重开后继续优先。名称、指令和配置随实际发送写入 organization/planning-input，实际模型由普通 request/header 记录。catalog 只读取当前项目的本人导航，不触发模型，也不让已撤权任务历史阻塞最近列表。导航按每项目 maxCatalogItems（默认 200）及 maxBots（默认 100）限制，并受 maxReportBytes 限制。

Tasks 显示当前授权的节点，选中后复用审核、分配与执行控件。分配必须另行确认；普通成员只可选自己或直属下属，管理员可选任意启用成员，后端叠加现有任务/项目授权校验。组织工作台增加组织架构树及管理员直属上级编辑，变更后的分配权限在线重新计算。

组织侧全局加号直接创建无项目的账号私有普通会话，并归入 Recent；项目行的新建仍绑定所选项目。无项目会话经 `/planning/read` 验证当前有效成员身份，不取得项目正文、规划授权或任务工具。Projects 标题栏向有效成员开放新建项目，服务端同事务授予创建者显式读写权限。目录查询只读，不创建占位会话；单个会话目录失败保留已读取的项目和其他目录，无项目 Recent 查询独立于项目分页。

普通对话的 native attach 保存命令与授权读取共享账号生命周期，项目内容刷新不会取消已提交写入的回执；退出、失权、断线和休眠仍终止生命周期。写入前持久化未知操作，丢失回执后只核对结果，不自动重发。私有 IPC 仅返回固定错误码，区分 forbidden、版本冲突、未核对写入、过期请求及连接不可用；未分类异常返回 unavailable，不推断为无编辑权限。
