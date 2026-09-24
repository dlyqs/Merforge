# Electron Agent 正式开发基座裁剪计划

[English](desktop-agent-foundation-pruning-plan.md) | 中文

本文是 [产品路线图](../ai-native-work-os-product-roadmap.md) 之前的基座清理执行计划。后续收到“继续”或“执行 Phase X”时，先读取本文件及其英文对应文档，再按唯一阶段状态表执行。本文只规划清理，不实施路线图中的 Bot、组织服务或 WorkGraph。

## 目标与可行性

目标是在当前仓库直接裁剪非目标源码、构建和发行入口，形成可继续开发的 macOS/Windows Electron Agent 基座。最终用户只通过桌面 GUI 操作；桌面内部允许保留 HTTP、前端渲染、进程和 profile 启动机制。基座需能用 API key 完成真实编码任务，保留会话恢复、受限工具执行、Skill 加载、项目对话与以后增加组织授权的接口。Linux 客户端与组织能力均不属于本计划交付。

此目标可行，但不能把所有含有 Web 或 CLI 名称的代码删掉。当前 Desktop 从 Web profile 组合 base 与 web-app，Desktop Host 调用 dsh/profile-boot，窗口加载 Web 前端资源，并经本机认证连接到 Host。先拆出 Desktop 所需的内部启动与传输，再删独立 Web 应用、命令行和其他发行入口。只禁用插件行不会缩小打包体积；要继续删除 manifest 依赖并检查打包闭包。

## 范围、已确认决定与约束

- 用户已确认在当前仓库物理删除非目标源码；不保留独立 Web、CLI、SDK、ACP 或 Python SDK 作为产品或开发发行面，只有实际被 Desktop 内部使用的代码可以留在内部模块。
- 用户已确认本计划只清理基座；路线图能力另立计划。首版支持 macOS 和 Windows；不迁移已有 DeepSeek Harness 用户会话、工作区与插件配置。新产品使用独立数据目录，旧数据原样留在用户磁盘。
- 保留 Cordis 运行组合、Agent loop、模型和工具接口、Session 日志与 JSONL 持久化、投影与恢复、Bash/PowerShell、沙箱与审批、凭据、文件与项目视图、基本子 Agent、Skill、Web 搜索、浏览器操作、computer use 及其桌面 UI/Host/IPC、Electron Host/Client 传输。两套 LLM 适配器和持久化接口在消费者核验前不作为删除目标。
- 保留供未来组织模式复用的授权执行点和本机认证传输；不提前开发组织身份、内网服务、Bot 长期记忆、WorkGraph、Capability Capsule 或 Codex CLI 适配器。
- 不改动或删除用户磁盘中的旧数据及仓库已提交的 Session 历史代际。新产品不提供旧数据导入，不等于可以破坏仍被当前读写链依赖的格式编解码和迁移包。
- 助手不启动页面，不使用 Playwright、浏览器自动化或 GitNexus；这项验收限制不意味着从产品中删除 Agent 的浏览器操作能力。前端改动通过静态检查、构建、纯逻辑测试和用户侧桌面人工核验确认；不能把未执行的 GUI 验收写成通过。
- 不在清理过程中顺手改写产品路线图、发布新安装包或接入生产账号。源码删除要同步消费者、manifest、文档、测试和 generated catalog；用实际 Desktop 打包闭包判断减量。

## 功能裁剪地图

