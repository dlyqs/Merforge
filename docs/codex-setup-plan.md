# Codex 设置与首次使用实施计划

## 目标与执行入口

为 Desktop 补齐 Codex 的设置、登录和首次使用入口，使新用户不安装全局 Codex CLI、不配置 Merforge API key，也能从应用获得明确的接入路径。已有原生登录继续自动发现并复用，但界面清楚说明当前状态；发现模型不会自动选择后端、创建会话或发送消息。

这是跨原生协议、Host 生命周期、Desktop IPC 和 Client 的大型目标。本文件是后续执行入口和阶段状态唯一来源，与已完成的 [Codex 后端计划](codex-backend-plan.md)分开编号；不重新执行其 Phase 9–10，也不推进 [7C 对话规划计划](conversation-planning-plan.md)。

- execution mode: `manual`
- automatic start phase: `none`
- automatic stop phase: `none`
- conversation relay: `off`
- 计划状态：用户于 2026-10-02 授权“请完成 phase4-6”；闭区间 Phase 4–6 工程实现、验证和交接已完成，全部 Phase 1–6 为 `completed`。已到达授权终点，恢复 `manual`、清空自动边界；真实账号、可见及跨平台产品验收仍待用户，不推进 7C。
- 工作目录：`/Users/git_local/Merforge`
- 工作流 Skill：`/Users/git_local/dev-workflow-skill/SKILL.md`
- 用户目标：补齐上一轮确认缺失的 Codex 配置入口，参考 Multica 的入口组织方式。

### 纳入范围

1. 始终可见的“设置 → 模型 → Codex”卡片：内置 runtime 版本、运行状态、原生认证状态、模型可用性、重新检测及明确错误处理。
2. 用户主动点击的应用内 ChatGPT 设备码登录：展示短时验证码与验证链接、复制、等待、取消、超时和重试；认证仍由官方 Codex runtime 完成。
3. 个人模型下拉、Bot 默认模型和组织执行模型选择共用可用性更新；失败时能够跳到 Codex 设置。
4. 可跳过的首次模型接入引导：提供 Codex 与已有 API 配置两条路径，已可用 Codex 不要求 API key。
5. 真实组合的无页面测试、发行路径 smoke，以及 macOS/Windows 新用户手工验收步骤。

### 范围外

不增加任意二进制路径、PATH fallback、CustomArgs、自动 npm 安装、通用 RPC、原生配置编辑或凭据导入。不提供退出原生账号、切换已有账号、邮箱/套餐/额度展示或 service tier 设置。账号退出和切换会影响共享原生登录，需要另行设计；本次已认证状态只提供检测和模型信息。保留现有会话、Bot 默认值和组织策略的选择职责，不新增全局 Codex 默认后端，也不照搬 Multica 的自定义命令配置。无独立 Web/CLI/SDK 启动器、7C 实现、任务调度改造或组织身份认证改造。

## 现状、参考与可行性

### 当前源码事实

| 位置 | 当前行为 | 本次缺口 |
| --- | --- | --- |
| `apps/desktop-host/desktop.patch.yml` | 自动注册 `agent-codex` | 未提供用户可见的接入状态入口 |
| `packages/subagent/codex-runtime/src/process.ts` | 只解析 `@openai/codex@0.153.4` 的官方 wrapper | runtime 缺失是安装包问题，不能提示用户安装全局 CLI 来绕过 |
| `packages/core/agent-codex/src/index.ts` | 原生账号和模型探测；缺登录/模型时失败 | 只有发现和执行接口，没有登录流程所有者 |
| `packages/api/session-controller/src/catalog.ts` | API 与原生模型分组、局部失败 | 原生失败缺少结构化的设置操作指引 |
| `packages/client/ui-settings-models/src/client/store.ts` | 读取 LLM Provider、settings 和 credentials | 原生后端不会成为 API Provider 行 |
| `packages/client/ui-settings-models/src/client/index.ts` | Desktop 禁用强制 API credential onboarding | 不应重新启用强制 API key 弹窗；需要补可跳过的接入选择 |
| `packages/client/ui-model-selection/src/client/ModelSelect.tsx` | Codex 能力/登录文案及模型重试 | 登录提示没有直达设置和操作入口 |

创建选择仍为显式 Session 选择 → Bot 默认值 → 现有 API 默认值；历史会话从持久选择恢复。原生模型、effort 和后端变化沿现有独立关联会话规则处理。

### Multica 的可借鉴部分

只读参考 `/Users/git_local/multica`，不运行或复制其产品代码。首次引导 `step-runtime-connect.tsx` 提供扫描、选择、刷新和空状态；Runtimes 提供设备/版本/诊断，`runtime-profiles-dialog.tsx` 管理配置；`agent-detail-inspector.tsx` 提供模型/思考强度/服务档位；`runtime-required-banner.tsx` 从聊天引导到配置。`install-runtime-issue.ts` 明确提供外部 CLI 安装和终端登录步骤。Merforge 借鉴入口可发现性、状态反馈和故障处理，采用已固定的内置 runtime。

### 可行性证据与限制

2026-10-02 计划编写时，通过已安装固定 payload 的 `app-server generate-json-schema` 在随机临时目录生成稳定 schema，隔离 `HOME`/`CODEX_HOME` 后删除临时目录。确认存在：

- `account/login/start`，`chatgptDeviceCode` 请求及含 `loginId/userCode/verificationUrl` 的响应。
- `account/login/cancel` 及取消状态响应。
- `account/login/completed`，其中 `success` 必填，`loginId` 可空或缺省。
- `account/updated` 和已有 `account/read`。

