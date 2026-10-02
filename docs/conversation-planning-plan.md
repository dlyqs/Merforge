# 对话主入口与自动任务规划实施计划

本文细化[产品路线图](../ai-native-work-os-product-roadmap.md)的 **产品 Phase 7C**。下文 Phase 1–10 是本计划内部施工编号。后续针对本计划说“继续”或“执行 Phase X”，先读本文及[工程概览](overview.md)，不要续跑已完成的组织执行计划，也不要进入产品 Phase 7B 或 Phase 8。

## 目标、歧义检查与可行性

把个人与组织的自然对话接到已有持久计划、任务分配和执行交付服务：普通问答和简单目标保持普通对话；复杂新目标在正常设置下自动评估、必要澄清并保存可审阅任务树；用户在同一对话内调整计划、选择真人负责人、明确确认分配，再从各自独立对话完成接受、委托、开始、人工介入、提交、验收、返工及目标交付。组织工作台继续提供辅助总览。

歧义检查：路线图 v0.5 已明确下一轮先做产品 Phase 7C，且关闭强制拆分测试模式是主验收条件。无需在 Phase 7B、7C 和 8 之间再次选择。本次请求仅授权生成计划；全部施工阶段保持 `pending`。以下拟定语义供评审，Phase 1 固化接口和状态；若实施发现必须改变真人确认、私人隔离或既有授权原则，记录具体差异并停在该决策处。

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
| Phase 1 | 协议与消费者 | 固化路由、设置、组织规划准入和对话归属 | pending | — | 先定状态/权限，不创建空包 |
| Phase 2 | 个人默认自动识别 | 用户策略、目标/澄清关联及兼容迁移 | pending | — | 依赖 Phase 1 |
| Phase 3 | 组织规划权威 | 模型许可、可见成员与固定传输 | pending | — | 依赖 Phase 1–2 |
| Phase 4 | 组织对话宿主 | 项目目标对话、隔离模型与持久恢复 | pending | — | 依赖 Phase 3 |
| Phase 5 | 结构化计划写入 | 根草案、准确修改与获准子树细分 | pending | — | 依赖 Phase 4 |
| Phase 6 | 对话内计划管理 | 普通发送、树/版本、修改、查询与负责人 | pending | — | 依赖 Phase 2、5 |
| Phase 7 | 分配及员工对话 | 逐项/批量确认、授权及独立对话恢复 | pending | — | 依赖 Phase 6 |
| Phase 8 | 对话内执行交付 | 接受到提交、验收/返工/集成完整确认 | pending | — | 依赖 Phase 7 |
| Phase 9 | 组合及故障验证 | 正常模式双人 CSV 和路由/权限负例 | pending | — | 依赖 Phase 8 |
| Phase 10 | 发行与验收交接 | 构建、无窗口 smoke、真实模型/三机剧本 | pending | — | 依赖 Phase 9；不自动进入产品 Phase 8 |

## Phase 1：协议、状态与实际消费者

目标：先明确每条输入由谁处理、哪些数据共享、哪些动作需要真人确认，以及无任务规划如何合法调用模型。

产出：新增 `docs/conversation-planning.md`；必要时更新 `docs/personal-workflow.md`、`docs/organization-workgraph.md`、`docs/organization-assignment.md`、`docs/organization-execution.md`、`docs/architecture.md` 和 `docs/session-format-status.md`。给出服务定义/提供者/消费者表；拟新增 `packages/workspace/organization-conversation` 仅承担本机组织目标/任务对话，实际创建留 Phase 4。

验收清单：

- [ ] 固化设置优先级、旧显式 off 的迁移、测试 override、模型/工具配置引用及停止位置；自动识别不等于自动执行。
- [ ] 固化目标与消息身份、路由状态及澄清/修改/查询流程、幂等键与冲突处理。
- [ ] 列出规划许可、共享草案、子树 edit、候选成员、分配及员工对话绑定的作者与读取权限。
- [ ] 固化无任务规划限额及逐请求在线资格；拒绝从个人 Agent 或执行 Run 借权。
- [ ] 固化子树修改对 revision、grant、批准/租约/验收的影响；明确重新批准消费者和限额继承。
- [ ] 按实际 slot/ConversationNode/私有 IPC/服务/API 接口列出端到端消费位置及失效/销毁规则。

