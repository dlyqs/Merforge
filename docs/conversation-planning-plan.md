# 对话主入口与自动任务规划实施计划

本文细化[产品路线图](../ai-native-work-os-product-roadmap.md)的 **产品 Phase 7C**。下文 Phase 1–10 是本计划内部施工编号。后续针对本计划说“继续”或“执行 Phase X”，先读本文及[工程概览](overview.md)，不要续跑已完成的组织执行计划，也不要进入产品 Phase 7B 或 Phase 8。

## 目标、歧义检查与可行性

把个人与组织的自然对话接到已有持久计划、任务分配和执行交付服务：普通问答和简单目标保持普通对话；复杂新目标在正常设置下自动评估、必要澄清并保存可审阅任务树；用户在同一对话内调整计划、选择真人负责人、明确确认分配，再从各自独立对话完成接受、委托、开始、人工介入、提交、验收、返工及目标交付。组织工作台继续提供辅助总览。

歧义检查：路线图 v0.5 已明确下一轮先做产品 Phase 7C，且关闭强制拆分测试模式是主验收条件。无需在 Phase 7B、7C 和 8 之间再次选择。初始请求仅授权生成计划。2026-10-02 用户先要求“请自动完成 phase1-2”，随后要求“请自动完成 phase3-4”；随后用户要求“请自动完成 phase5-6”；随后用户要求“请自动完成 phase7-8”；2026-10-03 用户进一步要求“请自动完成剩余 phase”，当前自动授权覆盖剩余 Phase 9–10。以下拟定语义供评审，Phase 1 固化接口和状态；若实施发现必须改变真人确认、私人隔离或既有授权原则，记录具体差异并停在该决策处。

目标可行：个人规划、组织 WorkGraph、分配、设备许可和交付消费者已经存在。难点是尚未有任务时的组织规划模型授权、独立组织对话的完整生命周期、子树修改及分配后对话的幂等恢复。仅启用个人增强模式或把工作台表单搬到聊天旁边不能完成本期。

最小交付切片：一位下发人、一位员工、一个已授权项目、正常模式下自然输入的 CSV 复杂目标、至少两个必要子任务及真实可核对文件。建树、调整、分配和日常管理均从对话完成；两人的聊天分开，业务记录来自同一组织权威。

范围内：默认复杂度路由、按用户保存的规划设置、澄清与目标身份、组织项目/任务对话、规划模型授权、结构化草案与准确版本修改、获准子树细分、真人负责人建议和选择、逐项/批量分配确认、独立员工任务对话、对话内业务确认、恢复/重复请求/权限负例及验收交接。

范围外：外部 Codex 执行器、跨设备接力、自动人员调度、自动批准或自动委托、共享 Runner、企业 IM、全套岗位系统、私人 Bot/记忆进入组织、自动学习、自动应用或 push 成果、公开发布和产品 Phase 8 的真实三机总验收。首版仍沿用 Phase 7A 已支持的内建模型和有界文件工具，不顺带开放 shell、subagent、job 或终端。

与 [Phase 7B Codex 后端计划](codex-backend-plan.md)的衔接：本计划仍可用内建 API 后端独立完成；规划宿主准入按后端能力区分，HTTP/endpoint/key 校验只适用于 API 路径。Codex 的原生运行时、登录与组织执行由 7B 建设；原生工具由 Codex 拥有，不经过 Harness 逐动作权限管线。已有组织任务使用与 Run 完全一致的 `inputs.backend`（kind/runtime/model/effort/turn/time），不填写 endpoint/key。7C 复用该消费者和固定真人动作；选 Codex 后不得要求另一个 API 模型负责规划。7B 可用后，组织目标/任务对话消费同一权限和规划接口，不另建任务权威或改变真人确认规则。完整 Codex 自然目标流程需两者均完成，各自主表保持独立。

## 静态核验基线与复用位置

核验日期：2026-10-02；HEAD：`ad5afa255e34c3f79bdd804842e372e6ec78c2ec`。本次依据当前工作区路线图、工程概览、既有实施记录及源码规划，没有重跑历史测试。

开始时已有修改：路线图，以及 `packages/host/organization-connection/{README.md,src/index.ts,tests/workgraph.spec.ts}` 的拒绝请求刷新收敛修复。本计划将它们作为现状读取，不改写、不回滚、不声称已经验证。后续实施先核对工作区变化，避免覆盖并行工作。

| 现有位置 | 已核验能力 | 本期复用与缺口 |
| --- | --- | --- |
| `packages/skill/skill-dev-workflow/src/index.ts`、包内 `assets/SKILL.md` | 模式门控、日志化方法、`workflow_assess` / `workflow_propose`、受限执行工具 | 复用方法和分类结果；目前模式默认 off，工具依赖 personal 服务，不能直接挂入组织隔离域 |
| `packages/workspace/personal-workflow/src/{index,mode-projection,schema}.ts`、`packages/api/session-controller/src/index.ts` | 持久计划、审核、回执、会话模式、默认关闭的本机强制拆分设置 | 补自动默认策略、显式关闭的兼容、稳定目标与澄清关联；保留个人唯一写入者 |
| `packages/workspace/organization/src/{workgraph,workgraph-access,assignment}.ts` | 整计划 revision、root edit + project write、叶子批准、任务可见范围、通知/回执 | 完整保存要求整树编辑权；还没有员工子树结构修改命令。分配审核只检查已有查看权，不自动加 grant |
| `packages/host/organization-connection/src/{index,types,schema}.ts`、`packages/api/organization-api/src/` | 原生固定动作、HTTPS、generation、SSE、未知回执核对 | 接规划资格、可见负责人候选和必要新事务；管理快照中的成员列表目前仅对 admin 加载，不能作为所有成员的推荐来源 |
| `packages/workspace/organization-context/src/`、`apps/desktop{,-host}/src/organization-context.ts` | 本人独立两事件只读上下文、固定任务快照、私有 IPC 复核 | 保留现有只读格式；新目标尚无 task，不能伪造 task 或将该服务改为普通 Agent 入口 |
| `packages/workspace/organization-execution/src/{runtime,model,action-guard,protocol}.ts` | 隔离 Agent/Session、模型目的地交集、逐动作许可、本机日志及显式恢复 | 执行适配器要求已有运行任务与委托；复用适用的安全机制，不能用伪造 Run 授权规划模型 |
| `packages/client/ui-organization/src/client/{Workbench,TaskEditor,MemberSelect,AssignmentPanel,Inbox,ExecutionPanel,DeliveryPanel,AcceptanceReview,IntegrationPanel}.tsx` | 工作台任务详情、成员选择和完整业务动作 | 提取适用展示及固定动作消费者接到对话；复用不等于共享两人的聊天记录 |
| `packages/client/ui-personal-workflow/src/client/`、`docs/subsystems/conversation.md` | 个人模式、任务树、执行控件；ConversationNodeDefinition 与 keyed renderer | 接入可重建的任务关联和对话内详情；纯展示不增加业务事实或第二条历史流 |

可行性风险及处理：

- **自动识别是模型判断。** 程序能校验路由与持久效果，不能用字符数、关键词或确定性适配器证明真实自然语言判断准确。提供普通问答、简单、复杂、模糊及续聊语料；真实模型评估单独记录，不能以 forced 模式或单元测试替代。
- **无任务规划不能借执行资格。** 新目标尚无 assignment/lease，必须有独立、有限、仅供规划的模型准入；服务拒绝或断线时不能借个人模型路径继续发送组织内容。
- **组织业务与本机聊天不能跨进程原子落盘。** 稳定标识、先持久意图、服务端回执和本机绑定分步恢复；未知写入先核对，不自动重发分配或建另一条对话。
- **子树细分会改变整计划版本。** 保留既有全局 revision 与结构授权失效规则；在确认前展示受影响批准、grant、Run 和交付资格。不能为了体验绕过失效，也不能无提示把员工已接受的叶子变成父任务。
- **历史产品验证未完成。** Phase 7A 最终发行、真实模型和三机检查仍待用户。本期新增工程证据不追认历史待验项，也不把本计划工程完成写成 Phase 8 产品通过。

## 约束与拟定实施语义