没有启动真实 app-server、读取原生认证文件、发起登录或调用模型。协议存在使实现具备可行性，但真实网络、组织账号是否允许设备码登录、平台持久化及打包行为仍待验证。Phase 1 固化完整证据和关联规则；设备码流程不可用时显示明确原因，不静默切换浏览器 OAuth 或安装外部 CLI。若固定版本无法满足必需的取消/关联/持久化行为，阻塞对应阶段并记录证据，另行评审替代方案。

当前 [Codex 协议文档](codex-backend.md)禁止原生登录修改。本计划评审后执行时仅新增“本人在 Desktop 显式启动/取消设备码登录”的固定能力，更新该限制的 owning docs；不扩大其他原生认证和配置写入能力。实施授权不等于代替用户进行真实账号登录。

## 约束与产品行为

### 固定用户流程

| 情况 | 显示与操作 | 成功判据 |
| --- | --- | --- |
| 未安装全局 Codex CLI 或桌面应用 | 显示 Merforge 内置 runtime，不检查全局安装作为准入 | 完整安装包可启动固定 runtime |
| runtime 缺失、不匹配或启动失败 | 保留 Codex 卡片，分类原因、重新检测和应用安装修复说明 | 不自动安装、不走 PATH，不伪装成缺登录 |
| 需要认证且没有有效原生登录 | “登录 Codex”，主动生成设备码，用户打开验证链接完成登录 | 准确登录尝试完成后重读账号，再读取模型 |
| 已有有效原生认证 | 显示“使用本机 Codex 登录”与认证方式，不显示账号身份 | 不调用 login/start、不要求 API key，模型可发现 |
| 原生配置无需 OpenAI 认证 | 如实显示无需该认证，继续依原生 catalog 判断可用 | 不把 `account: none` 单独等同于必须登录 |
| 登录中、取消、超时、网络或协议故障 | 显示准确状态与可执行重试，设备码只在当前尝试有效期内显示 | 旧尝试通知不得结束新尝试；取消与清理结果分别处理 |
| 已认证但模型为空或读取失败 | 认证和模型状态分别显示，提供重新检测 | 不推断账号失效，不自动回退 API |
| 首次进入、暂不配置 | 可选择 Codex/API 或稍后设置 | 不发模型请求、不自动建会话、不阻塞项目管理 |
| 登录完成 | 更新设置和各模型选择入口 | 不替用户选择模型、修改 Bot 或启动组织 Run |

卡片展示模型/effort 可用信息；实际模型选择继续由会话、Bot 或组织执行入口拥有，不在设置卡片里创建第二套默认模型。设备码登录受上游账号策略影响，应用显示分类失败和帮助说明。

### 状态、数据与生命周期

- runtime、account、catalog、login 是分别观察的状态，不能用单一“已连接”覆盖。Phase 1 为每个状态确定可序列化的判别联合、revision/generation 和刷新时点；错误只使用固定分类，不从原始异常字符串推断身份。
- `codex-runtime` 定义并实现固定账号读取、设备码开始/取消、关联通知和进程清理；`agent-codex` 内的独立 setup service 拥有登录尝试、可用性快照及配置限额；Desktop 固定 IPC 和 Client 是消费者。复用同一原生环境解析和发现逻辑，不新增竞争 Agent factory。
- 登录使用独立的 managed app-server，不借用运行中会话连接，不创建 thread/turn。一个 Host 同时最多一项登录尝试，所有打开的设置入口共享其状态；按钮重复点击不重复启动。
- 开始前重读原生认证，已有效认证不发起新登录。Merforge 拥有的 Codex 执行活动与登录写入互斥；Phase 1 明确个人、组织和 one-shot 的活动观察点与准入，不能只检查当前打开会话。外部 Codex 进程不受应用锁控制，重读状态不宣称锁住外部认证变化。
- Electron 只接受所属顶层 Desktop 窗口的固定操作；普通远端 Web、iframe、browser guest 与其他进程不能触发登录。请求和迟到回复绑定当前 Host 与窗口代次。窗口销毁、Host 重启、超时或插件卸载取消并 await owned child 和回调排空；关闭设置卡片不隐式取消仍可在同一窗口查看的尝试。
- 设备码和验证链接只给发起窗口的短时登录视图；其他窗口最多看到安全状态。取消操作需匹配 owner 和品牌化尝试 ID。重启不恢复旧设备码、不重放 login/start，先重读账号。
- 账号原始响应、email、token、plan、home、auth 文件、设备码和验证 URL 不进入 Session、Bot、organization SQLite、localStorage、日志或通用 Remote catalog。账号持久化仅由官方 runtime 处理。Renderer 不导入 Node 或读取认证文件。
- 打开验证网站必须由用户点击；通过固定 Desktop 操作打开当前尝试关联、Host 已校验的官方 HTTPS URL，Renderer 不能传任意地址。具体允许的 origin 以固定版本证据在 Phase 1 固化。
- 登录完成通知不是最终就绪判据，必须重读 `account/read` 并按认证要求判断，再重新读取模型。缺失/可空 loginId 通知不能任意匹配当前尝试；根据固定协议为仅有的一项尝试制定关联和复核规则，无法关联则保持未确认并检测，不能假报成功。
- 一次主动刷新采用同一代次快照；迟到探测不能覆盖登录完成后的结果。登录变化使已有 model catalog 缓存失效，所有入口收到通知后更新，不以高频轮询代替生命周期。
- 所有产品文案走中英 typed locale；使用现有 UI primitives、Slots 和注册时绑定的 observable。新增导航能力由 settings shell 拥有，按已声明 props/service 接入，不能跨插件导入设置实现或模拟点击。
- 不启动页面，不使用 Playwright、浏览器自动化、GitNexus 或子代理。Frontend 验证仅静态检查、构建、纯逻辑及无页面组件测试；真实登录、可见和跨平台验收由用户完成。不自动 commit/push，不写 Agent Notes。