| 功能点 | 目标处理 | 保留理由或删除条件 |
| --- | --- | --- |
| DeepSeek 官方账号、Platform 登录、Session 日志上送与官方遥测 | 最先从 Desktop 默认组合移除，再删无消费者的实现与配置。 | 默认 session-log-deepseek 会随官方 API 请求上送 canonical Session 后缀；遥测默认指向 DeepSeek 服务。新应用的私人/组织数据不能沿用该默认行为。保留普通 DeepSeek API key 模型适配与本地诊断。 |
| 官方品牌、反馈 UI、官方更新源 | 替换品牌与默认更新源；没有自有更新源时关闭网络更新检查，保留启动恢复和通用更新机制。 | 深度绑定当前产品服务，不能把反馈评分当作未来任务验收。 |
| 插件商店、在线安装、Cordis 调试与 Creator preset | 从产品 UI 和运行组合移除；验证后删除无消费者代码。 | 保留内部静态插件组合和 Skill 注册，以免损坏 Agent 扩展。 |
| 内嵌浏览器、Agent 浏览器操作与 computer use | 保留浏览器 guest、桌面 UI、Host/IPC、权限控制、服务及至少一套可用的浏览器和电脑操作 provider；裁剪时验证模型工具到实际操作的调用链。 | 用户明确要求保留这两项 Agent 能力；仅保留服务注册接口不等于保留操作能力，独立 Web 产品入口仍可移除。 |
| 语音与 Office 创作/转换 | 从首版发行物移除配套 UI、Host、原生依赖与资源；保留普通代码、Markdown、图片及成果预览。 | 这些能力不是当前基座的必要组成，Office 原生资源对包体影响大。 |
| Open in App 与 Host 机器本地打开 | 从桌面产品移除双侧入口，除非个人编码工作区仍有明确独立用例。 | 后续组织服务器不应替员工打开服务器本机应用。 |
| 用户交互终端与 Agent Shell | 保留受控个人终端和 Agent 的 Bash/PowerShell 执行，后续组织模式再单独授权。 | GUI 应用可以包含终端；删除它会削弱编码任务能力。 |
| PTC 工作流、Ralph、实验性 Agent Teams、Schedule/Webhook | 从首版模型工具目录与发行闭包移除；按实际消费者依序删源码。 | 保留基础子 Agent。Ralph 与 Schedule UI 已默认关闭，不能把关闭当作包体缩减。 |
| 会话 Goal、Plan Mode、Todo | 暂保留个人 Agent 的工作辅助，不把它们当组织 WorkGraph。 | dev-workflow-skill 与个人复杂任务尚未产品化；此时删除会损伤基座能力，后续替换时再决定。 |
| ACP、独立 Web、headless、TS/Python SDK 与样例发行 | Desktop 内部启动从这些产品入口拆出后，删除入口、独占包、发布流水线和相应测试。 | 不能删除 Desktop 实际依赖的 Web 前端、Host/RPC、profile loader 或动态客户端模块。 |
| Linux 平台实现 | 不发行 Linux 安装包；源代码先保留可能被跨平台构建共享的部分，独占代码只在可达性确认后删。 | 首版不支持 Linux，但目标产品以后支持，避免为暂时缩包制造重写。 |

## 唯一阶段状态表

| 阶段 | 主题 | 主要目标 | 状态 | 实际产出 | 备注 |
| --- | --- | --- | --- | --- | --- |
| Phase 1 | 基线与数据隔离 | 固定 Desktop 能力证据、新产品数据目录及默认外传关闭 | 助手已完成 | Merforge 独立主目录、基线闭包与外传测试 | 用户侧数据目录核验仍待手动完成 |
| Phase 2 | Desktop 独立启动 | 将桌面内部 profile/boot 从公开 Web/CLI 产品入口拆出 | 助手已完成 | 私有 Host boot、桌面 profile、Host 为根的打包闭包 | GUI 编码核验待用户手动完成；全仓构建仍会先打包不用的 CLI |
| Phase 3 | 官方服务解耦 | 清除 DeepSeek 官方账号、上送、品牌和更新源耦合 | 助手已完成 | official-services bundle、Merforge 品牌与 API key 入口、禁用网络更新 | 品牌 GUI 核验待用户手动完成；公开 profile 继续保留官方服务 |
| Phase 4 | 可选桌面功能 | 移除语音、Office、插件商店与调试等非目标功能 | 助手完成 | 移除 Desktop Office/语音及商店/调试，保留所选 provider 链路 | 实际 provider 操作与 GUI 待人工核验 |
| Phase 5 | Agent 工具瘦身 | 裁掉 PTC/Ralph/实验团队等非目标执行入口 | 助手完成 | 缩减 Desktop 工具目录与打包闭包，保留非 Desktop 快照 | 真实模型编码待 API key 验证 |
| Phase 6 | 非 Desktop 发行 | 删除独立 Web/CLI/headless/SDK/ACP/Python 入口与发布链 | assistant complete | 已移除产品入口、专属源码、发布工作流与过时快照执行器；验证 Desktop 专用构建和 218 包闭包 | 不声称完成安装版 GUI 核验 |
| Phase 7 | 闭包与双平台验收 | 清理孤立包、构建和文档，验证正式基座 | in_progress | Desktop 构建与 218 包闭包、Host 重启冒烟、四项无浏览器快照、聚焦测试、hygiene、typecheck、lint 及 doc-sync 已通过 | macOS/Windows 安装版 GUI 核验仍是硬完成条件 |

