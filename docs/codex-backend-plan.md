# Codex 对话后端与组织外部执行实施计划

本文细化[产品路线图](../ai-native-work-os-product-roadmap.md)的 **产品 Phase 7B**。Phase 1–10 是本计划内部编号，与产品 Phase 7A、7B、7C 分开管理。针对本文说“继续”或“执行 Phase X”时，先读取本文及[工程概览](overview.md)。本计划是阶段状态的唯一来源。

## 目标、歧义检查与范围

2026-10-02 检查时，仓库只有路线图的 7B 概述，没有独立实施计划。用户明确要求参考 `/Users/git_local/multica`，让 Merforge 能用 Codex 替代内部依赖 API key 的模型进行交互。本计划据此扩展原先“应用模型规划，Codex 仅执行”的范围：**用户选择 Codex 后，普通对话、澄清、已有任务规划及获准执行由 Codex 承担，不要求另配 Merforge 模型 API key，也不在后台启动一个 API 模型负责监督。** 现有 API 模型仍是独立可选后端，不强制迁移已有会话。

这是涉及 Agent 驱动、持久日志、工具许可、组织权限及 Desktop 组合的大目标。用户于 2026-10-02 明确授权“请自动完成 phase1-2”；该次执行范围为 Phase 1 至 Phase 2，已完成。用户随后于 2026-10-02 明确授权“[codex-backend-plan.md](docs/codex-backend-plan.md) 请自动完成 phase3-4”；原连续执行范围为 Phase 3 至 Phase 4，包含首尾；用户随后要求完成 Phase 3 后停止，本轮终点已相应缩至 Phase 3。

用户随后于 2026-10-02 明确调整责任：“如果使用 codex 那么任务的完成不需要当前应用来确保……当前应用只需要能作为一个桥传递发送信息给 codex 执行，然后能获取到 codex 的输出和执行结果就行。”该说明替代先前“保留原门槛”的决定。Codex 模式由原生执行器拥有上下文、工具和执行质量；Merforge 拥有任务调度、发送记录、thread 关联、输出/结果接收、停止与组织真人动作。应用记录桥接转录，不要求重建 Codex 内部模型请求，也不以自身工具 guard、逐模型请求许可或独立产物核验作为 Codex 接入前置。API 后端仍遵循既有执行和日志要求。该责任定义继续有效；执行范围以用户最新的 Phase 3 停止要求为准。

范围内：

- 复用已有官方 Codex app-server 传输与 subprocess 管理，提供独立于 one-shot subagent 的持续对话后端；同一 Merforge Session 保留原有项目/Bot、查询、归档及运行展示关系。
- 本机原生登录状态、可用模型与推理选项、流式输出、多轮续聊、停止、重开核对、人工提问/审批、错误分类及 Codex 报告的执行结果。
- 通过调度桥接消费现有 personal-workflow、skill-dev-workflow 与组织任务服务；Codex 使用原生工具执行，计划管理、批准、委托、提交和验收仍归现有服务及真人动作。
- 组织精确任务版本、有限委托、设备租约、启动/继续许可、独立桥接转录、有界运行与撤权停止的 Codex 消费者。
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
| `packages/workspace/personal-project`、`personal-workflow`、`packages/skill/skill-dev-workflow` | Bot 模型默认值当前引用 LLM route；项目/Bot 输入、工具/Skill 限制和计划资格在既有流程检查 | 更新默认后端引用及真实消费者；Codex 桥接仍执行应用任务管理动作的资格检查 |
| `packages/workspace/organization-execution/src/{index,runtime,model,guard}.ts` | 独立 Run/JSONL；内建模型 HTTP 发送前复核；有界文件工具；当前拒绝 shell | Codex 新增原生执行后端与启动/继续调度资格，不伪造 HTTP endpoint，不复用原有 model permit |
| `apps/desktop{,-host}`、`packages/host/organization-connection` | 私有 Host、固定 IPC/native 动作、当前身份 generation、Electron 所有的认证材料 | 维持现有所有者与固定命令，Renderer 不得到通用进程/JSON-RPC/组织代理 |

### Multica 参考

本次只读抽查本地 `/Users/git_local/multica` 的提交 `32a396fd520bdbdec2d6cd95b5742da946003ca9`，没有运行其产品、测试或导入其代码。这与路线图 v0.4 的旧参考快照不同，不覆盖旧对照的核验范围。

- `server/pkg/agent/agent.go`：执行选项、进度流/终态分离、resume 标识、准备超时和取消超时、已观测终态不被清理失败改写。
- `server/pkg/agent/codex.go`：initialize、thread/start/resume、turn/start、流式事件、turn/interrupt、运行中追加输入、最终回答选择和当前 turn 过滤。借鉴失败场景；本计划参考其执行桥职责，保留恢复失败明确报错，不自动新建 thread 的选择。
- `server/internal/daemon/execenv/codex_home.go`：配置/会话目录隔离、模型缓存关联、稳定会话存储。借鉴分离原则，不直接复制整份用户配置、skills、MCP 或 sessions。
- `server/internal/daemon/execenv/codex_sandbox.go`：存在平台相关 `danger-full-access` 选择。该取舍不能照搬；Merforge 的沙箱承诺以自己验证过的能力为准，失败不得自动扩大权限。
- `LICENSE`：上游含附加商业/品牌等条件。本计划仅参考行为与故障设计，实现优先来自本仓库及官方协议，不做逐行翻译。

