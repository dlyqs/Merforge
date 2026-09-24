# 个人任务增强、任务结构与同机接力执行计划

本文细化[产品路线图](../ai-native-work-os-product-roadmap.md)的产品 Phase 3。本文 Phase 1–7 是该产品阶段内部的施工顺序，不对应路线图同号阶段。后续在本任务中说“继续”或“执行 Phase X”，先读本文；不续跑其他计划。

## 目标、现状与可行性

目标：用户在 Project 普通对话或 Bot 对话显式选择“任务增强模式”后输入目标。简单目标沿用普通 Agent 行为；复杂目标经过消除歧义、可行性评估、任务拆分与阶段划分，生成可审核、持久化、可视化的任务实体。用户可以在对话输入框的下拉菜单或“＋”菜单中选择可执行子任务，为不同子任务分别打开执行对话并行工作，也可以将同一子任务接力到新对话，保留计划版本、上下文和成果证据。

2026-09-25 根据用户对齐修订：先建设 Task 架构、父子树、依赖图、持久化与基础可视化，再接入内置 Skill。多个对话分别执行不同子任务是本期并行方式；本期不建设自动调度，包括自动挑选其他任务、分配 Agent 或创建执行对话。任务选择入口放在对话输入框的下拉菜单或“＋”菜单，按任务状态过滤可选项。最初重排时所有施工阶段尚未开始；2026-09-25 用户授权后 Phase 1–2 已完成，实际证据见下文。

2026-09-24 对照基线 `8c38b86` 的静态核查：

- `packages/workspace/personal-project/src/{types,index,projection,runtime}.ts` 已实现个人对象、归属投影及运行时配置，`packages/client/ui-personal` 提供双入口。它们不是空的界面壳，但尚无跨 Session 任务状态。
- `packages/skill/skill` 支持注册内嵌 Skill，`packages/skill/tool-skill` 承担加载及模型可见记录；当前 packages/apps 搜索未发现 dev-workflow 的内置实现。
- `packages/api/session-controller` 有 Session 创建、恢复及 fork 能力；这些接口本身不提供任务级审核、接力所有权或交付核验。
- 当前 `packages/bundle/web-app/presets/standard.patch.yml` 保留 Todo、Skill、文件/shell、subagent、提问等能力；当前代码树没有 Goal、Plan Mode 包。旧概览和基础裁剪文档的保留声明不能作为复用证据。
- 个人模式计划记载代码与自动化检查已完成，也记录过无关 GUI 测试失败；本轮没有重跑或将旧记录视为本轮通过证据。基础裁剪收尾继续由原计划负责。

可行性：可以在现有 Cordis、Session、存储和 Desktop 内部 API 上实现，属于跨持久化、执行控制和 Client 的大型目标。难点是多记录提交、取消与接力竞态、崩溃后副作用不确定性，以及 Skill 方法和实际授权的一致性。不能通过复制提示词或自动 fork 即宣称完成。先做个人、单设备的任务数据与用户发起的多对话执行闭环，不提前搭建完整组织 WorkGraph 或自动多 Agent 调度系统。

歧义检查：用户已明确任务增强入口、简单目标透传、复杂目标实体化，以及由用户开对话选择子任务的并行方式。下述范围据此确定；执行中若出现影响这些行为的重大歧义，先澄清再实现。

## 范围与约束

范围内：任务增强模式；Task 实体、任务树与依赖图；结构化持久化、计划版本与审核；任务/依赖可视化；内置版本化方法及简单/复杂分流；用户为子任务选择或创建执行对话；manual/auto/auto_until；执行证据与进度汇总；同设备、同工作区接力及重启核对。

范围外：自动任务选择、Agent 分配和执行调度、自动工作区隔离/合并、通用资源冲突检测与全局文件锁、组织账号/内网服务/分配审批、多人并发 WorkGraph、跨设备或跨 worktree 自动集成、外部 Agent 新适配器、自动学习记忆、后台定时唤醒、新模型供应商、自动发布及安装包验收。下一产品阶段仍是路线图 Phase 4 的组织服务与身份授权。