## 分阶段执行内容

Phase 1 链路从桌面壳启动带专用 profile 的 `desktop-host` 开始。base bundle 提供 Agent loop、模型和工具服务、权限预设及 JSONL Session 持久化；web-app 提供经认证的 Session API 和客户端模块。`apps/desktop/src/browser-guests.ts` 将客户端浏览器侧栏连接到 Electron guest。浏览器操作和 computer use 的模型工具使用 `packages/experimental/` 下单独配置的 provider。Desktop bundle 保留 Chrome DevTools MCP 与原生 Cua Driver 链路；两者默认禁用，满足浏览器与系统前置条件后再启用。[闭包记录](desktop-agent-foundation-pruning-closure.json)列出原始和当前包集合；当前第一方压缩 tarball 合计 12,791,765 字节。桌面 profile 仍支持动态插件，Session 快照沿用现有持久化链路，Windows 安装器与更新消费者留待 Phase 7 验证。

### Phase 1：基线与数据隔离

目标：在任何大规模删除前记录当前 Desktop 的运行、打包依赖、存储位置与数据外传路径，建立新产品数据目录，关闭官方 Session 日志上送和默认遥测。此阶段可以调整运行组合与配置，不删除 Agent 核心。

预计区域：apps/desktop、apps/desktop-host、packages/bundle/base、packages/session/session-log-deepseek、packages/session/session-telemetry-otel、packages/boot/app-boot、相关配置与文档。

- [x] 记录 Desktop 运行链、模型到工具再到 Session 持久化的基线测试，包括浏览器操作与 computer use 的服务、可选 provider、工具、权限和客户端连接，并记录 dsh + Desktop Host 打包闭包清单与大小。
- [x] 新产品使用独立数据目录；不扫描、迁移、重命名或删除旧 DSH_HOME 内容。
- [x] 默认配置不附带 dsh_session_log，也不向 DeepSeek 官方遥测地址发送反馈或日志；负向测试验证无隐含外传。
- [x] 记录保留、替换、删除和暂缓的包/功能清单，注明动态插件、快照及 Windows 消费者。

助手侧检查：运行配置解析、外传负向测试、相关单元和无浏览器的真实组合测试、Desktop 打包闭包生成与 git diff --check。用户侧核验：确认新产品数据目录与旧产品目录隔离；本阶段不把 GUI 目测当作自动测试。依赖：无。实际完成记录：Merforge 使用 `~/.merforge` 或 `MERFORGE_HOME`，并在 profile 启动前设置 Host 主目录；Desktop 选择路径时不读取旧 `DSH_HOME`。[闭包记录](desktop-agent-foundation-pruning-closure.json)包含原 dsh 与 Desktop Host 根，以及当前仅 Host 根。base 与 web-app 不再配置 Session 上送、反馈和遥测；默认组合负向测试拒绝这些配置行。用户侧目录核验仍待手动完成。下一阶段：独立启动。

### Phase 2：Desktop 独立启动

目标：让 Desktop 通过专用 profile 与内部启动 API 运行，公开 Web/CLI profile 不再是桌面创建、恢复或打包的前提。窗口仍从内部前端资源加载并连接受认证的本机 Host。

预计区域：apps/desktop/src/project-manager.ts、apps/desktop-host/src/index.ts、packages/boot/app-boot、apps/cli 的 profile-boot 代码、packages/bundle/base、packages/bundle/web-app、apps/web 及打包脚本。

- [x] 建立 Desktop 专用 bundle/preset 清单，覆盖新安装、已有新产品 profile 的恢复和插件配置失败恢复。
- [x] 将 Desktop 必需的 profile 启动能力从公开 CLI 可执行入口分离；若更改应用启动规则，同步根 AGENTS.md 与 docs/architecture.md。
- [x] 保留 Host/RPC/Client modules/静态资源、loopback 认证及 Agent 浏览器操作所需的 guest；独立 Web 应用入口停止构成桌面运行前提。
- [x] 验证启动、连接、Session 创建、消息、工具结果、关闭与重启；未验证时不删旧启动器。

