# 当前工程概览

本文记录当前代码结构，帮助开发者定位基础裁剪和后续产品阶段的实现。目标产品见[产品路线图](../ai-native-work-os-product-roadmap.md)，基础裁剪的实际状态见[基础裁剪计划](desktop-agent-foundation-pruning-plan.md)，个人模式进度见[个人项目与 Bot 开发计划](personal-project-bot-plan.md)。Desktop 产品名为 Merforge。个人 Project 与私人 Bot 的 Host 数据、运行时和双入口 Client 界面已实现；个人复杂任务与同机接力的实施记录见[执行计划](personal-workflow-plan.md)，Phase 1–2 已完成：[个人工作流设计](personal-workflow.md)、持久 Task/计划版本、审核及 Remote 已实现，Phase 3 任务视图、修改、审核和导出已实现；Phase 4 的显式增强模式、内置方法、评估及结构化提案也已实现，Phase 5 的任务领取、输入框选择、有界执行与真实证据已实现；Phase 6 的持久接力、所有权转移和重启核对已实现；Phase 7 无页面 CSV 集成验证及文档收尾已完成，发行构建与产物测试通过，可见验收待用户检查；组织 Phase 1–7 已完成隔离设计、独立 SQLite 身份权威、私有 TLS 服务、授权同步、设置/登录 UI、停服备份恢复与发行验证；产品 Phase 4 三机验收待定，WorkGraph 尚未实现。

## 下一阶段计划入口

[组织 WorkGraph 与任务上下文实施计划](organization-workgraph-plan.md)细化 roadmap 的产品 Phase 5，内部 Phase 1–8 均待执行，模式为 `manual`，待用户审阅。本期拟扩展现有组织权威/API/原生连接/Client，复用个人工作流纯图规则，新增任务级授权与本人任务上下文隔离；当前代码尚无这些能力。正式批准、委托和执行仍属于产品 Phase 6–7A，不能从普通聊天入口提前启动。后续在该计划上下文中说“继续”，先读该计划唯一状态表，不续跑已完成的组织基础计划。

## 运行方式与目录

Cordis 插件组合 Agent 运行时。Desktop 是 Electron 外壳，启动私有 Desktop Host，并在窗口中加载打包的前端资源。Host 通过 app-boot 启动自己的 profile，保留内部 Web bundle、本地 Webserver 和认证连接。独立 Web、CLI、headless、SDK、ACP 及 Python 产品入口已移除。Desktop 组合不包含 Office 转换与创建、麦克风、插件市场与检查、Open in App、Schedule、PTC workflow 和 Ralph；标准 Agent preset 保留文件、shell、Skill、subagent、job、Todo。浏览器 guest 仍由 Electron 管理；Agent 浏览器和 computer-use provider 随 Desktop 打包，但默认禁用，需要满足各自运行前提后启用。[依赖闭包记录](desktop-agent-foundation-pruning-closure.json)列出 Desktop package 集合。

| 目录 | 当前职责 |
| --- | --- |
| `apps/desktop` | Electron 主进程、窗口、原生交互、恢复、更新与跨平台打包。 |
| `apps/desktop-host` | 私有 Desktop Node 进程，启动 profile，向 Electron 提供认证地址和 boot injection。 |
| `apps/web` | Desktop 内部前端构建入口和前端测试。 |
| `packages/bundle` | 运行时组合；Desktop 选用 base 和 web-app。 |
| `packages/core`、`packages/session`、`packages/llm`、`packages/fs`、`packages/shell` | Agent loop、工具、事件日志、持久化、模型和本地执行。 |
| `packages/client`、`packages/api`、`packages/host` | Client 插件、Remote/API、Web Host 和资源传输。 |
| `packages/workspace/personal-project` | 独立个人 Project、Bot Profile、Session 归属事件投影及当前运行时配置。 |
| `packages/host/organization-connection` | Electron 原生组织连接、证书信任、身份/组织隔离、事件与回执核对。 |
| `packages/client/ui-organization` | 组织设置、账号/邀请、成员/项目授权与个人/组织入口。 |
| `packages/workspace/organization` | 独立 SQLite 账号/组织/成员/邀请/登录权威，事务回执、审计、限流和恢复；通过 Desktop 私有组织组合启动。 |
| `packages/workspace/personal-workflow` | 持久 Task、独立父子树/依赖图、原子计划版本与审核、幂等回执、Session 快照、Markdown 导出、任务领取、执行预算、证据和同机接力恢复。 |
| `packages/client/ui-personal-workflow` | 任务树、阶段并列分支、详情编辑、准确版本审核、导出、输入框模式开关、任务选择与授权、暂停/取消/恢复和接力入口。 |
| `packages/skill/skill-dev-workflow` | 固定版本的包内方法、模式上下文及受约束的目标评估/提案工具。 |
| `packages/client/ui-personal` | 个人 Project/Bot 双入口、对象编辑、会话移动及归属历史。 |
| `packages/subagent`、`packages/skill`、`packages/interaction` | 基础委派、Skill、用户问题与审批。 |
| `docs`、`scripts`、`snapshots` | 架构与 package 文档、构建/静态门禁、基于 Session 的预期输出。 |

