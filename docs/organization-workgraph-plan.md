# 组织 WorkGraph 与任务上下文实施计划

本文细化[产品路线图 v0.4](../ai-native-work-os-product-roadmap.md)的**产品 Phase 5**。下文 Phase 1–8 是本计划内部施工编号，不对应 roadmap 的同号阶段。在本任务中说“继续”或“执行 Phase X”，先读取本文及 [工程概览](overview.md)，按本文唯一状态表选择工作，不续跑已完成的组织基础计划。

## 目标、歧义检查与可行性

目标：在已有组织项目上保存一份权威、版本化的任务树与依赖图，明确目标、范围、真人责任人建议、下发人及验收要求；领导和员工只读取获准的任务视图，各自的任务上下文与对话关联独立。一个任务可以经 GUI 创建、修改、重开、授权查看并关联自己的上下文，服务端搜索和同步遵守同一权限规则。

计划创建时只制定计划；用户于 2026-09-27 授权完成 Phase 1–2，随后明确要求“请自动完成phase3-4”，用户又于 2026-09-27 明确要求“请自动完成phase5-6”，本次按 Phase 5–6 范围执行。歧义检查：roadmap 已确定产品 Phase 4 工程完成、产品 Phase 5 尚未实现，因此“下一阶段”落在产品 Phase 5；不把 Phase 6–7A 的批准、委托和运行一并纳入。权限与预执行上下文方案已在 Phase 1 按本次执行授权定稿；哪些能力已经实现以状态表及设计文档为准。

关键阶段边界：本期保存的是**计划定义和待分配责任人**，不是已下发任务。指定责任人不授予读取或执行权限；显式授予任务查看权只允许查看准备材料，不产生分配通知、执行资格或员工电脑上的自动动作。正式批准后生成员工执行对话、员工接受/委托、HumanRequest、领取、Run、提交及验收分别留给产品 Phase 6–7A。任务绑定在本期提供身份隔离和持久关联，不打开普通 Agent 执行通道。

可行性高，但属于跨持久化、权限、原生 IPC、Session 与 Client 的大型目标。现有组织事务/连接可以扩展；不需要引入 Go/PostgreSQL、复制 Multica 代码或重建 Agent loop。主要风险是项目授权错误地扩大为整棵树授权、任务依赖泄露隐藏节点、组织账号切换后仍能读取旧对话，以及把“绑定对话”误当成执行授权。

### 静态核验基线（2026-09-27，`99a8a92`）

| 当前实现 | 本期使用方式与缺口 |
| --- | --- |
| `workspace/organization/src/{index,database,resources}.ts`：独立 SQLite v2、串行事务、OperationId 回执、项目 read/write grant、授权游标 | 继续作为组织数据唯一写入者；没有任务、任务授权或组织计划版本表。新增物理结构需单调升级组织 schema。 |
| `api/organization-api`：受限 HTTPS；`host/organization-connection`：原生认证、请求代次、失效清理和回执核对 | 增加明确任务动作和受限响应，不建立通用 URL/RPC 转发。成员令牌仍留在 Electron 原生侧。 |
| `ui-organization`：组织入口和管理对话框 | 项目当前主要用于登记/授权，没有任务工作台。业务任务详情应独立于账号/服务管理表单。 |
| `personal-workflow/src/plan-schema.ts`：父子树、依赖与隐含父完成环校验；`projection.ts`：个人任务投影 | 复用纯图规则；当前规则未独立成通用库，不能直接加载个人服务或把其带 cwd/Bot/Session 的 schema 用作组织模型。 |
| Session Controller：个人列表、读取、移动、投影与执行入口 | 当前不是组织身份隔离接口。组织对话关联需要独立的可信身份来源和读写检查，不能仅加 sidebar 筛选。 |
| 组织基础计划内部 Phase 1–7 已记录工程完成 | 本次未重跑旧测试。三机和 Desktop 可见验收待用户完成；通常不阻塞本期工程，真实部署结论仍以用户证据为准。 |

## 范围与验收边界

范围内：共享项目任务工作台、手工创建/编辑计划、不可变计划版本、任务父子关系与依赖、必要子任务标记、待分配真人及下发人信息、独立任务授权、授权后的详情/列表/搜索/失效事件、任务上下文与本人对话绑定、撤权/切换/重开处理、无页面集成验证。

范围外：模型自动拆分/分配、正式批准下发、执行委托、执行器/Run、人工请求收件箱、提交/验收/返工、自动父任务完成、附件上传下载、实际产物整合、企业 IM、甘特图/看板矩阵、智能排程、跨设备 Session 同步、私人 Bot 记忆、离线写入队列、共享 Runner。后续可共享的资料本期仅允许用户明确填写的任务说明和验收要求，不自动抓取 URL、读取本机路径或上传文件。

本期必须验证“未实现的动作不可调用”：界面无批准/执行入口之外，原生和服务端也不得接受伪造的 approve、dispatch、claim、submit 或完成状态字段。不能用模拟完成、假审批或直接改数据库作为产品验收步骤。

本期完成不等于组织闭环完成；roadmap 产品 Phase 5 的运行通知、实际产物权限检查随对应 Phase 6–7A 消费者实现。本期验证任务事件和文字产物要求的隔离，同时继续拒绝组织访问个人附件接口。

## 建议设计与所有者

### 任务、版本与写入

