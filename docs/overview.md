# 当前工程概览

本文记录当前代码结构，帮助开发者定位基础裁剪和后续产品阶段的实现。目标产品见[产品路线图](../ai-native-work-os-product-roadmap.md)，基础裁剪的实际状态见[基础裁剪计划](desktop-agent-foundation-pruning-plan.md)，下一阶段见[个人项目与 Bot 开发计划](personal-project-bot-plan.md)。Desktop 产品名为 Merforge。私人 Bot、组织服务和 WorkGraph 目前尚未实现。

## 运行方式与目录

Cordis 插件组合 Agent 运行时。Desktop 是 Electron 外壳，启动私有 Desktop Host，并在窗口中加载打包的前端资源。Host 通过 app-boot 启动自己的 profile，保留内部 Web bundle、本地 Webserver 和认证连接。独立 Web、CLI、headless、SDK、ACP 及 Python 产品入口已移除。Desktop 组合不包含 Office 转换与创建、麦克风、插件市场与检查、Open in App、Schedule、PTC workflow 和 Ralph；标准 Agent preset 保留文件、shell、Skill、subagent、job、Plan Mode、Goal 和 Todo。浏览器 guest 仍由 Electron 管理；Agent 浏览器和 computer-use provider 随 Desktop 打包，但默认禁用，需要满足各自运行前提后启用。[依赖闭包记录](desktop-agent-foundation-pruning-closure.json)列出 Desktop package 集合。

| 目录 | 当前职责 |
| --- | --- |
| `apps/desktop` | Electron 主进程、窗口、原生交互、恢复、更新与跨平台打包。 |
| `apps/desktop-host` | 私有 Desktop Node 进程，启动 profile，向 Electron 提供认证地址和 boot injection。 |
| `apps/web` | Desktop 内部前端构建入口和前端测试。 |
| `packages/bundle` | 运行时组合；Desktop 选用 base 和 web-app。 |
| `packages/core`、`packages/session`、`packages/llm`、`packages/fs`、`packages/shell` | Agent loop、工具、事件日志、持久化、模型和本地执行。 |
| `packages/client`、`packages/api`、`packages/host` | Client 插件、Remote/API、Web Host 和资源传输。 |
| `packages/subagent`、`packages/skill`、`packages/interaction` | 基础委派、Skill、用户问题与审批。 |
| `docs`、`scripts`、`snapshots` | 架构与 package 文档、构建/静态门禁、基于 Session 的预期输出。 |

## 关键链路

### Desktop 启动与连接

`apps/desktop/src/project-manager.ts` 管理 Desktop bundle 列表，`apps/desktop-host/src/profile-boot.ts` 直接启动该组合。Electron 加载前端资源，使用 Host 返回的认证地址和注入值。`apps/desktop/scripts/prepare-package-set.ts` 从 Desktop Host 出发收集发行依赖。修改 profile 或 Web bundle 前，应沿这条链路追踪消费者和 package 闭包。

### Agent 执行与恢复

`packages/core/agent-loop` 使用 system-prompt、tools 和 llm 处理模型请求及工具调用。Session 事件记录可恢复的模型可见输入和执行结果，JSONL provider 持久化日志；fs、shell、subprocess、sandbox、approval 和 credentials 决定本地动作的实际权限。删除模型工具或运行时插件时，应同时检查 Session 日志、恢复、权限拒绝和 Windows PowerShell 路径。

### Client 展示与发行

`packages/bundle/web-app/cordis.patch.yml` 挂载 Host controller、Client module 和 UI 插件；内部 Web 前端是 Desktop 的一部分。Desktop 主进程还管理浏览器 guest、目录选择、更新等原生功能。移除可选 UI 功能时，应一并检查 Host、IPC、manifest、打包资源、测试及文档；只禁用组合条目不会自动缩小安装包。

## 维护说明

本文只描述当前代码，不把计划中的 Bot 或组织功能写成已实现。每执行完一个阶段，应按实际文件、入口和验证结果更新本文及对应计划的唯一状态表。Merforge 使用 `~/.merforge` 或 `MERFORGE_HOME`，不迁移或删除旧的 `DSH_HOME` 数据。当前 Session 保存与重开规则见[格式状态](session-format-status.md)。用户禁止助理自行启动页面、使用 Playwright、浏览器自动化或 GitNexus；可见 Desktop 行为由用户自行检查。用户于 2026-09-24 取消 macOS/Windows 安装验收，并报告本地模型交互正常；这不代表其他未执行检查已通过。