- 用户显式选择任务增强模式后才启用目标评估流程；关闭时保持普通 Agent 行为。开启后简单目标也沿用普通执行，不强制创建 Task、计划或审核；复杂目标先澄清和评估可行性，再生成任务提案。模型不能自行启用模式或批准计划，没有 Bot 也能完整使用。
- Project 是归类对象，Bot 是配置；新增个人任务用独立品牌化 TaskId，关联多个 Session 和可选 Project/Bot。任务关联不能跟随会话移动悄悄变化；运行中发生归属、目录或权限变化时暂停并核对，不能扩大执行范围。
- 应用内结构化计划和持久运行记录是权威；Markdown 是导出视图，编辑导出文件不自动改写批准状态。**本文是开发施工计划的权威**，两者用途不同。
- 审核绑定准确计划版本；计划范围/验收/依赖变更形成新版本并使受影响批准失效。阶段用于审核和推进边界；阶段内允许多个无前置关系的任务并列。父子关系不代表执行顺序，依赖关系独立保存；不以列表顺序制造依赖。
- 默认 manual；生成计划不执行，批准计划不默认开启连续执行。auto/auto_until 需独立、可追溯的用户授权，停止位置、阶段数和资源限制由程序检查。推进范围只绑定用户明确选择的当前任务及其获准阶段；不自动领取子任务、挑选其他就绪任务或创建执行对话。auto/auto_until 仅控制当前任务内阶段的继续和停止，不承担任务调度；依赖未完成时显示等待。
- 每个可执行子任务最多有一个当前执行对话，但保留多个历史对话/Run；不同子任务可由用户在不同对话同时执行。全局计划锁只用于版本提交，不得作为整个目标的独占执行锁。阅读任务不等于领取，打开新对话不等于立即开工。
- 对话输入框下拉/“＋”中的任务选择列表只暴露当前可执行的任务：批准有效、前置满足、未被其他会话占用，且状态允许开始或明确恢复。草稿、待审核、依赖阻塞、运行中、已完成、已取消及待核对任务不作为新执行候选；恢复和接力走显式动作。最终状态枚举及筛选映射由 Phase 1 定稿。任务视图仍可展示全部状态；列表过滤不能代替 Host 在选择/开始时重新校验，候选失效时刷新列表并反馈原因。
- “可并行”表示业务依赖允许同时推进，不宣称文件或资源自动隔离。展示任务声明的工作目录、产物范围与已知重叠；用户协调共享文件，遇到已知冲突先处理。不同子任务的正常产物变化不自动令整个计划失效；接力核对按关联基线/产物定位变化，无法归因时仅暂停受影响任务。
- 首版接力限定同一客户端及同一工作区，保存实际 cwd、Git HEAD（有 Git 时）、脏文件指纹和交付位置；非 Git 工作区也必须有资料/产物版本核对。工作区变化进入待核对，不能自动覆盖用户文件。
- 不假装暂停可回滚已发生操作；重启不盲目重发 shell 或外部动作。旧执行者失去所有权后不得再获得新动作许可；仍在途的动作必须收敛或明确标记未知后才移交。
- 遵守现有工具审批、Bot allow list 和沙箱。Skill 被 Bot 禁用时明确提示，不能绕过许可。任务审核不是对所有工具操作的一次性授权。
- 新增行为走插件扩展点；模型可见计划、审核结果和交接内容须能由 Session 日志重建。记录存储格式及兼容策略，SQLite 变更才递增相应 schema；不为新增事件机械提高 Session 结构版本。
- Electron 唯一产品入口；新增 UI 文案归本地化字典。禁止助理启动页面、Playwright、浏览器自动化或 GitNexus。助理只做静态检查、构建和无页面的逻辑/Host 测试，可见验收交给用户。

## Task 数据与来源

以下是必须覆盖的逻辑数据，具体字段和存储提供者由 Phase 1 对照现有服务定稿；不预先要求每项各建一个 package 或数据库表。

| 数据 | 职责与最少内容 |
| --- | --- |
| Task | 稳定 TaskId、目标、范围、验收条件、产物声明、状态、所属计划；根目标和子任务都有独立身份 |
| 任务树 | parentTaskId 表达拆分层级；同一计划内单父节点、无环；父节点按必要子任务及自身验收汇总 |
| 依赖图 | dependsOn 引用必须先完成的任务；与父子树分开，禁止循环、失效引用及违反父子完成规则的依赖 |
| Phase | 可审核的阶段和推进边界，包含任务；阶段内可有并列分支，阶段排序与有效执行依赖须一致 |
| PlanRevision / Approval | 保存某版任务树、依赖、阶段、验收及批准记录；修改生成新版本，执行引用确切版本 |
| TaskSession / Run | 任务与会话的角色/历史关联、当前执行所有者、执行尝试及结果；规划对话与子任务执行对话可分离 |
| Evidence / Handoff | 产物与验证引用、交付位置、接力包、上下文及工作区基线；不复制全部聊天充当任务定义 |

来源链：用户目标及澄清 → 模型提出结构化任务方案 → 程序校验 → 用户查看/修改/批准 → 持久化版本 → 视图与执行对话读取。模型负责建议拆分和依赖；程序负责校验、保存、就绪计算和批准约束。Markdown 从同一版本导出，不成为第二个可独立写入的状态源。

树视图展示“拆成什么”，依赖视图展示“先做什么、哪些可同时做”，详情展示定义、证据和关联对话；均读取同一数据。首版可用树形列表加依赖连线/并列分支，不要求复杂拖拽画布。无依赖不等于已获准执行：就绪还需批准有效、前置完成且未被其他会话领取。

## 唯一阶段状态表

| 阶段 | 主题 | 主要目标 | 状态 | 实际产出 | 备注 |
| --- | --- | --- | --- | --- | --- |
| Phase 1 | Task 架构与交互设计 | 定稿树、依赖、状态、存储及视图 | completed | `docs/personal-workflow.md` | 语义及真实扩展点已核对 |
| Phase 2 | 任务数据与持久计划 | 实现任务结构、版本、审核及读写接口 | completed | `personal-workflow`、Session Remote、持久化与测试 | Phase 3 可开始；既有全仓门禁问题见实际完成 |
| Phase 3 | 基础任务可视化 | 查看/修改/审核任务树及并列分支 | completed | `ui-personal-workflow`、双入口、审核/修改/导出 | 可见验收待用户检查 |
| Phase 4 | 内置任务增强模式 | 简单目标透传，复杂目标生成结构化计划 | completed | `skill-dev-workflow`、模式开关、评估/提案工具及持久日志 | 作者授权已记录；可见/真实模型验收待定 |
| Phase 5 | 子任务对话与执行 | 用户绑定对话、并行执行与进度汇总 | completed | TaskRun、领取/控制 Remote、工具约束、证据及输入框选择器 | 可见验收待用户检查 |
| Phase 6 | 同机接力与恢复 | 子任务跨会话接管及重启核对 | completed | 持久交接、接收者幂等创建、所有权转移、恢复与故障测试 | 构建与产物测试通过；可见验收待用户检查 |
| Phase 7 | 集成验证与收尾 | 验证拆分、并行对话、依赖汇合与接力 | completed | Desktop Host 无页面组合测试、验收剧本及文档同步 | 实现与自动化完成；可见/真实模型验收待定 |

## Phase 1：Task 架构与交互设计