助手侧检查：profile 组合与内核单测、Desktop Host built smoke、认证连接与关闭测试、打包闭包检查、typecheck。用户侧核验：在 macOS 桌面打开并完成一次受控编码任务；Windows 在 Phase 7 作为硬条件。依赖：Phase 1。实际完成记录：`apps/desktop-host/src/profile-boot.ts` 负责启动；桌面 profile 和 overlay 组合 base 与 web-app，发布闭包仅以 Desktop Host 为根。已构建 Host 的欢迎流程覆盖认证连接、API key 持久化、停止与重启；Session 创建、消息和工具结果由独立 session-controller 测试覆盖，尚未运行真实模型的完整桌面任务。打包命令目前仍构建并打包全仓，再筛选桌面闭包；Phase 6 负责移除非桌面构建工作。用户 macOS 编码核验仍待手动完成。下一阶段：官方服务解耦。

### Phase 3：官方服务解耦

目标：移除新产品不应继承的 DeepSeek Platform 身份、品牌、反馈外传与官方更新策略，同时保留可配置的模型供应商和桌面恢复能力。

预计区域：packages/credentials/deepseek-account*、packages/api/account-controller、packages/client/ui-settings-account、packages/client/ui-brand-official、packages/feedback、packages/host/product-telemetry-otel、apps/desktop 的登录/更新组件与 locale、发布配置。

- [x] Desktop 不提供 DeepSeek Platform 登录、账户余额或官方反馈发送入口；个人 API key 接入仍可工作。
- [x] 更新检查不连接旧官方端点；若新端点未定则明确关闭网络检查，不删除错误恢复、签名校验与安装完整性检查。
- [x] 品牌和用户文案不误称新产品为 DeepSeek Harness；保留上游版权与许可证声明。
- [x] 删除官方服务独占包时同步 manifest、配置、测试与说明，保留本地审计与安全诊断。

助手侧检查：官方端点/账号代码目录的可达性搜索、负向网络配置测试、单元测试、build、lint 与打包闭包差异。用户侧核验：确认应用内无旧品牌与旧账号入口；此视觉项待用户查看，不能由助手打开页面代替。依赖：Phase 2。实际完成记录：Desktop 账号 IPC、preload、View 和 backend 已删除。官方账号、上送、反馈、遥测和品牌配置保留在公开 profile 使用的 `official-services` 中，不进入 Desktop。桌面保留 API key 欢迎页与 Merforge 图案；常规更新检查没有默认源。按当前 tarball 比较，闭包从 276 包降至 235 包，压缩大小估计减少 1,052,357 字节；原基线体积使用当前 tarball 估算，不是旧构建归档值。用户侧品牌核验仍待手动完成。下一阶段：Phase 4 可选功能。

验证记录：`pnpm run build:official`、`pnpm run typecheck`、`pnpm run lint:contracts-ready` 和 `pnpm run doc-sync` 均通过。`verify-cordis-config` 检查通过 199 份配置。聚焦的无浏览器测试通过 88 个单测及三个已构建 Host E2E 用例。打包准备得到 235 个桌面包，不包含公开 CLI 包或已知官方服务包。未运行 GUI、真实模型编码任务、签名安装包或 Windows 验证。

### Phase 4：可选桌面功能

目标：成对移除首版编码基座不需要的客户端入口、Host 服务和原生资源，实际减少发行闭包。

预计区域：packages/client/ui-open-in-app、ui-plugin-manager、ui-cordis、相关设置、packages/host/open-in-app、packages/document/office-to-pdf、语音相关组件、apps/desktop-host/src/office*、apps/desktop/scripts 与 manifest；同时核对 packages/client/ui-sidebar-browser、apps/desktop/src/browser-guests.ts 和 computer-use 相关组件没有被误删。