- 新 ID 使用品牌类型，区分组织 PlanId、TaskId、PlanRevision、OperationId 和个人 TaskId；具体类型在 Phase 1 定稿。组织和项目从已认证请求及已存在资源核验，不接收可信 actor/role 字段。
- 一个项目可有多个计划，每个计划有一个根任务；首个测试/GUI 切片可以只有根任务这一项，随后验证父子与依赖。Task 保存稳定 ID、目标、范围、验收条件、产物要求、父 ID、必要性、依赖、阶段及待分配成员。不得保存 cwd、个人 Bot、密钥或执行权限字段。
- 计划编辑产生完整不可变 revision；写入携带 expectedRevision 与 OperationId，失败不改变可见状态。移除的 TaskId 不复用于别的任务。组织服务验证完整图，裁剪给员工的局部视图不回写完整图。
- 定义版本、数据库事件 revision 和授权版本分别命名。历史版本按当前访问权限过滤，不能用旧版本或旧回执绕过撤权；任务移位/删除后，历史读取也不得重新扩大原授权范围。
- 创建者/下发人由服务器记录。Phase 5 可编辑建议责任人，但它不是正式分配记录；编辑成员字段不自动授权、建对话或启动任务。成员停用保留历史引用，当前视图显示不可分配，不能伪装其仍可执行。
- 组织事务原子提交定义、任务索引、授权变化（若有）、事件及回执；事务内无 await，只有 COMMIT 后发布失效事件。数据表、字段、索引和迁移在 Phase 1 的设计文档中定稿，不复制个人存储聚合布局。

### 查看权不等于项目成员资格

建议任务授权采用**项目准入 + 显式任务动作**，并继续分开管理权与内容读取权：

| 场景 | 建议规则 |
| --- | --- |
| 创建计划 | 需要当前项目 read + write；创建事务为创建者记录该计划根范围的 read/edit，避免存在无法由创建者读取的孤立计划。该行为不赋予其他管理员内容权。 |
| 管理任务授权 | 组织管理权限负责授权管理；非读取管理员仅获得管理所需 ID、动作与版本，不能借授权管理接口取得任务正文。沿用现有项目授权管理的显式信任模型。 |
| 读取任务 | 有效账号/成员、项目 read，加任务 read；项目 read 不自动放开任务树。支持节点及其子树范围，范围是明确字段。 |
| 编辑计划 | 项目 read/write 加根范围 edit；本期只有整份定义修订，不支持员工以局部投影覆盖完整计划。成员细分自己的任务在后续阶段另做。 |
| 查看他人上下文 | 不因任务 read、职位、创建者或管理身份自动授权。每人只访问本人本机绑定，不返回其他成员 SessionId、标题或聊天。 |
| 撤权/移位 | 撤销项目 read 或任务 read 后禁止继续查看；子树移位不得静默把新的敏感节点纳入旧 grant。Phase 1 固定授权覆盖的版本处理，建议结构变更令受影响 grant 失效并要求显式重授。 |

领导/员工是此场景的职责名称，不新增全局 leadership 角色，也不把 `admin` 等同于领导。跨项目/计划依赖首版拒绝；不引入岗位系统。

员工获准节点可以作为返回视图的根；不返回隐藏父节点/兄弟节点的标题、ID、数量、路径、责任人或阶段名称。对不可见前置只返回无身份信息的“有未公开前置条件”，不暴露其状态变化和数量；准备材料应显式写入获准任务。历史差异、总数和搜索摘要也使用相同投影。列表按可见条目分页，不能先返回全量再让 Client 裁剪。

### 任务上下文与 Session

此链路必须在 Phase 1 给出可执行的接口设计，Phase 5–6 完成验证，不能以未来委托功能补偿当前读取泄露。

- 组织权威只保存任务事实；本机绑定使用 `serverId/accountId/organizationId/planId/taskId` 与本人 Session 关联。本人在同机重开复用绑定；不同账号、不同任务不共享一个 Session，不上传聊天正文、私人 Session 标题或本机路径。
- Electron 原生连接产生可信身份及请求代次；Renderer 提交的 accountId 或任务快照不构成授权。Host 通过受限私有 IPC 接收必要的已验证上下文，不持有组织 bearer token、不代理通用 LAN 请求。接口新增需要更新架构中的进程职责说明。
- 优先复用 Session 存储/投影机制，但组织 Session 必须带明确的不可移除归属；覆盖列表、详情、投影、搜索、导出、分叉、移动、上传/附件引用和发送等可达入口。普通个人调用不得读取、改变归属或执行组织 Session。仅保留有权限检查的真实入口；没有安全消费者的入口拒绝。
- 本期上下文处于预执行只读状态：可展示获准任务摘要和关联历史，不接受模型发送、工具调用、自动唤醒或 fork 到个人空间。绑定不创建 Run，不带入用户已有私人对话；正式下发的员工执行对话由产品 Phase 6 在批准后创建或明确转用获准绑定。
- 首次绑定使用操作回执及固定 Session 标识进行幂等协调；组织授权检查、本机绑定和 Session 落盘跨存储不能假装同一事务。局部失败不显示成功；重试复用已保留标识，成功前验证 Session 已落盘，重启后可核对未完成关联。
- 退出、身份切换、撤权、连接失效后，后续读取拒绝并清空展示及在途代次。已经合法取得的本机历史不宣称能远程抹除；同 OS 用户直接访问磁盘也不是应用账号隔离能防御的范围。本期不提供离线打开组织上下文功能。
- 若组织事实进入 Session，则记录准确版本及已授权裁剪内容，不在重开历史时替换为最新版本。新增 Session event 使用当前格式扩展规则；不为了一个新事件任意提升 envelope 版本。

### 代码落点与复用方式