## 主阶段状态表

| 阶段 | 主题 | 主要目标 | 状态 | 实际产出 | 备注 |
| --- | --- | --- | --- | --- | --- |
| Phase 1 | 协议与产品规则 | 固化设备码登录、状态和所有者 | completed | stable schema 与协议规则 | 离线测试通过 |
| Phase 2 | runtime 与 setup service | 完成固定登录、取消和安全可用性 | completed | typed runtime、setup service 与共享准入 | 真实 subprocess fixture 通过 |
| Phase 3 | Desktop 固定通道 | 所属窗口操作和目录失效同步 | completed | 私有 IPC v1、product API v2 与目录失效 | 无页面测试、类型/lint、构建和产物 smoke 通过 |
| Phase 4 | Codex 设置卡片 | 状态、登录、取消与重新检测 | completed | 原生卡片、共享短时状态及中英反馈 | 无页面测试及 Client build 通过 |
| Phase 5 | 首次引导与失败入口 | Codex/API 选择和各入口直达设置 | completed | 可跳过接入步骤、typed 导航与草稿保留 | Loader/纯逻辑回归与 Client build 通过 |
| Phase 6 | 组合、发行与交接 | 验证新用户流程并交付手工剧本 | completed | Loader 到 Client、built/packed 及用户剧本 | 工程通过；真实账号/安装体待用户 |

## 阶段细节

### Phase 1：设备码协议、状态与产品规则

**目标：** 将计划中的产品行为转为固定版本证据和可实现的接口，避免把发现、认证和可用模型混为一谈。

**产出区域：** `packages/subagent/codex-runtime/tests/protocol.spec.ts` 与 `tests/fixtures/protocol-0.153.4.json`；`docs/codex-backend.md`；runtime、agent-codex 与 Desktop 的接口设计记录放在该 owning 文档。接口代码在后续对应阶段落地。

**验收清单：**

- [x] 固化 stable schema 的 login/start、login/cancel、completed/updated、account/read 字段、枚举和 required，包括空/缺失 loginId、取消响应及通知先于响应的情况。
- [x] 明确运行时、认证、模型与登录尝试各状态及固定错误分类；配置登录时限、快照缓存等部署可变值，不用测试钩子或 DEFAULT 常量代替 Config。
- [x] 固化设备码主路径和官方验证 URL 校验依据；如离线证据不足，记录需要用户真实验收的精确项目。
- [x] 明确一个 Host 的尝试所有者、跨窗口视图裁剪、个人/组织/one-shot 活动与登录互斥观察点、窗口与 Host 销毁清理，以及无法关联通知的处理。
- [x] 记录允许的固定 Desktop 操作及快照字段；更新原“禁止原生登录修改”的范围，明确只能用户主动开始/取消设备码登录。

**助理验证：** 离线固定 payload schema 对照测试；临时目录隔离并清理，禁止真实登录/模型；文档路径和接口消费者清点。

**用户检查：** 评审卡片字段、可跳过引导和设备码主路径；本阶段不依赖真实账号验证，协议必需能力缺失才阻塞。

**依赖：** 无；不改已有后端执行语义。

**实际完成：** stable schema 全字段证据已写入 protocol fixture，协议页定义状态、窗口裁剪、取消/无 ID 关联、执行准入和官方 URL。`pnpm exec vitest run packages/subagent/codex-runtime/tests/protocol.spec.ts` 通过（1 test）。额外只读核对官方 rust-v0.153.4 的 device_code_auth.rs/server.rs 默认 issuer 与 URL 拼接。未运行真实登录或模型；账号策略、持久化和平台留 Phase 6。下一阶段 Phase 2。

### Phase 2：固定账号方法与 Host setup service

**目标：** 让 Host 拥有一次可取消、可诊断、不会启动模型的登录流程，以及供设置和 catalog 使用的同源可用性。

**产出区域：** `packages/subagent/codex-runtime/src/{types,protocol,runtime}.ts` 与相应测试；`packages/core/agent-codex/src/index.ts`、setup service 新模块与声明、相关测试及 README。必要的执行活动准入改动只进入 Phase 1 明确列出的消费者。

**验收清单：**

- [x] 实现 typed 的读取、开始、取消和通知接口；不公开通用 RPC，不把 token 或身份字段带到外部消费者。
- [x] setup service 统一配置解析、managed process owner、可用性快照、尝试代次和失效通知；driver catalog 复用其发现逻辑，失败不阻断 API Provider catalog。
- [x] 重复开始、并发刷新、响应前通知、旧完成通知、取消与完成竞争、超时、EOF 和清理失败有准确状态；取消未确认不假报远端取消成功。
- [x] 认证成功后重读账号和模型；模型为空与认证失败分别记录。已有有效登录或无需认证的配置不发起 login/start。
- [x] 开始/执行相互检查 shared activity 准入，覆盖本 Host 个人、组织和 one-shot；setup 不创建 Agent、Session、thread/turn 或模型请求。
- [x] 超时、失败、卸载和取消都排空所属 managed range；未知开始结果不自动重放，认证文件操作全由官方 runtime 完成。

**助理验证：** 真实 subprocess/transport 搭配确定性 app-server fixture，测试状态竞态、敏感字段裁剪及 child 清理；受影响源程序类型和局部 lint。测试只模拟外部 Codex peer，不替换生命周期与 setup 实现。

**用户检查：** 真实设备码登录暂留 Phase 6；本阶段不操作本人账号。

**依赖：** Phase 1 的证据、接口和准入规则。

