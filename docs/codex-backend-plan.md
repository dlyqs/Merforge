# Codex 对话后端与组织外部执行实施计划

本文细化[产品路线图](../ai-native-work-os-product-roadmap.md)的 **产品 Phase 7B**。Phase 1–10 是本计划内部编号，与产品 Phase 7A、7B、7C 分开管理。针对本文说“继续”或“执行 Phase X”时，先读取本文及[工程概览](overview.md)。本计划是阶段状态的唯一来源。

## 目标、歧义检查与范围

2026-10-02 检查时，仓库只有路线图的 7B 概述，没有独立实施计划。用户明确要求参考 `/Users/git_local/multica`，让 Merforge 能用 Codex 替代内部依赖 API key 的模型进行交互。本计划据此扩展原先“应用模型规划，Codex 仅执行”的范围：**用户选择 Codex 后，普通对话、澄清、已有任务规划及获准执行由 Codex 承担，不要求另配 Merforge 模型 API key，也不在后台启动一个 API 模型负责监督。** 现有 API 模型仍是独立可选后端，不强制迁移已有会话。

这是涉及 Agent 驱动、持久日志、工具许可、组织权限及 Desktop 组合的大目标。当前请求授权检查与创建计划，没有授权跳过计划评审。全部阶段保持 `pending`。

范围内：

- 复用已有官方 Codex app-server 传输与 subprocess 管理，提供独立于 one-shot subagent 的持续对话后端；同一 Merforge Session 保留原有项目/Bot、查询、归档及运行展示关系。
- 本机原生登录状态、可用模型与推理选项、流式输出、多轮续聊、停止、重开核对、人工提问/审批、错误分类及实际产物证据。
- 通过受控工具桥接消费现有 personal-workflow、skill-dev-workflow 与组织任务服务；计划、批准、委托、提交和验收仍归现有服务及真人动作。
- 组织精确任务版本、有限委托、设备租约、逐动作许可、独立日志、有限预算与撤权停止的 Codex 消费者。
- Desktop 内的后端选择、能力限制说明、状态/请求/产物展示与无页面验证。

范围外：新建 CLI/Web/SDK 产品入口、托管或组织共享用户订阅后端、收集/共享登录 token、其他外部 Agent、跨设备 Codex thread 接力、自动提交/push/部署、后台自动负责人调度，以及复制 Multica 的 Go daemon、数据库或 UI。本轮不创建额外执行器 Skill，不启用新聊天 relay。

产品 Phase 7C 继续拥有“默认复杂度识别、无任务组织规划、对话内分配与管理”的业务建设。7B 先消费现有显式个人规划和已有组织任务，不重复实现 7C；7C 落地后通过同一后端能力接口接入。7B 的基本个人对话与组织 Run 不依赖 7C；**Codex 完整覆盖组织目标对话需要两者均完成**，不能以 7B 完成宣布 7C 已实现。

## 当前证据、参考与可行性

### Merforge 已有实现

| 位置 | 当前事实 | 计划中的处理 |
| --- | --- | --- |
| `packages/subagent/subagent-codex/src/{run,wire,jsonrpc}.ts` | 固定 `@openai/codex@0.153.4`；每次一个新进程、ephemeral thread 和 turn；返回最终文本/安全诊断；没有持续对话、模型发现或真人等待 | 保留 one-shot 行为；提取两种消费者真正共用的传输/进程代码，不把最终文本委派冒充主对话 |
| `packages/core/agent/src/index.ts`、`packages/core/agent-loop` | AgentRegistry 只有一个创建 factory，loop 注册它；Agent 有公共生命周期及 Session 写入约定 | Phase 1 固化多后端路由及单一日志写入者，不能再注册一个竞争 factory；必要公共 API 变化更新全部消费者 |
| `packages/api/session-controller/src/{agent,commands,control,history,catalog}.ts` | 普通发送、恢复、模型选择、列表/查询、流与控制依赖内建 Agent/LLM | 接显式后端选择和能力检查，保留 API 模型路径；不把 Codex CLI 的自主工具行为塞进 LlmAdapter |
| `packages/workspace/personal-project`、`personal-workflow`、`packages/skill/skill-dev-workflow` | Bot 模型默认值当前引用 LLM route；项目/Bot 输入、工具/Skill 限制和计划资格在既有流程检查 | 更新默认后端引用及真实消费者；Codex 桥接仍执行相同资格检查 |
| `packages/workspace/organization-execution/src/{index,runtime,model,guard}.ts` | 独立 Run/JSONL；内建模型 HTTP 发送前复核；有界文件工具；当前拒绝 shell | Codex 必须新增明确的后端与受控工具消费，不伪造 HTTP endpoint，不把原有 model permit 当作任意外部进程许可 |
| `apps/desktop{,-host}`、`packages/host/organization-connection` | 私有 Host、固定 IPC/native 动作、当前身份 generation、Electron 所有的认证材料 | 维持现有所有者与固定命令，Renderer 不得到通用进程/JSON-RPC/组织代理 |