助理验证：沿源码逐项核对，不运行模型或页面；检查文档引用和状态覆盖。用户检查：审阅默认设置、子树变更影响及确认粒度。依赖：无；重大产品原则变化必须明确处理后再进入实现。

实际完成：未开始；执行后在此记录文件、验证、跳过项、偏离及下一阶段。

## Phase 2：个人策略与正常模式自动识别

目标：用户直接发送复杂目标即可规划，同时保留明确关闭和简单对话体验。

产出：`personal-workflow` 类型/schema/设置及 Session 投影、`skill-dev-workflow` 方法/工具门控、`api/session-controller` 对应 Remote；`ui-personal-workflow` 设置和模式消费者。方法更新保留授权来源及 NOTICE，实际变动的 README 同步。

验收清单：

- [ ] 未选择时默认自动识别；旧 off/显式 off/显式 on 均按 Phase 1 映射，无设置或日志数据丢失。
- [ ] `simple`、`clarify`、`infeasible`、`complex` 可持久关联当前目标；澄清答复和查询不建另一根树。
- [ ] 测试默认关闭；打开可拆简单新目标，关闭恢复本人策略；已绑定执行步骤不递归拆分。
- [ ] 设置变化、Bot 禁用 Skill/工具或 Session 归属变化在提案落盘处拒绝旧资格；已批准执行不受测试开关授予额外范围。
- [ ] 方法文本、有效设置、评估与计划快照可从 Session 重建；简单目标没有计划副作用。

助理验证：聚焦模式/提案/迁移/重开及重复消息测试，受影响类型与局部 lint；模型仅确定性替身，不把分类用例称为真实识别准确率。用户检查：正常发送复杂/简单目标、显式关闭、切换偏好和测试开关。依赖：Phase 1。

实际完成：未开始；执行后填充。

## Phase 3：组织规划资格与当前可见负责人

目标：建立不依赖既有任务的有限规划模型许可和最小成员候选查询，先完成组织权威与传输。

产出：`organization` 规划资格/许可/限额/回执及必要 SQLite 单调迁移；`organization-api` 固定 HTTPS；`organization-connection` 固定动作/schema/types、generation 和未知回执核对。只新增实际消费者所需字段，日志/迁移/备份校验随持久关系更新。

验收清单：

- [ ] 当前项目 read 成员能获仅规划资格，无 write 成员仍不能写共享树；撤权、停用、策略变化、到期和服务 epoch 更换拒绝新增请求。
- [ ] 模型策略与本机目的地相交，限额原子核算；每次实际调用和重试独立准入，重复操作不重复计数，未确认调用不直接认定可免费重试。
- [ ] 对 renderer 不开放任意 HTTP/模型代理；个人凭据不进入权威记录，规划许可不能运行工具副作用或变成委托。
- [ ] 成员候选只含当前获准读取的必要身份/职责字段；推荐不泄露账号秘密、不可见任务或整份管理员成员表。
- [ ] 固定查询/命令/事件/回执同样经过当前权限；迁移失败回滚，冷重开和备份恢复校验新增关系。

助理验证：真实 SQLite 和 HTTPS/native 测试，限额并发、同键异内容、发送前撤权及策略变更；相关 Host 类型、lint、事件/配置门禁。用户检查：设置入口及权限限制说明后续在 Phase 6 一并检查。依赖：Phase 1–2。

实际完成：未开始；执行后填充。

## Phase 4：组织项目目标对话与隔离规划宿主

目标：尚未创建任务时也能打开本人组织项目对话、发送目标及澄清，运行受限规划 Agent，重开恢复原关联。