**实际完成：** runtime 新增 safe account read、device start/cancel、裁剪通知与官方 endpoint 校验；`agent-codex/src/setup{,-types,-protocol}.ts` 拥有单尝试、配置时限、同代次可用性和 owner view，driver catalog 复用 setup。共用 runtime 的进程准入覆盖个人/组织，one-shot 在 spawn 前使用同一许可；不改它们的执行语义。Loader 加真实 subprocess/transport fixture 覆盖重复开始、早到/无 ID/旧通知、认证复核、模型空/失败、取消/完成竞争、超时、EOF、未知开始、owner/unload 清理和敏感裁剪；新增 cleanup failure 保留准入锁至 Host 重启。`pnpm exec vitest run packages/core/agent-codex/tests/setup.spec.ts apps/desktop-host/tests/codex-setup.spec.ts apps/desktop/tests/codex-setup-ipc.spec.ts apps/desktop/tests/preload-app.spec.ts` 34 tests 通过；受影响 `tsc -b` 通过。长期诊断使用固定 component/status/category/generation（快照 revision）、cleanup 和 cancellation，未记录身份、grant 或 raw 错误。未运行真实账号/模型。下一阶段 Phase 3。

### Phase 3：Desktop 固定 IPC 与模型目录同步

**目标：** 将 setup 能力安全地接入所属 Desktop 窗口，并确保登录变化抵达所有现有模型消费者。

**产出区域：** `apps/desktop-host/src/index.ts` 与新增固定 setup control；`apps/desktop/src/{ipc,preload-app,host-process}.ts` 与固定操作处理；Desktop 通道公共类型的 owning 模块；`packages/api/session-controller/src/catalog.ts`、相关事件/Remote 生成与模型 catalog 消费者。

**验收清单：**

- [x] 仅暴露安全 snapshot、主动 detect、start/cancel、打开当前验证链接及订阅；短时设备码响应与通用安全状态分开，不开放 logout、任意 URL 或任意 RPC。
- [x] 校验所属顶层窗口、origin、请求字段、品牌化 attempt ID 和 Host/窗口代次；跨窗口取消、iframe/guest/远端请求、迟到旧 Host 回复拒绝。
- [x] 拥有登录的窗口销毁时取消并清理；Host 断连后短时码失效，新 Host 只做检测，不重放登录。
- [x] setup 变化使共享模型 catalog 失效；个人、Bot 和组织选择消费同一更新，晚到旧响应不能恢复失效模型。
- [x] 缺登录、payload、协议和模型目录错误使用固定操作原因；API catalog 和现有默认选择保持原语义。
- [x] 源/产物接口同时更新，按实际兼容变化核对 Host protocol 与 preload product API 版本；不依赖旧 lib 让源码检查通过。

**助理验证：** 无窗口固定 IPC 测试、真实 Host 组合与拒绝路径、目录失效/代次竞态测试；生成声明、受影响 Client/Host 类型、exports 与组合门禁。

**用户检查：** 真实窗口验证网站打开与手工登录留 Phase 6；无阻塞性可见前置。

**依赖：** Phase 2；复用 Desktop 安全校验，不新增网络登录 API。

**实际完成：** `apps/desktop-host/src/codex-setup.ts` 实现固定私有 parent IPC v1；`apps/desktop/src/{host-process,codex-setup-ipc,ipc,main,preload-app}.ts` 实现 nonce/requestId、所属顶层窗口及 origin 校验、Electron-owned owner、Host/文档代次复核、窗口退休、官方验证站点打开和安全状态订阅。短时 grant 只给 owner，原生 loginId 和 URL 不进入 Renderer；Host 断连清空可用性，旧广播和旧回复不能覆盖最新快照或恢复验证码。preload product API 升为 v2，所有已知消费者与 fixture 同步，未运行浏览器 fixture。

`session-controller` 新增固定 `setupReason` 及 `api-session/model-catalog-changed`，Remote 产物已更新。个人输入框共享目录、Bot 和组织模型入口按同一 revision 清除退休 availability 并拒绝旧读取；持久选择和 API Provider 语义不变。新增 Loader/setup/subprocess 组合、私有 IPC、Electron sender 拒绝与断连竞态测试；setup 卸载撤销 driver 注册及排空所属进程。owning README、协议页和 overview 已同步，设置卡片、首次引导及失败导航仍未实施。

本轮验证记录（不重复已通过的全量检查）：