| 所有者 | 预计改动 |
| --- | --- |
| `packages/workspace/organization` | 新增 `workgraph-types.ts`、`workgraph-schema.ts`、`workgraph.ts`、任务授权/查询模块（文件名待 Phase 1 定稿）；修改数据库、领域方法、错误码及维护校验。保持一个数据库写入者。 |
| `packages/workspace/personal-workflow` | 将实际共用的纯图校验剥离出个人 schema；保证个人语义不变。若两个消费者需要独立库，建立小型无服务图算法包；不把个人 runtime 带进组织进程。 |
| `packages/api/organization-api` | 专用任务读写/授权/事件路由、JSON 校验、响应限制和当前权限交付。 |
| `packages/host/organization-connection` | 固定任务查询/命令、身份分区缓存、回执核对、任务失效流；不得让整个任务正文进入通用管理快照。 |
| `apps/desktop/src/{organization-manager,ipc,preload-app}.ts` 及 Host 私有 IPC | 暴露受限任务动作、可信身份与本机上下文协调；继续只允许所属顶层窗口调用。 |
| `packages/api/session-controller` 及本机组织上下文插件（若需要） | 组织 Session 的持久绑定、归属检查及所有可达读取/执行入口保护。真实消费者与包归属在 Phase 1 定稿。 |
| `packages/client/ui-organization` | 共享项目任务列表/树、详情、编辑、权限及预执行上下文入口；typed locale 和 Client 纯交互测试。 |
| `apps/desktop-host/tests`、领域/API/连接/Client 测试 | 真实 Loader/HTTPS/持久化链路与拒绝案例；所有新增文件均为计划产物，不能当作已有证据。 |

不引入 Multica 代码或授权依赖。其任务详情与运行展示作为交互参考；本期不展示不存在的运行数据。纯库只在确有两个消费者且能删去重复逻辑时提取；不先建通用工作流引擎或抽象 provider。

## 唯一阶段状态表

| 阶段 | 主题 | 主要目标 | 状态 | 实际产出 | 备注 |
| --- | --- | --- | --- | --- | --- |
| Phase 1 | 协议与授权设计 | 定稿数据、任务可见范围和本机上下文隔离 | completed | organization-workgraph.md；架构职责说明 | Session 入口及隔离策略已定稿 |
| Phase 2 | 任务定义与版本 | SQLite 持久图、事务回执及纯规则复用 | completed | SQLite v3、WorkGraph、task-graph；73 项聚焦测试与两组产物 smoke | 历史阶段完成 |
| Phase 3 | 任务授权与投影 | 子树授权、历史/搜索/分页/事件一致过滤 | completed | workgraph-access；7 项新增权限测试 | 见阶段记录 |
| Phase 4 | HTTPS 与原生动作 | 连接、协议、重连及原生身份代次 | completed | 固定路由/动作、独立任务 SSE、代次响应 | 历史阶段完成 |
| Phase 5 | 本机上下文隔离 | 组织 Session 归属与入口保护 | completed | organization-context、个人入口保护、私有 IPC | 无公开任务 UI |
| Phase 6 | 持久对话绑定 | 幂等关联、准确任务快照和失败恢复 | completed | 原子预留、JSONL 快照、在线重验及恢复 | 已达本次授权停止点 |
| Phase 7 | 共享任务工作台 | 创建、编辑、授权视图与本人上下文入口 | pending | — | 依赖 6 |
| Phase 8 | 集成与交付 | 无页面跨身份链路、发行和用户验收剧本 | pending | — | 依赖 7；不启动产品 Phase 6 |

## Phase 1：协议与授权设计

目标：把上面的方案落实为明确请求、响应、事务、权限及失败行为，消除实现前的安全缺口。

预期文件：新建 `docs/organization-workgraph.md`；核对 `organization`、`organization-api`、原生连接、Session Controller、Session 查询/导出与上传入口；按需更新架构职责描述。

验收清单：

- [x] 定稿定义/版本/授权/本机绑定的数据字段和路由；明确整份计划编辑与裁剪视图不能互换。
- [x] 用两账号、两组织、两个不同任务子树推演授权矩阵，固定结构变化及历史版本授权行为。
- [x] 列出 Session 读、写、查询、导出、分叉、移动、模型输入和附件的所有实际消费者；每个有明确的 guard 或拒绝策略。
- [x] 定稿原生到本机 Host 的可信身份传递、撤销代次、超时与重启流程，不将 token 交给 Renderer。
- [x] 确定纯图逻辑是否需要小型公共库；明确 SQLite v2 升级、备份恢复、配置限额和包/编译面影响。

助理验证：源码与接口对照、请求和故障时序推演；不写仅验证静态类型的测试。用户检查：审阅“任务显式查看授权”和“预执行上下文只读”的建议；若要求本期就批准执行，属于范围调整，先修改计划。依赖：旧三机可见检查非阻塞，若当前基础已出现真实错误则记录具体阻塞。

实际完成（2026-09-27）：新增 [组织 WorkGraph 设计](organization-workgraph.md)，明确品牌 ID、完整修订请求/回执、SQLite v3 表及索引、当前权限和历史交集规则、两账号/两组织/两子树矩阵、原生身份代次与本机绑定故障时序；核对 Session Controller、查询工具、引用展开、导出、上传、文件和 Agent 恢复的实际消费者。架构页记录后续私有 IPC 与独立组织 Session 存储职责，明确 Phase 4–6 尚未实现。

设计决定：纯图规则提取为无服务 `util/task-graph`；结构变化采用整计划旧 grant 失效，仅提交新完整树的根编辑者在事务中更新自身 grant；本机上下文使用独立 Session 存储和保留 ID，不进入个人 corpus/Agent registry。源码核对和故障推演已完成；无页面检查、无静态类型专用测试。仓库引用的 `.agents/skills/dsh-prose-standard/SKILL.md` 不存在，检索后未找到，文档按 AGENTS 的直接契约规则人工核对。该缺失不阻塞设计和实施。下一阶段 Phase 2。

## Phase 2：任务定义与版本

目标：实现一个可持久重开的组织计划，再加入必要的树/依赖规则。

预期文件：`organization/src` 的图定义、存储、数据库迁移及 `tests/workgraph.spec.ts`；`personal-workflow/src/plan-schema.ts` 与必要纯逻辑库/回归；相关 README、manifest、paths 注册。

验收清单：