目标：先定义 Task 的业务语义、数据来源、持久化和展示方式，再接入 Skill。

预期输出：新增 `docs/personal-workflow.md`，记录上述数据、状态迁移、API、视图结构及调用链；核对 storage、session-controller、Agent 扩展点和 Desktop 组合。拟新增实现区 `packages/workspace/personal-workflow`、`packages/client/ui-personal-workflow`、`packages/skill/skill-dev-workflow`，名称及职责在此阶段核定，未创建前不当成现有模块。

验收清单：
- [x] 区分任务树、依赖图、阶段边界、计划版本和执行尝试；给出分叉/汇合样例与就绪、阻塞、完成聚合规则。
- [x] 明确持久化提供者、唯一写入服务、模型工具及 Host/Client 消费者，Session 引用和跨存储失败的对账顺序。
- [x] 定稿任务增强模式的作用范围、简单目标透传、复杂目标审核，以及任务树/依赖视图和输入框下拉/“＋”任务选择的交互；给出每种任务状态的候选可见性与操作映射。
- [x] 定稿任务级领取、版本比较、幂等键、停止范围和接力所有权；不同子任务允许同时有执行者。
- [x] 定稿项目/Bot 删除、会话移动/归档、任务改版和权限变更的处理；完成依赖真实证据，不以 Agent idle 或自述代替。

助理验证：阅读相关 AGENTS.md、存储文档和 defensive-patterns，核对真实扩展点；用样例推演层级、依赖、两对话领取和汇合，不启动页面。用户检查：审阅任务视图和语义，只有重大未定选择才提出必要问题。依赖：无。

实际完成：2026-09-25 新增 `docs/personal-workflow.md`。已阅读架构、包约束、存储 Domain/KvTable、JSON provider、Session controller/projection、工具注册和 Desktop web-app 组合，静态推演分叉/汇合、隐含完成环及独立任务所有权。采用单计划聚合原子提交、全版本审核；Phase 5–6 协议仅定稿未实施。未启动页面；下一阶段 Phase 2，按本次授权自动继续。

## Phase 2：任务数据与持久计划

目标：实现独立于聊天文本的任务实体、树/依赖、版本化计划和审核。

预期输出：个人工作流领域类型、存储/投影、Remote 读写/模型提案接口、Markdown 导出及聚焦测试；`packages/api/session-controller` 必要引用接入。

验收清单：
- [x] 保存 Task、父子关系、依赖、阶段、验收和产物；解析边界拒绝失效引用、跨计划依赖、层级/依赖循环和不可满足的完成关系。
- [x] 从数据计算就绪任务、可并列分支、阻塞原因和父任务汇总；不以兄弟节点顺序强制串行。
- [x] 提议和批准分离；用户修改保存新版本，旧批准不能启动受影响任务，重复请求不重复写入。
- [x] Session 引用稳定 TaskId/计划版本；模型读取的快照可从日志重建；真实存储重开后保持一致。
- [x] Markdown 导出与结构化版本一致；提交失败不呈现虚假成功，版本冲突不覆盖其他有效更新。

助理验证：真实存储重开、依赖分叉汇合、版本冲突、幂等审核、日志重建及 Remote 链路测试，相关类型/JSDoc/事件门禁。用户检查：可见检查在 Phase 3 提供。依赖：Phase 1。

实际完成：2026-09-25。

- 文件：新增 `packages/workspace/personal-workflow`（品牌化身份、完整定义解析、树/依赖有效性、并列就绪投影、版本与审核、幂等回执、真实存储、Session 快照、Markdown 导出）。`session-controller` 新增六个工作流 Remote；`web-app` 挂载服务并声明发行依赖。同步类型路径、Host 编译引用、lockfile、Session 已知事件/持久化目录、README、格式状态和 overview。
- 真实验证：`pnpm exec vitest run packages/workspace/personal-workflow/tests packages/api/session-controller/tests/personal-workflow.host.spec.ts` 最终 21 项通过；此前连同 `packages/api/session-controller/tests/controller.host.spec.ts` 共 26 项通过（含 6 项现有 Controller 回归，之后新增一项 Session append 失败恢复测试）。覆盖 JSON/JSONL 重开、分叉汇合、父节点证据、隐含完成环、并发改版、幂等/过期审核、提交与审核写失败、append/flush 失败重试、历史快照重放、真实 Gateway 调用。
- 静态检查：`pnpm exec tsc -b packages/workspace/personal-workflow packages/api/session-controller/tsconfig.host.json --pretty false`、`pnpm exec tsx scripts/run-oxlint.ts packages/workspace/personal-workflow packages/api/session-controller/src/index.ts packages/api/session-controller/tests/personal-workflow.host.spec.ts`、`pnpm run verify-export-jsdoc`、`pnpm run verify-scoped-events`、`pnpm exec tsx scripts/gen-persistence-catalog.ts --check`、`pnpm exec tsx scripts/verify-cordis-config.ts`、`pnpm exec tsx scripts/verify-package-dependencies.ts`、`git diff --check` 通过。
- 构建：首次 `pnpm run build` 在 Host bundling 达到默认约 4 GB Node 堆上限；`NODE_OPTIONS=--max-old-space-size=8192 pnpm run build` 重试通过。最终生命周期细节修改后又执行 `pnpm exec tsdown --env.DSH_BUILD_FACE host --filter @deepseek-ai/dsh-personal-workflow` 聚焦打包通过。`node packages/workspace/personal-workflow/tests/built-smoke.mjs` 通过，验证 built Loader、生成 Remote codec、JSON/JSONL 重开；无页面。
- 既有全仓问题（未修改相关文件，也未计为通过）：`pnpm run verify-package-invariants` 报 `ui-personal`、`session-format-catalog`、`session-format-current`、`session-format` 四份 README 缺少规定格式的不变量说明；`pnpm exec tsx scripts/check-workspace-constraints.ts` 报既有 `personal-project/package.json` runtime files 清单；`pnpm exec tsx scripts/verify-no-unknown-casts.ts` 报 `commands-create-fork.host.spec.ts` 两个已退休 baseline 项需清理。新增包不在这些报错中，本次未新增 unknown cast。
- 范围：模型提案接口为 `propose(session, request)`，模型工具/模式和 Skill 在 Phase 4 接入，普通 Agent 能力未改变。Run/Evidence 真实执行写入、领取和接力仍分别在 Phase 5–6；Phase 2 不制造执行记录。采用完整版本重新审核，历史保留且不自动压缩。无浏览器、Playwright、GitNexus、subagent 或真实模型调用；可见检查留到 Phase 3。
- 已到达授权终点 Phase 2，恢复 manual、清空自动边界。下一建议阶段 Phase 3，本次不自动执行。