| 命令/检查 | 实际结果 |
| --- | --- |
| `pnpm exec vitest run packages/subagent/codex-runtime/tests/protocol.spec.ts` | 离线固定 schema 1 test 通过 |
| 聚焦 runtime、setup、bridge、Desktop IPC/preload、catalog、个人/Bot/组织无页面回归 | 22 files 的初轮为 270 passed / 1 failed；失败为新 cleanup 测试误要求 SIGTERM 后 exitCode=0，修正断言后 cleanup/IPC 6 tests 通过；随后 setup/bridge/HMR 等 48 tests 通过 |
| `pnpm exec vitest run packages/core/agent-codex/tests/setup.spec.ts apps/desktop-host/tests/codex-setup.spec.ts` | 最终 17 tests 通过 |
| `pnpm exec vitest run apps/desktop/tests/host-process.spec.ts apps/desktop/tests/codex-setup-ipc.spec.ts` | 最终 22 tests 通过，含广播及快照回复的旧 revision 裁剪、Host loss |
| `pnpm exec tsc -b apps/desktop-host apps/desktop/tsconfig.host.json packages/core/agent-codex packages/subagent/codex-runtime packages/api/session-controller/tsconfig.host.json packages/api/session-controller/tsconfig.client.json packages/client/ui-model-selection packages/client/ui-personal packages/client/ui-organization --pretty false` | 受影响 Host/Client 程序通过；最后 Host 修改后再次检查 Desktop Host face 通过 |
| `pnpm exec tsx scripts/run-oxlint.ts`，参数为全部变更的 `.ts/.tsx/.mjs` 文件 | 局部 lint 通过；最后 Host 修改后对应两文件再次通过 |
| `pnpm run build` | 完整 Desktop build 通过，没有启动应用或页面 |
| `pnpm exec tsdown --env.DSH_BUILD_FACE host --filter '@deepseek-ai/dsh-agent-codex' --filter '@deepseek-ai/dsh-codex-runtime' --filter '@deepseek-ai/dsh-desktop-host' --filter '@deepseek-ai/dsh-desktop'` | 最新相关 Host 产物构建通过；最后 Desktop 修改后单独重建该 filter 通过 |
| `node apps/desktop-host/tests/codex-setup-built-smoke.mjs` | 最新产物的固定 IPC、owner grant、官方 URL、取消和真实 child cleanup 通过 |
| `node apps/desktop-host/tests/codex-built-smoke.mjs` / `node apps/desktop-host/tests/organization-codex-built-smoke.mjs` | 既有 Codex 与组织真实组合 smoke 通过，含 Node/Electron Node mode |
| `verify-client-ui-i18n` / `verify-cordis-config` / `verify-application-entrypoints` / `gen-tsconfig-paths.ts --check` / `gen-scoped-events` | 分别通过 840 sources、21 configs、entrypoints、source aliases 和事件生成；事件生成无 tracked diff |
| `git diff --check` | 通过 |

仓库既有失败单列，未计为通过，也不扩展本轮修复范围：

- `ui-settings-general/tests/shell.client.spec.ts` 为 8 failed / 1 passed；用 HEAD 原源码和原测试临时复跑获得完全相同结果后恢复当前文件。失败涉及缺少 `session/create` mock、旧 sections 预期和 account timeout。
- `gen-config-catalog` 无法处理 organization-api `./tls.ts` 与 organization `./schema.ts` 两个既有 schema import；`gen-cordis-api` 在 `organization/src/integration-schema.ts` 的 `integrationReceiptSchema` 无 comment JSDoc 处崩溃。新服务/事件 owner map 已补齐，协议与 README 已更新；全局文档生成仍待修复这些前置问题。
- `verify-export-jsdoc` 余下 OrganizationLoginSession.read/save 两个既有 prose 缺项；`verify-package-dependencies` 为 file-upload 的 `assertPersonalSessionId` 导入分类缺项；`verify-no-unknown-casts` 为五处既有 baseline；client domain graph 为 62 处既有跨 domain 导入，本轮没有新增这些导入或 unknown cast。

没有启动页面、浏览器、真实登录或模型，没有读取本人认证文件、调用子代理、使用 GitNexus、写 Agent Notes 或自动提交/推送。真实窗口打开、账号策略、平台持久化和安装包验收仍待用户在 Phase 6 检查，不能将工程检查算作这些验收。已完成授权 Phase 1–3，下一推荐 Phase 4，本轮停止于 Phase 3。

### Phase 4：模型设置中的 Codex 卡片

**目标：** 即便 runtime 缺失或尚未登录，用户也始终能在模型设置找到 Codex 和下一步操作。

**产出区域：** `packages/client/ui-settings-models/src/client/{ModelsSection,index,locales}.ts(x)`、新增 Codex 设置卡片/状态与操作适配、CSS 和无页面测试；按需更新 Slots 类型声明和 package README。

**验收清单：**

- [x] Codex 是独立原生后端卡片，与 API Provider 编辑并列，不出现 API key 输入或错误“未配置 API key”状态。
- [x] runtime 版本、认证方式、模型状态分别展示；成功状态说明复用本机登录，缺 runtime 提供应用安装修复说明及重新检测。
- [x] 设备码等待视图包含复制、用户点击打开官方验证站点、取消、有效状态及分类失败重试；不使用无协议依据的剩余秒数或成功推断。
- [x] 多处打开共享 Host 状态，短时码只给 owner 窗口；关闭卡片再打开可继续查看，旧代次不能覆盖最新结果。
- [x] 中英 locale、键盘操作、可访问名称、等待/禁用状态和模型列表均从 typed 状态派生；组件不自己建立外部订阅。
- [x] 仅展示模型/effort 能力；重新检测和登录不写默认模型、不创建或执行会话。

**助理验证：** 无页面状态/操作和组件行为测试，聚焦类型、局部 lint、i18n、Slot/domain graph 与 Client 构建。禁止启动页面或浏览器。

**用户检查：** 卡片布局、可读性、焦点和验证码体验，留 Phase 6 手工剧本，不把静态通过算作可见验收。

**依赖：** Phase 3。

**实际完成：** ModelsSection 声明独立 settings.models.native 卡片，在 API join 失败时仍显示；CodexCard 与 codex-source 通过注册时 hooks/固定回调共享状态，内存保留 owner 验证码并拒绝迟到 revision 与旧 Host 代次。卡片分开呈现 runtime、原生认证、模型、登录、取消确认与 cleanup，官方网站只由固定操作打开。中英 typed locale、代码复制与键盘按钮、模型/effort 信息已完成，不写默认值或创建会话。聚焦 4 文件 124 tests 通过，追加 Desktop 注册/卸载后 apply 16 tests 通过；tsc -b ui-settings-models、变更文件 run-oxlint、verify-client-ui-i18n（842 sources）及 tsdown client filter 通过。布局、焦点和真实设备码留 Phase 6 用户验收。下一阶段 Phase 5。