1. **仅 Desktop 入口。** 复用 Cordis 插件、标准 Agent loop 和现有对话组件。Electron 持有 bearer/设备材料；Host 只消费私有、固定、可取消的授权通道。组织服务不运行成员模型，不引入第二套服务栈。
2. **自动规划与执行分开。** `auto` 的产品规划策略表示自动判断复杂新目标；本计划的 `execution mode` 表示开发阶段推进，两者不混同。自动保存草案不批准、不下发、不领取、不执行。
3. **用户设置。** 拟用显式 `resolve(request): Spec` 计算有效规划策略：自动识别开关、粒度、执行方式、停止位置、模型/工具配置引用及测试开关。组织策略与当前权限是上限；岗位/职责仅影响建议。首版不新增 HR/职位管理系统，不按 admin/member 自动授予额外能力。
4. **默认及兼容。** 未作过选择的新对话默认自动识别；旧的 `enabled:false, revision:0` 与用户显式关闭需区分。历史明确关闭保留关闭，不能被新默认覆盖；明确开启继续有效。既有审核、预算与恢复不重置。具体映射和迁移在 Phase 1 定稿、Phase 2 验证。
5. **按用户保存。** 个人设置按本机 profile 的用户隔离；组织覆盖设置按 server/account/organization 隔离，登出或切换不串用。首版保证同一安装重开恢复，不增加跨设备偏好同步承诺。强制拆分默认关闭，只能由真人改变，不赋予业务权限。有效自动拆分明确关闭时，普通模式尊重关闭；显式测试 override 的优先级须显示，并在关闭后恢复本人策略。
6. **目标与消息身份。** 新目标、澄清答复、计划修改、进度查询、人工答复和已绑定执行输入分别路由。同一目标保存稳定 ID、输入消息身份、当前评估/设置版本及计划关联。相同已接收消息/operation 重试恢复原结果；相同文本的新请求不按文本哈希永久去重。非新目标不能反复建根树。
7. **组织对话隔离。** 项目目标对话、员工任务对话与 Run 执行日志分别关联，仍可在同一 UI 查看。规划/任务对话使用独立组织 Session 注册域与持久目录；个人发送、搜索、上传、fork、恢复拒绝组织 ID。原只读 context 保持原格式；私人 Bot、个人历史和本机秘密不进入组织模型或共享成果。
8. **规划模型准入。** 无任务时以当前项目 read、本人模型选择、组织模型/出站策略和有限规划限额获取短期许可；许可不要求共享编辑权，也不授予共享编辑权。每次实际模型 HTTP 调用及重试在线复核并核算限额；取消、撤权、身份变化、休眠、离线拒绝新增请求。只暴露澄清、授权查询、评估和草案工具，不挂载文件、shell、执行、审批或分配工具。可调限额进入 Config。
9. **一份任务权威。** 有编辑权的复杂目标保存组织结构化未批准定义；对话只持关联、准确版本和获准快照。无共享编辑权可保存本人私有建议，并标明未写入共享树；后续获权重新核验后才能应用，不伪装成正式任务。模型/自然语言结果均经 schema、关系/依赖、范围和当前权限校验。
10. **获准子树修改。** 新固定命令由服务端读取完整版本，只接受指定子树修改；不向员工回传或要求提交隐藏兄弟/祖先。外部依赖、目标、原批准要求、资源和预算上限不能扩大。自然语言范围不是可机器证明的权限：确定资源由结构化资格限制，含义变化以差异审阅和原下发人重新批准处理。细分引发的新版本与资格失效遵循原规则，新增叶子由原下发人明确重新批准；员工不获代批权限。无 edit 者只形成建议。
11. **负责人及确认。** 建议只引用当前可见、仍有效的真人成员；展示成员歧义供选择，不按名称猜唯一身份。候选查询与任务可分配审核均由服务端裁剪，成员身份可见不等于任务查看权。分配卡展示准确版本、负责人、目标/验收、资料范围及执行授权状态。缺 read 时另行明确确认补授权；无 grant 管理权不能代加。
12. **批量及独立对话。** 首版批量确认逐项执行现有原子分配事务，显示成功/冲突/未确认，不承诺整批原子。每项 operationId 在发送前保存，超时只查回执。批准生成持久分配通知和员工对话待建立标识；员工端在在线授权同步时幂等建立本机对话，员工离线不要求下发人机器写员工 JSONL。不复制领导原文，不因建对话自动接受或运行。
13. **真人动作与显示。** 自然语言只形成建议/待确认动作；批准、接受、委托、开始、提交、验收、驳回及最终确认始终调用既有真人固定动作。改派复用撤销与新批准，不改写历史下发人。对话详情至少显示目标/范围、验收、真人责任人、准确版本、运行状态、待谁处理及最新提交；完整日志仍按独立权限读取。
14. **验证和代码纪律。** 只做静态、纯逻辑、真实 Host/HTTPS/SQLite/JSONL 组合测试及无窗口 smoke，不启动页面或使用 Playwright、浏览器自动化、GitNexus。用户检查 Desktop 可见行为。包贡献通过 `ctx.effect()` / `ctx.on()`；waterfall 委派调用 `next()`；新 ID 使用品牌类型，不新增 `as unknown`。不开 Agent Notes，不自动提交、推送、发布或开新聊天。

## 主阶段状态表

仅此表记录全局进度；状态为 `pending`、`in_progress`、`completed`、`blocked`。`completed` 表示对应工程验收满足，真实模型、可见和三机验证按实际记录另列，不能推导为产品通过。

| 阶段 | 主题 | 主要目标 | 状态 | 实际产出 | 备注 |
| --- | --- | --- | --- | --- | --- |
| Phase 1 | 协议与消费者 | 固化路由、设置、组织规划准入和对话归属 | completed | docs/conversation-planning.md | 先定状态/权限，不创建空包 |
| Phase 2 | 个人默认自动识别 | 用户策略、目标/澄清关联及兼容迁移 | completed | 本人默认设置、稳定目标路由、方法 v2 与设置消费者 | 112 项聚焦回归通过；真实模型与可见待验 |
| Phase 3 | 组织规划权威 | 模型许可、可见成员与固定传输 | completed | 规划 grant/permit、SQLite v13、固定 HTTPS/native、项目候选 | 当前资格/计费/迁移/未知回执通过 |
| Phase 4 | 组织对话宿主 | 项目目标对话、隔离模型与持久恢复 | completed | 独立 organization-conversation、私有 IPC、JSONL、隔离标准 Agent | Node/Electron 无窗口 smoke 通过；真实模型/可见待验 |
| Phase 5 | 结构化计划写入 | 根草案、准确修改与获准子树细分 | completed | SQLite v14、真实提案工具、根/子树权威保存与原批准责任 | 迁移、回执恢复、冷重开与范围负例通过 |
| Phase 6 | 对话内计划管理 | 普通发送、树/版本、修改、查询与负责人 | completed | 个人内联计划节点、组织对话主入口与负责人建议 | 聚焦测试/构建/无窗口 smoke 通过；可见待验 |
| Phase 7 | 分配及员工对话 | 逐项/批量确认、授权及独立对话恢复 | completed | 原生逐项确认账本、持久通知关联、员工独立 Session 与侧栏入口 | 部分成功、未知回执、落盘恢复和权限负例通过 |
| Phase 8 | 对话内执行交付 | 接受到提交、验收/返工/集成完整确认 | completed | 对话固定动作、原分配 Run 关联、私有报告与查询路由 | 聚焦回归/类型/构建及 Node/Electron 无窗口 smoke 通过 |
| Phase 9 | 组合及故障验证 | 正常模式双人 CSV 和路由/权限负例 | completed | 正常发送到 CSV 交付组合、路由及权限故障证据 | 模型替身；可见与真实识别另列 |
| Phase 10 | 发行与验收交接 | 构建、无窗口 smoke、真实模型/三机剧本 | completed | Desktop 构建、Node/Electron 私有进程 smoke、tarball 资源与验收交接 | 真实模型无密钥跳过；可见/Windows/三机待用户 |

## Phase 1：协议、状态与实际消费者

目标：先明确每条输入由谁处理、哪些数据共享、哪些动作需要真人确认，以及无任务规划如何合法调用模型。

产出：新增 `docs/conversation-planning.md`；必要时更新 `docs/personal-workflow.md`、`docs/organization-workgraph.md`、`docs/organization-assignment.md`、`docs/organization-execution.md`、`docs/architecture.md` 和 `docs/session-format-status.md`。给出服务定义/提供者/消费者表；拟新增 `packages/workspace/organization-conversation` 仅承担本机组织目标/任务对话，实际创建留 Phase 4。

验收清单：

- [x] 固化设置优先级、旧显式 off 的迁移、测试 override、模型/工具配置引用及停止位置；自动识别不等于自动执行。
- [x] 固化目标与消息身份、路由状态及澄清/修改/查询流程、幂等键与冲突处理。
- [x] 列出规划许可、共享草案、子树 edit、候选成员、分配及员工对话绑定的作者与读取权限。
- [x] 固化无任务规划限额及逐请求在线资格；拒绝从个人 Agent 或执行 Run 借权。
- [x] 固化子树修改对 revision、grant、批准/租约/验收的影响；明确重新批准消费者和限额继承。
- [x] 按实际 slot/ConversationNode/私有 IPC/服务/API 接口列出端到端消费位置及失效/销毁规则。

助理验证：沿源码逐项核对，不运行模型或页面；检查文档引用和状态覆盖。用户检查：审阅默认设置、子树变更影响及确认粒度。依赖：无；重大产品原则变化必须明确处理后再进入实现。

实际完成（2026-10-02）：新增 `docs/conversation-planning.md`，沿 personal-workflow、Skill、Session Controller、Slot/Conversation、WorkGraph 权限及 Desktop 私有 IPC 源码核对设置解析、稳定输入、规划资格、子树失效和真实消费者。组织新增命令/包明确标为后续，不创建空包。工作区起始为干净状态，未覆盖计划基线中所述的历史修改。未运行模型或页面；没有改变真人确认、私人隔离或既有授权原则。仓库引用的 `.agents/skills/dsh-prose-standard/SKILL.md` 已不存在，搜索未找到；采用根 AGENTS 的直接文字规范核对。下一步 Phase 2。

