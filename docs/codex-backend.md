# Codex 后端协议与消费规则

本文拥有产品 Phase 7B 的后端接口方向和固定运行时能力证据；执行状态见[实施计划](codex-backend-plan.md)。Desktop 是唯一应用入口。Phase 1–8 已提供协议核验、共用 runtime、主对话驱动、个人 Desktop 模型/Bot 接入、显式任务管理桥与人工请求，以及组织原生调度、独立转录、执行与已有任务选择。Codex 模式由应用派发输入并接收输出和结果；组织实际 Codex 执行桥与选择 UI 已实现，7C 目标对话仍单独待建。

## 固定版本与证据等级

官方 payload 为 `@openai/codex@0.153.4`。本机离线执行 `--version` 得到 `codex-cli 0.153.4`，执行 `app-server generate-json-schema --experimental --out <temporary-directory>` 生成官方 JSON schema；没有运行真实 app-server、读取认证文件或调用模型。裁剪后的字段、required 与相关枚举记录在 [`protocol-0.153.4.json`](../packages/subagent/codex-runtime/tests/fixtures/protocol-0.153.4.json)。聚焦测试分别生成 experimental 与 stable schema，比较字段与稳定面可用性，升级时必须重新核验。schema 支持表示协议存在，不等于登录、隔离、计费或平台行为验证通过。

| 方法/事件 | 0.153.4 字段及消费者规则 |
| --- | --- |
| `initialize` → `initialized` | 显式发送 `experimentalApi` 和 `requestAttestation: false`；返回平台字段及本机 `codexHome`，后者仅留 Host。完成 handshake 才发业务 RPC |
| `account/read` | `refreshToken: false`；`requiresOpenaiAuth` 与可空 `account`。只输出 `none/apiKey/chatgpt/amazonBedrock` 和认证要求；不输出 email、token、plan 或 home |
| `model/list` | `data`、可空 `nextCursor`；读取完整分页，支持 effort 与默认 effort 来自原生 catalog；缓存限时、认证/限额/配置变更失效 |
| `thread/start` | 明确 `ephemeral`；持久模式必须显式协商 `experimentalApi: true` 才能指定 `historyMode: legacy` 和 `allowProviderModelFallback`（两字段不在 stable schema）；显式 model、cwd、approvalPolicy 与 `allowProviderModelFallback: false`；返回配置必须匹配 |
| `thread/read` | `threadId`、`includeTurns`；返回 thread/cwd/cliVersion/ephemeral/historyMode/turns。legacy 历史用于应用重开核对；拒绝分页或裁剪的历史，不能当完整模型上下文 |
| `thread/resume` | 只接受已经 read 核对的同一 ID、cwd、model、runtime 与 legacy 历史；不接受 `path/history` 替换；响应带 `turnsBackwardsCursor`、`itemsBackwardsCursor` 或 `initialTurnsPage` 时退休连接并保留 unknown，不自动创建新 thread |
| `turn/start` | text input、threadId、`clientUserMessageId`、model、effort；client ID 是核对标识，不是上游幂等承诺；发送前 await 消费者持久意图 |
| `turn/interrupt` | threadId + turnId；停止先请求 interrupt，等待准确终态，期限后关闭监听并由 subprocess owner 终止整个范围、await done |
| `turn/completed` | threadId + turn.id，status 为 `completed/interrupted/failed/inProgress`；只有前三者是终态。进程 exit、末条消息或旧 turn 不结束当前 turn |
| `item/completed`、`item/agentMessage/delta` | 匹配准确 thread/turn；item ID 品牌化。迟到旧 turn 或其他 thread 事件丢弃，响应前事件限额缓冲后再按返回 ID 接纳 |
| 动态工具与人工请求 | `dynamicTools`、`item/tool/call`、`item/tool/requestUserInput` 需要实验准入；显式 callback 消费者支持任务工具、提问、commandExecution/fileChange 一次审批。只接当前 thread/turn、未使用的 RPC/call ID，未知方法固定拒绝；dynamicTools 只在 thread/start 广告，resume schema 没有此字段 |