- [x] 单任务与 CSV 多阶段示例可保存/重开，历史 revision 不可变；身份、项目和成员引用同组织。
- [x] 根唯一、连通、重复 ID、悬空依赖、显式环和父完成隐环在输入边界拒绝。
- [x] 并发旧版本写入只允许一个成功；重复 OperationId 同内容返回原回执、不同内容拒绝；事务失败无半份图或孤立事件。
- [x] v2 组织库升级不丢账号/项目/grant；未知版本和损坏数据拒绝；停服备份/恢复认识新结构。
- [x] 不生成执行状态或批准；拒绝注入 cwd、权限、Run 或完成字段；个人图规则回归保持原行为。

助理验证：真实临时 SQLite、故障回滚、重开与迁移测试；纯图行为测试和相关编译面。用户检查：无本阶段新增 GUI。依赖：Phase 1 定稿后实现，不把未来任务领取租约提前建空表。

实际完成（2026-09-27）：组织服务新增 `savePlan/readPlan`、`workgraph-{types,schema,database}.ts` 与 `workgraph.ts`。完整定义、不可变 revision、稳定任务索引/tombstone、创建者根 grant、结构 epoch、事件和回执原子提交；当前权限控制历史与回执读取。SQLite 升为 v3，兼容 v1/v2 事务迁移，停服备份写 v3，恢复支持并校验 v2/v3。新库 `util/task-graph` 由组织与个人 schema 共用，无个人 runtime 依赖；同步 manifests、Host aggregate、源码 paths、lockfile、READMEs、架构及概览。

验证已完成（各文件最近一次结果，共 7 个测试文件、73 项通过）：

- `pnpm exec vitest run packages/workspace/organization/tests/workgraph.spec.ts packages/workspace/personal-workflow/tests/plan.spec.ts packages/workspace/personal-workflow/tests/storage.spec.ts packages/api/organization-api/tests`：5 文件 48 项。
- `pnpm exec vitest run packages/workspace/organization/tests/authority.spec.ts packages/host/organization-connection/tests/connection.spec.ts`：当时 24 项通过；随后增加 v2 备份恢复/manifest 不符测试，单独运行 `pnpm exec vitest run packages/host/organization-connection/tests/connection.spec.ts`：7 项通过。authority 最近一次为 18 项通过。
- `pnpm exec tsc -b packages/workspace/organization packages/workspace/personal-workflow`：通过。
- `pnpm exec tsdown --env.DSH_BUILD_FACE host --filter '@deepseek-ai/dsh-task-graph' --filter '@deepseek-ai/dsh-organization' --filter '@deepseek-ai/dsh-personal-workflow'`：三个相关包构建通过。
- `node packages/workspace/organization/tests/built-smoke.mjs`、`node packages/workspace/personal-workflow/tests/built-smoke.mjs`：普通 Node 产物验证通过，组织包含保存/重开计划，个人包含 Loader、Remote codecs 和持久执行恢复。
- `pnpm exec tsx scripts/run-oxlint.ts packages/util/task-graph/src packages/workspace/organization/src packages/workspace/organization/tests/workgraph.spec.ts packages/workspace/personal-workflow/src/plan-schema.ts packages/host/organization-connection/tests/connection.spec.ts`：通过。
- `pnpm exec tsx scripts/gen-tsconfig-paths.ts --check`：通过；通过 `tsx --eval` 调用仓库 `collectExportJsdocViolations()` 和 `packageMetaProblems()` 并筛选上述三个变更包：无问题。`git diff --check` 通过。

覆盖单任务和 CSV 三阶段持久重开、不可变历史、隐含父完成环、旧版本竞争、OperationId 冲突/重试不重复事件、晚期 SQL 故障全回滚、跨组织引用、管理员/建议成员无 grant 拒绝、撤权后历史/回执拒绝、移位失效、删除 ID 不复用、停用成员历史保留、完整 UTF-8 大小/深度限额、损坏数据拒绝、v1/v2 迁移及停服恢复。初次抽取的父字段替换错误和旧 v1 测试夹具遗漏新增表均已修正，后续相关检查通过。

偏差与范围：Phase 2 提前落下创建者根 grant 和结构失效的最小实现，以免新增完整读取接口出现权限空缺；一般任务授权、局部投影和查询仍属于 Phase 3。没有 GUI 改动、页面/Playwright、真实模型调用、全仓测试、全量发行构建或部署；本阶段未新增模型能力，不需要真实 API 测试。未自动 commit/push。本次 auto_until 已达 Phase 2，恢复 manual，下一候选为 Phase 3，需后续执行指令。

## Phase 3：任务授权与一致投影

目标：由组织服务按当前权限产生完整或裁剪视图。

预期文件：任务授权/查询模块、`resources.ts` 的访问版本协调、领域 `tests/workgraph-access.spec.ts`；设计中的权限矩阵同步。

验收清单：

- [x] 管理员无内容 grant 不能读取；建议责任人无 grant 也不能读取；查看权不授予编辑、绑定他人上下文或执行。
- [x] 节点/子树授权、移位、删除、改成员、撤权与历史读取遵守同一规则；不可见 ID、标题、计数和依赖详情均不返回。
- [x] 列表、搜索、详情、分页总数、历史差异与事件使用一致当前授权条件，旧游标/旧回执不能复活访问。
- [x] 任务内容改变或授权失效只在提交后通知；已有订阅在交付时重验权限；授权变化使相关游标失效。
- [x] 授权配置、层级/条目/正文/查询结果限额经过 Config 校验；大图或完整响应超限明确失败，不静默截断关系。

助理验证：真实领域查询、两个身份的同一请求差异、隐藏节点哨兵、读/撤权竞争及分页重开；断言数据输出而非只看菜单。用户检查：无新增界面，权限含义以已评审设计为准。依赖：Phase 2。

实际完成（2026-09-27）：新增 `workgraph-access.ts`，实现节点/子树 read、根 subtree edit、当前与历史覆盖交集、隐藏父/阶段/依赖裁剪、搜索与可见分页、管理元数据和按可见投影变化过滤的事件。授权和结构 epoch 纳入游标核验；当前成员有效性决定 assignable。完整历史定义读取要求根 edit，普通历史比较使用两个裁剪任务页，不增加泄露完整定义的差异接口。新增 grant/page Config 限额，所有任务响应受完整 UTF-8 大小限制；新增提交日志只记录 ID、revision 和结果。