## 关键链路

### Desktop 启动与连接

`apps/desktop/src/project-manager.ts` 管理 Desktop bundle 列表，`apps/desktop-host/src/profile-boot.ts` 直接启动该组合。Electron 加载前端资源，使用 Host 返回的认证地址和注入值。`apps/desktop/scripts/prepare-package-set.ts` 从 Desktop Host 出发收集发行依赖。修改 profile 或 Web bundle 前，应沿这条链路追踪消费者和 package 闭包。

### Agent 执行与恢复

`packages/core/agent-loop` 使用 system-prompt、tools 和 llm 处理模型请求及工具调用。Session 事件记录可恢复的模型可见输入和执行结果，JSONL provider 持久化日志；fs、shell、subprocess、sandbox、approval 和 credentials 决定本地动作的实际权限。删除模型工具或运行时插件时，应同时检查 Session 日志、恢复、权限拒绝和 Windows PowerShell 路径。

个人 Project 自身保存可选本地目录；旧 Workspace 记录迁移为 Project。`personal/affiliation` 在同一 Session 日志中记录当前 Project/Bot 与变更历史；移动不复制会话。Host Remote 可创建、编辑、删除对象并移动会话。Desktop 侧栏的 Project 和 Bot 入口从同一 Session 列表与归属投影索引会话，复用运行和归档状态；删除对象后可从未归属列表查看旧会话及历史。当前 Project 元数据、Bot 用户指定身份和工作方向进入后续模型请求；Bot 默认模型及工具、Skill 许可在请求和执行路径生效。Profile 不保存凭据，自动学习记忆尚未实现。

### 个人任务与计划

`personalWorkflow` 是个人计划唯一写入者；`personal_workflow` domain 的单计划聚合原子保存定义、版本、审核和幂等回执。`projectPlan` 计算前置及必要子任务阻塞、并列就绪和父级汇总；列表顺序不制造依赖。Session Controller 的 `workflowList/Read/Save/Approve/Export` 不激活 Agent，显式 `workflowSnapshot` 可以恢复已有 Session 写入准确版本快照，flush 后重读日志确认落盘。`workflowMode/SetMode` 读写当前对话显式选择；`skill-dev-workflow` 经 Skill 注册表读取包内方法，通过标准 Session 消息日志注入当前用户请求。`workflow_assess` 区分简单、待澄清、不可行和复杂目标，`workflow_propose` 在提交处核对模式版本、当前目标评估、Bot 许可及归属，只保存待审核计划。生成计划和批准都不会启动执行，Markdown 仅为导出视图。

Phase 5–6 增加任务级领取、动作许可和真实证据完成检查，以及先保存交接包、再幂等创建接收者、最后转移所有权的接力。接收者保持暂停，显式恢复并发送消息后才执行；预算沿用原运行，重启后未知副作用必须核对，不自动重放。不同子任务可同时执行，系统不自动选择任务。