## Phase 3：基础任务可视化

目标：先让持久任务可查看、可修改和可审核，为后续模型生成提供真实消费端。

预期输出：`packages/client/ui-personal-workflow`（拟新增）、`ui-personal` 必要入口、Client Remote 接入、字典和纯逻辑测试、web-app 组合。

验收清单：
- [x] 树视图与依赖展示读取同一计划；清楚呈现并列分支、前置任务、阶段、状态和阻塞原因。
- [x] 任务详情展示目标、范围、验收、产物及计划版本，提供修改/审核和 Markdown 导出；依赖不合法有明确反馈。
- [x] 明确区分计划批准、任务可执行和正在执行；阶段或父任务进度由真实子任务状态汇总。
- [x] 提供关联对话展示位置；执行入口尚未接通时不伪装可用，不创建虚假的执行记录。
- [x] 使用本地化文案，Project/Bot 双入口不复制任务；测试数据不作为产品默认生成结果。

助理验证：树/依赖投影、并列布局输入、审核状态及失败反馈的纯逻辑测试，相关类型检查、本地化门禁和前端构建。用户检查：树层级、并列分支及审核交互；可延后综合验收，不由助理打开页面。依赖：Phase 2。

实际完成：2026-09-25。新增 `packages/client/ui-personal-workflow`，通过 ui-personal 的子槽位展示同一份 Project/Bot 计划；树、阶段并列分支、依赖与阻塞、任务详情、父任务/阶段进度、声明产物重叠和关联规划对话均读取同一 Host 版本。支持修改任务字段/父节点/依赖/阶段及阶段名称、准确版本审核和 Markdown 下载；失败保留草稿与幂等键，不提供执行按钮。新增包、Client aggregate、bundle 和 lockfile 已接入。

检查：`pnpm exec tsc -b packages/client/ui-personal-workflow --pretty false`、`pnpm exec vitest run packages/client/ui-personal-workflow/tests packages/client/ui-personal/tests/personal-sidebar.client.spec.tsx`（最初 11 项）及新增 `review.client.spec.tsx`（1 项）、`pnpm exec tsx scripts/verify-client-ui-i18n.ts`、`pnpm --filter @deepseek-ai/dsh-client-ui-personal-workflow bundle` 通过。测试覆盖实际 Client roster 注册、双入口身份、树/依赖和失败重试/新版本批准；修复工作流类型文件从 Host 入口引入 SessionId 的 Client 编译污染。未启动页面；完整发行构建和最终静态门禁在 Phase 4 集成后执行。可见检查待用户验收，不阻塞授权范围内继续 Phase 4。

## Phase 4：内置任务增强模式

目标：用户选择模式并输入目标后，内置方法将复杂任务转为 Phase 2 的数据，直接呈现在 Phase 3 的视图。

预期输出：`packages/skill/skill-dev-workflow`（拟新增）及 assets、版本/许可记录、托管适配工具、模式入口与 bundle/preset/发行接入。

验收清单：
- [x] 固定上游提交、许可、引用资源和更新方式；资源不依赖开发者机器绝对路径。许可不可确认时阻塞本阶段。
- [x] 用户显式启用模式；关闭时保持普通路径，开启后简单目标也不强制创建任务/计划/审核。复杂度不确定时澄清，不能默默套复杂流程。
- [x] 复杂目标执行消除歧义、可行性判断、任务拆分、阶段划分和依赖分析；不可行时说明条件/替代方向，不直接启动执行。
- [x] 模型区分父子拆分和前置依赖，将可以同时做的工作列为并列分支；通过结构化工具提交，程序校验后保存待审核版本。
- [x] 托管适配不依赖 Codex 桌面工具或模型改写 Markdown 状态；Bot Skill 许可、资源加载和模型可见日志保持现有约束。

助理验证：真实 Loader/Skill 加载与打包检查，确定性模型输入覆盖关闭模式、简单目标、模糊复杂目标、不可行目标、分叉汇合计划和非法提案；相关类型与许可门禁。用户检查：选择模式输入简单/复杂目标，观察普通执行和任务视图分流。依赖：Phase 2、3。

实际完成：2026-09-25。

