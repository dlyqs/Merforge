# 当前工程概览

[English](overview.md) | 中文

本页记录当前仓库的实际结构，供后续基座裁剪与路线图建设查找代码。目标产品见 [产品路线图](../ai-native-work-os-product-roadmap.md)，尚未执行的源码清理见 [Electron Agent 基座裁剪计划](desktop-agent-foundation-pruning-plan.zh.md)。当前工程仍是 DeepSeek Harness；计划中的个人 Bot、组织服务和 WorkGraph 尚不存在。

## 运行与目录

当前系统以 Cordis 插件组成 Agent 运行时。Desktop 是 Electron 壳，启动 Desktop Host，并在窗口里加载打包的 Web 前端；Host 仍依赖 dsh profile 启动器、Web bundle、本机 Webserver 和认证连接。现有仓库也发行 Web、headless、SDK、ACP 等独立入口；这些是裁剪计划的目标，不能与 Desktop 内部传输混淆。

| 目录 | 当前职责 |
| --- | --- |
| apps/desktop | Electron 主进程、窗口、原生交互、恢复、更新与跨平台打包。 |
| apps/desktop-host | Desktop 的私有 Node 进程，启动 profile 并向 Electron 提供认证 URL 与启动注入。 |
| apps/web | Desktop 与独立 Web 共用的前端构建入口和前端测试。 |
| apps/cli | 公开 dsh 命令与 profile 启动实现；Desktop Host 当前调用其内部 profile-boot。 |
| packages/bundle | base、web-app 及其他运行组合；Desktop 当前复用 Web profile 的 bundles。 |
| packages/core、packages/session、packages/llm、packages/fs、packages/shell | Agent loop、工具、事件日志、持久化、模型与本机执行。 |
| packages/client、packages/api、packages/host | 客户端插件、Remote/API、Web Host 和资源传输。 |
| packages/subagent、packages/skill、packages/interaction | 基础委托、Skill 与用户提问/审批。 |
| python、packages/acp、packages/sdk、website | 非 Desktop 的 SDK、协议与文档网站；是否删除按裁剪计划的依赖核验决定。 |
| docs、scripts、snapshots | 架构与包文档、构建/静态门禁、Session 驱动的预期输出。 |

## 关键链路

### Desktop 启动和连接

apps/desktop/src/project-manager.ts 从 Web 模板建立 Desktop profile；apps/desktop-host/src/index.ts 调用 profile-boot 并启动 Host；Electron 加载前端资源后使用 Host 返回的认证地址和注入数据。apps/desktop/scripts/prepare-package-set.ts 以 dsh 与 Desktop Host 为根收集发行依赖。修改 profile、CLI 内核或 Web bundle 前，应沿这条链路查消费者和打包闭包。

### Agent 执行和恢复

packages/core/agent-loop 通过 system-prompt、tools 与 llm 发起模型请求和工具调用；Session 事件记录可恢复的模型可见输入与执行结果，JSONL provider 提供持久化。fs、shell、subprocess、sandbox、approval 和 credentials 决定本机动作的实际权限。删模型工具或运行时插件时，应同时核对 Session 日志、恢复、权限拒绝与 Windows PowerShell 路径。

### 客户端展示与发布

packages/bundle/web-app/cordis.patch.yml 装载 Host 控制器、Client 模块和 UI 插件；Web 前端并非可独立删除的静态页面。Desktop 主进程还持有浏览器 guest、目录选择与更新等原生能力。删除一项可选 UI 要同时检查 Host、IPC、manifest、打包资源、测试和文档；只禁用组合行不会自动减小安装包。

## 维护规则

本文描述当前代码，不把裁剪计划写成已实现状态。后续每完成一个阶段，按实际文件、入口和验证结果更新本页及计划的唯一状态表。新产品使用独立数据目录，旧 DSH_HOME 数据不在本计划中迁移或删除；Session 格式与已提交历史仍按 [格式状态](session-format-status.zh.md)和仓库规则处理。用户要求不启动页面，也不使用 Playwright、浏览器自动化或 GitNexus；相关 GUI 行为由用户在实际桌面客户端人工核验。
