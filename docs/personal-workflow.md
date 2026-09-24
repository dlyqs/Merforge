# 个人任务、持久计划与执行设计

本文拥有个人工作流的业务和 API 语义；施工状态见 [执行计划](personal-workflow-plan.md)。Desktop 是唯一入口。Phase 2 提供数据服务和 Remote，Phase 3 的任务视图和 Phase 4 的增强模式及模型工具已接入；Phase 5 的任务执行与 Phase 6 的持久接力/恢复已接入。

## 数据与完成规则

`packages/workspace/personal-workflow` 拥有 `ctx.personalWorkflow`，是任务数据唯一写入者。计划用根 `TaskId` 标识，子任务同样有稳定的品牌化 `TaskId`。`PhaseId`、`OperationId` 单独品牌化；版本为从 1 开始的整数。Task 包含目标、范围、验收条件、产物路径、可选 cwd、parentTaskId、dependsOn、phaseId 和 required；根必需且没有父节点。所有引用属于同一计划；树只能有一个根且必须连通。移除的 TaskId 不得在后续版本复用于其他任务。

阶段数组表达审核与推进顺序，不在兄弟任务间插入依赖。每个任务属于一个阶段，显式前置和必要子任务的阶段不得晚于消费者/父任务。依赖图加上“父任务等待必要子任务”的隐含完成边后必须无环。子任务依赖祖先、跨分支与聚合边组成的隐环均拒绝。

CSV 示例：根“交付 CSV 导出”（集成阶段），子任务 A“接口约定”（约定阶段），B“实现导出”和 C“准备独立测试数据”（开发阶段，各依赖 A），D“集成验收”（集成阶段，依赖 B、C）。A 完成后 B/C 同时就绪；两者完成才释放 D。根等待必要子任务和自身验收证据，不能因子任务全部 idle 而完成。可选子任务不阻碍父完成，但显式依赖可选任务仍须完成。

纯投影接受持久 Run/Evidence 的执行观察值，计算阻塞原因、并列候选和子任务完成数。模型不能直接写任务状态。产物是声明，不是证据。完成必须由具体 Run 的验证结果、可重查产物位置及验证摘要支持；父任务还需自身验收。

## 持久化、版本与审核

使用现有 `storageDomain`，域 `personal_workflow` version 1，`plans` 表一条记录保存一个根目标的全部不可变版本和操作回执。Desktop 沿用 `storage-json` 路由，单记录写入经现有原子文件替换提交；不新增 SQLite 表，不改变 SQLite SCHEMA_VERSION。未知存储格式/损坏记录拒绝加载，不自动跳过。`KvTable.update` 在存储队列内比较 expectedRevision 并提交；创建也由服务队列串行比较，关闭先拒绝新操作、排空已接收操作再关闭域。锁只覆盖计划提交，不能作为执行期独占锁。

提案/用户编辑均创建新版本；同一版本保存准确任务树、依赖、阶段和审核状态。首版采用全版本审核：任意定义变更令新版本所有批准失效，旧版本及批准保留用于历史展示。批准只接受当前准确版本，单独的用户 Remote 操作不启动执行、不授予工具权限。模型提案接口不能接受 approval、运行状态或自动执行授权。托管 `propose` 在提交队列内核对模式版本、复杂目标评估、Bot Skill 许可和当前对话归属。每个写请求包含 operationId；相同键和相同规范化请求返回原回执，相同键不同请求拒绝，即使期间产生新版也不重复写入。不同幂等键的过期版本请求拒绝，不能覆盖新版本。

根目标的 Project/Bot 归属在首次提案时固定；Session 移动不会更改任务归属。删除对象不删除任务或历史引用，视图显示失效归属；后续执行必须重新核对。编辑旧目标的归属需要未来明确的任务重归属动作，本轮不暴露隐式修改。

## Remote、模型与 Session

`sessionController` 提供 `workflowList`、`workflowRead`、`workflowSave`、`workflowApprove`、`workflowExport`、`workflowSnapshot`、`workflowMode` 和 `workflowSetMode`。保存/批准为用户动作；提案服务入口 `propose(session, modeRevision, request)` 供 Phase 4 的托管工具消费，只能保存未审核版本。标准 preset 的 `skill-dev-workflow` 提供模式适配和 `workflow_assess` / `workflow_propose`；模式默认关闭，此时隐藏工作流工具且不注入方法。Client 读取具体版本，导出从同一对象渲染，Markdown 无回写入口。