- 来源与许可：固定 `dlyqs/dev-workflow-skill@4f51803b4578139dd9de2dc690c1d2638c54decd`，包内保存原始 Skill、SHA-256、托管方法 v1 和更新规则。上游无公开许可证；本轮用户确认“我就是 dlyqs，这是我的 skill”，结合明确内置授权记录于 `assets/NOTICE.md`，不替上游声明开源许可。托管方法只依赖包内资源，未接入上游自动开发对话接力。
- 实现：新增 `packages/skill/skill-dev-workflow`，接入标准 preset 和 web-app 发行依赖。Client 输入框提供显式模式开关；`workflowMode/SetMode` 与 Session 模式事件保存用户选择，不提交目标。默认关闭时不注入方法、不展示工作流工具。开启后的每次用户输入记录准确方法、版本和归属；工具续步不重复注入。关闭说明同样记入模型历史。
- 程序约束：`workflow_assess` 保存 simple / clarify / infeasible / complex 路由，前三者不创建计划；`workflow_propose` 只保存待审核版本。旧的无模式模型提案入口已合并，唯一 `propose(session, modeRevision, request)` 在提交队列中核对持久模式、准确版本、当前用户目标后的复杂评估、Bot Skill 许可和归属，再复用图校验。模式写失败不返回成功；相同操作可重试，未完成操作阻止另一个选择越过它。普通工具权限和沙箱保持原有约束。不存在自动执行/批准/任务调度或虚假 Run。
- 持久格式：新增 `personal-workflow/mode`、`personal-workflow/assessment` 和 `personal-workflow-method` 消息来源，同步已知事件、持久目录与机器 schema；未修改 Session envelope 或 SQLite schema 版本。机器目录因消息来源联合类型变化由生成器更新。
- 验证：`pnpm exec vitest run packages/client/ui-personal-workflow/tests packages/skill/skill-dev-workflow/tests packages/workspace/personal-workflow/tests packages/api/session-controller/tests/personal-workflow.host.spec.ts packages/client/ui-personal/tests` 45 项通过。进一步扩充 `loader.spec.ts` 的真实 AgentLoop 脚本，覆盖关闭模式、简单目标、模糊复杂目标、不可行目标、非法提案拒绝后修正、分叉汇合提案及模型可见日志，3 项通过。合并提案入口后 `pnpm exec vitest run packages/workspace/personal-workflow/tests packages/skill/skill-dev-workflow/tests` 26 项通过；保留并更新旧的提交/append/flush 故障恢复测试。
- 静态与构建：相关 Host/Client `tsc -b`、新增包及修改入口的 `run-oxlint.ts`、`verify-export-jsdoc`、`verify-client-ui-i18n`、`pnpm run verify-scoped-events`、`gen-persistence-catalog.ts --check`、`verify-cordis-config.ts`、`verify-package-dependencies.ts`、`verify-client-packages.ts` 和 `git diff --check` 通过。新增 assets 已纳入发布清单规则。第一次完整构建因 Client 先消费旧 Remote 生成物失败；使用真实 Typert generator 更新 Host 接口后，`NODE_OPTIONS=--max-old-space-size=8192 pnpm run build` 通过（含 Desktop 依赖和 Vite 资源，共记录 261 个 Client artifacts）。最后提案接口合并后重跑 Host 类型检查和两个 Host 包的 `tsdown --env.DSH_BUILD_FACE host --filter <package>`；`node packages/workspace/personal-workflow/tests/built-smoke.mjs` 通过，覆盖真实 Loader、模式 Remote codec、JSON/JSONL 重开和包内 Skill 资源。
- 既有全仓门禁：`verify-package-invariants.ts` 仍报告 ui-personal 及三个 session-format README 的说明格式；`check-workspace-constraints.ts` 仍报告既有 personal-project 的 files 清单；`verify-no-unknown-casts.ts` 仍要求清理 commands-create-fork.host.spec.ts 的两项退休 baseline。新增包已无这些报错，本次未增加 unknown cast；这些全仓命令不计为通过。
- 未验证：未启动页面、浏览器、Playwright 或 GitNexus；未启用 subagent。当前环境及根 `.env` 无 `DEEPSEEK_API_KEY`，真实模型分类表现未验。Desktop 的任务树/审核交互和简单/复杂目标可见分流由用户检查；不是实现阻塞。
- 已完成本次授权的 Phase 3–4（含端点），恢复 manual，清空自动范围。下一阶段 Phase 5 的任务选择/执行及 Phase 6 接力未实施，本次不自动推进。


## Phase 5：子任务对话与有界执行

目标：用户新开对话，在输入框下拉菜单或“＋”菜单选择状态允许执行的子任务；不同子任务可同时执行并汇总结果。

预期输出：TaskSession/Run、任务领取服务、上下文加载、执行 guard、控制 API、证据记录，以及 Client 输入框下拉/“＋”任务选择器和返回关联对话入口。

验收清单：
- [x] 在输入框下拉菜单或“＋”菜单提供任务选择器（具体载体沿用现有组件定稿）；按 Phase 1 状态映射只列可执行候选，未就绪/占用/终态等不可执行任务不暴露为可选项。选择后加载目标、必要背景、确切计划版本、验收及前置产物，不复制任务实体。
- [x] 不同就绪子任务可由用户分别开启对话同时执行；同一子任务重复领取被拒绝或引导到当前对话，其他任务不受全局执行锁阻塞。
- [x] 前置未完成的任务可在任务视图查看，但不出现在输入框的可执行候选中；全部必要前置完成后才出现。两个选择器同时展示同一任务时，Host 原子领取仅允许一个成功，失败端刷新候选并反馈原因。
- [x] manual/auto/auto_until 只控制用户所选任务内的获准阶段，到界停止；不自动选择下一任务、领取子任务、派生 Agent 或创建对话。可执行列表更新不触发执行。
- [x] 工具入口核对批准、版本、任务执行者和现有权限；取消阻止新增动作，其他子任务可继续；在途结果分别记录。
- [x] 证据与产物归属具体 Task/Run；父任务还需自身验收/集成证据，不能因所有对话 idle 就完成。显示工作目录与声明的产物重叠，不声称自动隔离或合并文件。
- [x] 无目录时先明确执行目录；阶段数/时长/预算等 tunable 通过 Config 校验，不因多对话重复获得同一授权预算。