## Phase 2：个人策略与正常模式自动识别

目标：用户直接发送复杂目标即可规划，同时保留明确关闭和简单对话体验。

产出：`personal-workflow` 类型/schema/设置及 Session 投影、`skill-dev-workflow` 方法/工具门控、`api/session-controller` 对应 Remote；`ui-personal-workflow` 设置和模式消费者。方法更新保留授权来源及 NOTICE，实际变动的 README 同步。

验收清单：

- [x] 未选择时默认自动识别；旧 off/显式 off/显式 on 均按 Phase 1 映射，无设置或日志数据丢失。
- [x] `simple`、`clarify`、`infeasible`、`complex` 可持久关联当前目标；澄清答复和查询不建另一根树。
- [x] 测试默认关闭；打开可拆简单新目标，关闭恢复本人策略；已绑定执行步骤不递归拆分。
- [x] 设置变化、Bot 禁用 Skill/工具或 Session 归属变化在提案落盘处拒绝旧资格；已批准执行不受测试开关授予额外范围。
- [x] 方法文本、有效设置、评估与计划快照可从 Session 重建；简单目标没有计划副作用。

助理验证：聚焦模式/提案/迁移/重开及重复消息测试，受影响类型与局部 lint；模型仅确定性替身，不把分类用例称为真实识别准确率。用户检查：正常发送复杂/简单目标、显式关闭、切换偏好和测试开关。依赖：Phase 1。

实际完成（2026-10-02）：`personal-workflow` 新增本人设置域、显式策略解析、品牌化 GoalId、当前 MessageId 评估回执及目标/计划关联；mode 投影升级到 stateVersion 2，以日志中的明确选择区分历史初值。澄清复用目标，修改保留根与版本，查询不能提案；相同消息重试恢复，不按文本去重。提案重新核对设置、输入、Bot Skill/工具及归属，先保存领域回执再写 Session 快照。`skill-dev-workflow` 托管方法 v2 记录有效设置、模型引用和当前目标，保留 upstream/NOTICE；绑定执行不再拆分，Bot 禁用规划时普通对话仍可使用。`api/session-controller` 新增本人设置 Remote，`ui-personal-workflow` 在既有设置入口提供自动识别与粒度，并显示测试 override。已同步四个包 README、个人工作流、Session 格式说明、持久化生成目录及项目引用；没有新增 Session tag、组织包或 SQLite 迁移。

实际验证：

- `pnpm exec vitest run packages/skill/skill-dev-workflow/tests packages/workspace/personal-workflow/tests packages/client/ui-personal-workflow/tests apps/desktop-host/tests/personal-workflow.spec.ts packages/storage/storage-domain/tests/invariant.spec.ts packages/core/agent-codex/tests/bridge.spec.ts apps/desktop-host/tests/personal-codex.spec.ts`：20 个文件、112 项通过。新自动规划用例从真实 AgentLoop/工具发送进入；JSON/JSONL、设置重开、重复消息、澄清/查询/修改、权限变化与普通 Bot 对话保持真实，仅模型及原生 peer 的不确定性使用替身。
- `pnpm exec tsc -b packages/api/session-controller/tsconfig.host.json packages/skill/skill-dev-workflow packages/client/ui-personal-workflow --pretty false` 和 `pnpm exec tsx scripts/run-oxlint.ts <实际修改的源码及测试文件>` 通过。
- 定向构建通过：`pnpm exec tsdown --filter @deepseek-ai/dsh-api-session-controller --env.DSH_BUILD_FACE=host`；`pnpm exec tsdown --filter @deepseek-ai/dsh-personal-workflow --filter @deepseek-ai/dsh-skill-dev-workflow --env.DSH_BUILD_FACE host`；`pnpm exec tsdown --filter @deepseek-ai/dsh-client-ui-personal-workflow --env.DSH_BUILD_FACE=client`；`pnpm exec tsdown --filter @deepseek-ai/dsh-client-ui-personal-workflow/client --env.DSH_BUILD_FACE client`。另以仓库 WorkspaceTypertGenerator 为 session-controller 生成 Host/Remote 产物，核对新增偏好 codecs。
- `node packages/workspace/personal-workflow/tests/built-smoke.mjs` 通过：普通 Node 真实 Loader、Remote 设置编解码、偏好与 JSONL 重开、执行中断恢复及托管方法资源。
- `pnpm run gen-persistence-catalog` 与 `pnpm exec tsx scripts/gen-persistence-catalog.ts --check` 通过，生成目录与 schema 一致；known-event-types 没有内容变化。
- `verify-client-ui-i18n`、`verify-client-packages`、`verify-client-route-resolution`、`verify-tsconfig-paths`、`verify-cordis-config`、`verify-application-entrypoints`、`verify-scoped-events` 通过。变更文档引用及 `git diff --check` 通过。

既有门禁问题：`verify-client-domain-graph` 在未修改的 ui-conversation、ui-sidebar-browser、ui-sidebar-documentpreview、ui-workspace 报 62 项；`verify-package-dependencies` 在未修改的 `packages/client/file-upload/src/index.ts:2` 报一项分类问题；`verify-export-jsdoc` 在未修改的 `packages/host/organization-connection/src/login-session.ts:20,31` 报两项方法说明缺失。全仓 Markdown 引用检查仍有既有断链和缺失 skill；本轮修正触及 README 的文档路径，变更文档引用单独通过。未扩大范围修复或修改门禁例外。

未执行真实模型识别评估、完整 Desktop 发行构建、页面/浏览器、用户可见或三机验收；确定性分类测试不代表真实识别准确率。工程验收完成，保留上述待验；下一阶段为 Phase 3，本轮授权范围已结束。

## Phase 3：组织规划资格与当前可见负责人

目标：建立不依赖既有任务的有限规划模型许可和最小成员候选查询，先完成组织权威与传输。

产出：`organization` 规划资格/许可/限额/回执及必要 SQLite 单调迁移；`organization-api` 固定 HTTPS；`organization-connection` 固定动作/schema/types、generation 和未知回执核对。只新增实际消费者所需字段，日志/迁移/备份校验随持久关系更新。

验收清单：

- [x] 当前项目 read 成员能获仅规划资格，无 write 成员仍不能写共享树；撤权、停用、策略变化、到期和服务 epoch 更换拒绝新增请求。
- [x] 模型策略与本机目的地相交，限额原子核算；每次实际调用和重试独立准入，重复操作不重复计数，未确认调用不直接认定可免费重试。
- [x] 对 renderer 不开放任意 HTTP/模型代理；个人凭据不进入权威记录，规划许可不能运行工具副作用或变成委托。
- [x] 成员候选只含当前获准读取的必要身份/职责字段；推荐不泄露账号秘密、不可见任务或整份管理员成员表。
- [x] 固定查询/命令/事件/回执同样经过当前权限；迁移失败回滚，冷重开和备份恢复校验新增关系。

助理验证：真实 SQLite 和 HTTPS/native 测试，限额并发、同键异内容、发送前撤权及策略变更；相关 Host 类型、lint、事件/配置门禁。用户检查：设置入口及权限限制说明后续在 Phase 6 一并检查。依赖：Phase 1–2。

实际完成（2026-10-02）：`organization/src/planning-schema.ts`、`planning.ts` 提供仅项目 read 的有限资格、原子请求/字节预留、一次性消费与最小项目成员分页；命令/回执不含凭据、文本、assignment/lease/Run。SQLite 从 v12 单调升至 v13，启动/备份恢复校验 grant/permit/event/receipt 归属与累积计数，v12 迁移失败回滚。显式续期保留首次限额及累计用量，旧 qualificationRevision 的未消费许可拒绝。候选只返回 membershipId/username；首版没有可授权职责字段，因此不扩张成员资料。

`organization-api` 固定三个规划 POST，`organization-connection` 暴露两种 Renderer 只读查询和私有 generation-bound planningCommand；未知写入复用 durable pending journal，只核对回执。`organization-conversation/model.ts` 交叉核验在线策略和本机显式 credential destination；DeepSeekAdapter 的 beforeRequest 新增最终 serialized payload，在 credential/preparation 后为每次实际 HTTP 和 provider retry 按 UTF-8 字节独立计费、flush 意图及回执、消费许可、再复核后发送。没有 API fallback 或共享写权。

工程验证：规划 SQLite 11 项、原生规划未知回执 1 项通过；取消/撤权/策略/epoch/身份及 provider retry 在 Phase 4 组合中通过。既有权威、WorkGraph、分配、API/Codex/人工执行、产物/验收/集成、HTTPS/native 回归共 141 项均已通过，其中首次 5 项失败来自旧 schema 夹具未删除新表及旧备份版本断言，修正夹具后重跑 authority/connection 34 项通过，不改迁移失败语义。DeepSeek adapter/egress 和 native WorkGraph 另 37 项通过。实际命令在 Phase 4 收尾区统一列出。

## Phase 4：组织项目目标对话与隔离规划宿主

目标：尚未创建任务时也能打开本人组织项目对话、发送目标及澄清，运行受限规划 Agent，重开恢复原关联。