官方依据：[Codex App Server](https://developers.openai.com/codex/app-server/)（2026-10-02 已读取）。该页描述双向 JSON-RPC、持久 thread、多轮 turn、流式 item、账号/模型发现和客户端工具调用；`dynamicTools` 及部分用户输入接口需要 experimental capability。官方当前页面不能直接证明本仓库固定 0.153.4 支持每一项，实施时必须对所选 payload 的生成 schema 和实际协议复核。该页也限制 app-server 原生认证用于商业/托管服务；本计划只覆盖获准的本地应用场景，若产品部署方式改变，另行评估官方授权接入，不能扩展成共享账号服务。

可行性结论：**Codex 原生执行桥可行。** 由 app-server 拥有模型请求、上下文和原生工具；Merforge 只对调度、关联、发送和已观测结果负责。原生工具不经过 Harness guard，不宣称应用能够重建完整模型请求、逐请求限额或独立验证执行质量。组织路径后续仍须验证任务访问、启动/继续授权、设备租约及停止，但不以禁用所有原生工具作为前置。原生登录、真实模型效果与平台行为另列实测。


## 约束与接口方向

1. **显式后端。** 持久选择区分 `harness-api` 与 `codex`。API 路由保留 provider/model；Codex 引用经过验证的 runtime/model/effort 及能力，不要求 API credential 或虚构 endpoint。未选择的旧会话保持原 API 行为。选择或加载失败明确报错，不自动调用收费 API，不悄悄切模型/后端。
2. **官方运行时。** 优先复用现有固定 payload 和 subprocess seam。可选已安装 CLI 必须由 Config 显式选定位置、核验版本并进入兼容矩阵，不能作为损坏 payload 的隐式 fallback。禁止 shell 拼接、任意 CustomArgs、自动安装/升级和写用户原配置。Desktop 闭包、签名、payload notices 及发行体积一并检查。
3. **原生认证。** 用官方 account 接口读取安全状态；账户/额度不等于组织资格。无需 Merforge API key，但仍需用户自己的有效 Codex 登录。认证由原生机制持有；不把 auth 文件、token、账户邮箱或完整环境上传组织、传给 Renderer 或写进诊断。组织独立运行目录使用的认证方式必须经所选版本验证；若需另行原生登录就明确提示，不复制整个用户 home 或历史，也不自动替用户登录/退出。
4. **驱动而非伪装模型。** Codex 原生执行器作为插件驱动，经统一 create/resume/send/cancel/read 能力路由；复用 Agent、Session、工具和远程展示。内建 loop 的模型/工具循环继续由原实现拥有。多后端不争夺 factory，不产生两个活跃 Agent 或 Session writer。若必须改 loop 的注册接线，同时更新 `docs/architecture.md`，不把组织业务放进 loop。
5. **桥接记录与原生历史。** 同一逻辑 Session 绑定一个当前 backend/thread，thread/turn/item/request ID 使用品牌类型。应用发送的文字、runtime/model/effort/cwd、发送意图与回执、收到的输出/原生工具条目、协议终态及恢复决定持久记录。Codex 拥有内部上下文、原生历史、配置和工具；应用转录不表示完整模型日志，不以完整请求可重建或禁用原生注入作为接入门槛。Codex 的 completed 表示原生 turn 完成，任务提交和真人验收另由任务管理拥有。新增必需 Session 事件更新类型、读取者、投影与目录；结构不变时不增加格式版本。
6. **持久性与幂等。** 原子预留 Session/thread 关联、稳定输入 ID 和发送意图。发送超时先核对官方 thread/turn 与本地回执，未知副作用保留 `unknown`；不得重发或自动新开 thread。恢复核对登录可用性/runtime/cwd/归属及桥接回执；原生账号由 Codex 持有，不把安全账号类别冒充账号身份，也不要求应用确认不可取得的账号代次。跨后端继续在首版通过明确新建关联会话和可审阅交接输入完成，不把 API 历史静默塞入原生 thread；fork 不冒充原生历史复制。
7. **当前 turn 与终态。** 严格按绑定的 thread/turn 接纳事件；恢复历史、旧 turn、无关联 item 不结束新运行。`turn/completed` 的状态是终态依据，末条消息/进程 exit 0/空闲不能替代；支持空文本但有原生工具结果的完成情形。终态先持久，清理错误另记，不把成功翻成失败。usage 缺失标未知，不捏造 token、API 价格或订阅费用。
8. **能力按后端声明。** Codex 使用原生工具、配置和执行许可，Merforge 不宣称其动作经过 Harness guard。未实现的 steering、fork、图像/附件及人工请求在 Host 和 UI 同步拒绝。若 Codex 后续调用 Merforge 的任务管理工具，只有这些应用动作经过既有权限管线；不会据此声称控制原生 shell/file/MCP/subagent。
9. **人的决定。** 模型只能提出计划和待确认动作。批准、接受、委托、开始、提交、验收、驳回和最终交付仍经既有固定真人动作。协议请求绑定当前人/窗口/Session/thread/turn/版本、超时与撤销；未知请求拒绝。回答不自动续跑，断线/睡眠/退出/撤权销毁旧答复资格；组织等待使用持久 Inbox，不借 Codex 审批放宽组织授权。
10. **组织调度资格。** 外部后端策略明确 Codex 是原生执行器，不能复用 API endpoint 或 model permit。启动/继续仍复核当前任务访问、精确版本、接受、委托、设备租约与运行限额；内部模型请求/重试与原生工具由 Codex 拥有，不宣称逐动作许可或逐请求预算。账号凭据留在员工设备。撤权阻止新调度并停止所属运行，已在途副作用不承诺回滚。
11. **配置与代码纪律。** 准备、RPC、首条进度、执行、人工等待、取消和销毁限额是验证过的 Config 字段，不硬编码成测试 hook。贡献经 `ctx.effect()`/`ctx.on()`，waterfall 调 `next()`；跨进程 JSON 校验，同进程类型值不加无谓防御；不新增 `as unknown`，不创建 Agent Notes。
12. **验证归属。** 助理只进行静态检查、纯逻辑/Host/私有 IPC/HTTPS/SQLite/JSONL 及无窗口产物测试；禁止拉起页面、Playwright、浏览器自动化或 GitNexus。可见 Desktop、原生登录、真实 Codex 与双平台/三机验收交用户。工程、发行、真实模型和产品验收分别记录，不能互相替代。

## 主阶段状态表

`completed` 仅表示相应阶段的工程验收已满足；未运行的真实模型、平台和可见验收单独记录在该阶段。

| 阶段 | 主题 | 主要目标 | 状态 | 实际产出 | 备注 |
| --- | --- | --- | --- | --- | --- |
| Phase 1 | 协议与能力核验 | 固化运行时与消费者接口 | completed | 设计、固定版本 schema 与离线核验 | 历史日志/工具门槛已按用户说明修订 |
| Phase 2 | 共用 Codex runtime | 传输、进程、账号/模型、持久 thread | completed | 共用 runtime、one-shot 迁移、110 项回归与 2 项产物 smoke | 原生登录/真实模型/双平台待验；未挂 Desktop |
| Phase 3 | 日志与对话驱动 | 多后端路由、Session、发送/流/重开 | completed | 单 factory native driver、持久意图/回执/结果、停止与恢复 | 聚焦回归/build/无窗口 smoke 通过；真实模型待验 |
| Phase 4 | 个人 Desktop 接入 | 无 API key 选择 Codex、持续对话和配置 | in_progress | 已有 catalog、Bot/UI/Host 接线与测试代码 | 用户要求完成 Phase 3 后停止；保留部分实现，未宣布阶段完成 |
| Phase 5 | 个人工作流与人工请求 | 任务管理桥、审批/等待、停止/恢复 | pending | — | 依赖 Phase 4；不实现 7C 自动识别 |
| Phase 6 | 组织调度资格 | 外部策略、启动/继续许可与固定传输 | pending | — | 依赖 Phase 1、5 |
| Phase 7 | 组织 Codex 执行桥 | 任务派发、独立转录与原生结果 | pending | — | 依赖 Phase 6 |
| Phase 8 | 组织 Desktop 消费 | 选择/运行/待处理/提交及后续 7C 接口 | pending | — | 依赖 Phase 7；已有任务可独立验证 |
| Phase 9 | 组合与故障回归 | 个人/组织双后端、访问隔离/取消/恢复回归 | pending | — | 依赖 Phase 8；7C 可用时加组合验证 |
| Phase 10 | 发行与验收交接 | 闭包/build/smoke、真实 Codex 验收剧本 | pending | — | 依赖 Phase 9；不自动公开发布 |

## Phase 1：协议、兼容版本与消费者核验

Phase 1–2 的清单和完成记录保留当时的工程证据；其中完整模型日志、原生工具禁用及逐模型请求许可的未来准入要求已由本文当前责任定义替代。

目标：确定真实可支持的模式和接口，避免后续把“能发 prompt”误当作安全的应用后端。

产出：`docs/codex-backend.md`；兼容 schema/协议 fixtures 与聚焦探测测试；必要的架构、Session 格式和现有 provider README 修订。列出 Service Definition / Provider / Consumer，拟设共享 `packages/subagent/codex-runtime` 与驱动 `packages/core/agent-codex`，只有实际角色与依赖确认后创建，不预建空包。

验收清单：

- [x] 核对固定 payload 的 initialize、account/read、model/list、thread/start/resume/read、turn/start/interrupt 与终态字段；实验能力显式声明，未知方法拒绝。
- [x] 固化 backend 选择/继承、单 factory 路由、单 writer、Agent 公共方法能力、inbox/turn 语义与所有者；不支持的 steering/fork/附件类型明确拒绝。
- [x] 给出受控工具禁用原生工具、MCP、skills、memory 及模型请求限额的可执行证据方案；不能只凭提示词确认隔离。
- [x] 固化个人 native/受控模式与组织能力表，认证/独立 home/历史、model-visible 日志和重开核对规则；逐一列出剩余硬门槛。
- [x] 明确已有组织 model policy 的变更、7C 的可替换后端接口及不依赖 7C 的验收路径。

助理验证：源码与所选版本 schema/fixtures、无网络假 app-server 探测；不读取认证文件或启动真实模型。用户检查：审阅后端范围、工具限制及需要登录的原生环境。依赖：无；个人和组织能力分别记录，不能用个人可行掩盖组织限制。

实际完成（2026-10-02）：新增 `docs/codex-backend.md`，确定唯一 router factory、单 Session writer、选择/能力/日志及组织 policy 消费者方向；新增 `codex-runtime/tests/fixtures/protocol-0.153.4.json` 与离线 schema 回归。`pnpm exec vitest run packages/subagent/codex-runtime/tests/protocol.spec.ts` 通过（1 文件/1 测试），使用固定 payload 生成 schema，无真实 app-server/模型/认证读取。个人 native 协议可实施；受控工具隔离、完整模型输入核对及逐模型请求许可未证明，能力拒绝，Phase 5–7 准入仍需补证。没有修改 Session 格式或预建 agent-codex。原引用的 `.agents/skills/dsh-prose-standard/SKILL.md` 已不存在，按 AGENTS 的具体文字规范检查，不创建替代 Skill。下一阶段：Phase 2，已在授权范围内进入。

## Phase 2：共用传输、运行时状态与持久 thread

目标：让 one-shot 委派和持续驱动共享可靠的官方协议实现，各自保留自己的行为。

产出：Phase 1 确认的 codex-runtime 定义/提供者、schema/解析、subprocess 生命周期与能力快照；`subagent-codex` 的必要迁移；package exports/依赖/构建闭包/tsconfig paths 和 README。

验收清单：

- [x] initialize/initialized、请求关联、线帧上限/错误、启动失败、stdout EOF 与子进程退出分别可诊断；未知服务端请求安全拒绝。
- [x] 安全账号/可用模型/effort 读取有明确缓存与失效，分页完整；配置变化和限额/认证失败不默默复用旧可用状态。
- [x] 持久 thread 与 ephemeral one-shot 明确区分，当前 thread/turn 事件严格过滤；发送请求前保存意图并返回可核对标识。
- [x] stop 先 interrupt，超时后由 subprocess owner 分级终止并 await done；停监听、进程树退出和资源释放达到静止。
- [x] 原 one-shot 终态、最终文本选择、环境清理、取消和安全诊断回归通过；不扩大它的工具或恢复能力。

助理验证：JSON-RPC/进程与 fake app-server 聚焦测试、既有 provider 回归、相关类型/局部 lint/exports/依赖门禁；不启动真实 Codex。用户检查：无单独 GUI 项。依赖：Phase 1。

实际完成（2026-10-02）：

- 新增 `packages/subagent/codex-runtime` 的类型、传输、固定命令/进程清理、账号模型解析与持久 thread 实现，以及 README、manifest、tsconfig 和离线 fixtures。固定 0.153.4；分页、缓存失效、准确 thread/turn 过滤、意图先持久后发送、未知发送/准备状态、interrupt 与独立清理结果均有回归。`onDiagnostic` 只发布固定生命周期事实，进程结果通过独立 Promise 观察。
- `subagent-codex` 迁移到共用传输/命令/清理；保留 ephemeral、权限、最终文本和安全诊断语义。新增部署 Config `maxFrameBytes`。按本文隐私要求，原始 stderr 从转发 Host 改为排空后丢弃；对应测试验证秘密和路径不进入 Host 或返回诊断。
- 同步 `docs/codex-backend.md`、architecture、overview、subagent 组及 provider README、依赖/lockfile/tsconfig paths。模块图正常生成，包含原文件遗漏的已有组织/工作流节点；notices 生成无变更。配置目录因已有组织 schema 导入问题，只用同一导出生成器更新两个 Codex 包对应条目。

实际通过的检查：

- `pnpm exec vitest run packages/subagent/codex-runtime/tests packages/subagent/subagent-codex/tests/subagent-codex.spec.ts packages/subagent/subagent-codex/tests/jsonrpc.spec.ts packages/subagent/subagent-codex/tests/real-product-cleanup.spec.ts`：7 文件、110 测试通过；真实 subprocess 回归使用离线假服务器。
- `pnpm exec tsc -b packages/subagent/codex-runtime packages/subagent/subagent-codex`；另以 `node --input-type=module` 调用 TypeScript API，按根 paths 检查两个包的源码及变更测试，无相关诊断。
- `pnpm exec oxlint packages/subagent/codex-runtime/src packages/subagent/codex-runtime/tests packages/subagent/subagent-codex/src packages/subagent/subagent-codex/tests/subagent-codex.spec.ts`。
- `pnpm exec tsdown --filter @deepseek-ai/dsh-codex-runtime --filter @deepseek-ai/dsh-subagent-codex --logLevel warn`。
- `pnpm exec vitest run --config vitest.e2e.config.ts packages/subagent/codex-runtime/tests/built-runtime.e2e.ts packages/subagent/subagent-codex/tests/loader-composition.e2e.ts`：2 文件、2 测试通过；普通 Node 消费发布入口和真实 subprocess owner，核对持久意图、历史/重开、环境清理与退出；Loader 组合不启动真实 Codex 或窗口。
- `pnpm run verify-tsconfig-paths`、`pnpm run verify-package-meta`、`git diff --check`。用 `node --import tsx --input-type=module` 调用 JSDoc/依赖收集器并筛选两个 Codex 包，均无违规。`pnpm exec publint packages/subagent/codex-runtime` 通过；现有 provider 的 publint 仅有原有 `./src/*` 未发布警告。
- `pnpm run gen-module-graph`、`pnpm run gen-third-party-notices`；配置目录的局部生成使用 `gen-config-catalog` 的导出函数及两个包的临时副本。

全仓门禁的既有问题（未绕过，未计为通过）：`verify-export-jsdoc` 的 `OrganizationLoginSession.read/save` 缺描述；`verify-package-dependencies` 的 file-upload `assertPersonalSessionId` 导入未分类；`verify-package-invariants` 的 ui-personal/session-format/session-format-current/session-format-catalog README 缺 omission reason；`verify-no-unknown-casts` 的 `commands-create-fork.host.spec.ts:29` 既有断言。全量 `gen-config-catalog` 拒绝 organization-api 的 `./tls.ts` 和 organization 的 `./schema.ts` 本地导入，未修无关包。

偏离与待验：固定 stable schema 不含 `historyMode`/`allowProviderModelFallback`，故持久操作要求显式 `experimentalApi: true`；关闭时只开放 handshake/账号模型发现，不放行工具或真人请求。没有修改 Session 格式，没有启动真实 Codex app-server、读取认证文件、调用真实模型、打开页面或升级 payload。原生登录、实际订阅可用性、真实推理及 macOS/Windows 隔离待用户；受控工具、完整模型日志和逐请求许可仍未准入。未运行全套测试或完整 Desktop 发行构建，当前证据仅覆盖本阶段 runtime/provider。

下一阶段：Phase 3（Session 日志与对话驱动），尚未开始。Phase 1–2 授权终点已达到；本地工程交付完成，恢复 manual，自动边界清空，relay 关闭。

## Phase 3：多后端对话驱动、Session 日志与恢复

目标：Codex 不依赖内建 API 模型即可驱动同一应用会话，查询和展示从可核验的日志恢复。

产出：agent-codex、Phase 1 定义的选择/创建路由；`agent`、`session`、`session-persistence`/投影的必要事件与消费者；`api/session-controller` 的发送/控制/跟随接线；所有受影响的 Session query/fork/导出/typert 声明与文档。

验收清单：

- [x] create/resume/send/cancel/read 不要求 LLM route 的凭据；只选择一个 driver，未配置 Codex 不影响既有 API 会话。
- [x] 应用输入/运行时选择/发送意图先落盘后发出，完成/失败/取消及收到的原生工具条目可读取；流式 delta 与持久结算区分，重开不重复消息。
- [x] Session/thread 准备、日志锁和发布失败有回滚或恢复记录；未确认创建保持 unknown，不执行或再次创建 thread。
- [x] 发送断线、read 失败、进程丢失和未决副作用呈现 unknown；确认前不重放；resume 失败不自动新建 thread。
- [x] API↔Codex 切换明确新会话与交接范围，fork/搜索/上传/导出均保留既有隔离及能力限制；原生 thread 回执和应用索引可独立核对。

助理验证：真实 Session/JSONL/Remote 与 fake app-server 组合，双发送/多窗口/冷重开/取消竞争与纯投影测试；相关类型/事件/JSDoc/投影门禁。用户检查：后续 Phase 4 统一验证。依赖：Phase 2。

实际完成（2026-10-02）：

- 新增 `packages/core/agent-codex`，由原 `agent-loop` 唯一 factory 创建，保留单 Session writer、未发布维护、创建回滚及作用域销毁。共用 inbox/assistant stream 移到 `agent`，API 路径行为保留。新增必需 backend、handoff、thread preparing/bound、send intent/receipt、item、turn-result、recovery 和 diagnostic 事件、投影及读取目录；Session envelope 和 SQLite 版本不变。
- 真实 Cordis Loader、Session/JSONL 和确定性协议替身覆盖排队两轮、冷重开第三轮、创建冲突/发布回滚、发送前 flush、缺回执不重发、已确认回执的终态恢复、read/resume 失败、工具结果无最终文字、取消后显式续聊、缺登录后重试、flush 失败清理和模型目录查询卸载清理。迟到结果保留在 native 卡，不补写已关闭的标准回合。保留固定协议分页拒绝修复，不调用内部 API 模型监督或兜底。
- session-controller 的持久选择、独立替换会话及 `scope: none` 交接已实现；Host 拒绝 native 附件/上传、steering、fork 和应用 slash command/compaction。个人归属变更同时检查冷会话。标题使用首条用户文字，避免辅助 API 调用。任务管理工具、人工请求与组织派发属于后续阶段。
- 聚焦回归命令：`pnpm exec vitest run packages/core/agent-codex/tests packages/core/agent-loop/tests packages/subagent/codex-runtime/tests packages/subagent/subagent-codex/tests/subagent-codex.spec.ts packages/subagent/subagent-codex/tests/jsonrpc.spec.ts packages/api/session-controller/tests/session-models.host.spec.ts packages/client/file-upload/tests/file-upload-http.host.spec.ts packages/workspace/personal-project/tests/personal-project.spec.ts packages/session/session-title-llm/tests/llm.spec.ts packages/interaction/commands/tests/commands.spec.ts packages/compaction/compaction-basic/tests/manual-compaction.spec.ts packages/compaction/command-compact/tests packages/client/ui-chat/tests/conversation-node-definitions.client.spec.ts packages/client/ui-model-selection/tests/native-directory.client.spec.ts`，42 文件/769 项通过。之后新增模型发现卸载测试，`pnpm exec vitest run packages/core/agent-codex/tests` 24 项通过。native InputBar 的 jsdom 聚焦用例通过。
- `pnpm run build`、`node apps/desktop-host/tests/codex-built-smoke.mjs` 通过。built smoke 使用私有 Host manifest 解析已构建 driver，再走 Loader、两轮发送、JSONL 和进程清理；不启动 Electron 窗口、不读取认证或调用真实模型。相关 `tsc -b`、局部 `run-oxlint`、`verify-client-ui-i18n`、`verify-package-meta`、`gen-scoped-events --check`、`verify-cordis-config`、`verify-application-entrypoints` 和 `git diff --check` 通过；`gen-tsconfig-paths`、`gen-persistence-catalog` 已更新。
- 全局门禁的既有问题如实保留：`verify-export-jsdoc` 的 OrganizationLoginSession read/save 文档；`verify-package-dependencies` 的 file-upload → assertPersonalSessionId 分类；`verify-package-invariants` 的三处 Session-format README；`gen-config-catalog` 的 organization schema 相对导入；`gen-cordis-api` 的 integrationReceiptSchema 文档。已对照原 HEAD 复验的 Client/Session 基线失败为 fork workspace ancestor 断言及 InputBar/InputMatrix 的旧 plan/goal 提示断言，不扩展本轮修复范围。新 API/配置说明保留在所属 README；全局 API/config 目录生成仍受这些基线问题阻塞。

用户待验：本人原生登录、真实 Codex 模型的两轮上下文/停止/冷重开、macOS/Windows 行为及可见 Desktop。替身与 build 不代表这些检查通过。未运行全仓测试、打包/签名、真实模型或页面；未安装/升级 runtime、修改原生配置、commit/push 或创建 Agent Notes。

下一阶段为 Phase 4。用户随后明确要求“做完 phase3 就先停止”，当前 Phase 3 工程收尾完成后停止，保留已写入的 Phase 4 部分实现，恢复 manual 并清空自动边界。

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

实际进度（2026-10-02）：已写入 Desktop 私有 Host driver 接线、原生 catalog/effort 与错误刷新、Bot 默认 backend、模型选择的新会话交接、native 结果/恢复卡及 UI 附件/steering/fork 限制；部分静态和纯逻辑/Host 用例已随 Phase 3 验证。用户要求 Phase 3 完成后停止，因此保留这些改动，不再推进 Phase 4，也不将本阶段标成 completed。后续明确续接时先审阅当前改动，再完成本阶段验收和文档。

## Phase 5：个人工作流、任务管理桥与人工请求

目标：把应用任务交给 Codex，并接回规划建议、输出、执行状态和需要人的请求；Codex 拥有原生工具和执行质量。

产出：runtime 人工请求桥、agent-codex 的应用任务管理工具消费者、personal-workflow 和 skill-dev-workflow 的派发/结果接线、Client 请求 presenter 与能力文档。

验收清单：

- [ ] 用户显式选择任务后，将任务文字和选定资料发给 Codex；普通对话与规划无需内部 API 模型监督，不实现 7C 自动识别。
- [ ] 如开放 workflow_assess/propose 等应用动作，参数经过真实应用工具管线和任务权限校验；原生文件、shell、Skill/MCP 仍由 Codex 执行，不宣称经过 Harness guard。
- [ ] Codex 的计划建议和执行结果可展示与记录，应用不独立保证结果正确；真人批准、提交和验收沿既有服务。
- [ ] 人工提问/审批绑定当前请求、Session/thread/turn 与窗口；旧答复、重复答复及未知请求拒绝。
- [ ] 停止/超时/退出/HMR 清理所属请求与进程；结果未确认时保留 unknown，继续显式恢复原 thread，不自动重发。

助理验证：真实任务管理/存储/工具管线与假协议的派发、结果、人工请求、停止和过期答复测试；必要静态检查。文件结果验证仅用于测试 fixture，不作为产品对 Codex 结果的质量保证。用户检查：任务派发、Codex 规划/执行、人工请求、停止和继续。依赖：Phase 4；不以禁用原生工具或完整模型日志作为前置。

实际完成：未开始；执行后填充。

## Phase 6：组织后端调度策略、资格与固定传输

目标：组织权威准许员工设备上的 Codex 领取/启动/继续指定任务，保持任务访问与真人流程。

产出：organization 的显式 Codex 后端策略、调度许可和运行限额、必要 SQLite 迁移；organization-api、organization-connection 与 Desktop 固定 IPC 类型；组织执行与备份文档。

验收清单：

- [ ] API endpoint 策略保持原语义；Codex 独立记录 runtime/model 与调度方式，不保存本机账号/token/home。
- [ ] 启动/继续前复核有效任务版本、依赖/read、接受、委托、设备租约及后端允许范围；版本/身份变化阻止新调度。
- [ ] 有界 turn、总运行时间与停止分别记录；不把运行限额宣传为内部模型请求或原生工具预算。
- [ ] 迁移、回执、重复领取、旧设备结果、unknown 与恢复审计覆盖新增持久关系；历史 API Run 不被转换。
- [ ] 固定 HTTPS/native/IPC 具备当前 generation、nonce、签名与顶层窗口检查；Renderer 不获得任意 JSON-RPC 或组织代理。

助理验证：真实 SQLite/HTTPS/native 的迁移、资格、并发、撤权及调度拒绝测试；类型/配置/事件与受影响门禁。用户检查：后续 Phase 8 的配置和调度入口。依赖：Phase 1、5；原生执行质量和每个内部动作由 Codex 负责。

实际完成：未开始；执行后填充。

## Phase 7：组织 Codex Run、派发与结果回传

目标：已有组织任务在员工设备交给 Codex 执行，组织应用接收运行状态与输出，并继续拥有提交/验收流程。

产出：organization-execution 的 backend dispatch、Codex Run 消费者、独立桥接转录、恢复关系与私有 Host IPC；结果/附件及必要任务管理桥。

验收清单：

- [ ] 从获准任务和明确选定的本机资料构造派发输入；应用不主动附带其他私人 Session/Bot 历史。
- [ ] 独立 Run/Session/thread 关联与转录访问权限；个人搜索/fork/上传不跨入组织转录。原生账号和配置留在员工设备。
- [ ] 应用派发和应用任务管理动作复核调度资格；原生文件/shell/MCP/子代理由 Codex 管理，不宣称应用逐动作控制。
- [ ] 失联/休眠/撤权/停止阻止新调度并 await 所属进程退出；重连不自动重发，未知结果明确保留。
- [ ] 人工请求接入现有 Inbox；原生 completed、员工提交、下发人验收分别记录。应用不以 Codex 自报替真人验收，也不独立保证执行结果正确。

助理验证：真实 Loader/HTTPS/SQLite/JSONL 与 fake app-server 的派发、输出、结果、恢复、停止及访问隔离组合；真人提交/验收沿既有固定动作测试。用户检查：员工 Codex 执行、停止、人工答复、提交与下发人验收/返工。依赖：Phase 6；不以完整内部请求日志或原生工具禁用作为准入。

实际完成：未开始；执行后填充。

## Phase 8：组织 Desktop 展示及 7C 接口衔接

目标：已有组织任务从应用明确选 Codex 到交付全链可操作，后续目标对话复用同一后端。

产出：ui-organization 的 Assignment/Execution/HumanRequest/Delivery/Acceptance/Integration 消费者、后端配置/能力展示、locale 和 Remote/native 类型；7C 计划/已存在实现中必要的后端接口说明与适配。

验收清单：

- [ ] 真人责任人、执行后端、设备、模型、能力限制、当前版本、Run/待谁处理/产物分别展示；选 Codex 不要求填写 API endpoint/key。
- [ ] 开始/停止/继续/提交/验收都是现有权威动作，失败草稿/unknown 回执不重复发送；身份变化与迟到响应隐藏旧内容。
- [ ] Codex 进度及权限/输入请求用纯 presenter 和持久 metadata，原始协议和 stderr 不直接作为共享 UI 内容。
- [ ] 7C 的后端选择不能写死 HTTP/key；Codex 原生规划结果接入任务管理，真实分配由人确认。若 7C 尚未实现，仅完成定义及已有任务消费者，不创建重复组织对话模块。
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
- [ ] 检查应用未授权派发、跨组织转录、非允许后端/模型、过期租约与运行限额在调度处拒绝；原生上下文和工具不计为应用可控制的动作。
- [ ] 7C 已完成时增加“关闭强拆、自然目标、自动建树、对话内分配、员工 Codex 执行”组合；尚未完成则记录未运行，不宣布完整自然对话闭环通过。

助理验证：聚焦组合和已有 API/one-shot 回归、相关静态门禁；模型使用确定性协议替身，产物由独立读取者检查。用户检查：Phase 10 的真实 Codex 与可见剧本。依赖：Phase 8；不默认跑全仓测试，不把替身测试称为真实产品验收。

实际完成：未开始；执行后填充。

## Phase 10：发行闭包、无窗口 smoke 与用户验收交接

目标：交付可安装的运行时和可复核的双平台/三机剧本，不留下只有源码可用的接入。

产出：Desktop 闭包/签名/打包资源及必要 NOTICE 更新、无窗口 built smoke、`docs/codex-backend-acceptance.md`；后端/组织协议、overview 与 roadmap 的真实状态。

验收清单：

- [ ] `pnpm run build`、受影响的应用入口/组合/闭包/依赖/exports/类型/i18n/JSDoc/事件门禁通过或如实记录失败，不绕过基线问题。
- [ ] 普通 Node/Electron Node mode 通过私有 Host 与实际打包 resolver 的无窗口 smoke；协议可用 fake peer，真实平台 payload 启动/模型调用另行验证，不混记。
- [ ] 剧本区分 macOS/Windows 的固定 runtime 版本、登录方式、账户/额度、原生执行权限、真实两轮/结果回传/取消/冷重开及缺登录/协议不支持负例。
- [ ] 三机双成员验证组织权限、日志隔离、租约失效和人工交付；7C 未完成时只验已有任务路径，完整目标对话另列依赖。
- [ ] 实际未运行的真实模型、Windows、可见和三机检查列为待用户验证；不得因 build 或本机单平台成功扩大支持声明。

助理验证：按前述范围进行 build、无窗口 smoke 和静态门禁，报告仅实际运行的命令；不拉起 Desktop 页面或真实模型。用户检查：本人原生登录的真实 Codex 交互、平台隔离、可见请求/错误与三机交付。依赖：Phase 9；用户侧检查默认不阻塞工程记录，但支持声明必须以实测为据。

实际完成：未开始；执行后填充。

## 关键链路日志

使用 `ctx.logger` 与现有组织 action 日志，新增长期诊断采用 `component=codex event=<name>`，可含 sessionId/runId/threadId/turnId/requestId/operationId、runtimeVersion、配置摘要、status/category、durationMs 与可用的 exitCode/signal；ID 仍受各日志的可见权限裁剪。

| 阶段 | 需要诊断的链路 | 记录时点 |
| --- | --- | --- |
| Phase 2–3 | runtime resolve → spawn → handshake → thread 绑定 → turn → 结算 → dispose | entry/ready/rejected/error/terminal/cleanup；终态与清理分开 |
| Phase 3–5 | 输入持久 → send → 原生输出/工具条目 → 人工请求 → resume 核对 | 输入 receipt、原生结果、应用动作资格、请求建立/失效、回执一致/unknown；不逐 token 打日志 |
| Phase 6–8 | native 身份/lease → 调度资格 → 派发 → Codex 结果 → 提交 | 当前代次与拒绝原因、许可/预算/撤权、真实 actionId、证据 digest；复用组织现有日志 |
| Phase 9–10 | 日志/原生 thread 回执/共享 Run 的独立核验、payload smoke | 冲突类别、拒绝能力、runtime/平台和检查结果 |

禁止诊断日志记录 API key、auth/token、完整环境、邮箱、原始私聊/提示词/工具大包、用户绝对目录及 stderr 原文。模型可见内容写入受保护的 Session/原生本机日志，不写一般诊断或组织共享 Run。临时协议排障如确需开启，必须 opt-in、裁剪及限额，交付前关闭；上述关键事件保留长期使用。

## 执行规则

- `execution mode: manual`
- `automatic start phase: none`
- `automatic stop phase: none`
- `conversation relay: off`
- 执行授权：2026-10-02 用户原授权自动完成 Phase 3–4；随后要求“做完 phase3 就先停止”，将本轮终点改为 Phase 3。Phase 3 已完成，按最新要求停止并恢复 manual、清空自动边界；Phase 4 部分改动保留，relay 关闭，不进入 Phase 5。

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