- [x] 语音、Office 创作及转换、插件市场和 Cordis 调试不在正式 Desktop 组合与打包闭包中；浏览器 guest，以及各至少一套经验证的浏览器操作与 computer-use provider，仍能从 Desktop 配置启用并进入打包闭包。
- [x] 为 macOS/Windows 记录所选 provider 的模型、浏览器或驱动、系统权限等前置条件；不得因位于 packages/experimental 而一并删除所选实现。
- [x] 移除被裁功能的 UI、Host、IPC、资源、manifest、测试和文档消费者，保留浏览器/电脑操作所需组件，以及代码/Markdown/图片预览和文件下载。
- [x] 保留个人编码需要的终端、文件树、变更与产物视图；组织授权尚未实现的部分不宣称安全可用。
- [x] 对每项记录删掉的维护面、失去的能力与实际包体变化；未降低维护成本的删除不强推。

助手侧检查：依赖可达性、Client/Host 纯逻辑测试、build、打包闭包清单与大小，重点核对浏览器与 computer-use 的工具、Host、IPC、权限及资源仍可达。用户侧核验：桌面侧边栏能完成文件、终端、成果和浏览器操作；用户自行人工确认，无页面自动化。依赖：Phase 3。实际完成记录：Desktop Host 不再加载 Office 转换或处理麦克风，Document Preview 不再注册 Office，打包也不再包含 Office 资源。共享 Web 组合不再挂载插件商店、Cordis 调试、Open in App 或 Schedule UI。Desktop Host 打包闭包仍包含 Chrome DevTools MCP 与原生 Cua Driver，满足 Desktop README 所列前置条件后可通过 profile patch 启用。profile 与闭包测试验证配置可达性；真实浏览器/电脑操作、权限，以及文件、终端、成果的 GUI 操作留待 Phase 7 人工核验。同一批重新打包的 tarball 对比显示，闭包由 235 包降至 218 包，第一方压缩大小净减 623,348 字节；闭包 JSON 记录各项移除成本与新增 provider 成本。下一阶段：Phase 5 工具瘦身。

### Phase 5：Agent 工具瘦身

目标：缩小默认模型工具目录和执行运行时，不让首版出现与未来 WorkGraph 竞争的第二套编排器，同时保持强编码能力。

预计区域：packages/bundle/base 与 Desktop preset、packages/ptc-runtime、packages/workflow、packages/experimental/agent-team*、packages/schedule、packages/webhook、相关工具、模型目录和快照。

- [x] 从 Desktop 默认模型工具中移除 PTC 工作流、Ralph、实验 Agent Teams、Schedule 与 Webhook 的专用入口；只在消费者为零时物理删包。
- [x] 保留原生工具执行、文件和 Shell、Web 搜索、浏览器操作与 computer use 的服务及所选 provider、Skill、基础子 Agent、compaction、受控后台任务与用户提问/审批。
- [x] Goal、Plan Mode、Todo 暂作为个人 Agent 辅助；明确它们不具备组织任务权威性，等路线图替代能力完成后再评估删除。
- [x] 模型请求、Session 日志、工具结果与恢复后的可见输出一致；不通过删事件或快照掩盖行为变化。

[闭包对照](desktop-agent-foundation-pruning-closure.json)使用同一批源码打包的 tarball 比较 Phase 3 与当前第一方包。Office 预览与转换减少 46,970 字节，移除 Host/Client 转换维护面；电子表格与 PDF 预览保留。插件商店和调试减少 413,657 字节，移除包管理和调试 UI 维护面，失去应用内插件安装与 Cordis 检查。Open in App 减少 66,851 字节，移除 Host/UI 处理逻辑，失去从侧栏启动本地应用的能力。Schedule 减少 12,440 字节，移除 UI/Host 接线，失去定时任务控制。PTC 工作流与 Ralph 减少 156,500 字节，移除 Desktop 工具和运行时组合，默认工具目录不再提供脚本编排与新 Agent 迭代。语音没有带来额外包体减量；麦克风路径删除后不再维护 Desktop 权限与录音处理。所选浏览器及电脑 provider 增加 73,070 字节，净减量为 623,348 字节。外部 npm/原生 payload 和 shell 资源不在该测量范围内。