产出：Phase 1 确认的 `organization-conversation` 服务/协议/持久化；`apps/desktop{,-host}/src/` 固定私有 IPC；必要 bundle/preset/manifest 与持久事件目录。复用 loop、工具、Session、LLM 与日志基础，不复用 personal 状态作为组织权威。

验收清单：

- [ ] 本人项目对话有稳定 Session 与组织身份关联；原子预留、JSONL 写入和重开对得上，半完成记录可以恢复且不建立副本。
- [ ] 组织对话用独立 Agent/Session 域，个人发送/查询/fork/上传/恢复全部拒绝；原只读 context 不变。
- [ ] 用户输入、准确授权上下文、有效设置、方法版本及澄清均记录；只把明确允许的共享资料用于组织模型。
- [ ] 私有 IPC 关联 nonce/request/generation/顶层窗口；迟到响应拒绝，销毁等待 Agent/请求/落盘收敛。
- [ ] 最终 HTTP 发送前检查一次性规划许可；默认工具集仅规划与澄清，无文件/执行/审批绕过。
- [ ] 断线、休眠、身份切换停止新增调用，重连不自动续跑；有独立持久关系才增加 invariant，并在真实 Loader 门禁执行。

助理验证：真实 Loader/私有 IPC/HTTPS/JSONL 与模型替身组合、准入/取消竞争、重开及 HMR dispose；检查独立模型可见日志。用户检查：后续从组织项目打开、重开和切换对话。依赖：Phase 3；共享草案写入留 Phase 5，不能用此阶段宣布已自动建树。

实际完成：未开始；执行后填充。

## Phase 5：根草案、准确修改与员工子树细分

目标：把模型建议接到权威 WorkGraph，形成可审阅树和获准局部修改，避免两份漂移计划。

产出：`organization` 的目标/计划关联及子树固定命令、schema/事务/当前授权投影；API/native 接线；组织规划评估/提案消费者；当前版本快照与本人私有建议记录。必要的两消费者纯逻辑从既有实现抽取，不合并个人与组织写入者。

验收清单：

- [ ] 复杂、已澄清目标提交校验过的结构化草案；simple 不建树，无 write 者只存私有建议并清楚标明状态。
- [ ] 相同已接收目标/operation 重试只有一棵树，失去回执先核对；不同内容同键拒绝，版本冲突不覆盖。
- [ ] 保存处在线复核当前设置、项目/task edit、评估版本及目标归属；模型草案不包含领导完整聊天或私人秘密。
- [ ] 服务端合并获准子树，隐藏兄弟不参与客户端输入/返回；非法祖先/跨树依赖、预算资源扩大、历史移除 ID 重用均拒绝。
- [ ] 文本修改和结构修改准确递增版本，按原机制失效资格；变更前可查影响，新叶子只由原下发人重新批准，不隐式继承旧叶子许可。
- [ ] 对话和工作台重读同一权威记录；依赖查询、提交及父级汇合消费细分后的当前定义。

助理验证：领域事务/权限/迁移/并发测试、真实提案工具管线与回执丢失、下发后细分及重新批准；独立查询 SQLite 校验隐藏子树未被修改。用户检查：从对话调整草案、修改目标、细分授权任务及确认失效影响。依赖：Phase 4。

实际完成：未开始；执行后填充。

## Phase 6：对话内计划树、修改和负责人选择

目标：把个人和组织计划能力接到日常对话输入与可重建卡片，工作台成为可选总览。

产出：`ui-personal-workflow` 与 `ui-organization` 的对话入口、设置、任务节点/卡片、详情与成员选择；现有 ConversationDefinition/keyed renderer/slots 注册及 native 订阅。抽取适用任务详情视图，全部产品文案经 typed locale。

验收清单：