Phase 1–7 已有聚焦测试、类型/局部 lint、完整构建和无页面 built Host smoke 证据；Phase 7 相关回归 19 个测试文件、79 项测试通过，另有 6 项 storage-domain 不变量测试通过。`apps/desktop-host/tests/personal-workflow.spec.ts` 验证 CSV 三阶段、并行对话、接力、汇合、独立 Node 文件校验和持久化重开；模型使用确定性适配器。生成接口、中断恢复和打包 Skill 的产物测试通过。用户可按[验收剧本](personal-workflow-acceptance.md)检查 Desktop。具体命令及范围见施工计划。既有全仓不变量 README、personal-project 包清单与已退休 unknown-cast baseline 的门禁问题记录于[施工计划](personal-workflow-plan.md)，未计为本轮通过。

### Client 展示与发行

`packages/bundle/web-app/cordis.patch.yml` 挂载 Host controller、Client module 和 UI 插件；内部 Web 前端是 Desktop 的一部分。Desktop 主进程还管理浏览器 guest、目录选择、更新等原生功能。移除可选 UI 功能时，应一并检查 Host、IPC、manifest、打包资源、测试及文档；只禁用组合条目不会自动缩小安装包。

## 维护说明

路线图 Phase 4 的组织服务按[组织基础实施计划](organization-foundation-plan.md)完成内部 Phase 1–7，当前为 `manual`。`workspace/organization` 提供独立 SQLite v2 身份与项目权威；`api/organization-api` 与 Desktop 私有 `organization.yml` 提供受限 HTTPS 和当前权限事件同步。`host/organization-connection` 由 Electron 主进程持有，管理信任、登录、请求代次、失效缓存和未确认回执；`client/ui-organization` 提供设置与个人/组织入口，个人视角复用原 `personal.manager`。服务默认关闭，可显式保存随应用启动恢复；单写者目录锁、停服备份、保留旧目录的校验恢复和恢复后登录撤销已实现。72项聚焦测试、相关编译/lint/门禁、完整构建和两组普通 Node/Electron Node mode 产物验证通过。全仓不变量 gate 的既有四处 README 缺项仍单列，未计为通过。

产品 Phase 4 三机验收待定；[A/B/C 验收剧本](organization-foundation-acceptance.md)列出用户侧 Wi-Fi、防火墙、不同账号/授权、个人隔离、撤权重连、停服恢复与证书轮换步骤。组织入口不复用个人 cookie、不暴露个人 profile，不增加组织执行、任务分派或 WorkGraph。

本文只描述当前代码。个人模式双入口和编辑 UI 已实现；产品路线图 Phase 3 内部施工 Phase 1–7 的 Task 数据、可视化、任务增强模式、输入框任务选择、不同子任务独立执行及同机接力已实现。Phase 7 集成验证与收尾已完成，计划保持 manual，不自动进入组织阶段。可见 Desktop 验收和真实模型 API 验证仍待完成。本阶段不建设自动任务或 Agent 调度。旧基础裁剪记录中保留 Goal/Plan Mode 的说明不是当前能力清单，当前代码树已无这两个包。每执行完一个阶段，应按实际文件、入口和验证结果更新本文及对应计划的唯一状态表。Merforge 使用 `~/.merforge` 或 `MERFORGE_HOME`，不迁移或删除旧的 `DSH_HOME` 数据。当前 Session 保存与重开规则见[格式状态](session-format-status.md)。用户禁止助理自行启动页面、使用 Playwright、浏览器自动化或 GitNexus；可见 Desktop 行为由用户自行检查。用户于 2026-09-24 取消 macOS/Windows 安装验收，并报告本地模型交互正常；这不代表其他未执行检查已通过。

## 个人管理设置

设置 →“任务、项目与 Bot”集中提供计划查看/修改/审核、项目目录和 Bot 配置，侧栏与设置页复用 `ui-personal` 的 `personal.manager` Factory，任务插件占用 `personal.manager.workflow`。临时“每次任务强制拆分”开关默认关闭，保存到本机 `personal_workflow_testing` domain；开启后未绑定任务的新目标也必须拆分为至少两个必要子任务，已绑定执行任务不重复拆分。关闭恢复对话原模式；审批和显式领取保持独立。实现位于 `packages/client/ui-personal/src/client/PersonalSettings.tsx`、`packages/client/ui-personal-workflow/src/client/TestingPreferences.tsx`、personal-workflow 与 skill-dev-workflow；完整规则见[个人工作流](personal-workflow.md#集中设置与临时强制拆分)。