## Codex 与应用的责任

用户于 2026-10-02 明确：Codex 模式下 Merforge 是调度、任务管理和组织应用，只需传递输入并取得 Codex 的输出与执行结果。Codex 拥有内部模型请求、原生上下文、工具、配置与执行质量；Merforge 拥有后端选择、task/Session/thread 关联、发送意图、输出和终态记录、恢复、停止、访问权限及真人管理动作。不调用内部 API 模型监督 Codex，不要求应用独立验证其任务结果。

应用转录记录发送内容、接收输出和原生工具条目，不宣称是完整模型日志。`thread/read` 的 typed items、raw response 与 `instructionSources` 路径不能重建完整请求；这仍是能力事实，但不再阻塞 Codex 接入。`completeModelLog: false` 继续如实声明。Harness API 后端仍保留自身完整请求日志和工具 guard；这些规则不强加到 Codex 内部执行。

组织应用仍复核是否允许向指定设备派发/继续该任务、转录访问与真人提交/验收。它不要求禁用 Codex 的原生文件、shell、MCP 或子代理，也不宣称逐内部模型请求许可或原生工具限额。应用 task completed 的管理含义由既有真人流程拥有；原生 `turn/completed` 记录的是 Codex 报告的运行终态。


不向 Renderer 或业务消费者开放通用 RPC（Host 底层 transport 仅供协议实现共用）、CustomArgs、PATH fallback、任意二进制路径、原生登录修改或自动安装。one-shot 保留现有权限模式、ephemeral 单 turn、最终回答选择和安全诊断；共享传输与进程 owner，不扩大其恢复或工具能力。

## 当前能力与后续接入

| 能力 | 当前工程事实 | 应用消费方式 |
| --- | --- | --- |
| 持久 text thread、model/effort、多轮/interrupt | schema + fake 协议/进程测试通过；真实模型待用户 | Phase 3–4 已接入个人执行桥、Desktop 选择/Bot 默认值及冷重开/归档 |
| 登录与配置 | 原生机制拥有；有效登录待用户 | 只读取安全可用状态，不输出凭据或邮箱 |
| 原生 shell/file/MCP/skills/memory/subagent | 使用 Codex 自身机制，未声明应用 guard 控制 | 原生执行器负责，任务管理桥只限制应用动作 |
| 内部模型请求/重试限额 | 无应用逐请求 permit | 按有界运行/turn 和停止管理，不宣称逐请求预算 |
| 完整模型可见日志 | `completeModelLog: false` | 应用只声明桥接转录；不作为准入门槛 |
| 任务动作与人工请求 | 固定 callback + Loader/真实工具权限/JSONL 回归通过 | 个人任务评估/提案/报告；组织独立 Run、Inbox 等待及显式继续；命令决定可消费一次，文件审批不能复用缺提案的旧 item |
| steering、fork、图像/附件 | 当前共用 runtime 拒绝 | Host/UI 同步声明不可用 |
| 组织调度资格 | 显式 policy、codex-turn、SQLite v12 与固定签名传输回归通过 | 准许指定设备启动/继续；独立原生执行与已有任务 UI 已接入 |

当前 runtime 仍只接受 `native` 选择，拒绝旧 `controlled` 与 `organization` mode 标签；这描述现有代码，没有据此宣布未来调度桥已实现。后续组织资格由任务管理消费方拥有，不再以“关闭全部原生工具、重建全部内部模型请求”作为实现目标。原生账号、模型效果与 macOS/Windows 运行行为仍需实际验证。

## 个人 Desktop 验收步骤

以下为用户操作步骤，工程验证没有启动页面、替用户登录或调用真实 Codex 模型。