产出：Phase 1 确认的 `organization-conversation` 服务/协议/持久化；`apps/desktop{,-host}/src/` 固定私有 IPC；必要 bundle/preset/manifest 与持久事件目录。复用 loop、工具、Session、LLM 与日志基础，不复用 personal 状态作为组织权威。

验收清单：

- [x] 本人项目对话有稳定 Session 与组织身份关联；原子预留、JSONL 写入和重开对得上，半完成记录可以恢复且不建立副本。
- [x] 组织对话用独立 Agent/Session 域，个人发送/查询/fork/上传/恢复全部拒绝；原只读 context 不变。
- [x] 用户输入、准确授权上下文、有效设置、方法版本及澄清均记录；只把明确允许的共享资料用于组织模型。
- [x] 私有 IPC 关联 nonce/request/generation/顶层窗口；迟到响应拒绝，销毁等待 Agent/请求/落盘收敛。
- [x] 最终 HTTP 发送前检查一次性规划许可；默认工具集仅规划与澄清，无文件/执行/审批绕过。
- [x] 断线、休眠、身份切换停止新增调用，重连不自动续跑；有独立持久关系才增加 invariant，并在真实 Loader 门禁执行。

助理验证：真实 Loader/私有 IPC/HTTPS/JSONL 与模型替身组合、准入/取消竞争、重开及 HMR dispose；检查独立模型可见日志。用户检查：后续从组织项目打开、重开和切换对话。依赖：Phase 3；共享草案写入留 Phase 5，不能用此阶段宣布已自动建树。

实际完成（2026-10-02）：新增 `packages/workspace/organization-conversation`，用独立 version-1 domain 原子预留本人 server/account/organization/project/conversation → Session，独立 organization-conversation JSONL 在半写失败后恢复同一绑定。open/read 不运行模型，settings 按账号隔离、比较 revision 并幂等恢复；send 先保存 operation/input/goal，发出前保存实际方法/设置/准确授权并与 Session 事件核对。重复已接收消息不重发，澄清引用原 goal；sending 冷恢复为 unknown，stopped/unknown 均需新显式输入，不自动续跑。

标准 Session/Agent/loop/LLM/Tools/Retry 在隔离域挂载，仅 workflow_assess 与 planning_authorization，关闭评估移除前者。没有文件、shell、执行、审批或分配服务。四个必需事件及当前 reader/生成 schema 同步，Session envelope 版本不变。个人 Session/Agent、查询、JSONL、上传和 fork 的中央准入拒绝新 namespace；原只读 context 保持不变。独立 `./invariant` 经真实 Loader 与 built child 执行，核对 owner、实际 input/settings/authority、评估来源、重复与孤儿记录。

Desktop/Host private IPC、preload typed conversation 接口及发布闭包已接线，nonce/request/authorizationId 多槽对应并核验 generation、top frame、Host/window 寿命。撤权、取消、身份切换、休眠、迟到授权和 dispose 均有拒绝/排空证据；重连只读取。Config 拥有模型目的地/credential 引用、步数、复核/时长和报告上限，`desktop.patch.yml` 显式部署。诊断仅记录 ID、generation、操作与终态，不含模型文本或秘密。临时诊断已移除。

最新真实 Loader/HTTPS/native/JSONL 组合 11 项通过，只替换模型 fetch；两项 built smoke 在普通 Node 和 Electron Node mode 通过，使用真实私有子进程、标准 Agent/HTTPS/JSONL、冷重开与重复发送，未创建窗口。API 项目规划可独立使用；Codex 原生项目规划尚无专用能力，明确拒绝 API 代替。共享草案写入留 Phase 5，普通组织聊天控件留 Phase 6，不宣称已自动建树或 UI 通过。

本轮实际检查命令（聚焦范围去重共 201 项；失败后的修复回归已说明）：

- `pnpm exec vitest run packages/workspace/organization/tests/planning.spec.ts packages/workspace/organization-conversation/tests/conversation.spec.ts`；随后新增负例的最终命令为同两文件加 `packages/workspace/organization/tests/authority.spec.ts packages/host/organization-connection/tests/connection.spec.ts`（55 项通过）。
- `pnpm exec vitest run packages/workspace/organization/tests/authority.spec.ts packages/workspace/organization/tests/assignment.spec.ts packages/workspace/organization/tests/execution.spec.ts packages/workspace/organization/tests/execution-human.spec.ts packages/workspace/organization/tests/execution-codex.spec.ts packages/workspace/organization/tests/delivery.spec.ts packages/workspace/organization/tests/acceptance.spec.ts packages/workspace/organization/tests/integration.spec.ts packages/workspace/organization/tests/workgraph.spec.ts packages/host/organization-connection/tests/connection.spec.ts packages/host/organization-connection/tests/assignment.spec.ts packages/api/organization-api/tests/https.spec.ts`（141 项，初次 136 通过/5 夹具失败，修复后上述相关 34 项通过）。
- `pnpm exec vitest run packages/workspace/organization-conversation/tests/conversation.spec.ts packages/host/organization-connection/tests/planning.spec.ts`（12 项通过）；实际授权快照与本机 intent 的最终核对改动后单独再跑前者（11 项通过）。
- `pnpm exec vitest run packages/llm/llm-deepseek/tests/adapter.spec.ts packages/llm/llm-deepseek/tests/egress.spec.ts packages/host/organization-connection/tests/workgraph.spec.ts`（37 项通过）。
- `pnpm exec tsc -b apps/desktop apps/desktop-host --pretty false`；`pnpm exec tsdown --filter @deepseek-ai/dsh-session --filter @deepseek-ai/dsh-session-persistence-jsonl --filter @deepseek-ai/dsh-organization --filter @deepseek-ai/dsh-organization-api --filter @deepseek-ai/dsh-organization-connection --filter @deepseek-ai/dsh-organization-conversation --filter @deepseek-ai/dsh-llm-deepseek --filter @deepseek-ai/dsh-llm-retry --filter @deepseek-ai/dsh-desktop --filter @deepseek-ai/dsh-desktop-host --env.DSH_BUILD_FACE=host`（通过；是定向 Host 构建，不是完整 Desktop 发行验收）。
- `node apps/desktop-host/tests/organization-conversation-built-smoke.mjs` 及同命令 `--electron`（通过）。
- `pnpm exec tsx scripts/run-oxlint.ts <本轮变更源码与受影响迁移测试>`（两组局部范围通过，新增 package 全量覆盖）；`pnpm run gen-persistence-catalog`、`pnpm exec tsx scripts/gen-persistence-catalog.ts --check`、`pnpm run verify-tsconfig-paths`、`verify-cordis-config`、`verify-application-entrypoints`、`verify-package-meta`、`verify-scoped-events`（通过）。
- `pnpm install --lockfile-only --ignore-scripts` 更新新增 retry/workspace 闭包；变更 Markdown 新增/修改本地链接核对和 `git diff --check` 通过。

既有全仓门禁本次复核仍失败：`verify-package-dependencies` 为未修改 file-upload 一项导入分类；`verify-export-jsdoc` 为未修改 login-session 两处描述；`verify-package-invariants` 为 ui-personal、agent-codex、session-format-catalog、session-format-current、session-format 五处 README 缺省略理由；`verify-no-unknown-casts` 为未修改 model-selection-projection、commands-create-fork.host、session-models.host、agent/inbox 共五处。新增代码无 unknown assertions，未修改例外表掩盖失败。全仓历史文档断链保留；本轮新增/修改链接已单独核对。

未运行真实模型、页面/Playwright/浏览器自动化/GitNexus、完整发行构建、用户可见、Windows 或三机验收；不把模型替身或静态接线当作产品通过。Phase 3–4 工程验收完成，自动范围到达 Phase 4 后停止，下一阶段为 Phase 5，需用户另行授权。

## Phase 5：根草案、准确修改与员工子树细分

目标：把模型建议接到权威 WorkGraph，形成可审阅树和获准局部修改，避免两份漂移计划。

产出：`organization` 的目标/计划关联及子树固定命令、schema/事务/当前授权投影；API/native 接线；组织规划评估/提案消费者；当前版本快照与本人私有建议记录。必要的两消费者纯逻辑从既有实现抽取，不合并个人与组织写入者。

验收清单：

- [x] 复杂、已澄清目标提交校验过的结构化草案；simple 不建树，无 write 者只存私有建议并清楚标明状态。
- [x] 相同已接收目标/operation 重试只有一棵树，失去回执先核对；不同内容同键拒绝，版本冲突不覆盖。
- [x] 保存处在线复核当前设置、项目/task edit、评估版本及目标归属；模型草案不包含领导完整聊天或私人秘密。
- [x] 服务端合并获准子树，隐藏兄弟不参与客户端输入/返回；非法祖先/跨树依赖、预算资源扩大、历史移除 ID 重用均拒绝。
- [x] 文本修改和结构修改准确递增版本，按原机制失效资格；变更前可查影响，新叶子只由原下发人重新批准，不隐式继承旧叶子许可。
- [x] 对话和工作台重读同一权威记录；依赖查询、提交及父级汇合消费细分后的当前定义。

助理验证：领域事务/权限/迁移/并发测试、真实提案工具管线与回执丢失、下发后细分及重新批准；独立查询 SQLite 校验隐藏子树未被修改。用户检查：从对话调整草案、修改目标、细分授权任务及确认失效影响。依赖：Phase 4。