### Phase 5：首次接入与失败直达设置

**目标：** 从首次进入和使用失败两处都能找到 Codex 配置，接入后现有模型入口立即可用。

**产出区域：** `packages/client/ui-settings-models` 的 welcome/onboarding 状态及视图；`packages/client/ui-settings-general` 的 shell 导航、`ui-settings` 声明；`packages/client/ui-model-selection`、`ui-personal` Bot 编辑、`ui-organization` 既有 ExecutionPanel 和中英文 locale；对应纯逻辑/组件测试。

**验收清单：**

- [x] 在既有欢迎流程增加可跳过的模型接入选择，含 Codex、已有 API 设置和稍后配置；Desktop 不启用原强制 API credential onboarding。
- [x] 已认证且模型可用时允许继续使用；缺登录/模型/runtime 时展示对应操作，不用 API credential 判断原生可用性。
- [x] 首次步骤完成/跳过的设置只保存偏好，不保存认证或验证码；重开不重复阻塞已有用户，设置卡片仍可随时访问。
- [x] 会话模型失败、Bot 原生模型失败、组织执行选择失败可直达同一 Codex 卡片，返回保留原草稿；通过 shell-owned typed 导航，不导入其他插件组件。
- [x] 登录完成使已有目录刷新，错误提示消退；用户仍明确选择模型/effort，组织资格继续由组织权威检查。
- [x] API 配置、旧 API 会话、Bot 默认值、已有 native 会话、后端切换建新会话和组织人工提交/验收均保持现有行为；登录成功不派发任务。
- [x] 纠正旧“先在本机 Codex 登录”文案，并按当前能力表修正关联入口中的过时限制说明，不扩展执行能力。

**助理验证：** 首次/跳过/重开投影、shell 导航、目录失效和草稿保留的无页面测试；受影响类型/lint/i18n/Client 构建；现有 API/native 选择聚焦回归。

**用户检查：** 从首次进入、个人、Bot、组织三个入口完成接入及返回，留 Phase 6 手工验收。

**依赖：** Phase 4；与 7C 无实施依赖。

**实际完成：** Desktop 新增 model-setup 可跳过步骤，modelSetupVersion 只保存 v1 偏好；已有非空会话或已完成偏好不再显示，原强制 API credential 步骤保持关闭。ui-settings 定义 SettingsNavigation/target 声明，ui-settings-general 提供导航服务和已访问页的挂载保留；模型菜单、Bot、组织 ExecutionPanel 使用固定 callbacks 打开同一 Codex 卡片。设置内来源返回原 section；Bot 暂时隐藏 Modal chrome，草稿由原 owner 保留。更新旧原生登录和过时能力提示，不改变业务派发。新 Client Loader 测试验证共享 source、仅 preference 写入、单 target 及卸载；pure/组件/原选择 7 文件初次 100 passed（旧切换卸载预期已改为隐藏保留），后续 9 文件 80 tests、5 文件 56 passed、修正新 Loader 断言后 2 文件 5 tests 通过。受影响六组 tsc、局部 lint、i18n（845 sources）、client-packages（59 packages）及全部相关 Client filter build 通过。domain graph 为既有 62 处，不含本轮导入。真实首次/返回布局仍留 Phase 6。下一阶段 Phase 6。

### Phase 6：组合验证、发行路径与用户交接

**目标：** 用实际组合和产物验证接入链路，并明确哪些产品行为仍需真实账号与平台确认。

**产出区域：** `apps/desktop-host/tests` 新用户 setup 组合和 built/packed smoke；相关 runtime/Client 回归；`docs/codex-backend-acceptance.md`、`docs/codex-backend.md`、受影响 README 和 `docs/overview.md`。

**验收清单：**

- [x] 真实 Loader + managed subprocess + 固定 Desktop 通道验证：无登录 → 开始 → fixture 完成 → 重读认证/模型 → 目录可选；全链无 API 模型请求、thread/turn 和业务自动执行。
- [x] 缺 payload、版本不匹配、无认证、无需认证、模型为空、设备码拒绝、超时、取消竞争、旧通知、Host 重启/窗口销毁与拒绝来源均有行为证据。
- [x] 聚焦回归覆盖原个人/API/组织消费者，读取保持私有，one-shot 不获得登录写入权限。
- [x] Desktop build 和必要发布路径 smoke 通过；普通 Node/Electron Node mode 验证实际 exports/固定 payload 解析，隔离原生认证，不把 app-server 替身当作真实账号验收。
- [x] 发行检查覆盖平台 Codex payload 和独立 Electron Node executable；缺全局 CLI 不影响解析。当前不能执行的 Windows 安装包检查明确待用户，不计为通过。
- [x] 新用户手工剧本包含未装外部 Codex、没有原生登录、已有登录、验证码取消/过期、重开、模型选择/两轮对话、组织入口和 API 继续可用；可能影响原生登录的操作由用户在独立 OS 测试账号内进行。
- [x] 已运行命令、既有失败、新失败、未运行项和产品验收待办分别记录；不得通过修改全局基线或跳过门禁制造全绿。

**助理验证：** 按改动选择聚焦 vitest、受影响源程序类型、局部 lint、i18n/exports/JSDoc/事件/Config/组合/依赖门禁；执行一次必要完整 `pnpm run build` 与无窗口 built smoke。不默认跑全仓测试，已有通过项只在新修改或失败证据要求时重跑。

**用户检查：** 真实设备码登录、官网回执、实际原生账号持久化、macOS/Windows 安装包与可见入口、真实两轮模型对话。上述检查未运行时允许工程阶段完成，但产品验收明确待定；若工程依赖的协议行为只能通过该检查确认，则记录具体 blocker，不能宣布依赖阶段完成。