验证：`pnpm exec vitest run packages/workspace/organization/tests/workgraph-access.spec.ts` 7 项通过；本轮 `workgraph.spec.ts` 12 项及 `authority.spec.ts` 18 项通过；`pnpm exec tsc -b packages/workspace/organization --pretty false`、局部 `run-oxlint.ts` 及筛选本包的 `collectExportJsdocViolations()` 通过。重开测试发现并修正新增授权事件/回执未被启动校验接纳的问题，后续重开测试通过。没有页面或模型调用；未自动提交。按授权继续 Phase 4。

## Phase 4：HTTPS、原生连接与受限 IPC

目标：让真实桌面连接消费任务服务，保持原有账号、TLS 和重连保障。

预期文件：`organization-api/src` 及 `tests/workgraph.spec.ts`；`organization-connection/src/{types,schema,index}.ts` 及连接测试；Desktop IPC、preload 与组织管理器。

验收清单：

- [x] 建立明确的任务读写和授权 API/原生动作；未知字段/动作/路由拒绝，主体只从登录解析。
- [x] 两个真实连接取得不同任务视图；组织、账号、服务及请求代次完整分区，迟到响应不进入新身份页面。
- [x] SSE 重连、重复批次、乱序、缺口、权限变化要求正确重新取快照；不广播正文和隐藏任务标识。
- [x] 未确认写入沿用原生回执核对，不自动重发；网络断开禁止写入。
- [x] 顶层窗口限制、无任意 URL 代理、token 不进入 Client、组织无法访问个人 Session/附件的负例仍通过。

助理验证：真实 HTTPS、两个原生连接、测试时钟/断连；IPC 参数与发送者校验；相关类型/本地化接口门禁。用户检查：任务界面留 Phase 7。依赖：Phase 3。

实际完成（2026-09-27）：实现 `/workgraph/save/read/tasks/grant/grants` 与独立 `/workgraph/events`（轮询/SSE），共享严格 schema 通过 `organization/workgraph` 导出。原生连接增加固定任务动作，沿用证书/账号隔离和未确认回执账本；读取结果单独携带品牌 requestId、server/account principal、organizationId 和 generation。管理快照仅增加 generation，不含任务正文。项目与任务流共用批次顺序/去重校验，撤权/失效/断线清代次并重新取快照，关闭连接等待两种流退出。Desktop 复用原有 preload/管理器固定动作通道，异步交付后再次校验顶层窗口及代次；Client 仅同步初始 generation 类型，未增加任务界面。本机 Host 上下文私有 IPC 需 Phase 5 的真实消费者，未提前建立空服务或开放 Session。

实际验证：

- `pnpm exec vitest run packages/api/organization-api/tests/workgraph.spec.ts packages/api/organization-api/tests/resources.spec.ts packages/host/organization-connection/tests/connection.spec.ts`：3 文件 21 项通过；单独 `packages/api/organization-api/tests/https.spec.ts`：6 项通过。
- `pnpm exec vitest run packages/host/organization-connection/tests/workgraph.spec.ts`：4 项通过，覆盖双身份视图、SSE 失效、迟到响应、丢失写入响应后的重启核对、离线拒写与服务重启重连；随后加强真实账号/组织切换，单独 `-t 'discards late'` 通过。
- `pnpm exec vitest run packages/host/organization-connection/tests/workgraph.spec.ts apps/desktop/tests/main-startup.spec.ts apps/desktop/tests/preload-app.spec.ts packages/client/ui-organization/tests/mode-switch.client.spec.tsx`：preload 与 Client 纯交互通过；首次原生测试在自动重连期间立即读取的夹具时序已修正并以上述重跑通过。main-startup 81/82 通过，唯一失败为既有 macOS `hiddenInset` 断言，HEAD 实现已为 `hidden`；未修改无关窗口行为。单独运行 `apps/desktop/tests/main-startup.spec.ts -t 'organization task IPC'`：新增所属顶层窗口/伪造动作测试通过（其余 81 项按过滤跳过）。
- `pnpm exec tsc -b packages/api/organization-api packages/host/organization-connection apps/desktop/tsconfig.host.json packages/client/ui-organization --pretty false` 与 `pnpm exec tsc -b apps/desktop-host --pretty false`：通过。
- 对 organization、organization-api、organization-connection 源码及新增测试、Desktop main/IPC 测试、Client 初值/纯交互测试、产物 smoke 运行局部 `run-oxlint.ts`：通过。筛选三个包的 `collectExportJsdocViolations()`、`packageMetaProblems()`：无问题；`gen-tsconfig-paths.ts --check`、`verify-application-entrypoints.ts`、`verify-client-ui-i18n.ts` 和 `git diff --check` 通过。
- `pnpm exec tsdown --env.DSH_BUILD_FACE host --filter '@deepseek-ai/dsh-organization' --filter '@deepseek-ai/dsh-organization-api' --filter '@deepseek-ai/dsh-organization-connection' --filter '@deepseek-ai/dsh-desktop-host'`：四包构建通过。
- `node apps/desktop-host/tests/organization-built-smoke.mjs` 与扩展后的 `node apps/desktop-host/tests/organization-integration-built-smoke.mjs`：普通 Node 和 Electron Node 模式通过；后者新增真实私有进程/原生 WorkGraph 保存、授权裁剪、撤权和备份恢复定义验证。首次 smoke 在重连期间立即断言权限错误，已改为等待 ready 后核验 forbidden，最终通过。