### Multica 参考

本次只读抽查本地 `/Users/git_local/multica` 的提交 `32a396fd520bdbdec2d6cd95b5742da946003ca9`，没有运行其产品、测试或导入其代码。这与路线图 v0.4 的旧参考快照不同，不覆盖旧对照的核验范围。

- `server/pkg/agent/agent.go`：执行选项、进度流/终态分离、resume 标识、准备超时和取消超时、已观测终态不被清理失败改写。
- `server/pkg/agent/codex.go`：initialize、thread/start/resume、turn/start、流式事件、turn/interrupt、运行中追加输入、最终回答选择和当前 turn 过滤。借鉴失败场景；本计划不采用其部分失败后自动新建 thread 的兼容路径。
- `server/internal/daemon/execenv/codex_home.go`：配置/会话目录隔离、模型缓存关联、稳定会话存储。借鉴分离原则，不直接复制整份用户配置、skills、MCP 或 sessions。
- `server/internal/daemon/execenv/codex_sandbox.go`：存在平台相关 `danger-full-access` 选择。该取舍不能照搬；Merforge 的沙箱承诺以自己验证过的能力为准，失败不得自动扩大权限。
- `LICENSE`：上游含附加商业/品牌等条件。本计划仅参考行为与故障设计，实现优先来自本仓库及官方协议，不做逐行翻译。