1. 使用本人已登录的本机 Codex 环境，启动 Desktop；Merforge 可以不配置 API key。打开输入框模型菜单，从 Codex 分组选择实际模型，再选择其提供的推理等级。缺登录时先在本机 Codex 完成登录，再在模型列表点击重试；Bot 编辑器使用“刷新模型”。空模型目录提示检查账号访问；运行时启动失败提示检查应用安装，不自动安装或切换 API。
2. 发送一条包含约定信息的文字，再提问该信息，确认两轮上下文、流式文字及 Codex 结果卡。原生工具记录显示在同一会话中；“回合已完成”仅表示 Codex 终态，用量保持未知。
3. 关闭并重新启动 Desktop，打开原会话并继续文字问答，确认原 Project/Bot 归属、记录与上下文；停止正在运行的回合后明确发送下一条。归档后无法发送，恢复归档后可继续原会话。重开核对失败或结果未知时应显示错误，不自动重发或新建 thread。
4. 新建 Bot，选择 Codex 后端、模型和 effort；不选模型应无法保存。由该 Bot 新建会话应继承默认值。编辑 Bot 默认值只影响新会话；已有 native 会话保持自身选择。API Bot 与旧 API 会话继续使用已有 API 配置。
5. 空闲时切换 API↔Codex 或 Codex model/effort，确认打开新的独立会话，源会话历史仍可查看，新会话没有源历史。跨 Bot 或不同 cwd 的 native 会话移动应拒绝并要求新会话；Project 路径编辑只决定新建会话的目录，已有会话保留记录的 cwd。
6. Codex 会话附件/图片、插话和分叉入口应不可用；应用 slash commands 和压缩暂未接入。原生请求出现时，使用现有提问/一次审批入口答复；停止后原请求消失，迟到答复不能继续执行。API 会话检查原有问答、停止、重开行为。

原生工具按 Codex 自身配置和许可执行。Merforge 的 Bot 身份/方向、工具/Skill allowlist 不构成原生工具或上下文约束；应用任务资料通过已接入的显式任务管线派发。macOS 与 Windows 分别检查，不以本机无窗口构建替代平台行为验收。

## 个人任务与人工请求

用户显式开启增强模式后，方法文本进入持久输入；`workflow_assess/propose` 经真实应用工具流水线核验模式版本、Bot Skill/工具许可、归属和任务规则。提案不批准、不领取任务。用户审核并选择任务后，准确计划/任务、验收条件、选定资料和授权进入 Codex 输入。普通对话和规划不调用内部 API 模型。

Codex 的 `workflow_complete` 记录 summary 和每项验收的报告，Evidence 标记 `reportedBy: codex`，files/callIds 为空。应用不独立读成果来保证正确；任务领取、回合结束和显式恢复只核对目录与应用权限，不扫描文件或 Git 内容，也不要求原生任务声明产物。API 的真实工具/文件证据门槛保留。原生 turn 结束而任务未完成时暂停，下一步需用户明确 resume/send；累计时长和 turn 限额不重置。原生任务 handoff 明确拒绝，避免转交 API 或伪装复制原生历史。

动态工具声明只在创建时传入，三项任务声明随原 thread 保留；旧 thread 没有记录所需声明时可继续普通问答，任务增强与执行明确要求新建会话；模式关闭或资格改变时由 executor 拒绝调用。Codex 原生 shell/file/MCP 等继续按自身配置运行，应用工具管线仅拥有任务管理动作。

`item/tool/requestUserInput` 复用当前 Agent 的 userQuestions answerer；secret 问题、重复问题 ID 和非法选项答复拒绝。commandExecution/fileChange 请求复用 approval service，只返回 accept/decline/cancel；不接受长期 session/policy grant。请求绑定 Session/thread/turn/RPC ID，等待上限 `humanTimeoutMs` 默认 300000；stop、terminal、超时、provider 卸载撤销答复资格并 drain 回调写入。请求与本机答复由 required `codex/request`/`codex/request-result` 记录，后者不代表原生远端已收回执。恢复不自动答复或重发旧请求。