- [ ] 普通发送直接进入自动路由，不依赖斜杠命令、手工根任务表单或测试开关；简单目标正常显示答复。
- [ ] 树、版本、授权状态和当前目标关联来自持久记录；澄清答复、自然语言修改和进度查询针对当前目标。
- [ ] 详情持续显示目标/范围、验收、责任人、版本、运行状态、待谁处理及最新提交；无权者看到明确限制，不显示旧内容。
- [ ] 支持“开发交给某成员”等建议及控件选择，姓名歧义、成员失效和无任务查看权分别提示；选择本身不分配。
- [ ] 保存冲突保留本人修改但拒绝覆盖；generation 变化隐藏正文，重取后再允许动作；对话销毁释放订阅并拒绝迟到响应。
- [ ] 工作台与对话对同一任务有相同授权业务事实；展示状态不新增 Session 业务事件。

助理验证：类型、局部 lint、i18n/Client 图与 slot 门禁、投影/路由纯逻辑测试；不拉起页面。用户检查：不打开工作台完成建树、修改、查询及负责人选择；检查两种语言和复杂树可读性。依赖：Phase 2、5；视觉检查留待用户，不阻断后续可静态验证的接线。

实际完成：未开始；执行后填充。

## Phase 7：明确分配与员工独立任务对话

目标：从对话确认分配清单，员工在自己的入口看到持久任务对话，不接收下发人的完整聊天。

产出：共享分配确认展示与现有 `assignment-review` / grant / approve 消费者；Inbox 及 `organization-conversation` 的分配标识、员工对话建立/打开/恢复；必要服务端事件及绑定查询。

验收清单：

- [ ] 准确版本、真人负责人、目标/验收、资料范围和执行授权状态可逐项审阅；批量确认逐项显示终态、冲突与 unknown。
- [ ] 分配前核验编辑/分配权和员工 read；缺 read 时另行确认 grant，有权补齐后重新审核，不能由模型代确认。
- [ ] 正式通知与 assignment 持久关联；员工在线打开或同步时幂等创建独立任务对话，离线待建立状态可恢复。
- [ ] 双击、超时、重开、另一窗口打开均不重复批准/通知/对话；本机失败不会回滚或重发已提交的组织业务。
- [ ] 对话注明原目标任务和下发人，任务选择只返回获准资料；领导原文、员工完整执行日志不自动分享。
- [ ] 对话建立不接受、不委托、不领取、不运行；撤销/改派/新版本不把旧 Session 变成新负责人资格。

助理验证：真实权威/native/IPC/JSONL 多客户端测试，员工离线、批准提交后本机写失败、部分批量成功、撤权及重复建立；独立查询数量及通知收件人。用户检查：在对话确认两个子任务、员工从通知/侧栏打开独立对话，检查隐私及部分失败提示。依赖：Phase 6。

实际完成：未开始；执行后填充。

## Phase 8：从对话完成执行、提交、验收和返工

目标：把 Phase 7A 的全部真人固定动作接到对话内，完成员工与下发人的日常管理。

产出：`AssignmentPanel`、`ExecutionPanel`、`ExecutionHumanRequest`、`DeliveryPanel`、`AcceptanceReview`、`IntegrationPanel` 适用组件/消费者的复用；组织任务对话与 Run/私有 transcript 的关联、对话内待处理投影。业务事务仍归既有服务。

验收清单：

- [ ] 员工能在对话明确接受/拒绝、选择本机配置、有限委托、领取、开始/停止/显式恢复；模型建议不能直接操作。
- [ ] 规划不继承执行许可，执行不重新创建根树；细分后重新资格流程、依赖阻塞和当前版本均在同一对话可处理。
- [ ] HumanRequest 的答复与继续执行分开；失联或撤权拒绝新增动作，unknown 核对与显式恢复沿用旧消费者。
- [ ] 员工明确上传/提交；原下发人明确验收或驳回；返工显示新 revision 及重新批准，运行完成不自动提交。
- [ ] 对话内查看必要已验收输入、选择目标、实际核验和最终确认；父级交付条件不变，不自动应用/覆盖文件。
- [ ] 完整私有日志独立读取且仍受当前资格约束；共享详情/搜索/通知没有聊天或本机目录泄露。

