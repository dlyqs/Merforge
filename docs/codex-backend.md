# Codex 后端协议与消费规则

本文拥有产品 Phase 7B 的后端接口方向和固定运行时能力证据；执行状态见[实施计划](codex-backend-plan.md)。Desktop 是唯一应用入口。Phase 1–2 提供协议核验与共用 runtime，主对话接线属于 Phase 3–4。

## 固定版本与证据等级

官方 payload 为 `@openai/codex@0.153.4`。本机离线执行 `--version` 得到 `codex-cli 0.153.4`，执行 `app-server generate-json-schema --experimental --out <temporary-directory>` 生成官方 JSON schema；没有运行真实 app-server、读取认证文件或调用模型。裁剪后的字段、required 与相关枚举记录在 [`protocol-0.153.4.json`](../packages/subagent/codex-runtime/tests/fixtures/protocol-0.153.4.json)。聚焦测试分别生成 experimental 与 stable schema，比较字段与稳定面可用性，升级时必须重新核验。schema 支持表示协议存在，不等于登录、隔离、计费或平台行为验证通过。

| 方法/事件 | 0.153.4 字段及消费者规则 |
| --- | --- |
| `initialize` → `initialized` | 显式发送 `experimentalApi` 和 `requestAttestation: false`；返回平台字段及本机 `codexHome`，后者仅留 Host。完成 handshake 才发业务 RPC |
| `account/read` | `refreshToken: false`；`requiresOpenaiAuth` 与可空 `account`。只输出 `none/apiKey/chatgpt/amazonBedrock` 和认证要求；不输出 email、token、plan 或 home |
| `model/list` | `data`、可空 `nextCursor`；读取完整分页，支持 effort 与默认 effort 来自原生 catalog；缓存限时、认证/限额/配置变更失效 |
| `thread/start` | 明确 `ephemeral`；持久模式必须显式协商 `experimentalApi: true` 才能指定 `historyMode: legacy` 和 `allowProviderModelFallback`（两字段不在 stable schema）；显式 model、cwd、approvalPolicy 与 `allowProviderModelFallback: false`；返回配置必须匹配 |
| `thread/read` | `threadId`、`includeTurns`；返回 thread/cwd/cliVersion/ephemeral/historyMode/turns。legacy 历史用于应用重开核对；拒绝分页或裁剪的历史，不能当完整模型上下文 |
| `thread/resume` | 只接受已经 read 核对的同一 ID、cwd、model、runtime 与 legacy 历史；不接受 `path/history` 替换，不自动创建新 thread |
| `turn/start` | text input、threadId、`clientUserMessageId`、model、effort；client ID 是核对标识，不是上游幂等承诺；发送前 await 消费者持久意图 |
| `turn/interrupt` | threadId + turnId；停止先请求 interrupt，等待准确终态，期限后关闭监听并由 subprocess owner 终止整个范围、await done |
| `turn/completed` | threadId + turn.id，status 为 `completed/interrupted/failed/inProgress`；只有前三者是终态。进程 exit、末条消息或旧 turn 不结束当前 turn |
| `item/completed`、`item/agentMessage/delta` | 匹配准确 thread/turn；item ID 品牌化。迟到旧 turn 或其他 thread 事件丢弃，响应前事件限额缓冲后再按返回 ID 接纳 |
| 动态工具与人工请求 | `dynamicTools`、`item/tool/call`、`item/tool/requestUserInput` 需要实验准入；当前共用 runtime 不开放。未知服务端 request 固定拒绝，不能借实验开关自动放行 |

不向 Renderer 或业务消费者开放通用 RPC（Host 底层 transport 仅供协议实现共用）、CustomArgs、PATH fallback、任意二进制路径、原生登录修改或自动安装。one-shot 保留现有权限模式、ephemeral 单 turn、最终回答选择和安全诊断；共享传输与进程 owner，不扩大其恢复或工具能力。

## 模式与硬门槛

| 能力 | 个人 native | 个人受控工作流 | 组织 Run |
| --- | --- | --- | --- |
| 持久 text thread、显式 model/effort、多轮/interrupt | schema + 假协议/进程测试；真实模型待用户 | 同左，但不能以此获得执行资格 | 同左，但不能以此获得执行资格 |
| 原生登录与配置 | 本机原生机制拥有；有效登录待用户 | 独立 home 认证与上下文核验未通过 | 员工本机独立 home 认证未通过 |
| shell/file/MCP/skills/memory/subagent 禁用 | 不承诺禁用，也不宣称 Harness guard 覆盖 | 未验证，拒绝该模式 | 未验证，拒绝该模式 |
| 模型请求/重试逐动作许可与预算 | 不承诺逐请求控制 | 未验证 | 未验证，不能用 turn 数冒充请求预算 |
| 完整模型可见日志 | 原生 rollout + 应用输入核对仍待 Phase 3/5；应用转录不是完整日志 | 必须验证无隐式注入 | 必须验证隔离与所有逐动作许可 |
| 真人审批、steering、fork、图像/附件 | 当前 runtime 拒绝；逐项另行准入 | Phase 5 前拒绝 | Phase 6–7 准入前拒绝 |