助理验证：真实工具路径和两 Session 确定性夹具，验证任务状态与候选可见性映射、候选失效竞态、不同子任务执行区间重叠、重复领取拒绝、依赖阻塞/释放、汇合、取消隔离和停止边界；读取真实产物而非模型自述。用户检查：在两个新对话的输入框下拉/“＋”中分别选择独立子任务并运行，确认不可执行任务不出现在候选中；前置完成后汇合任务出现，由用户另行选择执行。依赖：Phase 4。

实际完成：2026-09-25。

- `personal-workflow` 在单计划聚合内保存 TaskRun、执行会话历史、动作、证据与幂等回执；同一任务只允许一个执行者，队列仅覆盖短时事务，不持有执行期全局锁。`session-controller` 提供候选、领取、限制、状态、暂停、取消与恢复 Remote；模型没有这些用户授权入口。
- `skill-dev-workflow` 在真实工具流水线重新核对批准/版本/归属/目录/许可，持久记录动作后才派发。当前任务的准确计划、前置证据和执行范围通过 `personal-workflow-execution` 消息进入 Session 历史。`workflow_complete` 只接受已成功且写入日志的动作，并实际读取声明文件；未知动作、缺失产物或验收项未覆盖不能完成。父任务仍需独立证据。
- 输入框使用现有 `conversation.input.left` 承载任务下拉和授权弹窗。候选只显示就绪任务，领取失败刷新候选；manual 默认，每轮暂停；auto/auto_until 只继续所选 Task，使用其唯一 phaseId 作为停止边界。动作数、推进轮次、总时长与文件读取上限均由 Config 控制，Client 读取 Host 上限。绑定不发送消息。
- 任务详情显示真实执行进度、证据和历史对话。工作目录采用真实路径比较，避免 macOS `/var` 与 `/private/var` 别名误判。已声明的共享产物仍由用户协调；没有自动隔离、合并或跨任务调度。
- 验证：相关 Host/Client `tsc -b` 通过；聚焦 Vitest 46 项通过（覆盖工作流、Skill、Session Remote、Client 纯交互；其中包含为后续接力已编写的故障用例）。真实 AgentLoop + Loader 测试证实并列任务工具执行区间重叠、产物可读取、汇合任务释放及自动推进到预算停止。局部 lint 最终收尾和完整构建与 Phase 6 一并执行。
- 未启动页面、浏览器、Playwright、GitNexus 或 subagent。Desktop 可见验收由用户完成。按用户“请自动完成 phase5-6”授权继续 Phase 6，不进入 Phase 7。

## Phase 6：同机接力与恢复

目标：同一个子任务从旧对话转给新对话，与不同子任务并行执行明确区分；重启后能核对执行状态。

预期输出：Handoff 持久记录、任务级所有权转移、Session 创建与上下文注入、恢复服务、Client 接力/恢复入口和故障注入测试。

验收清单：
- [x] 交接含 TaskId、计划版本、定义/决定、必要前置产物、代码基线、证据、待办、授权范围及源/目标 Session。
- [x] 先持久化交接包，再幂等创建接收 Session；覆盖创建前、创建后未回写、移交后未唤醒崩溃，每个被移交任务最多一个有效执行者。
- [x] 核对版本、工作区和许可；旧执行者的在途动作收敛后移交，新增动作被拒绝。其他子任务的有效对话不因本任务移交而停止。
- [x] 重启不盲目重放未知副作用；关联基线或产物变化无法确认时显示待核对，提供人工恢复入口。
- [x] 保留原推进范围、停止位置及预算；重复接力不重复执行，到界后不创建下一条对话，历史证据仍可查。

助理验证：真实存储/Session/工具链故障注入，核对所有者与文件效果，覆盖权限收紧、并行兄弟任务和重复恢复。用户检查：将一个子任务接力到新对话、重启并查看任务与对话关系。依赖：Phase 5。建设产品接力不等于启用本次开发任务的新任务自动接力。

实际完成：2026-09-25。

- `personal-workflow` 的 execution types/schema/service 与 workspace-baseline 保存 TaskId、RunId、计划版本、源/目标 Session、定义快照、上下文/决定/待办、前置证据、授权和原预算。交接包先落盘，接收者身份固定后幂等创建；在途动作收敛后才转移 epoch，旧执行者不能取得新动作许可，兄弟任务所有权不受影响。
- Session Controller 接入接收者创建和重试；`skill-dev-workflow` 记录可重建的执行输入并约束工具许可、完成证据和自动推进；Client 提供暂停、取消、核对、恢复和接力，重新挂载后可重试已经准备好的交接包。接收对话保持暂停，须显式恢复并发送消息才执行；这是避免未知副作用重放的明确实现选择，不自动唤醒或调度下一任务。
- 重启将未完成运行标为待核对；未知动作不会重发，也不能充当成功验收证据。核对真实目录、Git HEAD/脏文件和产物指纹，非 Git 工作区要求资料/产物引用；无法归因的变化仅阻止受影响任务。移交保留开始时间、推进范围和计数，到预算边界不预留接收对话。
- 聚焦验证：`pnpm exec vitest run packages/workspace/personal-workflow/tests packages/skill/skill-dev-workflow/tests packages/api/session-controller/tests/personal-workflow.host.spec.ts packages/client/ui-personal-workflow/tests` 通过 13 个文件、52 项测试。覆盖真实 Loader/AgentLoop 工具执行与产物、并行和汇合、权限收紧、迟到结果、Session 创建失败及重试、移交前后崩溃/重开和预算耗尽。
- 类型检查：`pnpm exec tsc -b packages/workspace/personal-workflow packages/skill/skill-dev-workflow packages/api/session-controller/tsconfig.host.json packages/client/ui-personal-workflow --pretty false` 通过。对上述三个实现包及 Session Controller 改动文件执行局部 `scripts/run-oxlint.ts --fix`，最终无 lint 问题。
- 门禁通过：`pnpm run verify-export-jsdoc`、`pnpm run verify-scoped-events`，以及通过 `pnpm exec tsx` 执行的 `scripts/verify-client-ui-i18n.ts`、`scripts/verify-client-packages.ts`、`scripts/verify-package-dependencies.ts`、`scripts/verify-cordis-config.ts`、`scripts/gen-persistence-catalog.ts --check`、`scripts/gen-config-catalog.ts --check`、`scripts/gen-plugin-packages.ts --check`。同步配置/持久化目录、包参考和格式说明；未新增 Session envelope 或 SQLite schema 版本。
- 最终 `NODE_OPTIONS=--max-old-space-size=8192 pnpm run build` 通过（261 个 Client artifacts，Vite 提示大 chunk）；`node packages/workspace/personal-workflow/tests/built-smoke.mjs` 通过，覆盖真实 Loader、生成 Remote codecs、JSON/JSONL 重开、中断动作恢复、移交 codecs 和打包 Skill。`git diff --check` 通过。
- 未启动页面、浏览器、Playwright、GitNexus 或 subagent；未执行真实模型 API 验证，Desktop 可见验收仍待用户检查。本期不实现跨设备/worktree 集成或自动任务调度。Phase 5–6 授权范围已完成，恢复 manual，停在 Phase 7 之前；下一建议阶段为 Phase 7，须另行授权。