用户验收：同一原会话先普通问答，再开启增强模式并要求方案，确认提案仍待审核；选择获准任务并附带资料，检查 Codex 输出与报告结果；分别答复提问、接受/拒绝一次审批、停止待答复请求，再显式继续。可见 Desktop 与真实模型仍待用户检查。

## Multica 的实现参考

本地只读源码快照为提交 `32a396fd520bdbdec2d6cd95b5742da946003ca9`，未运行其产品或复制代码。`server/pkg/agent/codex.go` 启动 `codex app-server --listen stdio://`，initialize 后执行 thread/start 或 thread/resume，再 turn/start；把通知映射为 text/thinking/tool-use/tool-result/status/error，并依据当前 turn 的 completed/failed/interrupted 接收终态。最终 Result 包含 Status、Output、Error、SessionID、DurationMs 与可用 Usage，优先选择 phase 为 final_answer 的助手输出。Supplement 使用 turn/steer，停止使用 turn/interrupt 与进程树清理。

每次 Execute 有独立 app-server 进程，多轮关系通过返回的原生 thread ID 和后续 ResumeSessionID 延续。`execenv/codex_home.go` 准备任务运行目录：共享 auth.json 的符号链接，复制选定配置与 instructions，按 agent/issue-or-chat 维持原生 sessions 存储。它允许 Codex 自身加载原生上下文和工具，没有把完整模型请求可重建设为该 adapter 的发送前置。Merforge 采用相同的派发/事件/结果职责；认证目录处理、恢复失败自动新建和平台权限策略独立选择，不照搬。

## Service Definition / Provider / Consumer 与所有者

`packages/subagent/codex-runtime` 的类型定义固定 RPC、品牌 thread/turn/item/input ID、能力、账号模型快照、持久意图与终态。其实现提供官方固定 payload、线帧/请求关联、subprocess 生命周期及持久 thread 操作。现有 `subagent-codex` 消费共用传输、固定命令和清理，继续拥有一次性委派策略。Phase 3 的 `agent-codex` 是持久对话消费者，已挂入 Desktop 私有 Host。

Phase 3 保留 `AgentRegistry` 的唯一 factory slot：`agent-loop` factory 在 prepare/load 时委派到 `codex` driver；无外部选择时保留 API loop。factory 解析持久选择；不能注册第二个竞争 factory。driver 完成现有 unpublished setup/commit、caller fiber/parent ownership、collision 检查、created/disposed 配对与有序 quiescence。一个 Session 当前只有一个 driver 和一个持久 handle writer；runtime 只写原生历史，不直接写 Harness Session；driver 记录应用发送和接收的内容。

API 选择保持既有 provider/model/reasoningEffort 事件；外部选择通过 `agent/backend {kind: codex, runtimeVersion, model, effort}` 固定。创建优先级是显式 Session 选择 → Bot 默认选择 → 现有 API 默认值。没有后端事件的旧 Session 保留 API；resume 使用持久选择，显式冲突拒绝。API↔Codex 或 native model/effort 切换创建关联新 Session，`agent/backend-handoff` 记录源 Session 和 `scope: none`，不复制历史或原生 thread。Bot、cwd、runtime 或应用授权变化要求重核对；原生账号由 Codex 管理，重开检查登录可用性；缺能力/模型/认证明确失败，没有 API fallback。

Agent 公共能力按 driver 返回：`followup`/下一 turn inbox 支持 text；`cancel` 和 owned `dispose` 保持 drain；`whenIdle` 只表示生命周期静止，不证明单消息成功。steer/下一 step 注入、clear、fork seed、图片、附件、应用 slash commands/compaction 和尚未桥接工具在 Host 入口拒绝；UI 同步禁用附件与 steering、隐藏 fork。当前 Codex driver 拒绝通用 `inject`；显式任务与方法消息由真实 pre-step 管线追加、记录并发送。Codex 自身加载的上下文由原生机制拥有；模型、effort 修改通过空闲时显式新建会话。session-controller、personal-project、查询/归档及 Desktop 已消费该选择；personal-workflow 与 skill-dev-workflow 已消费显式任务和方法管线；organization-execution 已通过独立 Run 转录消费 Codex，见下文组织调度与执行。