官方依据：[Codex App Server](https://developers.openai.com/codex/app-server/)（2026-10-02 已读取）。该页描述双向 JSON-RPC、持久 thread、多轮 turn、流式 item、账号/模型发现和客户端工具调用；`dynamicTools` 及部分用户输入接口需要 experimental capability。官方当前页面不能直接证明本仓库固定 0.153.4 支持每一项，实施时必须对所选 payload 的生成 schema 和实际协议复核。该页也限制 app-server 原生认证用于商业/托管服务；本计划只覆盖获准的本地应用场景，若产品部署方式改变，另行评估官方授权接入，不能扩展成共享账号服务。

可行性结论：**个人 Codex 持续对话可行；完整组织执行有明确技术门槛。** 原生工具不会自动穿过 Harness guard，动态工具也不会自动关闭原生 shell、文件、MCP 或子代理。组织可用资格必须先证明“只暴露受控工具”和配置/上下文隔离；若所选版本无法做到，应将对应阶段标为 `blocked` 并说明缺少的能力，不能靠提示词、输出回报或 turn 完成后补账替代许可。账户可用性、真实用量、macOS/Windows 原生隔离及真实模型效果仍需实际验证。

## 约束与接口方向

1. **显式后端。** 持久选择区分 `harness-api` 与 `codex`。API 路由保留 provider/model；Codex 引用经过验证的 runtime/model/effort 及能力，不要求 API credential 或虚构 endpoint。未选择的旧会话保持原 API 行为。选择或加载失败明确报错，不自动调用收费 API，不悄悄切模型/后端。
2. **官方运行时。** 优先复用现有固定 payload 和 subprocess seam。可选已安装 CLI 必须由 Config 显式选定位置、核验版本并进入兼容矩阵，不能作为损坏 payload 的隐式 fallback。禁止 shell 拼接、任意 CustomArgs、自动安装/升级和写用户原配置。Desktop 闭包、签名、payload notices 及发行体积一并检查。
3. **原生认证。** 用官方 account 接口读取安全状态；账户/额度不等于组织资格。无需 Merforge API key，但仍需用户自己的有效 Codex 登录。认证由原生机制持有；不把 auth 文件、token、账户邮箱或完整环境上传组织、传给 Renderer 或写进诊断。组织独立运行目录使用的认证方式必须经所选版本验证；若需另行原生登录就明确提示，不复制整个用户 home 或历史，也不自动替用户登录/退出。
4. **驱动而非伪装模型。** Codex 原生执行器作为插件驱动，经统一 create/resume/send/cancel/read 能力路由；复用 Agent、Session、工具和远程展示。内建 loop 的模型/工具循环继续由原实现拥有。多后端不争夺 factory，不产生两个活跃 Agent 或 Session writer。若必须改 loop 的注册接线，同时更新 `docs/architecture.md`，不把组织业务放进 loop。
5. **日志与原生历史。** 同一逻辑 Session 绑定一个当前 backend/thread，thread/turn/item/request ID 使用品牌类型。应用送入 Codex 的输入、方法/上下文/工具 schema、配置版本、工具参数结果、人工答复、终态及续聊决定先持久后发出。原生 rollout 留在本机独立存储，通过官方 read/export 能力核验可重建的实际上下文；不能把仅应用转录说成完整模型日志。禁用并验证未记录的原生记忆、外部配置注入、插件/MCP 和隐式历史；若仍有模型可见内容无法记录，不通过相应准入。新增必需 Session 事件更新 schema/类型、读取者、投影和目录；只在结构格式变化时增加 SESSION_FORMAT_VERSION，不无条件加版本或忽略事件。
6. **持久性与幂等。** 原子预留 Session/thread 关联、稳定输入 ID 和发送意图。发送超时先核对官方 thread/turn 与本地回执，未知副作用保留 `unknown`；不得重发或自动新开 thread。恢复必须核对账户/runtime/cwd/归属/授权版本及日志基线。跨后端继续在首版通过明确新建关联会话和可审阅交接输入完成，不把 API 历史静默塞入原生 thread；fork 不冒充原生历史复制。
7. **当前 turn 与终态。** 严格按绑定的 thread/turn 接纳事件；恢复历史、旧 turn、无关联 item 不结束新运行。`turn/completed` 的状态是终态依据，末条消息/进程 exit 0/空闲不能替代；支持空文本但有已验证工具结果的完成情形。终态先持久，清理错误另记，不把成功翻成失败。usage 缺失标未知，不捏造 token、API 价格或订阅费用。
8. **能力按模式声明。** 普通个人原生执行只承诺 Codex 已验证的权限；选择受控工作流或组织模式时，原生 shell/file/MCP/subagent、背景终端及其他未桥接动作必须在运行时禁用并验证。不能证明时拒绝该模式。动态工具桥接走真实 `ctx.tools` 管线/guard/作用域，绝不直接调用绕过许可的文件 helper。规划只开放澄清、查询、评估及草案，不开放执行工具。
9. **人的决定。** 模型只能提出计划和待确认动作。批准、接受、委托、开始、提交、验收、驳回和最终交付仍经既有固定真人动作。协议请求绑定当前人/窗口/Session/thread/turn/版本、超时与撤销；未知请求拒绝。回答不自动续跑，断线/睡眠/退出/撤权销毁旧答复资格；组织等待使用持久 Inbox，不借 Codex 审批放宽组织授权。
10. **组织外部资格。** 现有 model/endpoint policy 必须显式扩展为后端与能力策略；Codex 自身模型请求/重试、工具调用与出站行为不可观测或不可限额时不宣称具备逐请求控制。必须由 runtime 提供可验证逐动作 hook，或由独立隔离层实现相等限制；否则拒绝该能力。账号凭据留在员工设备，任务当前 read、精确版本、依赖、接受、委托、租约及预算共同准入。撤权阻止新动作，已在途副作用不承诺回滚。
11. **配置与代码纪律。** 准备、RPC、首条进度、执行、人工等待、取消和销毁限额是验证过的 Config 字段，不硬编码成测试 hook。贡献经 `ctx.effect()`/`ctx.on()`，waterfall 调 `next()`；跨进程 JSON 校验，同进程类型值不加无谓防御；不新增 `as unknown`，不创建 Agent Notes。
12. **验证归属。** 助理只进行静态检查、纯逻辑/Host/私有 IPC/HTTPS/SQLite/JSONL 及无窗口产物测试；禁止拉起页面、Playwright、浏览器自动化或 GitNexus。可见 Desktop、原生登录、真实 Codex 与双平台/三机验收交用户。工程、发行、真实模型和产品验收分别记录，不能互相替代。

## 主阶段状态表

`completed` 仅表示相应阶段的工程验收已满足；未运行的真实模型、平台和可见验收单独记录在该阶段。

| 阶段 | 主题 | 主要目标 | 状态 | 实际产出 | 备注 |
| --- | --- | --- | --- | --- | --- |
| Phase 1 | 协议与能力核验 | 固化运行时、日志、工具禁用和消费者接口 | pending | — | 组织隔离与逐动作控制是硬门槛 |
| Phase 2 | 共用 Codex runtime | 传输、进程、账号/模型、持久 thread | pending | — | 依赖 Phase 1；保持 one-shot 行为 |
| Phase 3 | 日志与对话驱动 | 多后端路由、Session、发送/流/重开 | pending | — | 依赖 Phase 2 |
| Phase 4 | 个人 Desktop 接入 | 无 API key 选择 Codex、持续对话和配置 | pending | — | 依赖 Phase 3 |
| Phase 5 | 个人工作流与人工请求 | 受控方法/工具、审批/等待、停止/恢复 | pending | — | 依赖 Phase 4；不实现 7C 自动识别 |
| Phase 6 | 组织后端资格 | 外部策略、有限许可、预算与固定传输 | pending | — | 依赖 Phase 1、5 的能力证据 |
| Phase 7 | 组织 Codex 执行 | 独立上下文/日志、逐动作桥接和真实证据 | pending | — | 依赖 Phase 6；不合格能力拒绝启动 |
| Phase 8 | 组织 Desktop 消费 | 选择/运行/待处理/提交及后续 7C 接口 | pending | — | 依赖 Phase 7；已有任务可独立验证 |
| Phase 9 | 组合与故障回归 | 个人/组织双后端、隔离/取消/恢复回归 | pending | — | 依赖 Phase 8；7C 可用时加组合验证 |
| Phase 10 | 发行与验收交接 | 闭包/build/smoke、真实 Codex 验收剧本 | pending | — | 依赖 Phase 9；不自动公开发布 |

## Phase 1：协议、兼容版本与消费者核验

目标：确定真实可支持的模式和接口，避免后续把“能发 prompt”误当作安全的应用后端。

产出：`docs/codex-backend.md`；兼容 schema/协议 fixtures 与聚焦探测测试；必要的架构、Session 格式和现有 provider README 修订。列出 Service Definition / Provider / Consumer，拟设共享 `packages/subagent/codex-runtime` 与驱动 `packages/core/agent-codex`，只有实际角色与依赖确认后创建，不预建空包。

验收清单：

- [ ] 核对固定 payload 的 initialize、account/read、model/list、thread/start/resume/read、turn/start/interrupt 与终态字段；实验能力显式声明，未知方法拒绝。
- [ ] 固化 backend 选择/继承、单 factory 路由、单 writer、Agent 公共方法能力、inbox/turn 语义与所有者；不支持的 steering/fork/附件类型明确拒绝。
- [ ] 给出受控工具禁用原生工具、MCP、skills、memory 及模型请求限额的可执行证据方案；不能只凭提示词确认隔离。
- [ ] 固化个人 native/受控模式与组织能力表，认证/独立 home/历史、model-visible 日志和重开核对规则；逐一列出剩余硬门槛。
- [ ] 明确已有组织 model policy 的变更、7C 的可替换后端接口及不依赖 7C 的验收路径。

助理验证：源码与所选版本 schema/fixtures、无网络假 app-server 探测；不读取认证文件或启动真实模型。用户检查：审阅后端范围、工具限制及需要登录的原生环境。依赖：无；个人和组织能力分别记录，不能用个人可行掩盖组织限制。

实际完成：未开始；执行后记录文件、检查、跳过项、偏离与下一阶段。

## Phase 2：共用传输、运行时状态与持久 thread

目标：让 one-shot 委派和持续驱动共享可靠的官方协议实现，各自保留自己的行为。

产出：Phase 1 确认的 codex-runtime 定义/提供者、schema/解析、subprocess 生命周期与能力快照；`subagent-codex` 的必要迁移；package exports/依赖/构建闭包/tsconfig paths 和 README。

验收清单：

- [ ] initialize/initialized、请求关联、线帧上限/错误、启动失败、stdout EOF 与子进程退出分别可诊断；未知服务端请求安全拒绝。
- [ ] 安全账号/可用模型/effort 读取有明确缓存与失效，分页完整；配置变化和限额/认证失败不默默复用旧可用状态。
- [ ] 持久 thread 与 ephemeral one-shot 明确区分，当前 thread/turn 事件严格过滤；发送请求前保存意图并返回可核对标识。
- [ ] stop 先 interrupt，超时后由 subprocess owner 分级终止并 await done；停监听、进程树退出和资源释放达到静止。
- [ ] 原 one-shot 终态、最终文本选择、环境清理、取消和安全诊断回归通过；不扩大它的工具或恢复能力。

助理验证：JSON-RPC/进程与 fake app-server 聚焦测试、既有 provider 回归、相关类型/局部 lint/exports/依赖门禁；不启动真实 Codex。用户检查：无单独 GUI 项。依赖：Phase 1。

实际完成：未开始；执行后填充。

## Phase 3：多后端对话驱动、Session 日志与恢复

目标：Codex 不依赖内建 API 模型即可驱动同一应用会话，查询和展示从可核验的日志恢复。

产出：agent-codex、Phase 1 定义的选择/创建路由；`agent`、`session`、`session-persistence`/投影的必要事件与消费者；`api/session-controller` 的发送/控制/跟随接线；所有受影响的 Session query/fork/导出/typert 声明与文档。

验收清单：

- [ ] create/resume/send/cancel/read 不要求 LLM route 的凭据；只选择一个 driver，未配置 Codex 不影响既有 API 会话。
- [ ] 输入/运行时选择/上下文及 schema 先落盘后发出，完成/失败/取消及工具请求可重建；流式 delta 与持久结算区分，重开不重复消息。
- [ ] Session/thread 准备、日志锁和发布失败有回滚或恢复记录；晚到创建响应不产生孤立可执行 thread。
- [ ] 发送断线、read 失败、进程丢失和未决副作用呈现 unknown；确认前不重放；resume 失败不自动新建 thread。
- [ ] API↔Codex 切换明确新会话与交接范围，fork/搜索/上传/导出均保留既有隔离及能力限制；原生历史和应用索引一致性可独立核对。

助理验证：真实 Session/JSONL/Remote 与 fake app-server 组合，双发送/多窗口/冷重开/取消竞争与纯投影测试；相关类型/事件/JSDoc/投影门禁。用户检查：后续 Phase 4 统一验证。依赖：Phase 2。

实际完成：未开始；执行后填充。

## Phase 4：个人 Desktop 后端选择与多轮交互

目标：用户从 Desktop 选择已登录 Codex，在未配置应用 API key 时正常发送、停止和续聊。

产出：session-controller catalog 与类型、`personal-project` Bot 默认选择/schema/迁移、`ui-personal`、`ui-input`、`ui-chat`、locale；Desktop profile/Host/预加载及打包消费者。具体组件沿现有 slot 接入，产品文案归 typed locale。

验收清单：

- [ ] 后端与模型/effort 选择来自实际 catalog；可继承 Bot 默认值，显式 Session 选择优先；旧 API 模型配置与会话不丢失。
- [ ] Codex 选择不触发 API key 表单或后台 API 调用；缺登录/runtime/模型时显示准确原因与用户可操作步骤。
- [ ] 文字和受支持的工具过程/终态接入同一会话展示、列表/查询/归档；至少两轮以及关闭重开有稳定关系。
- [ ] 不支持的图像/上传/steering/fork 在发送前拒绝，UI 与 Host 同步核验；不能只禁用按钮。
- [ ] 选择别的后端、项目 cwd/Bot 归属变化不把旧 native thread 沿用到新配置，不泄露其他会话历史。

助理验证：catalog/选择迁移/纯 UI 投影及 Host Remote 测试，相关 Client/Host 类型、局部 lint、i18n 和资源构建；不拉起页面。用户检查：无应用 key 的普通问答、两轮上下文、重开、停止、Bot 默认值和 API 后端回归。依赖：Phase 3。

实际完成：未开始；执行后填充。

## Phase 5：个人受控工作流、人工请求与继续

目标：Codex 使用现有方法与工具完成任务规划/获准执行，同时保留精确版本审批和可恢复的人工作答。

产出：runtime 动态工具/人工请求桥、agent-codex scoped tools 消费者、personal-workflow 和 skill-dev-workflow 的方法/上下文接线、现有 interaction 与 Client 请求 presenter；更新权限和能力 README。

验收清单：

- [ ] 显式增强模式中 Codex 调用 workflow_assess/propose，结构化计划进入现有唯一写入者；无内部 API 模型参与，simple/clarify/complex 仍受既有资格限制。
- [ ] 动态工具参数在协议入口校验，调用穿过真实 tools 管线、Bot/Skill 许可、计划版本/执行预算；原生未桥接动作经运行时证据禁用。
- [ ] 模型建议不批准计划、不自动领取/执行；实际文件操作产出有 guard 记录和真实哈希，不信任模型自报。
- [ ] 原生提问/审批绑定准确请求与当前所有者，旧答复/重复答复/未知权限请求拒绝；回答与继续分开，挂起请求重开可核对。
- [ ] 停止/超时/退出/HMR 清理全部所属请求、进程及背景工具；未确认副作用先核对基线，用户明确继续后才 resume。

助理验证：真实工具管线+存储+假协议的计划/审批/撤权/取消/产物测试；关键拒绝路径及销毁测试；相关静态检查。用户检查：选择 Codex 后显式规划 CSV 任务、审阅批准、获准执行、人工答复与继续，检查真实文件；默认自动识别仍属于 7C。依赖：Phase 4 和 Phase 1 的受控工具证据。

实际完成：未开始；执行后填充。

## Phase 6：组织外部后端策略、许可与传输

目标：让组织权威明确区分 API 模型和 Codex 运行资格，不借旧 model permit 放行原生执行器。

产出：`organization` 后端/能力策略、执行配置/许可/动作种类/schema、单调 SQLite 迁移与关系校验；`organization-api`、`organization-connection`、Desktop 固定 IPC 类型；`docs/organization-execution.md`、备份/格式文档。

验收清单：

- [ ] API endpoint 策略保持原语义；Codex 配置独立记录 runtime/model、隔离方式、工具集合和可执行预算，不保存本机账号/token/home 路径。
- [ ] 有效任务版本/依赖/read/接受/有限委托/设备租约及实际 runtime 能力相交准入；策略/版本/身份变化阻止新增动作。
- [ ] model 调用/重试与工具动作采用可验证许可及核算；禁止将 turn 上限宣传成逐模型请求预算，能力不足时在启动前拒绝。
- [ ] 迁移、回执、重复领取、旧设备结果、unknown 核对和恢复审计覆盖新增持久关系；历史 API Run 可读且不被转换。
- [ ] 固定 HTTPS/native/IPC 命令具备当前 generation、nonce、签名和顶层窗口检查，不向 Renderer 开放 JSON-RPC 或任意出站代理。

助理验证：真实 SQLite/HTTPS/native 的并发、迁移、备份恢复、撤权及许可边界测试；类型、配置/事件/JSDoc 与受影响不变量门禁。用户检查：后续 Phase 8 统一检查配置入口。依赖：Phase 1、5；若所选 runtime 无法兑现许可/隔离，标 blocked 并保留个人完成记录。

实际完成：未开始；执行后填充。

## Phase 7：组织 Codex Run、隔离工具与交付证据

目标：已有组织任务能在员工设备通过 Codex 执行，继续复用 Phase 7A 的交付闭环。

产出：organization-execution 的显式 backend dispatch、隔离 codex consumer、runtime/guard/人工请求/证据接线与私有 Host IPC；必要的工具桥、JSONL 事件和执行恢复关系。

验收清单：

- [ ] 从获准任务快照、明确本机输入和组织允许方法构建 Codex 上下文；个人 sessions、Bot 记忆、用户全局指令/Skill/MCP 不隐式进入。
- [ ] 独立组织 namespace、运行 home 和 Session/thread 绑定；个人搜索/fork/上传/恢复拒绝，组织共享历史不含员工原始对话。
- [ ] 每次实际受控工具/model 动作前复核许可、预算/lease；绕行 shell/MCP/子代理和背景工具在真实组合中拒绝，不以沙箱只限制写入替代读/网络控制。
- [ ] 断线/休眠/撤权/停止阻止新动作，await 所属进程静止；重连不自动继续，已在途结果按原历史结算规则保留。
- [ ] 人工等待进入既有持久 Inbox，答案绑定准确资格；完成不自动上传/提交/验收；员工明确提交实际文件与哈希，下发人验收/返工/目标核验沿原固定动作。

助理验证：真实 Loader/HTTPS/SQLite/JSONL/文件工具+假 app-server 的 Run/交付与故障组合；独立文件读取核验产物，双 owner/权限裁剪和跨域历史负例。用户检查：员工 Codex 执行、停止、人工答复、提交和下发人验收/驳回；无需新 API key。依赖：Phase 6。

实际完成：未开始；执行后填充。

## Phase 8：组织 Desktop 展示及 7C 接口衔接

目标：已有组织任务从应用明确选 Codex 到交付全链可操作，后续目标对话复用同一后端。

产出：ui-organization 的 Assignment/Execution/HumanRequest/Delivery/Acceptance/Integration 消费者、后端配置/能力展示、locale 和 Remote/native 类型；7C 计划/已存在实现中必要的后端接口说明与适配。

验收清单：

- [ ] 真人责任人、执行后端、设备、模型、能力限制、当前版本、Run/待谁处理/产物分别展示；选 Codex 不要求填写 API endpoint/key。
- [ ] 开始/停止/继续/提交/验收都是现有权威动作，失败草稿/unknown 回执不重复发送；身份变化与迟到响应隐藏旧内容。
- [ ] Codex 进度及权限/输入请求用纯 presenter 和持久 metadata，原始协议和 stderr 不直接作为共享 UI 内容。
- [ ] 7C 的后端准入不能写死 HTTP/key；无任务规划仍只给有限规划工具，真实分配由人确认。若 7C 尚未实现，仅完成定义及已有任务消费者，不创建重复组织对话模块。
- [ ] API 后端的有界文件执行、人工介入和交付展示继续可用；不因支持 Codex 顺带开放 API Run shell。

助理验证：权限/身份/事件的纯投影与固定操作测试、局部类型/lint/i18n/Client 构建；不启动页面。用户检查：工作台现有任务 Codex 选择及操作全链；7C 可用后另检查对话入口同样选择。依赖：Phase 7；7C 未完成不是已有任务路径的阻塞条件。

实际完成：未开始；执行后填充。

## Phase 9：组合回归、取消恢复与能力拒绝

目标：验证单独测试无法覆盖的完整链路，记录清楚哪些模式已经兑现。

产出：`apps/desktop-host/tests` 的无页面个人/组织 Codex 组合回归、runtime 故障 fixtures、one-shot/API 回归证据；能力矩阵及阶段文档修订。

验收清单：

- [ ] 未提供应用 API key、禁止 API 模型出站的测试环境完成个人两轮、显式规划/审批/执行/重开；请求计数证明没有内部模型兜底。
- [ ] 已有组织 CSV 任务以两个独立成员走完许可、执行、人工介入、实际成果、提交、验收、驳回返工与集成；共享历史不含私人 transcript。
- [ ] 覆盖初始化/线程准备失败、恢复历史串流、重复终态、没有最终文本、终态后 cleanup 错误、进程崩溃、取消超时、未知 RPC、人工答案过期、失联/撤权和半完成绑定。
- [ ] 检查原生未桥接工具、隐藏上下文/跨组织配置、非允许模型、绕行出站与预算超限真实拒绝；只在实际可验证环境填写通过。
- [ ] 7C 已完成时增加“关闭强拆、自然目标、自动建树、对话内分配、员工 Codex 执行”组合；尚未完成则记录未运行，不宣布完整自然对话闭环通过。

助理验证：聚焦组合和已有 API/one-shot 回归、相关静态门禁；模型使用确定性协议替身，产物由独立读取者检查。用户检查：Phase 10 的真实 Codex 与可见剧本。依赖：Phase 8；不默认跑全仓测试，不把替身测试称为真实产品验收。

实际完成：未开始；执行后填充。

## Phase 10：发行闭包、无窗口 smoke 与用户验收交接

目标：交付可安装的运行时和可复核的双平台/三机剧本，不留下只有源码可用的接入。

产出：Desktop 闭包/签名/打包资源及必要 NOTICE 更新、无窗口 built smoke、`docs/codex-backend-acceptance.md`；后端/组织协议、overview 与 roadmap 的真实状态。

验收清单：

- [ ] `pnpm run build`、受影响的应用入口/组合/闭包/依赖/exports/类型/i18n/JSDoc/事件门禁通过或如实记录失败，不绕过基线问题。
- [ ] 普通 Node/Electron Node mode 通过私有 Host 与实际打包 resolver 的无窗口 smoke；协议可用 fake peer，真实平台 payload 启动/模型调用另行验证，不混记。
- [ ] 剧本区分 macOS/Windows 的固定 runtime 版本、登录方式、账户/额度、受控工具/网络限制、真实两轮/文件产物/取消/冷重开及缺登录/协议不支持负例。
- [ ] 三机双成员验证组织权限、日志隔离、租约失效和人工交付；7C 未完成时只验已有任务路径，完整目标对话另列依赖。
- [ ] 实际未运行的真实模型、Windows、可见和三机检查列为待用户验证；不得因 build 或本机单平台成功扩大支持声明。

助理验证：按前述范围进行 build、无窗口 smoke 和静态门禁，报告仅实际运行的命令；不拉起 Desktop 页面或真实模型。用户检查：本人原生登录的真实 Codex 交互、平台隔离、可见请求/错误与三机交付。依赖：Phase 9；用户侧检查默认不阻塞工程记录，但支持声明必须以实测为据。

实际完成：未开始；执行后填充。

## 关键链路日志

使用 `ctx.logger` 与现有组织 action 日志，新增长期诊断采用 `component=codex event=<name>`，可含 sessionId/runId/threadId/turnId/requestId/operationId、runtimeVersion、配置摘要、status/category、durationMs 与可用的 exitCode/signal；ID 仍受各日志的可见权限裁剪。

| 阶段 | 需要诊断的链路 | 记录时点 |
| --- | --- | --- |
| Phase 2–3 | runtime resolve → spawn → handshake → thread 绑定 → turn → 结算 → dispose | entry/ready/rejected/error/terminal/cleanup；终态与清理分开 |
| Phase 3–5 | 输入持久 → send → 流 → 受控工具 → 人工请求 → resume 核对 | 输入 receipt、工具许可/结果、请求建立/失效、历史一致/unknown；不逐 token 打日志 |
| Phase 6–8 | native 身份/lease → 后端资格 → 动作许可 → guard → 证据 → 提交 | 当前代次与拒绝原因、许可/预算/撤权、真实 actionId、证据 digest；复用组织现有日志 |
| Phase 9–10 | 日志/原生历史/共享 Run 的独立核验、payload smoke | 冲突类别、拒绝能力、runtime/平台和检查结果 |

禁止诊断日志记录 API key、auth/token、完整环境、邮箱、原始私聊/提示词/工具大包、用户绝对目录及 stderr 原文。模型可见内容写入受保护的 Session/原生本机日志，不写一般诊断或组织共享 Run。临时协议排障如确需开启，必须 opt-in、裁剪及限额，交付前关闭；上述关键事件保留长期使用。

## 执行规则

- `execution mode: manual`
- `automatic start phase: none`
- `automatic stop phase: none`
- `conversation relay: off`
- 计划评审：待用户；尚无阶段执行授权。

1. 新计划先评审，创建本文件不启动 Phase 1。后续执行先读取本文、overview、当前用户要求及适用 AGENTS；改 `packages/` 前读 architecture，生命周期/并发/销毁前读 defensive-patterns。
2. “执行 Phase X”只执行该阶段，包含明确单阶段命令时该轮不推进下一阶段；不改变既有自动模式，除非用户也要求变更。“继续”先重检有关 blocked 的解除条件，随后选择首个 in_progress，否则首个 pending；依赖未完成且不可隔离时停止报告依赖。
3. manual 完成所选阶段的检查、阶段完成记录、唯一状态表和 overview 同步后停止。auto 只有用户看过已存在计划并明确授权连续做到完成时启用，两个自动边界均为 none；逐阶段记录后继续，不再询问。
4. auto_until 只有计划存在后的明确连续范围/停止位置授权才启用。执行前保留原话，验证并记录包含首尾的具体阶段；省略起点时用当前 in_progress，否则首个 pending，按数量指令映射主表顺序。终点早于起点、遗漏依赖或映射不唯一时保留原模式并澄清；单独“执行 Phase 5”不等于“执行到 Phase 5”。
5. 每次自动选阶段前重读当前模式、范围、状态与依赖，先标 in_progress。auto/auto_until 遇到重大产品歧义、不可替代的人工/外部前置、新权限/凭据、验证失败无安全修复或用户暂停才停止；blocked 记录解除条件并保留自动范围。非阻塞用户可见检查记待验，不自动停在每阶段。
6. auto_until 不选择范围外阶段；范围全部完成且必要交付返回验证满足后恢复 manual、清空两个边界为 none、记录授权终点已达到并停止。已完成阶段不重跑；终点完成不能替代前序依赖完成；交付受阻保留原模式/范围。
7. 仅实际执行证明某阶段过大、风险或验证无法界定时，先把该阶段最小拆成 A/B，更新主表、详情、验收和次序，再施工；不为整齐预拆，不改无关编号。授权原阶段终点映射其最后子阶段，只有用户点名子阶段才在那里停止。
8. 每阶段完成在其详情记录实际文件、检查命令/结果、跳过项、偏离、风险/待用户验收与下一阶段；主表只给短摘要。同步 overview；公共接口/流程变化同步对应 README/拥有文档和生成目录，不创建重复全局完成记录。
9. relay 默认关闭；本计划不创建后继聊天、worktree relay 或后台自动执行。后续只有用户明确要求此计划跨聊天自动接力时，读取指定 Skill 的 relay/worktree-return references，先补齐授权、批次、所有权和必要交付字段再启用。
10. 不自动 commit、push、发布、安装 runtime、替用户登录或改变原生账号配置。验证遵循本计划的无页面约束；所有支持结论以实际证据为准。

本计划暂不需要任务专用 executor Skill；后续用本文和 dev-goal-workflow-meta-skill 即可续接。评审后可明确指定“执行 Phase 1”、“自动完成剩余阶段”或“自动执行 Phase 1 到 Phase 5 后停下”，分别对应单阶段、auto 和 auto_until；后两种模式必须在执行前写入授权与有效范围。