## Phase 7：集成验证与文档收尾

目标：验证从任务增强、拆分展示到用户多对话执行、依赖汇合和同机接力的完整链路。

预期输出：`apps/desktop-host/tests` 中无页面真实组合测试、产品验收剧本、package README、`docs/personal-workflow.md`、本计划、overview 与路线图状态更新。

验收清单：
- [x] 简单目标在模式关闭/开启时都无需任务树审核即可普通执行；普通 Project/Bot 会话不回归。
- [x] 复杂示例：CSV 导出目标澄清后形成“接口约定 → 导出实现与独立测试数据准备两个并列任务 → 集成验收”。树、依赖、阶段和审核版本一致。
- [x] 用户给两个并列任务分别开对话，通过输入框下拉/“＋”选择执行；二者可同时运行。集成任务在前置完成前不出现在候选中，完成后出现并由用户选择，不自动启动。将其中一个子任务移交第三条执行对话，旧执行者失效，另一子任务继续。
- [x] 到授权阶段终点后停止；独立读取最终文件及运行检查，保留 Task/Run、批准、接力和交付证据，不能以模型声明代替验收。
- [x] 覆盖依赖环、未就绪、重复领取、过期批准、重启、重复接力、工作区变化和迟到结果；发布组合构建及 built Host smoke 通过，Skill 无本机路径依赖。
- [x] 有独立观察源的运行时不变量接入实际门禁，没有则在 README 说明；真实模型有凭据时按仓库策略检查，无凭据明确未验证。

助理验证：相关 `pnpm exec vitest run <测试文件>`、face typecheck、局部门禁；发行路径变更后运行 `pnpm run build` 及 built Host smoke。具体命令依已有配置选定，只报告实际执行检查，不默认全仓测试或页面自动化。用户检查：上述模式分流、任务可视化、多对话并行与接力的真实 Desktop 剧本。依赖：Phase 6。缺少外部验收时分别记录实现完成与产品验收待定，不虚报全部通过。

实际完成：2026-09-25。用户授权“请继续完成 phase7”；本阶段实现、无页面集成验证与文档收尾完成。上列勾选指自动化及工程交付完成，不代表 Desktop 可见验收或真实模型验收通过。

- 新增 `apps/desktop-host/tests/personal-workflow.spec.ts`：测试用 cordis.yml 经真实 Loader 组合服务、个人配置、Skill、AgentLoop、Session Controller/Gateway 和 JSON/JSONL 存储；仅模型响应为确定性适配器。CSV 案例包含三阶段、接口 → 两并列分支 → 集成 → 根交付，串起澄清、模型提案、准确版本审核、Remote 领取、执行区间重叠、兄弟任务在途时移交、重复移交、旧所有者拒绝、用户选择汇合、真实文件证据和存储重开。CSV 导出由独立 Node 子进程执行，再逐字节读回检查转义及换行。两个附加用例覆盖普通 Project/Bot 在模式关闭及简单目标开启时不创建 Task/Run。
- 修复 `personal-project/tests/loader-composition.spec.ts` 的两条旧夹具：补齐当前要求的真实 JSONL provider 和空工作区列表。首次扩大回归暴露服务未加载，修复后通过；未改变产品行为。
- 新增 [Desktop 验收剧本](personal-workflow-acceptance.md)，更新三个工作流包 README、领域文档、overview 和产品路线图。测试范围明确为无页面 Host 组件组合，并非完整 Electron 进程启动或真实模型自然语言评估。
- 聚焦回归：`pnpm exec vitest run apps/desktop-host/tests/personal-workflow.spec.ts packages/workspace/personal-workflow/tests packages/skill/skill-dev-workflow/tests packages/api/session-controller/tests/personal-workflow.host.spec.ts packages/client/ui-personal-workflow/tests packages/workspace/personal-project/tests packages/client/ui-personal/tests` 通过 19 个文件、79 项测试。随后增强三阶段与完成后重开断言，重跑 `pnpm exec vitest run apps/desktop-host/tests/personal-workflow.spec.ts`，3 项通过。`pnpm exec vitest run packages/storage/storage-domain/tests/invariant.spec.ts` 6 项通过，确认持久/缓存独立观察关系的检查会拒绝不一致。
- 静态检查：`pnpm exec tsc -b apps/desktop-host packages/workspace/personal-workflow packages/skill/skill-dev-workflow packages/api/session-controller/tsconfig.host.json packages/client/ui-personal-workflow --pretty false` 通过。修改的两个测试文件局部 `scripts/run-oxlint.ts` 通过；最终新增测试再次单独 lint 通过。`pnpm run verify-export-jsdoc`、`pnpm run verify-scoped-events`，以及 `pnpm exec tsx` 执行的 `scripts/verify-client-ui-i18n.ts`、`scripts/verify-cordis-config.ts`、`scripts/verify-package-dependencies.ts`、`scripts/gen-persistence-catalog.ts --check` 通过；`git diff --check` 通过。
- 发行验证：`NODE_OPTIONS=--max-old-space-size=8192 pnpm run build` 通过，记录 261 个 Client artifacts，只有 Vite 大 chunk 提示；`node packages/workspace/personal-workflow/tests/built-smoke.mjs` 通过，覆盖发布 JS、生成 Remote codecs、JSON/JSONL 重开、中断动作恢复、接力及可移植包内 Skill。
- 不变量：三个工作流包无第二份独立运行副本，README 已说明不发布 companion 的原因；不新增空 installer。`pnpm exec tsx scripts/verify-package-invariants.ts` 仍失败于既有 ui-personal、session-format-catalog、session-format-current、session-format 四份 README 的说明格式，未计为通过，也不以本阶段完成宣称全仓门禁全绿。
- 待验：环境和根 `.env` 均无 `DEEPSEEK_API_KEY`，未执行真实模型 API；Desktop 可见检查由用户按剧本完成。未启动页面、浏览器、Playwright、GitNexus、subagent 或开发会话接力。产品路线图 Phase 3 的工程实施已完成，产品验收仍待定；未启动组织阶段。当前计划保持 manual，自动边界为 none。