实际完成（2026-10-03）：SQLite 单调升级至 v14，新增 planning_goals 和 planning_reapprovals；v13 用量不重置，旧版本及备份夹具同步。新增 readPlanningPlan 与 save-planning-draft，固定 HTTPS/native/私有 Host 接线，复用 WorkGraph 唯一 writer。非根 edit 只接受准确子树，服务端保留父节点和外部依赖、合并完整版本；隐藏兄弟不变，原目标/范围/验收/产物、跨树依赖及历史 ID 重用受校验。结构修改不隐式续 grant；旧资格失效，新叶子由原下发人重新批准，其他根编辑者也不能代替。

真实 workflow_propose 工具消费当前输入的 complex 评估，方法升级 v2；新必需 proposal 事件、Session 投影与 reader/catalog 已接入。保存前先持久意图，无 edit 仅保留本人私有建议，冲突不覆盖；同键变更拒绝，丢回执通过原生 journal 和权威 goal 关联恢复。自己的保存引发 generation 更新时，身份不变才允许只读恢复，不重发输入/模型/保存。历史任务失权拒绝旧正文重放。新成员建议复核当前可见性；没有自动批准、分配、委托或运行。

领域与真实工具管线验证覆盖冷重开、迁移、隐藏外部依赖、范围扩大拒绝、旧批准失效、原下发人重新批准、共享/私有/冲突/回执丢失与撤权。冷重开曾发现新审计 kind 未加入枚举，已补齐并通过；临时诊断已移除。模型只使用 HTTP 替身；自然语言范围不被声称可机器证明，最终仍由原下发人审阅。具体命令统一记在下方 Phase 5–6 验证记录。

## Phase 6：对话内计划树、修改和负责人选择

目标：把个人和组织计划能力接到日常对话输入与可重建卡片，工作台成为可选总览。

产出：`ui-personal-workflow` 与 `ui-organization` 的对话入口、设置、任务节点/卡片、详情与成员选择；现有 ConversationDefinition/keyed renderer/slots 注册及 native 订阅。抽取适用任务详情视图，全部产品文案经 typed locale。

验收清单：

- [x] 普通发送直接进入自动路由，不依赖斜杠命令、手工根任务表单或测试开关；简单目标正常显示答复。
- [x] 树、版本、授权状态和当前目标关联来自持久记录；澄清答复、自然语言修改和进度查询针对当前目标。
- [x] 详情持续显示目标/范围、验收、责任人、版本、运行状态、待谁处理及最新提交；无权者看到明确限制，不显示旧内容。
- [x] 支持“开发交给某成员”等建议及控件选择，姓名歧义、成员失效和无任务查看权分别提示；选择本身不分配。
- [x] 保存冲突保留本人修改但拒绝覆盖；generation 变化隐藏正文，重取后再允许动作；对话销毁释放订阅并拒绝迟到响应。
- [x] 工作台与对话对同一任务有相同授权业务事实；展示状态不新增 Session 业务事件。

助理验证：类型、局部 lint、i18n/Client 图与 slot 门禁、投影/路由纯逻辑测试；不拉起页面。用户检查：不打开工作台完成建树、修改、查询及负责人选择；检查两种语言和复杂树可读性。依赖：Phase 2、5；视觉检查留待用户，不阻断后续可静态验证的接线。

实际完成（2026-10-03）：ui-organization 注册独立 organization-conversation 主面板、侧栏和图标，普通发送使用本人项目对话、稳定目标、自动规划设置和显式模型选择；支持已有授权任务、澄清/修改、查询答复、新目标和停止/重读。计划卡重读同一权威树，显示版本、范围/验收/产物、责任人、Run 状态、待处理方和最新提交。候选分页搜索、姓名歧义和失效提示、本人选择仅写建议；分配查看权只调用既有 review，实际批准留 Phase 7。

ui-personal-workflow 从现有 snapshot 增量注册 personal-plan 节点和 keyed renderer，内联当前树、准确版本、字段编辑及执行证据，不新增业务事件或另一计划 writer。组织 generation 变化隐藏旧内容，销毁请求停止并丢弃迟到结果；失败输入保留 operation 身份，早期目标修改后保持当前选择；个人保存冲突保留草稿，显式刷新后才使用最新 revision。全部产品文案经 typed locale，贡献随 fiber 释放。

Phase 5–6 实际验证记录：

- `pnpm exec vitest run packages/workspace/organization/tests/planning-draft.spec.ts packages/workspace/organization/tests/workgraph.spec.ts packages/workspace/organization/tests/planning.spec.ts packages/workspace/organization-conversation/tests/conversation.spec.ts packages/client/ui-organization/tests packages/client/ui-personal-workflow/tests --testTimeout=20000`：18 文件、88 项通过。后续新增外部依赖及撤权测试后，draft 5 项通过；撤权最终并入下面 23 项传输回归。
- `pnpm exec vitest run packages/workspace/organization-conversation/tests/conversation.spec.ts packages/host/organization-connection/tests/planning.spec.ts packages/host/organization-connection/tests/workgraph.spec.ts --testTimeout=20000`：23 项通过，含私有建议成员校验和失权正文重放拒绝。
- `pnpm exec vitest run packages/client/ui-personal-workflow/tests/conversation.client.spec.tsx packages/client/ui-organization/tests/conversation.client.spec.tsx --testTimeout=20000`：4 项通过；随后增加早期目标选择保持用例，单独运行后者，4 项通过。
- `pnpm exec vitest run packages/workspace/organization/tests/authority.spec.ts packages/workspace/organization/tests/assignment.spec.ts packages/workspace/organization/tests/execution.spec.ts packages/workspace/organization/tests/execution-human.spec.ts packages/workspace/organization/tests/execution-codex.spec.ts packages/workspace/organization/tests/delivery.spec.ts packages/workspace/organization/tests/acceptance.spec.ts packages/workspace/organization/tests/integration.spec.ts --testNamePattern='migrat|restor|backup|schema' --testTimeout=20000`：15 项通过，74 项由名称过滤跳过。
- `pnpm exec vitest run apps/desktop/tests/host-process.spec.ts packages/host/organization-connection/tests/connection.spec.ts packages/host/organization-connection/tests/assignment.spec.ts --testTimeout=20000 --maxWorkers=2`：47 通过、4 个旧 schema 夹具失败；更新 v14 manifest 断言及旧表降级夹具后，`pnpm exec vitest run packages/host/organization-connection/tests/connection.spec.ts --testNamePattern='backup|restor' --testTimeout=20000` 的10项全部通过，其余6项由过滤跳过。
- `pnpm exec tsc -b packages/client/ui-organization/tsconfig.json packages/client/ui-personal-workflow/tsconfig.json apps/desktop/tsconfig.json apps/desktop-host/tsconfig.json --pretty false` 通过。两个 Client 包目录分别执行 `pnpm exec tsdown --env.DSH_BUILD_FACE=client`，实际 browser client.js 和 Node loader 均构建成功。根级仅包名 filter 曾只选中 Node loader，未用该结果替代 browser 构建。
- `pnpm exec tsdown --filter @deepseek-ai/dsh-session --filter @deepseek-ai/dsh-organization --filter @deepseek-ai/dsh-organization-api --filter @deepseek-ai/dsh-organization-connection --filter @deepseek-ai/dsh-organization-conversation --filter @deepseek-ai/dsh-desktop --filter @deepseek-ai/dsh-desktop-host --env.DSH_BUILD_FACE=host` 通过；`node apps/desktop-host/tests/organization-conversation-built-smoke.mjs` 及 `--electron` 通过。首次 smoke 的旧工具白名单已同步为当前四个工具，重跑成功；均未创建窗口。
- 变更 TS/TSX/MJS 的 `pnpm exec tsx scripts/run-oxlint.ts` 局部 lint、`verify-client-ui-i18n`（849 文件）、`verify-client-packages`、`verify-client-route-resolution`、`verify-tsconfig-paths`、`verify-scoped-events`、`gen-persistence-catalog` 及其 `--check`、新增文档链接和 `git diff --check` 通过。

未通过的全仓检查单独保留：本轮曾执行 `pnpm run test:gui`，该次为 509 文件通过/20 文件失败、7317 项通过/70 项失败/1 跳过，不能作为全仓通过证据；其中本轮相关的 native 迁移夹具问题已修复并定向复测，其余 settings/input-bar/styles/binary RPC/license 等失败未在本轮扩范围处理。`verify-client-domain-graph` 报告 62 项范围外违规；`verify-package-dependencies` 为未修改 file-upload 的导入分类；`verify-export-jsdoc` 仅剩未修改 login-session 的两处描述缺失。本轮新增 JSDoc 问题已修正，未修改例外表掩盖失败。

未运行真实模型、页面、Playwright、浏览器自动化、GitNexus、完整发行或三机验收，视觉和真实识别效果仍由用户检查。Codex 原生项目规划仍待专用能力，不用 API 替代。Phase 5–6 工程完成，达到授权 Phase 6 终点，恢复 manual、自动边界 none、relay 关闭；没有进入 Phase 7、提交或推送。