新增诊断为任务提交 ID/revision 与原生项目/任务流 reset decisionCode，不记录正文或凭据。未新增事件声明/Loader 组合/依赖包，未重跑无关全仓测试、完整发行构建或模型 API；缺失的 prose skill 延续 Phase 1 记录，按 AGENTS 文档规范人工复核。没有页面、Playwright、用户安装验收、自动 commit/push。工程完成不代表任务 GUI 或真实三机可见验收通过。已达 auto_until Phase 4，恢复 manual，下一候选 Phase 5，未自动开始。

## Phase 5：本机组织上下文隔离

目标：先完成组织 Session 的归属与保护，再暴露对话绑定。

预期文件：Phase 1 核定的本机上下文所有者、Session Controller 与其他可达入口 guard、私有 IPC 身份传递、Session 类型/投影及测试。

验收清单：

- [x] 可信原生身份与当前有效任务 read 共同控制本机访问；Renderer 伪造身份或快照不能创建通行证。
- [x] 组织 Session 无法通过个人列表、搜索、导出、猜测 ID、分叉/移动、附件入口或普通模型发送绕过保护。
- [x] 退出/撤权/断线/身份切换使旧代次访问失败；不把组织上下文挂到私人 Bot 或个人计划。
- [x] 预执行上下文不能启动模型、工具或子 Agent；无 UI 入口时内部调用也拒绝。
- [x] effect/监听器释放后无残余权限状态；个人 Session 原路径和已存在个人任务不受影响。

助理验证：真实 Loader、本机 Host 入口的跨身份/猜测 ID 拒绝、取消与失效竞争、个人 Session 回归；核对模型与工具调用计数为零。用户检查：本阶段无公开绑定 UI。依赖：Phase 4；若必须改变通用 Session 的生命周期，先更新局部设计和验证范围，禁止直接改 agent-loop。

实际完成（2026-09-28）：新增独立 organization-context 服务和 JSONL namespace，个人 SessionStore/AgentRegistry 的创建、恢复、进入和查找入口拒绝保留 ID，个人持久化、查询、归档/置顶与上传入口同步拒绝。Desktop 私有 Node IPC 以 requestId、启动 nonce、授权请求 ID 和原生 generation 关联，每次读取在线复核，切换/断线取消在途交付；所属顶层窗口校验保持有效。组织记录不进入个人 Session/Agent 集合，不提供执行或公开 Remote。

验证：Loader/真实 JSONL 隔离与恢复测试通过；真实 HTTPS→原生协调器→私有 Host IPC 测试验证可见任务快照和撤权拒绝；普通个人 create/fork、upload、cold-read、Desktop Host/preload 聚焦回归共 6 文件 87 项通过。随后新增历史授权和真实链路用例，单独 context.spec.ts 7 项通过；main-startup 的 context/任务 IPC 定向检查通过（无关项按过滤跳过）。相关 Host 编译通过；Phase 6 交付前继续检查新增故障用例、局部 lint 和构建产物。无页面/模型调用；继续授权内 Phase 6。

## Phase 6：持久绑定与任务快照

目标：在安全入口之上关联当前成员自己的独立任务上下文，重开仍可核对。

预期文件：本机上下文绑定/协调、Session 事件与投影、原生连接动作、`tests` 中绑定幂等及恢复案例。

验收清单：

- [x] 本人同一任务重复打开使用同一绑定；其他账号独立；不采用现有私人 Session，不复制领导聊天。
- [x] 创建 Session 前保留固定标识与操作状态；部分失败、断电重开、重复响应不会生成重复可见对话。
- [x] 快照包含已授权任务版本及必要说明；历史不自动替换最新定义，权限被撤销后不能通过旧快照继续访问。
- [x] 绑定只记录本人本机引用；组织服务及他人视图不返回 Session 标识、路径或正文。
- [x] 绑定失败无伪成功，无自动重试模型调用；创建后仍为预执行只读。

助理验证：真实 Session 持久化和重开、授权检查与落盘之间撤权、跨存储故障、同机不同账号；验证没有新增 Run 或工具副作用。用户检查：在 Phase 7 GUI 接入后一并检查。依赖：Phase 5。

实际完成（2026-09-28）：storage-domain 原子预留 binding/operation 回执及固定 SessionId；独立 JSONL 写入不可移除归属、首次获准 task revision 和时间，flush 后冷读比较，再提交 ready。重试与重启复用 reserved 标识；本人同任务不新增对话，账号/任务独立，operationId 改换绑定拒绝。每次重开在线核验当前及历史授权；历史关联不再可见时拒绝旧快照，不用新定义覆盖原文。私有 IPC 关联请求、启动 nonce 和独立授权请求；原生代次取消和最终交付复核覆盖异步竞争。组织服务不接收 SessionId 或本机聊天，未增加 Run/模型/工具执行。新增 invariant companion 对照 ready 绑定与 JSONL，两者不符会拒绝。

实际验证（无页面）：