`workflowSnapshot` 和模型提案把准确版本/批准状态/完整定义记入 `personal-workflow/snapshot`，包括 taskId、operationId 和 Session 的稳定引用。提交顺序：先提交领域记录，再追加 Session 快照，再 flush Session，全部成功才返回。Session 写失败时领域提交不回滚，调用方收到失败；用原 operationId 重试会复用领域回执，补写/flush 快照。快照以 sessionId + operationId 判重，事件内容必须相同；模型可见文本来自已 flush 的快照，未来工具结果由现有工具流水线记录，不能临时读取最新版本替代历史快照。审核本身无须跨存储写入；下次读取记录当时实际批准状态。Session 引用是阅读/规划关联，不授予执行所有权。

此阶段无需修改 agent-loop。真实扩展点：模型能力用 `ctx.tools.register`；模式上下文用 `agent/pre-step` 或已有 prompt 贡献并遵循 Session 日志；执行许可在 `tools/pre-execute` 重新核对；停止在 `agent/turn-stopping`。所有注册经 effect/on 清理。Session 创建/恢复沿用 session-controller 的显式 Agent 操作，不因读取计划创建会话。`workflowSnapshot` 为写日志的显式动作，可以恢复已有普通 Session，但不提交 prompt 或领取任务；其余计划读写不激活 Agent。

## 模式、视图与候选

增强模式属于当前对话、由用户显式选择，默认关闭；Project/Bot 都能进入，没有 Bot 也可使用。关闭为普通 Agent；开启时简单目标仍普通执行。复杂或不确定目标先澄清和评估，再提交未审核方案。Skill 禁用时明确失败，不绕过 Bot 权限。

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

manual 为默认。auto/auto_until 必须单独持久保存用户授权，绑定当前任务、准确版本、含端点阶段、停止位置及 Config 验证的预算；不能选择其他任务、分配 Agent 或自动开对话。每次新工具动作核对批准/所有权/权限/预算，取消只阻止后续动作，不能回滚在途副作用。修改正在执行的任务版本须先停止并收敛在途动作；不同任务正常产物变化不自动撤销其他任务批准。

Handoff 保存源/目标 Session、TaskId、revision、ownerEpoch、上下文、决定、证据、cwd、Git HEAD、脏文件指纹、非 Git 资料/产物指纹、预算及停止位置。先提交交接包，再幂等创建目标 Session，再待旧动作收敛或记录 unknown，最后转移 epoch；新对话保持暂停，由用户明确恢复并发送执行指令。崩溃恢复对照交接包与 Session 引用补齐关联，不能重发未知 shell/外部动作。只允许同客户端、同工作区接力；无法归因的变化仅暂停受影响任务。

## 验证与观测

关键提交/校验失败记录 `personal-workflow`、taskId、planRevision、operationId、decisionCode 和 result，不记录正文或凭据。业务事实由领域记录及 Session 快照恢复。测试必须覆盖真实 JSON 重开、并列汇合、隐含完成环、版本冲突、重复批准、存储失败、Session 重试和 Remote 调用；可见验收在 Phase 3。领取与接力已有 Loader、真实 AgentLoop/工具链、Remote 和文件观察测试；Desktop 可见验收仍由用户执行。

## 内置方法与模式实现

`packages/skill/skill-dev-workflow/assets/source.json` 固定上游 dlyqs/dev-workflow-skill 提交 `4f51803b4578139dd9de2dc690c1d2638c54decd` 和 SHA-256；`NOTICE.md` 记录作者在本任务中的身份确认及内置授权，不声明上游已有公开许可证。运行时只加载包内托管方法 v1，不依赖作者机器路径；上游源码作为来源记录保留，未引入自动接力引用资源。

输入框中的显式模式开关保存 `personal-workflow/mode`，含单调版本及幂等操作 ID。读取以真实持久日志为准，flush 失败不能启用提案；模式选择的同步投影只用于工具可见性。Bot 禁用 Skill、缺少包内 Skill、模式过期或关闭时明确拒绝。对话的每次用户输入在 pre-step 加入准确方法及模式信息，由普通 `user/message` 日志保存；工具后续步骤不重复注入。关闭后的下一次用户输入记录取代旧方法的关闭说明。

模型通过 `workflow_assess` 给出 simple / clarify / infeasible / complex 及理由，保存 `personal-workflow/assessment`。前三者不创建计划；复杂目标经消歧和可行性判断后才可提案。程序不假装能从自然语言独立证明复杂度判断正确；确定性测试覆盖每个路由的许可和持久效果。提案只产生待审核版本，既不批准也不创建 Run。托管方法中的 Markdown 权威和 Codex 对话管理流程已替换为应用结构化计划、审核和工具路径。