## Phase 7：明确分配与员工独立任务对话

目标：从对话确认分配清单，员工在自己的入口看到持久任务对话，不接收下发人的完整聊天。

产出：共享分配确认展示与现有 `assignment-review` / grant / approve 消费者；Inbox 及 `organization-conversation` 的分配标识、员工对话建立/打开/恢复；必要服务端事件及绑定查询。

验收清单：

- [x] 准确版本、真人负责人、目标/验收、资料范围和执行授权状态可逐项审阅；批量确认逐项显示终态、冲突与 unknown。
- [x] 分配前核验编辑/分配权和员工 read；缺 read 时另行确认 grant，有权补齐后重新审核，不能由模型代确认。
- [x] 正式通知与 assignment 持久关联；员工在线打开或同步时幂等创建独立任务对话，离线待建立状态可恢复。
- [x] 双击、超时、重开、另一窗口打开均不重复批准/通知/对话；本机失败不会回滚或重发已提交的组织业务。
- [x] 对话注明原目标任务和下发人，任务选择只返回获准资料；领导原文、员工完整执行日志不自动分享。
- [x] 对话建立不接受、不委托、不领取、不运行；撤销/改派/新版本不把旧 Session 变成新负责人资格。

助理验证：真实权威/native/IPC/JSONL 多客户端测试，员工离线、批准提交后本机写失败、部分批量成功、撤权及重复建立；独立查询数量及通知收件人。用户检查：在对话确认两个子任务、员工从通知/侧栏打开独立对话，检查隐私及部分失败提示。依赖：Phase 6。

实际完成（2026-10-03）：organization-connection 新增固定 assignment-batch / assignment-batch-read 和 `.assignments` 本机逐项确认账本，按 server/account/organization/project/plan/revision 隔离。每项发送前保存 operationId；成功项恢复原回执，冲突/拒绝独立呈现，unknown 只查询原回执并停止后续项，尚未发送项需再次明确确认。继续使用既有单项 review、grant、approve 事务及原生 `.pending` 核对，不增加批量原子承诺。Config 增加 maxAssignmentBatchItems，部署可调。

organization-conversation 的 request/owner 增加可选准确 assignment selector，conversationId 固定为 assignmentId；native 每次复核 preparation、本人 assignee 和当前任务 read。现有原子 assignment/request/notification 就是离线待建立标识，员工从 Inbox 或侧栏在线打开时预留并恢复独立 JSONL，无需增加共享 Session 表或复制领导聊天。绑定拒绝缺失/替换 assignment，固定目标拒绝 new_goal 和越任务 selector；撤销、改派或新版本不转换旧资格。只在待建立/ready 时增加标识诊断日志，无聊天正文或本机目录。

真实 Loader/HTTPS/native/IPC/JSONL 新增用例覆盖部分批量成功、缺员工 read 后独立补权、冷重开、丢失批准回执、双击并发、员工离线后打开、本机 ready 写失败、领导私聊隔离、本人独立日志、撤销/撤权、无分配权和旧版本。具体命令合并记录在 Phase 8 下。工程检查已满足；Desktop 可见验收仍待用户。随后在同一授权内进入 Phase 8。

## Phase 8：从对话完成执行、提交、验收和返工

目标：把 Phase 7A 的全部真人固定动作接到对话内，完成员工与下发人的日常管理。

产出：`AssignmentPanel`、`ExecutionPanel`、`ExecutionHumanRequest`、`DeliveryPanel`、`AcceptanceReview`、`IntegrationPanel` 适用组件/消费者的复用；组织任务对话与 Run/私有 transcript 的关联、对话内待处理投影。业务事务仍归既有服务。

验收清单：

- [x] 员工能在对话明确接受/拒绝、选择本机配置、有限委托、领取、开始/停止/显式恢复；模型建议不能直接操作。
- [x] 规划不继承执行许可，执行不重新创建根树；细分后重新资格流程、依赖阻塞和当前版本均在同一对话可处理。
- [x] HumanRequest 的答复与继续执行分开；失联或撤权拒绝新增动作，unknown 核对与显式恢复沿用旧消费者。
- [x] 员工明确上传/提交；原下发人明确验收或驳回；返工显示新 revision 及重新批准，运行完成不自动提交。
- [x] 对话内查看必要已验收输入、选择目标、实际核验和最终确认；父级交付条件不变，不自动应用/覆盖文件。
- [x] 完整私有日志独立读取且仍受当前资格约束；共享详情/搜索/通知没有聊天或本机目录泄露。

助理验证：业务动作适配、权限投影与类型/i18n/局部 lint；复跑受影响执行/交付聚焦回归，不为复用重复整套历史测试。用户检查：全程对话内接受到验收/返工/集成，检查每次确认含义及停止/恢复。依赖：Phase 7。

实际完成（2026-10-03）：ui-organization 增加 ConversationTask，把 AssignmentPanel、ExecutionPanel、IntegrationPanel 及其内嵌的 ExecutionHumanRequest、DeliveryPanel、AcceptanceReview 接到同一对话。员工接受/拒绝、设备和有限委托、领取、API/Codex 配置、开始/停止、人工答复、显式恢复、上传/提交继续调用既有固定消费者；原下发人审核、返工、目标核验和最终确认保持原事务。ExecutionPanel 可固定原 assignmentId，旧对话不自动改读后来改派的 Run。侧栏/main 通过框架 store 共享身份限定的导航标识，业务数据仍从 native 读取。

ProjectConversation 增加只读 query 路由，任务对话隐藏新根入口并固定 assignment goal。Native planning-read 与私有 conversation selector 分开，避免将 assignment 字段传给严格项目读取器。相同身份刷新保留在途组件、隐藏旧 generation 内容，身份切换和撤权继续拒绝迟到正文。没有增加模型可调用的业务动作、执行许可继承、自动提交或文件应用。相关 README、architecture、session-format-status、规划协议及 persistence catalog/schema 已同步；SQLite 仍 v14，Session envelope 与 organization_conversation 域仍为原版本。

Phase 7–8 实际验证记录（本轮运行，重叠用例不重复加总）：

- `pnpm exec vitest run packages/workspace/organization-conversation/tests/conversation.spec.ts packages/client/ui-organization/tests/conversation.client.spec.tsx --testTimeout=20000`：2 文件、20 项通过。
- `pnpm exec vitest run packages/client/ui-organization/tests packages/workspace/organization/tests/assignment.spec.ts packages/workspace/organization/tests/execution-human.spec.ts packages/workspace/organization/tests/delivery.spec.ts packages/workspace/organization/tests/acceptance.spec.ts packages/workspace/organization/tests/integration.spec.ts --testTimeout=20000`：12 文件、89 项通过，覆盖受影响的执行人工请求、提交、验收、返工和集成事务。
- `pnpm exec vitest run packages/workspace/organization-conversation/tests packages/client/ui-organization/tests/conversation.client.spec.tsx packages/client/ui-organization/tests/assignment.client.spec.tsx packages/client/ui-organization/tests/composition.client.spec.ts --testTimeout=20000`：5 文件、38 项通过，真实 Loader 到 native/IPC/JSONL 和 Client 插件注册/销毁均包含在内。
- `pnpm exec vitest run packages/workspace/organization-conversation/tests/assignment.spec.ts packages/client/ui-organization/tests/assignment.client.spec.tsx packages/host/organization-connection/tests/assignment.spec.ts --testTimeout=20000`：3 文件、35 项通过，包含改派后按原 assignment 读取 Run、部分批量、冷恢复及现有设备/执行固定通道。
- 增加严格项目读取器的绑定任务 UI 用例后，`pnpm exec vitest run packages/client/ui-organization/tests/conversation.client.spec.tsx --testTimeout=20000`：6 项通过。中间的新增 assignment 聚焦运行也均通过；未将其与上述重叠结果相加。
- `pnpm exec tsc -b packages/client/ui-organization/tsconfig.json apps/desktop/tsconfig.json apps/desktop-host/tsconfig.json --pretty false` 通过。ui-organization 包目录执行 `pnpm exec tsdown --env.DSH_BUILD_FACE=client`，browser client.js 和 Node loader 均构建成功。
- `pnpm exec tsdown --filter @deepseek-ai/dsh-session --filter @deepseek-ai/dsh-organization-conversation --filter @deepseek-ai/dsh-organization-connection --filter @deepseek-ai/dsh-desktop --filter @deepseek-ai/dsh-desktop-host --env.DSH_BUILD_FACE=host` 通过。扩展既有 `node apps/desktop-host/tests/organization-conversation-built-smoke.mjs` 和 `--electron` 均通过：实际子进程/HTTPS/私有 IPC、Agent/JSONL、批量分配、独立任务绑定及冷重开，未创建窗口。
- 变更 TS/TSX/MJS 的 `pnpm exec tsx scripts/run-oxlint.ts <实际修改文件>` 局部 lint、`verify-client-ui-i18n`、`verify-client-packages`、`verify-client-route-resolution`、`verify-tsconfig-paths`、`verify-scoped-events`、`verify-application-entrypoints`、`gen-persistence-catalog` 及 `--check`、变更文档引用与 `git diff --check` 通过。初次局部 lint 的格式及测试类型问题均已修正，未改变例外表。