助理验证：业务动作适配、权限投影与类型/i18n/局部 lint；复跑受影响执行/交付聚焦回归，不为复用重复整套历史测试。用户检查：全程对话内接受到验收/返工/集成，检查每次确认含义及停止/恢复。依赖：Phase 7。

实际完成：未开始；执行后填充。

## Phase 9：正常模式双人 CSV 与故障负例

目标：验证从自然目标输入开始的真实组件组合，覆盖两端授权、细分和持久恢复。

产出：`apps/desktop-host/tests/conversation-planning.spec.ts` 及相关 package 聚焦测试/夹具；复用既有 CSV 输入和文件核验，不另造演示专用任务权威。除模型外保持真实 Loader、native/HTTPS、SQLite、JSONL、业务命令及文件工具。

验收清单：

- [ ] 关闭 forced 模式从复杂目标发送开始，评估、草案、真人调整/分配、员工对话、执行/介入、提交、驳回返工及必要子任务汇合可贯通。
- [ ] 简单目标不建树；模糊目标答复补当前目标；不同设置与权限改变建议/路由；查询和已绑定步骤不建新树。
- [ ] 开关开启可拆简单新目标，关闭恢复；设置/身份切换不串用，不影响另一成员或既有执行范围。
- [ ] 重复消息、同键异内容、版本冲突、半批分配、失去回执、对话落盘崩溃、重开均无重复业务记录。
- [ ] 无编辑/分配权、缺员工 read、隐藏兄弟、撤权/停用、断线/休眠、模型准入竞争和旧版本操作均有实际拒绝证据。
- [ ] 最终独立读取成果字节/哈希和权威交付记录，核对未授权文件不变；不能只断言模型回复含“完成”。

助理验证：聚焦组合与新增错误路径，独立重开存储和文件核验；记录模型替身与未执行真实模型。用户检查：用本阶段相同样例在 Desktop 从自然对话复现；可见待验不等于组合测试失败。依赖：Phase 8；主路径必须从发送消费者进入，不能直接 savePlan 预种树后称为自动建树通过。

实际完成：未开始；执行后填充。

## Phase 10：发行验证、模型语料与 Phase 8 交接

目标：确认新增对话与规划能力进入发行组合，提供可执行用户验收，不在本次自动发布产品。

产出：`apps/desktop-host/tests/conversation-planning-built-smoke.mjs`、无页面真实模型 smoke/语料入口、`docs/conversation-planning-acceptance.md`；同步路线图、工程概览、实际修改包 README/公共接口文档及必要生成目录。

验收清单：

- [ ] 新包/方法资源/Client 模块都在 Desktop 闭包，Host 与 Client face 显式配置；不会出现额外应用入口。
- [ ] 本期发行构建及普通 Node/Electron Node mode 无窗口 smoke 验证私有进程路径、绑定重开、权限拒绝和方法资源；若用户明确保留给自己，交付准确命令并标待验，不能写通过。
- [ ] 真实模型语料覆盖普通问答、简单、复杂、多轮澄清、修改及绑定续聊；遵循现有密钥/用户授权，记录真实调用、失败、跳过或待用户，不安装或索取新凭据。
- [ ] 三机剧本从关闭 forced 模式的自然 CSV 目标开始；创建、分配和日常管理无需工作台，加入不同偏好/无分配权和重开负例。
- [ ] 交接区分确定性路由测试、真实识别效果、发行 smoke、可见/双平台/三机产品结果；保留 Phase 2–7A 的历史待验。
- [ ] Phase 7C 工程状态按本期证据更新；产品 Phase 8 仍是后续单独授权的验收目标。

助理验证：按下文检查策略完成新增发行路径和静态门禁；本阶段不运行产品 UI。用户检查：Desktop 可见、真实模型/双平台和 A/B/C 三机，结果填入验收记录；未完成项明确保留。依赖：Phase 9；存在发布闭包缺失或新权限绕过不得 completed。

实际完成：未开始；执行后填充。

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
plan review: pending
execution authorization: none
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

评审后推荐从 **Phase 1** 开始。本次规划没有启动任何实施阶段。