## 持久意图、日志与重开

runtime 的 send 操作要求消费者提供稳定 input ID 和异步 `persistIntent`；完成持久化才写 `turn/start`。返回的 receipt 携带 input/thread/turn ID 和独立终态 Promise，终态以通知 status 为准。发送后无回执、EOF、断线或不匹配响应保留 `unknown`；消费者保留预留和意图，不重发、不新建 thread。历史中 `userMessage.clientId` 可用来核对原始 input ID，但只有确切原生 read 证据才能解除 unknown。

Phase 3 已新增必需 backend binding、输入 intent/receipt、runtime/model/effort/cwd 选择、输出/原生工具条目与终态事件，更新 reader 已知事件、投影、导出、查询及生成目录；不把它们标成 ignorable。Session envelope 不变，因此不增加 SESSION_FORMAT_VERSION。原生工具条目接收时进入 Session，终态中未通知的条目补齐；delta 为短暂 UI 流，当前终态结算一次标准助手文本。`codex/recovery` 与已有终态分开；确认回执的迟到输出在原生结果卡显示，不补写已关闭标准回合。未知 usage 保持 unknown，不估计订阅费用。

resume 前核对登录可用性、runtime、cwd、Project/Bot 归属、应用授权、thread ID 和本地回执。account/read 的安全类别不能证明账号身份，应用不要求取得不可用的账号代次；原生 resume 若失败明确报告，不静默新建 thread。应用日志与 thread typed items 可用于识别已发送输入和终态，不声明能够重建所有内部模型上下文。共享组织记录保持现有访问限制，不主动附带私人 transcript、邮箱或凭据；一般诊断只记录固定类别、ID、状态与进程 outcome。

## 组织调度 policy 与 7C 接口

现有 organization modelPolicy 是 model/endpoint 对，API 执行在 HTTP dispatch 前消费 one-use permit 并禁重定向。Codex 原生执行不能伪造 endpoint 或复用该 permit。当前 `executionCodex` policy 默认关闭，显式原生委托与 Run 保存 backend/runtime/model/effort、device-native 方式及 maxTurns/maxDurationMs，在应用启动/继续派发点复核精确任务版本、read/依赖、接受、委托、device lease 和运行限额；不以内部模型或原生工具动作作为 Merforge 可观测的逐动作许可。

SQLite v12 只扩展显式原生调度记录，不转换 v11 API Run；固定签名 HTTPS/native/IPC 承载选择而不传凭据。turn-limit 记录应用调度预算耗尽，最后一个在途 turn 仍可结算；duration-limit 和 authority-lost 持久暂停并取消旧人工请求。组织运行桥和已有任务 Desktop 选择已挂载；派发、转录、原生回合核对和 Inbox 在本机独立保存，真人提交/验收仍使用既有固定动作；详见[组织执行协议](organization-execution.md)。

7B 消费显式 personal workflow 和已有组织任务，通过输入派发、结果接收与应用任务管理工具连接现有服务。批准、接受、委托、开始、提交和验收仍由现有真人动作拥有。7C 后续调用相同 backend create/resume/send/cancel/read + capability 接口，不在 loop 内复制组织业务。7B 基础执行桥不依赖 7C 自动识别；完整组织目标对话仍需两者完成。

7B Phase 7–8 已有任务接口接受显式 `inputs.backend`，其 kind/runtime/model/effort/turn/time 与组织 Run 必须一致；Codex 路径不接受 endpoint，也不解析 API 凭据。7C 后续应复用该选择与固定真人动作，不创建新的组织运行或批准权威。7C 当前仍未实现，7B 已有任务消费不表示无任务目标规划或组织自然目标对话已完成。