助手侧检查：工具目录与 profile 组合测试、相关单元、无浏览器 Session 快照、真实 API 编码 smoke（有有效密钥时）、typecheck。用户侧核验：个人模式对复杂编码任务仍可计划、执行和接力；未运行的真实模型项记录为待核验。依赖：Phase 4。实际完成记录：Desktop base 与 standard preset 不再挂载 PTC 工作流、Ralph、Schedule 或实验团队专用入口。Goal、Plan Mode、Todo、文件与 Shell 工具、Skill、Web 搜索、基础子 Agent、compaction、后台任务、用户提问与审批保留。Headless、SDK 与 ACP 通过各自的 profile 行保留原有 PTC 工作流；所选无浏览器 Session 快照通过，未改动 Session 事件或录制 fixture。环境没有 `DEEPSEEK_API_KEY`，因此未运行真实模型编码 smoke；个人模式 GUI 验收仍待人工执行。Goal、Plan Mode 与 Todo 只作个人辅助，不具备组织任务权威性。下一阶段：Phase 6 发行入口清理。

验证记录：`pnpm run build:official`、`pnpm run typecheck:contracts-ready`、`pnpm run lint:contracts-ready`、`pnpm run verify-cordis-config`（198 份配置）和聚焦的 Client/Desktop Vitest 测试通过。所选免密钥 Headless/SDK Session 快照通过 9 个用例。实际打包闭包包含 218 个 Desktop 包。`git diff --check` 通过。未运行真实模型任务、浏览器/电脑 provider 操作、安装后的 GUI 验收或签名安装包。

### Phase 6：非 Desktop 发行

目标：在 Desktop 启动已独立后，从仓库删除非目标产品入口与独占源码、构建和发布流水线；内部共用库仍按可达性保留。

预计区域：apps/cli 的公开 bin/profile、packages/bundle/headless、sdk-app、sdk-minimal、acp-app、packages/acp、packages/sdk、python/、独立 Web 启动、scripts/release、.github/workflows、根 package.json、测试与文档。

- [x] 移除独立 Web、CLI、headless、SDK、ACP、Python 的公开启动与产品发行定义；不因名称误删 Desktop 用的 Web 前端或 profile loader。
- [x] 检查 subagent-dsh-sdk、动态插件安装、Office 工具与测试支持对 SDK/CLI 的真实调用；迁移所需消费者后才删除其实现。
- [x] 删除或改写独立 npm/Python 发布与 CI 入口；Desktop Mac/Win 构建、签名、安装完整性和恢复验证仍有责任人。
- [x] Desktop package set 不再含非 Desktop 独占包；安装包减量由打包闭包而非禁用行证明。

助手侧检查：运行时依赖闭包、package metadata、application entrypoint、built Desktop Host smoke、hygiene、typecheck 与相关无浏览器快照。用户侧核验：无；实际安装检查在 Phase 7。依赖：Phase 5。实际完成记录：已移除公开 CLI 与独立 Web 启动器、Headless/SDK/ACP/Python 发行、专属 bundle 与包、发布工作流及过时快照执行器，同时保留已提交的 Session fixture。Desktop Host 现在只构建并打包所选 workspace 闭包，不再构建已移除的产品入口。通用 JSON-RPC 传输类从 SDK 协议包移入 Codex 子 Agent 消费方。准备好的 Desktop 包集合为 218 包、第一方压缩大小 12,791,765 字节；包成员与 Phase 5 相同，因此 Phase 6 不声称额外缩小安装包。包约束、hygiene、typecheck、聚焦 CI/打包测试、已构建 Host 重启冒烟及四项无浏览器快照通过。未运行安装版 GUI 或真实模型任务。下一步：Phase 7 自动闭包核验与用户侧双平台验收。

### Phase 7：闭包与双平台验收

目标：得到可供路线图 Phase 2 继续开发的正式桌面 Agent 基座，收尾孤立源码、文档与构建定义。

预计区域：剩余 orphan packages、apps/desktop、apps/desktop-host、根脚本、docs/architecture.md、包 README、docs/overview.md、本计划及快照/测试。

- [ ] 打包闭包、默认工具目录、外部网络目标和独立入口均与本计划清单一致；旧 DSH_HOME 数据未变动。
- [ ] macOS 与 Windows 安装后的桌面 GUI 能用 API key 真实完成代码任务；按记录的 provider 前置条件验证浏览器操作和 computer use 可用、Session 重启恢复，且受限目录外动作被拦截。
- [ ] 两端启动、认证连接、关闭、崩溃恢复和安装完整性通过；不支持的平台与功能如实标注。
- [x] 单元、类型、lint、文档、打包闭包及适用的无浏览器快照通过；未做的人工视觉核验列明，不声称完成。