受控和组织资格当前为 **不支持**，不是退化为 native。生成 schema 的 `config` 字典、read-only sandbox 或动态工具列表不能证明关闭全部原生工具或完整记录上下文。后续证据方案：在临时独立 home 与 cwd 中设置带唯一标记的用户/project 配置、AGENTS、skills、memory、MCP 和插件；用本地可观察模型 fixture 收集真实请求工具 schema 与上下文，分别尝试 shell/file/search/MCP/subagent/背景动作，检查工具缺席且执行处拒绝；在模型请求与重试派发点验证撤权、许可消耗和预算，在 macOS/Windows 验证进程/出站隔离。核验必须观察真实协议请求和实际文件/网络行为，不能依靠模型自报或提示词。现有 schema 没有为每一次内部模型请求提供可验证的 Harness permit hook；缺少 runtime hook 或独立隔离等价实现时，Phase 6/7 必须 blocked。

## Service Definition / Provider / Consumer 与所有者

`packages/subagent/codex-runtime` 的类型定义固定 RPC、品牌 thread/turn/item/input ID、能力、账号模型快照、持久意图与终态。其实现提供官方固定 payload、线帧/请求关联、subprocess 生命周期及持久 thread 操作。现有 `subagent-codex` 消费共用传输、固定命令和清理，继续拥有一次性委派策略。Phase 3 的 `agent-codex` 才是持久对话消费者，当前不预建空包或挂进 Desktop。

Phase 3 保留 `AgentRegistry` 的唯一 factory slot：由一个 router factory 委派到 backend-keyed driver，API loop 注册为 `harness-api`，Codex driver 注册为 `codex`。router 在 Session prepare/load 时解析且持久选择；不能注册第二个竞争 factory。driver 必须完成现有 unpublished setup/commit、caller fiber/parent ownership、collision 检查、created/disposed 配对与有序 quiescence。一个 Session 当前只有一个 driver 和一个持久 handle writer；runtime 只写原生历史，不直接写 Harness Session。

持久选择为判别联合：`harness-api {provider, model}` 或 `codex {runtimeVersion, model, effort, mode}`。创建优先级是显式 Session 选择 → Bot 默认选择 → 现有 API 默认值。没有选择事件的旧 Session 解析为 API；resume 只能使用当前持久选择，显式冲突拒绝。API↔Codex 切换创建关联新 Session，交接内容可审阅并先记录；不继承原生 thread，也不静默转换 API 历史。Bot、cwd、账号、runtime 或授权变化要求重核对；缺能力/模型/认证明确失败，没有 API fallback。

Agent 公共能力按 driver 返回：`followup`/下一 turn inbox 支持 text；`cancel` 和 owned `dispose` 保持 drain；`whenIdle` 只表示生命周期静止，不证明单消息成功。steer/下一 step 注入、clear、fork seed、图片、附件和尚未桥接工具在 Host 入口拒绝；UI 后续消费同一能力。`inject` 上下文必须先进入 Session 事件，再合并到已记录输入，不得绕过日志；模型、effort 修改只在显式新选择及安全空闲边界发生。所有现有直接消费者（session-controller send/control/history/catalog/commands、personal-project Bot、subagent fork、workspace 查询/归档、personal-workflow、skill-dev-workflow、organization-execution）必须在 Phase 3–5 更新，不能仅更新 UI。

## 持久意图、日志与重开

runtime 的 send 操作要求消费者提供稳定 input ID 和异步 `persistIntent`；完成持久化才写 `turn/start`。返回的 receipt 携带 input/thread/turn ID 和独立终态 Promise，终态以通知 status 为准。发送后无回执、EOF、断线或不匹配响应保留 `unknown`；消费者保留预留和意图，不重发、不新建 thread。历史中 `userMessage.clientId` 可用来核对原始 input ID，但只有确切原生 read 证据才能解除 unknown。

Phase 3 新增必需 backend binding、输入 intent/receipt、runtime/context/tool-schema 选择与终态事件，更新 format-current schema、所有 readers、投影、导出、查询及生成目录；不把它们标成 ignorable。结构不变则不增加 SESSION_FORMAT_VERSION。Phase 1–2 未增加 Session 事件或修改读写格式。人答复和工具参数/结果先记录再响应；delta 为短暂 UI 流，结算一次持久文本/工具结果。未知 usage 保持 unknown，不估计订阅费用。

resume 前核对本机账号状态与用户确认的账号代次、runtime、cwd、Project/Bot 归属、授权版本、原生 thread ID 和日志基线；account/read 的安全类别不足以证明账号身份不变。原生 read 的 typed items 不保证包含全部 system/config/memory 注入，不能宣称它重建全部模型请求。共享组织日志只记录许可、action ID、预算、证据 digest 与终态，不包含私聊、prompt、邮箱或用户绝对目录。一般诊断只包含固定 stage/category/HTTP code/进程 outcome，排障原文保持关闭。

## 组织 policy 与 7C 接口

现有 `organization/src/execution-schema.ts` 的 modelPolicy 是 model/endpoint 对，`organization-execution/src/model.ts` 在 HTTP dispatch 前消费 one-use permit 并禁重定向。Codex 不能伪造 endpoint 或复用这个 permit。Phase 6 增加判别 backend policy、runtime/model/capability/isolation/tool-set 与真实动作预算，并更新 SQLite、固定 HTTPS/native/IPC 以及撤权路径。schema 存在 account 或 model 不代表组织资格。

7B 消费显式 personal workflow 和已有精确组织任务：查询/评估/草案工具与获准执行工具分别准入。批准、接受、委托、开始、提交、验收仍由既有真人服务所有。7C 以后调用同一 backend create/resume/send/cancel/read + capability 接口生成规划，不在 loop 内复制组织业务；7B 工程验证不依赖自动识别：用已有 approved task、有效 read/依赖/接受/有限委托/device lease 和预算，分别验证两个 backend 的准入及拒绝。Phase 1–2 完成不表示组织 Codex 或 7C 已实现。