- `./node_modules/.bin/vitest run packages/workspace/organization-context/tests/context.spec.ts`：最终 8 项通过，使用真实 Loader、storage-domain/JSONL、HTTPS 和原生协调/私有 Host IPC；包括重复打开、账号隔离、个人读/导出/分叉/Agent 拒绝、撤权/代次/取消/离线、预留落盘失败、ready 标记失败恢复、历史授权缩小、跨存储损坏及监听器释放。
- 聚焦回归运行了 `apps/desktop/tests/{host-process,preload-app}.spec.ts`、`packages/api/session-controller/tests/{commands-create-fork,commands-upload-file,session-cold}.host.spec.ts`、`packages/workspace/personal-workflow/tests/storage.spec.ts`、`packages/session/session-persistence-jsonl/tests/jsonl.spec.ts`。最新三文件 context/host-process/upload 合跑 46 项通过；其余文件最近一次通过。新增上传负例核对附件写入和 followup 均为零。测试夹具中的列表调用和 global 写入故障注入已修正，最终新增用例通过。
- `./node_modules/.bin/vitest run packages/workspace/organization-context/tests/context.spec.ts apps/desktop/tests/main-startup.spec.ts -t 'context|persists|isolates|refuses reserved|retains a reservation|denies revocation|rejects a history|routes real'` 的原生所属窗口/伪造身份检查通过；无关 Desktop 测试按过滤跳过，未重跑 Phase 4 记录的 titleBarStyle 旧断言。
- `./node_modules/.bin/tsc -b apps/desktop-host apps/desktop/tsconfig.host.json packages/client/file-upload/tsconfig.host.json packages/api/session-controller/tsconfig.host.json --pretty false`，及带 `packages/client/ui-organization` 的相关编译通过；变更文件局部 `run-oxlint.ts`、新增包/原生包的 export JSDoc 与 package metadata/invariant publication 检查通过。
- `gen-tsconfig-paths.ts --check`、`verify-application-entrypoints.ts`、`verify-cordis-config.ts`、`gen-scoped-events.ts --check`、`verify-client-ui-i18n.ts`、`git diff --check` 通过。`gen-persistence-catalog.ts` 已同步两个必读事件及机器 schema；Session envelope 保持 v4。首次误用不存在的 `verify-scoped-events.ts`，已改用仓库真实命令并通过。
- `./node_modules/.bin/tsdown --env.DSH_BUILD_FACE host` 针对 session、agent、session-persistence-jsonl、session-query、workspace、client-file-upload、organization-context、organization-connection 和 desktop-host 九包构建通过；最后上下文修改后重建 context/desktop-host。`node apps/desktop-host/tests/organization-context-built-smoke.mjs` 在普通 Node 与 Electron Node mode 验证隔离、落盘、重开和离线拒绝；原有 `organization-built-smoke.mjs` 和 `organization-integration-built-smoke.mjs` 两组 Node/Electron smoke 同样通过。
- 非通过项：`gen-config-catalog.ts` 仍被未修改的 organization-api `./tls.ts`、organization `./schema.ts` 本地 schema 导入解析两项阻塞；本次 Config.root JSDoc 已补齐。`gen-cordis-catalog.ts` 的新增 ContextRequest/Authority/Result 和 service page 映射已补齐，剩余既有类型映射问题仍未通过。只同步本次接口拥有的 README/设计/架构，不把全仓生成器计为通过。

同步计划、overview、架构、WorkGraph 设计和相关包 README；诊断只记 operationId、revision、generation、prepared/committed/reconcile-required/denied，不记正文。没有页面、Playwright、模型 API、全仓测试、完整发行构建、自动 commit/push 或部署。GUI 和用户可见验收留 Phase 7–8。已达 Phase 6 停止点，恢复 manual，不开始 Phase 7。

## Phase 7：共享项目任务工作台

目标：用少量明确入口让用户管理计划和查看获准任务。

预期文件：`ui-organization/src/client` 新任务列表/树、详情及编辑组件、locale、样式与纯交互测试；保持现有账号/服务设置入口。

验收清单：

- [ ] 项目进入任务列表；单任务可创建/编辑，复杂计划展示树和依赖摘要；不建设可拖拽流程画布。
- [ ] 详情显示目标/范围、版本、建议责任人、下发人、验收要求与可用动作；明确“尚未下发”，不显示虚假的运行/完成数据。
- [ ] 保存失败保留本地草稿与幂等键；版本冲突要求刷新/重新确认，不覆盖远端；离线、无权限和资料失效有明确文案。
- [ ] 任务管理授权与读取分别展示；员工只能查看已授权内容；本人上下文入口经过原生动作，普通发送入口不可用。
- [ ] 组织/账号切换清理旧任务详情、草稿及在途响应；个人 Project/Bot 双入口仍正常；所有产品文案走 typed locale。

助理验证：状态投影、纯交互、注册/组合测试、Host/Client 编译及局部 lint；不启动页面、不运行 Playwright。用户检查：任务详情阅读、键盘操作、窗口布局和只读提示，记录为待验，不自动阻塞后续无页面集成。依赖：Phase 6。

实际完成：未开始，执行后填写。

## Phase 8：无页面集成与交付

目标：验证跨进程真实链路，交付用户可执行的三机准备流程。

预期文件：`apps/desktop-host/tests/organization-workgraph.spec.ts` 与必要 built smoke；新建 `docs/organization-workgraph-acceptance.md`，同步设计、相关包 README、overview 和 roadmap 状态。

验收清单：

- [ ] 从真实 Loader/私有组织进程开始，用两个身份完成单任务创建、版本编辑、授权读取、本人上下文绑定、撤权、重连和重开；测试直接检查数据库和 Session 持久结果。
- [ ] CSV 多阶段计划证明依赖/父完成隐环拒绝及可见子树裁剪；隐藏内容哨兵不出现在 API、搜索、事件、快照、日志和他人上下文。
- [ ] 新 schema 的停服备份/恢复保留任务与权限，恢复后旧 token 失效；未知新格式拒绝且原数据保留。
- [ ] 真实构建产物在普通 Node/Electron Node mode 无窗口验证；必要发行依赖和入口检查通过，未增加组织 Agent 或第二种产品入口。
- [ ] 验收剧本明确三个设备、账号、项目与任务 grant、预执行只读、故障预期，以及尚未提供批准/委托/执行；既有三机检查仍保持待验，不能据此宣称闭环已完成。

助理验证：相关聚焦测试、发行构建和无页面产物 smoke；报告实际命令、失败/跳过及影响。用户检查：真实三机、macOS/Windows 可见交互与安装运行，由用户决定时间，不自动恢复已取消的旧安装验收。依赖：Phase 7。完成后停止；下一产品阶段是 roadmap Phase 6，需另行制定/确认实施范围。

实际完成：未开始，执行后填写。

## 验证与关键链路日志

以下是**执行期检查要求，不是本次已运行结果**：