## 关键路径可观测性

Phase 2 记录任务/依赖校验、计划版本提交、批准与拒绝；Phase 3 关联视图操作失败与 Host 记录；Phase 4 记录模式选择、复杂度分流、内置 Skill 加载和提案提交；Phase 5 记录任务领取/释放、依赖阻塞变化、执行启动/停止、guard 拒绝及证据汇总；Phase 6 记录交接准备、接收者创建、所有权转移、恢复核对与未知副作用。

使用仓库现有 logger，稳定标签 `personal-workflow`，字段以 taskId、planRevision、phaseId、runId、sessionId、handoffId、operationId、decisionCode、result 为主。只在关键状态变化记录，避免每 token、轮询或每个成功工具调用刷日志。禁止记录 API key、批准令牌、完整提示词、用户文件正文和大载荷。持久业务事件负责恢复及模型输入重建，日志只负责排障；上述关键记录长期保留，故障注入调试日志仅在测试中使用。

## 后续执行规则

- execution mode: manual
- automatic start phase: none
- automatic stop phase: none
- conversation relay: off
- 最近授权：2026-09-25 用户要求“请继续完成 phase7”；仅执行 Phase 7，现已完成工程验证与文档收尾。计划 Phase 1–7 全部实施完成，Desktop 可见/真实模型验收待定；保持 manual，不启动其他产品阶段。未启用 subagent 或开发会话接力。
- 开发流程 Skill：`/Users/git_local/dev-workflow-skill/SKILL.md`。Phase 1–7 的授权及验证记录保留在各阶段实际完成区。本次授权终点为 Phase 7；产品中的多对话并行不授权开发使用 subagent。

1. 首次计划须评审后另行指示开始。执行前读取本文、overview 和相关 AGENTS.md；“执行 Phase X”当次只运行指定阶段，不触发自动后继任务；“继续”先复核 blocked 的解除条件，再选首个 in_progress，否则首个 pending。依赖无法隔离时停止并说明。
2. manual 完成所选阶段后更新文档、汇报并停止。用户在计划存在后明确连续授权，才可切换 auto 或 auto_until；记录原授权。auto 的两个边界为 none，推进到全部完成或真实阻塞。
3. auto_until 先校验并记录含端点起止；省略起点取当前 in_progress，否则首个 pending；“再做 N 阶段”按主表换算确定终点。“执行 Phase 5”不等于“执行到 Phase 5”。无效范围保留原模式并澄清。
4. 自动选择每个阶段前重读状态、依赖、模式和授权范围，标记 in_progress。不得越过终点或因一个阶段完成而询问继续；已完成阶段不重做。范围全部完成且需要的工作区返回核验完毕后，auto_until 改回 manual，两个边界清为 none，记录到界并停止；交付阻塞则保留模式及范围。
5. 非阻塞人工可见检查记录待验而不自动暂停；重大产品歧义、依赖人工结果、新权限、无法安全修复的验证失败、外部条件或用户中断才阻塞。记录 blocked 及解除条件，不擅自扩大范围或跳过 guard。
6. 只有执行证据表明阶段过大/风险过高/无法验证时才做最小拆分，通常 A/B 两段；先更新主表、详情、验收和依赖顺序，再实施。保持其他阶段编号；原停止阶段默认指其最后子阶段，除非用户明确指定子阶段。
7. 每阶段在自己的实际完成区记录文件、实际检查、跳过项、偏差、风险及下一建议阶段，同时更新唯一状态表和 `docs/overview.md`。不增加重复的全局完成附录，不改写其他计划的历史验收。
8. 本次不创建专用 executor Skill，也不启用自动新任务接力。计划足以作为执行入口；未来用户明确授权开发会话 relay 时，才读取元 Skill 的 conversation-relay/worktree-return 说明并登记其完整交接字段。