Client 全部计划入口及 Project/Bot 子入口读取同一版本投影；树和阶段分组分别显示层级与显式依赖，不由展示顺序产生依赖。编辑保存需重新审核，失败保留草稿及幂等键；导出引用显示的准确版本。可见 Desktop 验收由用户执行，助理不启动页面。

## 执行授权与持久恢复细节

`StoredPlan.runs` 与 `executionReceipts` 和计划版本在同一条存储记录内提交。旧记录可以省略这两个字段；有执行记录时验证 Task/版本/阶段引用、单执行者、会话唯一性、epoch、预算和证据。格式仍是 `personal_workflow` domain v1；未变更 SQLite 或 Session envelope。旧构建会拒绝不能识别的新增字段/消息来源，不能用旧构建继续写这些记录。

Remote 增加 `workflowCandidates`、`workflowLimits`、`workflowRun`、`workflowClaim`、`workflowStop`、`workflowResume`、`workflowHandoff`。候选查询、绑定、恢复和接力均不提交模型输入。一个执行对话绑定一个尝试；完成后要执行另一任务，请使用另一个对话。当前 TaskDefinition 每项只属于一个阶段，因此自动范围只包含所选 Task 的 phaseId；不把父任务阶段解释为获准领取其子任务。

Config 的 `maxActions`（默认 100）、`maxTurns`（20）、`maxDurationMs`（3600000）、`maxEvidenceBytes`（16777216）是部署上限，用户可以在绑定时收窄。时长从首次领取起累计，暂停和接力不重置。`maxTurns` 计用户输入或同任务自动续步的推进次数；工具返回后的普通模型续步不重复计数。`blockedTools` 默认包含标准 `subagent`、`subagent_fork`、`subagent_codex`、`subagent_claude_code` 和 `send_message` 委派工具；部署重命名委派工具时应同步此列表。已有工具审批、Bot allow list 与沙箱仍独立执行。

工具调用在派发前保存 pending，派发返回后保存 succeeded/failed。取消只禁止新动作；迟到结果仍归原 Run。完成必须引用该 Run 成功动作的真实 Session tool/result，先 flush 日志，再读取声明产物并保存 SHA-256、验收摘要及时间。实际文件与成功检查是必要证据，验收摘要仍由执行模型填写，程序不宣称可自动判定任意自然语言验收语义。

接力先持久化目标 SessionId、准确计划、决定/待办、证据、前置成果、基线及剩余授权，再由已有 Session 创建接口按固定 ID 创建或采用目标对话。准备期间源暂停、目标也被保留为不可执行；创建成功但提交失败时重试复用目标。必须先等待工具和已登记的 Session 活动收敛，才允许移交；转移增加 epoch，旧对话后续请求被拒绝。接收者不自动唤醒，避免崩溃后重复执行。已经到预算终点的任务不能再创建接收者。

恢复保存 cwd、Git HEAD、脏文件内容指纹以及本任务/前置产物 SHA-256；非 Git 目录必须声明产物路径。读取拒绝逃逸工作目录的符号链接、循环目录和超限文件。已运行兄弟任务的已声明产物变化可以归因，不自动暂停本任务；自身关联文件、HEAD 或无法归因的脏文件变化要求人工核对。恢复不覆盖文件、不重放动作。模型失败或取消后，对话 idle 而 Task 未正常结算时也进入待核对；idle 永远不表示任务完成。重启将 running 改为 needs_reconciliation，将 pending 改为 unknown；用户核对后 unknown 变为 reconciled 并保留备注，它不能作为成功检查证据，完成需要新的真实成功检查。

运行时没有第二份所有权缓存，候选、guard 和详情都从同一计划聚合派生。日志仅记录领取、停止、完成、移交、恢复等关键状态变化，不为每次成功工具调用输出排障日志。

## 验证与验收

无页面 Desktop Host 组件组合测试位于 `apps/desktop-host/tests/personal-workflow.spec.ts`，覆盖 Project/Bot 简单目标，以及 CSV 三阶段提案、审核、并行执行、接力、汇合、父任务证据和重开。测试通过独立 Node 子进程执行导出并读取最终文件；模型使用确定性响应，不能据此推断真实模型分类质量。包级故障测试、Client 纯交互测试与 built Host smoke 的实际命令见[施工计划 Phase 7](personal-workflow-plan.md#phase-7集成验证与文档收尾)。

工程验证已完成，Desktop 可见验收和真实模型验证待定。[验收剧本](personal-workflow-acceptance.md)列出用户操作、期望状态、CSV 内容和异常恢复检查；不要求助理启动页面。