**依赖：** Phase 5。

**实际完成：** 新增 `codex-setup-flow.spec.ts`，贯通真实 Loader、managed subprocess、固定 Host control、Desktop handler、Client source 和实际 model catalog：无登录 → owner 验证码 → 用户固定打开 → fixture 完成 → 认证/模型复核 → 原生模型可选。保留 API 默认值，没有 thread/turn 或 Agent 执行。补齐设备码拒绝、payload 缺失/版本不匹配、平台 payload 文件保留、已有非空 Session 抑制首次步骤和固定诊断回归。source 卸载清除短时 view；API target 等异步表单就绪后定位一次，刷新不抢焦点。

setup built smoke 验证取消、完成复核、已有认证复用与 child 排空；packed smoke 提取真实 tarball exports，在普通 Node/Electron Node mode 运行 setup 与两回合执行 smoke，并在空 PATH 下验证固定 wrapper。组织 built smoke 通过双员工、人工等待、冷重开、返工和最终集成。协议页、受影响 README、overview 与[验收交接](codex-backend-acceptance.md)已更新；手工剧本覆盖新用户、取消/过期/重开、来源返回、两轮真实对话、API 和分平台安装体验证。

本阶段实际命令与结果（不同测试批次有重叠，不累加为唯一用例总数）：

| 命令/检查 | 实际结果 |
| --- | --- |
| `pnpm exec vitest run packages/core/agent-codex/tests/setup.spec.ts apps/desktop-host/tests/codex-setup.spec.ts apps/desktop-host/tests/codex-setup-flow.spec.ts apps/desktop/tests/codex-setup-ipc.spec.ts apps/desktop/tests/host-process.spec.ts apps/desktop/tests/preload-app.spec.ts packages/subagent/codex-runtime/tests/protocol.spec.ts` | 7 files / 54 tests 通过；协议为离线 schema，未启动真实登录或模型 |
| `pnpm exec vitest run apps/desktop/tests/prepare-package-set.spec.ts apps/desktop/tests/runtime-tree.spec.ts apps/desktop/tests/runtime-manifests.spec.ts apps/desktop/tests/runtime-file-policy.spec.ts apps/desktop/tests/prepared-runtime-smoke.spec.ts packages/subagent/codex-runtime/tests/process.spec.ts packages/subagent/codex-runtime/tests/runtime.spec.ts` | 7 files / 75 tests 通过 |
| `pnpm exec vitest run packages/client/ui-settings-models/tests/codex-source.client.spec.ts packages/client/ui-settings-models/tests/model-setup-onboarding.client.spec.tsx packages/core/agent-codex/tests/setup.spec.ts packages/subagent/codex-runtime/tests/payload.spec.ts apps/desktop/tests/runtime-file-policy.spec.ts` | 最终负例增量 5 files / 38 tests 通过；payload mock lint 修正后独立重跑 5 tests 通过 |
| `pnpm exec vitest run packages/client/ui-settings-models/tests/components.client.spec.tsx packages/client/ui-settings-models/tests/model-setup-onboarding.client.spec.tsx` | 108 passed / 1 failed；新增焦点测试误期待 OpenAI 而现有排序为 DeepSeek 优先，修正后按 `-t 'focuses the API destination'` 重跑 1 passed / 102 非目标用例 skipped；产品排序未改 |
| `pnpm exec vitest run packages/client/ui-settings-models/tests/codex-source.client.spec.ts packages/client/ui-settings-models/tests/codex-composition.client.spec.ts` | source 卸载修改后 2 files / 5 tests 通过 |
| `pnpm exec vitest run --config vitest.e2e.config.ts packages/subagent/codex-runtime/tests/built-runtime.e2e.ts` | 普通 Node 的 built runtime 1 test 通过；受控外部协议 fixture，不是 real-API 验收 |
| `pnpm exec tsc -b packages/client/ui-settings-models packages/client/ui-settings-general packages/subagent/codex-runtime packages/core/agent-codex apps/desktop-host` | 通过；最后 source 修改后单独 `tsc -b packages/client/ui-settings-models` 通过；其他受影响 Client 类型见 Phase 5 |
| `pnpm exec tsx scripts/run-oxlint.ts`，参数为全部变更 TS/TSX/MJS | 初次 46 files 只有新增 payload mock 两项 lint；修正后该文件与最后变更文件局部检查均通过，其余文件初次通过 |
| `pnpm run build` | 初次及最终 source 调整后的完整 Desktop 构建均通过；最终记录 258 client artifacts / 3 public values，没有启动应用 |
| `pnpm exec tsx -e 'import { readClientBuildRecord } from "./scripts/client-build-environment.ts"; const record = readClientBuildRecord(process.cwd()); console.log("client artifact record verified:", record.artifacts.fileCount);'` | 最终 258 个 Client 产物的构建记录与当前字节一致 |
| `pnpm exec tsdown --env.DSH_BUILD_FACE client --filter '@deepseek-ai/dsh-client-ui-settings-models/client' --filter '@deepseek-ai/dsh-client-ui-personal/client'`；最后仅 models filter；`DSH_DESKTOP_BUILD_ONLY=1 pnpm run build:web` | 最终 Client 与 Vite 构建通过；Vite 保留既有 chunk size 提示 |
| `node apps/desktop-host/tests/codex-setup-built-smoke.mjs` / `node apps/desktop-host/tests/codex-packed-smoke.mjs` / `node apps/desktop-host/tests/organization-codex-built-smoke.mjs` | 全部通过；packed/组织含普通 Node 与 Electron Node mode，当前机器 darwin/arm64 |
| `pnpm exec tsx scripts/verify-export-jsdoc.ts` | 新 copy 参数注释修正后仅余 OrganizationLoginSession.read/save 两个既有 prose 缺项 |
| `git diff --check` | 通过 |