既有全仓门禁问题按实际保留：verify-client-domain-graph 仍为未修改域的 62 项；verify-package-dependencies 为未修改 file-upload 的一项导入分类；verify-export-jsdoc 为未修改 login-session 的两处说明缺失。本轮未以这些命令声称全仓通过，也未扩范围修改历史问题。

真实模型、Desktop 可见、完整发行与三机产品验收未运行；模型 HTTP 为确定性替身，普通 Node/Electron smoke 无窗口。用户可检查对话中两个子任务的逐项/批量确认、员工侧栏打开、接受到验收/返工/集成和每次停止/恢复的含义。Phase 7–8 工程完成，达到授权 Phase 8 终点，恢复 manual、自动边界 none、relay 关闭；未进入 Phase 9–10，未提交或推送。

## Phase 9：正常模式双人 CSV 与故障负例

目标：验证从自然目标输入开始的真实组件组合，覆盖两端授权、细分和持久恢复。

产出：`apps/desktop-host/tests/conversation-planning.spec.ts` 及相关 package 聚焦测试/夹具；复用既有 CSV 输入和文件核验，不另造演示专用任务权威。除模型外保持真实 Loader、native/HTTPS、SQLite、JSONL、业务命令及文件工具。

验收清单：

- [x] 关闭 forced 模式从复杂目标发送开始，评估、草案、真人调整/分配、员工对话、执行/介入、提交、驳回返工及必要子任务汇合可贯通。
- [x] 简单目标不建树；模糊目标答复补当前目标；不同设置与权限改变建议/路由；查询和已绑定步骤不建新树。
- [x] 开关开启可拆简单新目标，关闭恢复；设置/身份切换不串用，不影响另一成员或既有执行范围。
- [x] 重复消息、同键异内容、版本冲突、半批分配、失去回执、对话落盘崩溃、重开均无重复业务记录。
- [x] 无编辑/分配权、缺员工 read、隐藏兄弟、撤权/停用、断线/休眠、模型准入竞争和旧版本操作均有实际拒绝证据。
- [x] 最终独立读取成果字节/哈希和权威交付记录，核对未授权文件不变；不能只断言模型回复含“完成”。

助理验证：聚焦组合与新增错误路径，独立重开存储和文件核验；记录模型替身与未执行真实模型。用户检查：用本阶段相同样例在 Desktop 从自然对话复现；可见待验不等于组合测试失败。依赖：Phase 8；主路径必须从发送消费者进入，不能直接 savePlan 预种树后称为自动建树通过。

实际完成（2026-10-03）：新增 Desktop conversation-planning.spec.ts 和 source/published 共用夹具。通过原生发送进入独立 Agent 的评估/提案工具，在正常默认设置下保存两个必要 CSV 子任务；真人建议修改产生 revision 2，过期修改拒绝，冷重开保持原 Session/目标；原生批量确认后员工打开独立任务对话，下发人读取被拒绝。随后复用原执行夹具贯通人工等待、显式继续、重开、提交、驳回 revision 3、重新批准及两个成果验收与目标确认。独立文件 SHA-256、CSV 字节、未选中文件、只读 SQLite、JSONL 和服务冷重开共同核验，组织数据库没有领导聊天哨兵。

新增组织路由/偏好回归覆盖简单目标、模糊目标补充、查询、相同文本新消息和账号切换；已有个人 forced 开关、子树隐藏兄弟、模型准入竞争/停用、半批分配、丢回执及落盘故障聚焦回归本轮运行。初次组合测试误取批次历史第一项及未打开新账号绑定，均修正测试消费者；已有 assignment 读取在并行刷新中一次 superseded；后续将该只读观察放入 vi.waitFor 等待实际状态，不重发任何业务写入、不改变断言或权限逻辑，最终与新组合并行运行通过。

实际命令：首轮 8 文件组合 65 项通过、2 项失败；修正后 3 文件 35 项通过、新路由 1 项失败，修正新账号打开方式后该路由通过；最后 `pnpm exec vitest run apps/desktop-host/tests/conversation-planning.spec.ts apps/desktop-host/tests/organization-execution.spec.ts packages/workspace/organization-conversation/tests/conversation.spec.ts --testTimeout=20000` 为 3 文件 26 项通过。其余首轮通过文件及重跑 assignment 的命令见 Phase 10 汇总；计数重叠，不累计成独立用例总数。模型 HTTP/执行模型与测试保险库是替身，其余服务、文件和存储真实。进入 Phase 10。

## Phase 10：发行验证、模型语料与 Phase 8 交接

目标：确认新增对话与规划能力进入发行组合，提供可执行用户验收，不在本次自动发布产品。

产出：`apps/desktop-host/tests/conversation-planning-built-smoke.mjs`、无页面真实模型 smoke/语料入口、`docs/conversation-planning-acceptance.md`；同步路线图、工程概览、实际修改包 README/公共接口文档及必要生成目录。

验收清单：

- [x] 新包/方法资源/Client 模块都在 Desktop 闭包，Host 与 Client face 显式配置；不会出现额外应用入口。
- [x] 本期发行构建及普通 Node/Electron Node mode 无窗口 smoke 验证私有进程路径、绑定重开、权限拒绝和方法资源；若用户明确保留给自己，交付准确命令并标待验，不能写通过。
- [x] 真实模型语料覆盖普通问答、简单、复杂、多轮澄清、修改及绑定续聊；遵循现有密钥/用户授权，记录真实调用、失败、跳过或待用户，不安装或索取新凭据。
- [x] 三机剧本从关闭 forced 模式的自然 CSV 目标开始；创建、分配和日常管理无需工作台，加入不同偏好/无分配权和重开负例。
- [x] 交接区分确定性路由测试、真实识别效果、发行 smoke、可见/双平台/三机产品结果；保留 Phase 2–7A 的历史待验。
- [x] Phase 7C 工程状态按本期证据更新；产品 Phase 8 仍是后续单独授权的验收目标。

助理验证：按下文检查策略完成新增发行路径和静态门禁；本阶段不运行产品 UI。用户检查：Desktop 可见、真实模型/双平台和 A/B/C 三机，结果填入验收记录；未完成项明确保留。依赖：Phase 9；存在发布闭包缺失或新权限绕过不得 completed。

实际完成（2026-10-03）：新增 conversation-planning-built-smoke.mjs、built kit/私有 Host child，以及 conversation-planning-packed-smoke.mjs。普通 Node 与 Electron Node mode 分别使用发行私有组织服务、规划 Host IPC 和执行 Host IPC，从正常新目标发送走到真实 CSV 最终交付；员工绑定查询保持单一任务和 pending 分配。四个实际 pnpm tarball 检查 Desktop Host 生产依赖闭包、运行时/类型导出、个人方法 assets/SKILL.md 和两个 Client bundle。未创建新应用入口，没有修改 Session/SQLite 格式或生成目录，也没有产品运行时代码改动。

新增 apps/desktop/tests/conversation-planning.e2e.ts，沿现有 credentials provider 和 e2e 密钥策略提供普通问答、简单、模糊、多轮澄清、复杂、修改、查询及绑定续聊语料。本轮无 DEEPSEEK_API_KEY，1 项明确跳过，未调用真实模型。新增 docs/conversation-planning-acceptance.md，提供同一 CSV 目标的三机对话步骤、独立哈希核验、偏好/权限/恢复负例和记录格式；同步路线图、overview、规划协议和 organization-conversation README。保留历史待验和 Codex 项目规划限制，不进入产品 Phase 8。

本轮实际验证（不将重叠计数相加）：

- `pnpm exec vitest run apps/desktop-host/tests/conversation-planning.spec.ts packages/workspace/organization-conversation/tests packages/host/organization-connection/tests/planning.spec.ts packages/host/organization-connection/tests/assignment.spec.ts packages/workspace/organization/tests/planning.spec.ts packages/workspace/organization/tests/planning-draft.spec.ts packages/skill/skill-dev-workflow/tests/automatic-planning.spec.ts --testTimeout=20000`：首轮 8 文件 65 项通过、2 项失败，具体原因和后续修正见 Phase 9。
- `pnpm exec vitest run apps/desktop-host/tests/conversation-planning.spec.ts packages/workspace/organization-conversation/tests/conversation.spec.ts packages/host/organization-connection/tests/assignment.spec.ts --testTimeout=20000`：新 CSV 组合及 assignment 文件通过；新增账号切换路由用例随后以 `pnpm exec vitest run packages/workspace/organization-conversation/tests/conversation.spec.ts -t 'keeps simple' --testTimeout=20000` 修正验证通过。
- 修正 SSE 刷新期间的只读测试观察后，`pnpm exec vitest run packages/host/organization-connection/tests/assignment.spec.ts apps/desktop-host/tests/conversation-planning.spec.ts --testTimeout=20000` 为 2 文件 19 项通过；该测试文件局部 lint 通过。
- Phase 9 最后一轮 3 文件 26 项通过。追加员工绑定查询断言后，`pnpm exec vitest run apps/desktop-host/tests/conversation-planning.spec.ts --testTimeout=20000` 再次 1 项通过。
- `pnpm run build` 通过，包含 Desktop Host/Client 发行构建；只有既有 chunk 大小提示。`pnpm exec tsc -b apps/desktop-host/tsconfig.json apps/desktop/tsconfig.host.json packages/client/ui-organization/tsconfig.json packages/client/ui-personal-workflow/tsconfig.json --pretty false` 通过。
- `node apps/desktop-host/tests/conversation-planning-built-smoke.mjs`、同命令 `--electron` 均通过；追加绑定查询后两个运行时均再次通过。`node apps/desktop-host/tests/conversation-planning-packed-smoke.mjs` 通过；初次夹具的 Client 包名及仓库 source wildcard 检查已修正，未删减发行运行时/类型资源要求。
- `pnpm exec vitest run --config vitest.e2e.config.ts apps/desktop/tests/conversation-planning.e2e.ts --retry=0`：1 项无密钥跳过，不计为真实模型通过。
- 新增与本轮修改的 TS/MJS/declaration 文件执行 `pnpm exec tsx scripts/run-oxlint.ts <本轮文件>` 通过；`pnpm run verify-application-entrypoints`、`pnpm run verify-cordis-config`、`pnpm run verify-tsconfig-paths`、`pnpm run verify-client-packages`、`pnpm run verify-client-ui-i18n` 通过。变更文档新增引用、文件结尾和 `git diff --check` 通过；无 staged 文件，未自动暂存。