- 每阶段运行 `pnpm exec vitest run <实际涉及的测试文件>`、`pnpm exec tsc -b <实际 Host/Client 编译面> --pretty false` 和局部 lint。新测试文件创建前不报告为已存在/已通过；不默认运行全仓 suite。
- 根据改动运行 `verify-export-jsdoc`、`verify-scoped-events`、`verify-client-ui-i18n`、`verify-application-entrypoints`、`verify-cordis-config`、依赖/包/paths 门禁；提取新包时核验 manifest、source paths、生成目录与发行闭包。
- Phase 8 运行 `pnpm run build`，再运行实现中新增/扩展的 built smoke；保留既有 `organization-built-smoke.mjs`、`organization-integration-built-smoke.mjs` 的相关回归。不在没有新证据时重复已通过检查。
- 新不变量只覆盖确有两个独立观察会漂移的关系；若不需要 companion，在包 README 说明由同一权威推导的原因，不增加空检查。适用关系必须接入实际执行的顶层 gate。
- 代码提交不是本计划默认动作；若另获提交授权，提交前手动 `git diff --cached --check`。文档/代码改动均检查 `git diff --check`。历史门禁失败要按当前结果复核，不能把旧记录直接当本次豁免或通过。

| 链路 | 长期保留的诊断事实 | 所有者 |
| --- | --- | --- |
| 任务写入/授权 | operationId、组织/项目/任务 ID、expected/current revision、结果与 decisionCode；只在提交成功后记 committed | 组织领域 `ctx.logger`，沿用 `organization` 前缀，增加 `component=workgraph` |
| HTTPS 到原生连接 | 请求动作、关联操作 ID、错误分类、snapshot-required、连接代次失效；不记成功轮询 | API/连接使用既有 logger；原生侧沿用 `organization component=...` |
| 上下文绑定 | 绑定操作 ID、任务版本、身份代次、prepared/committed/reconcile-required/denied；不把 Session 原文放入日志 | 本机上下文所有者；必要 ID 仅本机保留 |
| 撤权/切换/恢复 | 授权版本变化、缓存失效、拒绝原因、迁移开始/完成/失败与备份校验结果 | 对应权威和进程所有者 |

不得记录密码、token、证书私钥、个人路径、任务正文、聊天、附件正文、完整请求/响应或未经授权的任务名称。拒绝日志不能将猜测资源的正文带出。关键日志供排障使用，不充当业务事实或权限来源；不增加高频心跳、逐节点遍历或 UI render 日志。跨存储绑定的状态必须持久化，不能只靠日志恢复。

## 执行规则

- `execution mode: manual`
- `automatic start phase: none`
- `automatic stop phase: none`
- `conversation relay: off`
- 计划评审状态：用户 2026-09-27 明确授权“请自动完成phase5-6”；本次 auto_until Phase 5–6 已完成交付核验，恢复 manual，不进入 Phase 7。
- 使用的 Skill：`/Users/git_local/dev-workflow-skill/SKILL.md`；工作目录：`/Users/git_local/Merforge`。本计划是后续执行入口，暂不创建专用 executor skill。

1. 执行前读取本文、overview、相关 AGENTS、架构、防御模式与测试政策；优先复核 `blocked` 阶段的解除条件，未解除时不得跳过依赖。
2. `执行 Phase X` 仅执行该内部阶段，即使持久模式是自动也不继续其他阶段；`继续` 在 manual 下选择首个 in_progress，否则首个 pending。依赖未完成且无法安全隔离时报告依赖，不冒进。
3. 默认计划评审门禁：创建计划不代表批准 Phase 1；只有计划创建后的明确执行指令，或明确跳过评审指令，才开始实现。
4. 用户审阅后明确要求“自动完成剩余阶段”才启用 auto；要求“自动做到 Phase X”或有界数量才启用 auto_until。先核验状态/依赖和范围，记录用户原话、授权日期、模式与边界，再执行。auto 和 manual 的两个自动边界均为 none。
5. auto_until 的 start 缺省取首个 in_progress，否则首个 pending；把“前 N 个/再 N 个阶段”换算为表内明确起止，起止都包含。无效范围不改变现有模式。单阶段“执行 Phase 5”不等于“执行到 Phase 5”。
6. 每次自动选择前重读状态、依赖、模式与范围，并将选定阶段标为 in_progress。auto/auto_until 按授权连续执行，不因一阶段结束或非阻塞用户可见检查而询问是否继续。
7. 未解决的重大产品选择、必要人工结果、外部权限、无法安全修复的验证失败才记 blocked，并写明解除条件；自动模式及范围保留，用户撤销授权时例外。仅涉及 UI 观感的待验项目通常非阻塞，不由助理开启页面补验。
8. 阶段确实过大或无法安全验证时，先更新该阶段为最小有用子阶段（通常 A/B）、状态表、依赖和验收，再施工；不为了整齐预先层层拆分，不改无关已完成阶段。auto_until 指向原阶段时，以最后子阶段为止；明确指定子阶段则按指定停止。
9. 每阶段完成后在该阶段实际完成区记录文件、实际检查、跳过、偏差、风险和下一阶段，同步唯一状态表与 overview。工程 completed 不代表用户产品验收已通过。manual 模式此时停止。
10. auto_until 范围全部完成且必要交付核验完成后，恢复 manual、两边界清为 none，记录已达停止点，不选择后续阶段；已完成范围不重复运行。若以后启用 worktree relay，交付未核验时保留模式和范围，不把实现完成当成交付。
11. relay 当前关闭，不自动新建任务或委派子 Agent。仅用户针对本计划明确授权后，读取 Skill 的 `references/conversation-relay.md`；如使用 worktree，再读 `references/worktree-return.md`，补齐批次/交接/所有权/回归和交付字段后启用。缺字段不能擅自接力。
12. 本计划完成后不得自动进入 roadmap 产品 Phase 6、7A 或 7B；自动授权只覆盖本表范围。不自动 commit、push、部署、接入外部服务或改写许可。