Phase 4–5 已通过 i18n（845 sources）、client-packages（59 packages）、相关 Client 构建；本轮 `verify-cordis-config`（21 configs）、`verify-application-entrypoints` 和 `gen-tsconfig-paths.ts --check` 通过。已运行的 `verify-package-dependencies` 仍为 file-upload 的 `assertPersonalSessionId` 分类缺项，`verify-no-unknown-casts` 仍为 session-controller 三处与 agent/inbox 两处，domain graph 仍为 62 处既有跨 domain 导入；未修改这些基线。Phase 1–3 所记录的 shell 组合失败与 Config/API 文档生成失败本轮未重跑，不计为新结果；新增 navigation service owner 已登记，接口事实在 owning README。

真实设备码网站/账号策略、原生认证持久化、真实模型两轮、可见布局/焦点、macOS/Windows 安装包/签名/进程树均未执行。没有读取本人认证、启动页面/浏览器、安装 runtime、使用子代理/GitNexus、写 Agent Notes 或提交/推送；不将 fixture 成功或工程构建记为这些产品验收通过。

## 关键链路诊断

使用现有 `ctx.logger` 和 `component=codex-setup event=<event> status=<status> category=<category> generation=<n> runtimeVersion=0.153.4` 的固定字段。Desktop IPC 层沿相同 component 标记，避免在多个层重复记录同一高频探测。日志为长期维护诊断，默认记录错误和重要状态变化，重复成功读取使用 debug。

| 阶段/链路 | 必须记录的事实 | 用途 |
| --- | --- | --- |
| Phase 2 runtime → setup | payload/handshake 失败、检测完成、登录开始/等待/完成复核/取消/超时、cleanup 结果 | 区分安装、原生认证与模型问题 |
| Phase 3 Desktop → Host | 固定操作接纳/拒绝、代次失效、owner 销毁、目录失效 | 定位来源拒绝、断连和迟到回复 |
| Phase 4–5 UI 操作结果 | 仅必要的固定操作/导航失败分类；成功使用已有 store 状态 | 定位入口失败，不逐 render 输出日志 |
| Phase 6 组合回归 | 检查上述分类并保证 fixture 敏感值从诊断与持久记录中缺席 | 验证实际用户路径的诊断可用性 |

严禁日志记录账号身份、token、home/绝对认证路径、设备码、verificationUrl/authUrl、raw stderr、RPC params、模型目录全量和 UI 草稿。过程状态不是业务 Session 事件；setup 不向模型提供新输入，因此不伪造对话日志。

## 后续执行规则

1. 开始前读取本计划、`docs/overview.md`、当前用户约束和 applicable AGENTS.md。改 packages 前读架构；生命周期/进程工作读 defensive patterns；Client 层读 web-client/Slots/conversation 当前规范。只执行本计划范围。
2. 首版计划创建后停止，等待用户评审或明确执行命令。`继续`在本计划成为已选择目标后，先恢复首个 `in_progress`，否则执行首个 `pending`；先复核有关 `blocked` 阶段的解除条件，不越过依赖。
3. `execute Phase X` 或“执行 Phase X”只执行该阶段，本轮不会自动进入后续阶段，即便持久模式为自动；依赖未完成且无法隔离时报告依赖。`manual` 完成所选阶段、更新记录并报告后停止。
4. 计划已存在且用户明确要求连续做到完成时才能改为 `auto`，两个自动边界保持 `none`；明确要求做到某阶段/若干阶段时解析为 `auto_until`，执行前记录原授权和具体闭区间。省略起点取首个当前 `in_progress` 或 `pending`；按主表顺序换算数量，验证起止与依赖，歧义时只澄清边界。单阶段命令、普通鼓励和初始计划请求不启用自动模式。
5. `auto` 在阶段完成后继续符合依赖的阶段；`auto_until` 只选择记录范围内未完成阶段，不重复 completed。每次自动选择前重读状态、模式、依赖和授权边界，先改为 `in_progress`。不因非依赖性的可见/真实登录待验自动停下。
6. 出现影响产品结果的未解决选择、必须的人类验证/外部状态、新权限或凭据、不可安全修复的验证失败时，标记受影响阶段 `blocked` 并记录解除条件；保留自动模式和授权范围，除非用户撤销。用户要求停止或变更目标时遵守最新指令。
7. `auto_until` 的整个授权范围及必要交付均完成后恢复 `manual`，清空起止为 `none`，记录到达终点，不执行更晚阶段；停止阶段 completed 不能代替整个范围 completed。
8. 仅实施时证据表明一个阶段无法在正常上下文内安全完成才拆分，通常最多两项；先更新主表、受影响细节/验收和顺序再实现。保留其他编号；原阶段 stop 映射其最终子阶段，明确子阶段 stop 按用户原授权执行。
9. 每阶段具体记录实际文件、命令和结果、未运行项、偏差/风险与下一阶段；主表仅摘要，不增加第二份全局进度记录。同步 `docs/overview.md` 和改变的 owning README/协议页，未实现能力始终标注待实施。
10. Relay 保持 `off`，不创建新 chat、task-specific executor skill 或子代理。若用户另行明确启用 relay，先读取该 Skill 的 `references/conversation-relay.md`；涉及 worktree return 再读对应引用并补齐授权、交接、所有权和已验证交付字段，不临时推断。
11. 工程完成与真实账号/平台/可见验收分开；只报告实际跑过的命令。全程不代登录、不安装 runtime、不访问原生认证文件，不发布、不部署、不自动提交或推送。