助手侧检查：聚焦测试、built smoke、构建、hygiene、doc-sync、lint、git diff --check 及打包闭包对照；只在有环境时做真实 API 测试。用户侧核验：macOS/Windows 两端真实启动、可见 UI、文件与终端操作、浏览器操作、computer use，以及用户确认的任务结果；此项是 Phase 7 完成的硬条件。依赖：Phase 6。实际进展：Desktop 包构建与准备通过，包含 218 包、第一方压缩 tarball 共 12,791,765 字节；包成员与 Phase 5 相同。已构建 Host 的认证、API key 持久化及重启冒烟通过。四项选定的无浏览器 Session 快照及聚焦 CI/打包测试通过；清除过时 Headless overlay 条目后，五个 Loader e2e 文件的九项测试通过。已移除失效的独立启动测试与用户指南；app-boot 的 82 项、Client 插件管理的 49 项以及 time-context 的一项 e2e 测试通过。hygiene 的 17/17 项、doc-sync 的 42/42 项及 typecheck、lint、diff 空白检查通过。环境未设置 `DEEPSEEK_API_KEY`，因此未执行真实模型编码任务。用户目前没有 macOS 或 Windows 安装版验收结果。两端安装版的编码、浏览器操作、computer use、Session 恢复、越界目录拒绝、生命周期及安装完整性均待核验。Phase 7 在这些检查通过前保持进行中；之后才制定路线图计划。

## 后续执行规则

执行模式：auto_until。自动开始阶段：Phase 6。自动停止阶段：Phase 7。对话接力：off；不创建专用执行 Skill。用户于 2026-09-24 授权自动完成剩余阶段；Phase 7 的 macOS 和 Windows 已安装 GUI 核验仍是完成硬条件。

- 收到“执行 Phase X”只执行该阶段；收到“继续”先读取本计划，选第一个 in_progress，否则第一个 pending；若依赖未完成且不能安全隔离则停止。
- manual 每完成一个阶段就更新本计划唯一状态表、该阶段实际完成记录与 docs/overview.md，然后报告并停止。auto 在明确授权范围内连续推进；auto_until 仅执行记录的含首尾阶段范围，完成全部范围并核实交付后恢复 manual。
- 自动模式选择每个阶段前重新检查状态、依赖、授权范围和阻塞条件。用户侧人工检查默认记录为待核验；只有下阶段依赖其结果或本计划指定为硬条件时才阻塞。
- 若执行中证明某阶段超出一个正常上下文能安全验证的范围，先把该阶段分成最少必要的子阶段，更新状态表、验收项与顺序，再实施；不为整齐预先拆分。
- 每个阶段记录实际文件、命令和结果、未运行检查、偏差及下一阶段。用户若明确授权自动推进，也不授权删除旧用户数据、外部发布、生产变更或新的敏感凭据。
- 不在本计划执行路线图业务能力。Phase 7 完成后，以新基座实际代码和 docs/overview.md 为准，另制定路线图能力建设计划。

## 关键链路日志要求

Desktop 主进程到 Host 启动、profile 装载、认证连接、Session 创建/恢复、模型调用、工具授权与执行、Session 提交、停止/重启及打包闭包校验都属于验收关键链路。相关阶段使用现有 ctx.logger 或 Electron 结构化诊断，按稳定事件名记录入口、结果、状态转移和错误；区分长期诊断与临时迁移日志。不得记录 API key、完整 Session、提示词、工具大输出、私人路径明文或高频 token 流。移除官方遥测不等于移除本地可排障证据。

## 依据与保留项

[桌面 profile 创建](../apps/desktop/src/project-manager.ts)、[Desktop Host](../apps/desktop-host/src/index.ts)、[profile 模板](../packages/boot/app-boot/src/profile.ts)、[Base 组合](../packages/bundle/base/cordis.patch.yml)、[Web 组合](../packages/bundle/web-app/cordis.patch.yml)、[Desktop 打包清单](../apps/desktop/scripts/prepare-package-set.ts)、[Session 格式状态](session-format-status.zh.md) 和 [测试策略](testing.zh.md) 是本计划的主要当前代码证据。Paperclip 仅是产品参考。此计划不承诺对 DeepSeek Harness 的全仓库每个可选插件完成穷尽式删除审计；阶段执行时必须重新确认实际消费者。