本轮没有重跑全仓 domain graph、package dependencies 或 export JSDoc 门禁，不追认 Phase 7–8 记录的历史失败为通过。仓库引用的 dsh-prose-standard 文件及同名本地 Skill 不存在；README 按当前 AGENTS.md 的直接文档规则更新，未声称运行该缺失 Skill。

Phase 1–10 工程完成，恢复 manual、自动边界 none、relay 关闭。真实模型识别、Desktop 可见、Windows 和三机产品结果仍待用户；没有启动页面、使用浏览器自动化/GitNexus、自动提交、推送、发布或开新聊天。

## 关键链路日志要求

以下均为长期诊断记录，沿用 `ctx.logger`；Electron 原生层沿现有 `console.info/error` 格式。独立业务事件和 JSONL 保存完整事实，诊断日志仅记录标识和阶段，不充当状态权威。

| 阶段/链路 | 应记录的事件 | 建议字段 |
| --- | --- | --- |
| Phase 2、4：输入 → 有效策略 → 评估/澄清 | 输入身份接纳、有效策略版本、分类、澄清恢复、重复请求恢复、拒绝 | `component=planning goalId sessionId settingsRevision decisionCode operation result` |
| Phase 3–4：规划模型许可 → 最终 HTTP | 许可申请/拒绝、实际发出、重试、取消、结算/unknown | `organization component=planning-model goalId operationId permitId generation operation result reasonCode` |
| Phase 5：提案 → 权威保存/子树合并 | 授权复核、版本冲突、范围拒绝、落盘/回执恢复、资格失效 | `organization component=planning planId taskId planRevision operationId operation result` |
| Phase 7：分配 → 通知 → 员工对话 | 每项确认、分配回执、待建立/ready、绑定恢复/拒绝 | `organization component=conversation assignmentId bindingId operationId generation operation result` |
| Phase 8：任务对话 → Run → 交付 | 对话/Run 关联、需要真人处理、业务确认结果、旧版本拒绝 | 沿用现有 execution/delivery/integration 字段，必要时增加 `bindingId` |

不记录 API key、token、证书私钥、邮箱等个人资料、模型/聊天全文、完整成员列表、绝对本机路径、文件字节和巨大任务树。不为每个流 chunk、渲染或定时轮询打印日志。错误用稳定 reasonCode；若临时增加迁移调试日志，实际完成记录必须说明移除或降级位置。

## 验证策略与命令选择

规划创建只运行文档引用/空白核对，不执行代码测试、构建或模型调用。实施时读取相关目录 `AGENTS.md`，Client 变更前读取 Web Client、Slots 与 Conversation 文档；并发/销毁遵循[防御规则](defensive-patterns.md)，检查依[测试规则](testing.md)。

- 聚焦测试用 `pnpm exec vitest run <本阶段新增与受影响 tests>`；模型替身仅替代模型，授权/事务/存储/工具保持真实。测试解析 workspace 源码，不混用 lib。
- 类型按实际改动选择 Host/Client leaf config，例如 `pnpm exec tsc -b apps/desktop-host apps/desktop/tsconfig.host.json packages/client/ui-organization packages/client/ui-personal-workflow --pretty false`；新增包纳入必要 project references，不拿 solution root 当单一编译面。
- 局部 lint 用 `pnpm exec tsx scripts/run-oxlint.ts <实际修改文件>`；每阶段 `git diff --check`。只有存在 staged 修改时另跑 `git diff --cached --check`，不为检查自动暂存。
- 涉及对应表面时运行 `verify-client-ui-i18n`、`verify-client-packages`、`verify-client-route-resolution`、`verify-client-domain-graph`、`verify-tsconfig-paths`、`verify-cordis-config`、`verify-application-entrypoints`、`verify-scoped-events`、`verify-export-jsdoc`、`verify-package-dependencies` 及实际持久化/invariant 门禁；命令以根 `package.json` 为准。
- 事件/schema/config/模块变动才运行相关生成器，如 `gen-persistence-catalog`；分清新增失败与历史门禁债务，不修改例外表掩盖失败，也不复制历史“通过”。
- 中间阶段定向构建受影响包；Phase 10 对新增发行闭包执行 `pnpm run build` 及新增 built smoke。已有 passing 检查不因提交或报告重复，全面测试仅在不可缩小的全仓改动或用户要求时执行。
- 真实模型与跨进程 smoke 采用仓库声明 launcher 和密钥策略；无密钥自跳过必须如实记载，不把跳过记为通过。若用户保留最终测试，记录具体未执行项和命令。

## 执行规则

```text
execution mode: manual
automatic start phase: none
automatic stop phase: none
conversation relay: off
plan review: accepted for Phase 1–10
execution authorization: 用户要求“请自动完成剩余 phase”；覆盖剩余 Phase 9–10，relay 关闭
execution result: 2026-10-03 Phase 1–10 工程完成，剩余 Phase 9–10 已完成，恢复 manual；产品验收待用户
```

1. 本计划是 Phase 7C 唯一施工入口。首次评审后，用户明确“执行 Phase 1”才开始实现；选择 skill 或本次“给出计划”不授权实现。
2. 执行前读本文、overview、当前用户约束和相关目录规则，检查工作区及阻塞条件。`执行 Phase X` 只执行该阶段，即使以后持久模式是自动也限制本轮；未完成依赖无法安全隔离时报告依赖。
3. `继续` 先处理已恢复的 `blocked`，再选择首个 `in_progress`，否则首个 `pending`。未解除阻塞不得跳过依赖进入后续阶段。
4. `manual` 每次只执行所选阶段，更新实际完成、唯一主表及 `docs/overview.md` 后停止。未开始区域只留一行占位；完成记录写实际文件、检查、跳过、偏离和下一步，不复制主表摘要。
5. 计划存在且用户明确授权“自动完成剩余阶段”后可改 `auto`；记录原授权，两自动边界保持 `none`。完成一个阶段后立即选择下一合格阶段，直到本计划完成或真实阻塞。
6. 明确“自动执行到 Phase N”或连续 N 个阶段时可改 `auto_until`；先校验并记录包含首尾的范围。省略起点取当前 `in_progress`，否则首个 `pending`；数量按主表归一化，停止阶段不得早于开始。`执行 Phase 5` 不等于“执行到 Phase 5”。
7. 自动选择每阶段前重新读取状态、依赖、模式与授权范围，先标 `in_progress`；跳过已完成阶段，不复跑。`auto_until` 不选择 stop 之后的阶段；范围内全部必要工作及所需 worktree 返回核验完成后改回 `manual`，清空边界为 `none`，记录到达边界并停止。交付阻塞保留模式/范围。
8. 非阻断性用户可见检查记待验并继续；只有后续确实依赖其结果才成为 gate。产品选择不明、新权限/外部状态、无法安全修复的验证失败或用户撤销授权，停止并将具体阶段标 `blocked`，记录解锁条件；没有撤销时保留自动授权。
9. 仅在执行证据表明原阶段过大、风险失控或无法在一次上下文安全验证时做最小必要拆分，通常两个子阶段。实现前先更新主表、该阶段详细范围、验收与顺序，保留无关编号。原 stop 指向被拆阶段时，默认到其最后子阶段；只在用户点名时停特定子阶段。
10. Relay 默认关闭，不创建新聊天或 worktree；开启需用户对本计划另行明确授权，并先读取 `/Users/git_local/dev-workflow-skill/references/conversation-relay.md`，按其规定补齐所有权、批次和交接字段；worktree relay 另读 `worktree-return.md`。开启前不能凭历史对话自动转移执行。
11. 不创建专用 executor skill；现有入口 skill 与本文足够。以后确需复杂多会话接力，再评估执行包装，阶段事实仍只在本文。

Phase 1–10 工程已完成；真实模型、可见、Windows 及产品 Phase 8 三机验收仍单独待验。
